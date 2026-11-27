import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { AnalysisService } from "../runtime/service.ts";
import { DiskStore, hash } from "../runtime/store.ts";
import { Rules } from "../runtime/game/rules.ts";
import type { GameAction } from "../src/modules/play/domain.ts";
import type { ReviewReport } from "../src/modules/play/review.ts";

const directory = mkdtempSync(join(tmpdir(), "af-cache-measure-"));
const service = new AnalysisService(new DiskStore(directory, "local"));
const rules = new Rules();
const call = async <T>(name: string, input: Record<string, unknown> = {}) => {
  const r = await service.executeAsync(name, {
    workspaceId: "local",
    requestId: crypto.randomUUID(),
    expectedRevision: service.state.revision,
    ...input,
  });
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.data as T;
};
try {
  const deck = [..."23456789TJQKA"].flatMap((r) =>
    [..."cdhs"].map((s) => r + s),
  );
  const actions: GameAction[] = [
    { actor: 1, kind: "call" },
    { actor: 0, kind: "check" },
    ...[0, 1, 2].flatMap(() => [
      { actor: 0, kind: "check" as const },
      { actor: 1, kind: "check" as const },
    ]),
  ];
  const state = await rules.replay({ players: 2, deck, actions });
  const samples: {
    hand: number;
    reportReadyMs: number;
    cacheReadMs: number;
    evaluated: number;
    total: number;
  }[] = [];
  let warmJobs = 0,
    journalBefore = 0;
  for (let number = 1; number <= 31; number++) {
    const hand = {
      id: crypto.randomUUID(),
      number,
      revision: 0,
      players: 2,
      hero: 0,
      deck,
      actions,
      marks: [4],
      state,
      created: new Date().toISOString(),
    };
    const payload = {
      version: "riverline-hands/1",
      hands: [hand],
      studies: [],
    };
    await call("game_import", {
      backup: { payload, checksum: hash(payload), privateReplayData: true },
    });
    const start = performance.now();
    let report = await call<ReviewReport>("game_review_report", {
      handId: hand.id,
    });
    for (
      let i = 0;
      ["queued", "running"].includes(report.status) && i < 1000;
      i++
    ) {
      await wait(10);
      report = await call("game_review_report", { handId: hand.id });
    }
    if (report.status !== "completed")
      throw Error(`Report ${number}: ${report.status}`);
    const elapsed = performance.now() - start;
    const cached = performance.now();
    await call("game_review_report", { handId: hand.id });
    if (number === 1) {
      warmJobs = Object.keys(service.state.real!.jobs).length;
      journalBefore = statSync(join(directory, "journal.jsonl")).size;
    } else
      samples.push({
        hand: number,
        reportReadyMs: elapsed,
        cacheReadMs: performance.now() - cached,
        evaluated: report.nodes.filter((n) => n.gapBb !== undefined).length,
        total: report.nodes.length,
      });
  }
  const sorted = samples.map((s) => s.reportReadyMs).sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const jobs = Object.keys(service.state.real!.jobs).length;
  if (jobs !== warmJobs || p95 > 1000)
    throw Error(
      `Cache gate failed: jobs ${warmJobs}->${jobs}, report P95 ${p95}`,
    );
  const result = {
    scope:
      "30 warm-cache backend reports of the same public four-street checkdown; only bounded turn/river reference, not 100BB preflop or full-range flop scoring; not browser TTI",
    sampleCount: samples.length,
    p95ReportReadyMs: p95,
    p50ReportReadyMs: sorted[14],
    nativeJobsBefore: warmJobs,
    nativeJobsAfter: jobs,
    journalGrowthBytes:
      statSync(join(directory, "journal.jsonl")).size - journalBefore,
    samples,
  };
  mkdirSync(".artifacts/af", { recursive: true });
  writeFileSync(
    ".artifacts/af/cache-evidence.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, samples: undefined }));
} finally {
  rules.close();
  service.close();
  rmSync(directory, { recursive: true, force: true });
}
