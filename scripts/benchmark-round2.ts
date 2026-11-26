// Isolated local HTTP sampling. Presentation dwell is recorded separately from server latency.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { startRuntime } from "../runtime/server.ts";
import { frameDelay } from "../src/modules/play/presentation.ts";
import type { FramePage, HandView } from "../src/modules/play/domain.ts";
import { Rules } from "../runtime/game/rules.ts";
const directory = mkdtempSync(join(tmpdir(), "riverline-performance-")),
  runtime = startRuntime({ port: 0, directory });
await once(runtime.server, "listening");
const url = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
const samples: Record<string, { ms: number; bytes: number }[]> = {},
  batches: {
    players: number;
    frames: number;
    acted: number;
    dwellMs: number;
  }[] = [];
async function call<T = any>(
  tool: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const session = (await (
    await fetch(url + "/api/analysis/session")
  ).json()) as any;
  const start = performance.now();
  const response = await fetch(url + "/api/analysis/call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Riverline-Session": session.token,
    },
    body: JSON.stringify({
      tool,
      input: {
        workspaceId: session.workspaceId,
        requestId: crypto.randomUUID(),
        expectedRevision: session.revision,
        ...input,
      },
    }),
  });
  const text = await response.text(),
    ms = performance.now() - start,
    r = JSON.parse(text);
  if (!r.ok) throw Error(JSON.stringify(r));
  (samples[tool] ??= []).push({ ms, bytes: Buffer.byteLength(text) });
  return r.data as T;
}
async function frames(h: HandView) {
  let offset: number | null = 0,
    count = 0,
    acted = 0,
    dwellMs = 0;
  while (offset !== null) {
    const p = await call<FramePage>("game_transition_query", {
      handId: h.id,
      handRevision: h.revision,
      batchId: h.transition!.batchId,
      offset,
      limit: 16,
    });
    for (const f of p.items) {
      count++;
      if (f.kind === "player-acted") acted++;
      dwellMs +=
        frameDelay(f, "comfort") +
        (f.kind === "player-acted" && f.actor !== h.hero ? 400 : 0);
    }
    offset = p.nextOffset;
  }
  batches.push({ players: h.players, frames: count, acted, dwellMs });
}
try {
  for (let n = 0; n < 8; n++) {
    let h = await call<HandView>("game_create", {
      players: n % 2 === 0 ? 6 : 2,
    });
    await frames(h);
    for (let i = 0; !h.complete && i < 40; i++) {
      const a = h.legal.find((a) => a.kind === "check" || a.kind === "call")!;
      h = await call<HandView>("game_act", {
        handId: h.id,
        handRevision: h.revision,
        kind: a.kind,
      });
      await frames(h);
    }
    if (!h.complete) throw Error("incomplete performance hand");
  }
  const c = await call("real_case_create", {
      name: "性能采样转牌",
      board: ["2c", "3d", "7h", "9s"],
      pot: 1000,
      stack: 2000,
      betPercent: "100",
      turn: { kind: "hu-turn/3", turnBets: [500, 0], riverBets: [0, 700] },
      ranges: [
        { AcAd: 10000, "5c4c": 10000 },
        { KhKd: 10000, "8c8d": 10000 },
      ],
    }),
    spec = await call("real_spec_create", { caseId: c.ref.id }),
    job = await call("real_analysis_start", { specId: spec.ref.id });
  let done: any;
  for (let i = 0; i < 500; i++) {
    done = await call("real_analysis_get", { jobId: job.ref.id });
    if (["completed", "failed"].includes(done.status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  if (done.status !== "completed") throw Error(JSON.stringify(done));
  const path = [
    { kind: "action", index: 0 },
    { kind: "action", index: 0 },
  ];
  for (let n = 0; n < 24; n++)
    await call("real_turn_solution_query", {
      solutionId: done.result.id,
      path: [
        ...path,
        {
          kind: "deal",
          card: [
            "Ac",
            "Ad",
            "Ah",
            "As",
            "Kc",
            "Kd",
            "Kh",
            "Ks",
            "Qc",
            "Qd",
            "Qh",
            "Qs",
          ][n % 12],
        },
      ],
      player: n % 2,
      limit: 100,
    });
  const stats = Object.fromEntries(
    Object.entries(samples).map(([tool, rows]) => {
      const sorted = rows.map((v) => v.ms).sort((a, b) => a - b),
        quantile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
      return [
        tool,
        {
          n: rows.length,
          medianMs: quantile(0.5),
          p95Ms: quantile(0.95),
          maxMs: sorted.at(-1),
          maxBytes: Math.max(...rows.map((v) => v.bytes)),
        },
      ];
    }),
  );
  const rules = new Rules();
  let allinFrames = 0,
    allinDwellMs = 0,
    allinTraceMs = 0;
  try {
    let offset: number | null = 0;
    const start = performance.now();
    while (offset !== null) {
      const result = await rules.replay({
        players: 2,
        deck: [..."23456789TJQKA"].flatMap((r) =>
          [..."cdhs"].map((s) => r + s),
        ),
        actions: [
          { actor: 1, kind: "raise", amount: 10000 },
          { actor: 0, kind: "call" },
        ],
        trace: { afterActions: 0, includeInitial: true, offset, limit: 16 },
      });
      for (const f of result.trace!.frames) {
        allinFrames++;
        allinDwellMs +=
          frameDelay(f, "comfort") +
          (f.kind === "player-acted" && f.actor !== 1 ? 400 : 0);
      }
      offset = result.trace!.nextOffset;
    }
    allinTraceMs = performance.now() - start;
  } finally {
    rules.close();
  }
  const report = {
    cpu: cpus()[0].model,
    node: process.versions.node,
    threads: 1,
    method:
      "local HTTP including read/parse; session handshake excluded; 8 shuffled passive-policy hands; turn branches exceed LRU8; concurrently running browser regression may affect timings; not SLA",
    stats,
    batches,
    allin: {
      method:
        "separate cold PokerKit helper, all trace pages; dwell computed from public frame types",
      allinFrames,
      allinDwellMs,
      allinTraceMs,
    },
  };
  mkdirSync(".artifacts/round2", { recursive: true });
  writeFileSync(
    ".artifacts/round2/performance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      stats,
      batchCount: batches.length,
      maxBatchActions: Math.max(...batches.map((b) => b.acted)),
    }),
  );
} finally {
  await runtime.close();
  rmSync(directory, { recursive: true, force: true });
}
