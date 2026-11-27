import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore, hash } from "../../runtime/store.ts";
import { GameService } from "../../runtime/game/service.ts";
import { Rules } from "../../runtime/game/rules.ts";
import {
  autoConfiguration,
  referenceRanges,
  actionIndex,
} from "../../src/modules/play/review.ts";
import type { ReviewReport } from "../../src/modules/play/review.ts";
import type { GameAction, HandView } from "../../src/modules/play/domain.ts";

export async function importCheckdown(service: AnalysisService) {
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
  const rules = new Rules();
  try {
    const state = await rules.replay({ players: 2, deck, actions });
    assert(state.complete);
    const hand = {
      id: crypto.randomUUID(),
      number: 1,
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
    const r = await service.executeAsync("game_import", {
      workspaceId: "local",
      requestId: crypto.randomUUID(),
      expectedRevision: service.state.revision,
      backup: { payload, checksum: hash(payload), privateReplayData: true },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    return hand.id;
  } finally {
    rules.close();
  }
}

test(
  "AR: four-street public prefixes, bounded reference ranges, actual native EV, report recovery and information guard",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-review-"));
    let service = new AnalysisService(new DiskStore(dir, "local"));
    const raw = (tool: string, input: Record<string, unknown> = {}) =>
      service.executeAsync(tool, {
        workspaceId: "local",
        requestId: crypto.randomUUID(),
        expectedRevision: service.state.revision,
        ...input,
      });
    const call = async <T>(
      tool: string,
      input: Record<string, unknown> = {},
    ) => {
      const r = await raw(tool, input);
      assert.equal(r.ok, true, JSON.stringify(r));
      return (r as { data: T }).data;
    };
    try {
      const handId = await importCheckdown(service);
      const started = performance.now();
      const facts = new GameService(service.store);
      const inputs = await facts.reviewInputs(handId);
      facts.close();
      assert.deepEqual(
        inputs.map((i) => i.snapshot.board.length),
        [0, 3, 4, 5],
      );
      assert(inputs.every((i) => i.snapshot.revealed.length === 0));
      for (const profile of ["tight", "standard", "wide"] as const) {
        const ranges = referenceRanges(
          inputs[2].root.board,
          inputs[2].snapshot.heroCards,
          0,
          profile,
        );
        assert(ranges.every((r) => Object.keys(r).length <= 128));
        assert(
          ranges.every((r) =>
            Object.keys(r).every(
              (c) => !inputs[2].root.board.some((b) => c.includes(b)),
            ),
          ),
        );
      }
      const altered = structuredClone(inputs[2]);
      altered.prefix = [
        { actor: 0, kind: "raise", amount: 100 },
        { actor: 1, kind: "raise", amount: 200 },
      ];
      assert.throws(() => autoConfiguration(altered, "standard"), /再加注/);
      assert.equal(
        actionIndex(["Check", "Bet(500)", "AllIn(1000)"], {
          actor: 0,
          kind: "raise",
          amount: 501,
        }),
        -1,
      );
      let report = await call<ReviewReport>("game_review_report", { handId });
      for (
        let i = 0;
        ["queued", "running"].includes(report.status) && i < 100;
        i++
      ) {
        await wait(100);
        report = await call("game_review_report", { handId });
      }
      assert.equal(report.status, "completed", JSON.stringify(report));
      assert.equal(report.nodes.length, 4);
      mkdirSync(".artifacts/auto-review", { recursive: true });
      writeFileSync(
        ".artifacts/auto-review/evidence.json",
        JSON.stringify(
          {
            fixture:
              "HU four-street checkdown, fixed deck and public decisions",
            profile: report.profile,
            reportElapsedMs: performance.now() - started,
            nodeResults: report.nodes.map((n) => ({
              street: n.street,
              status: n.status,
              quality: n.quality,
              elapsedMs: n.elapsedMs,
              actions: n.actions,
              gapBb: n.gapBb,
            })),
            limits: { maxSeconds: 8, maxIterations: 5000, automaticNodes: 8 },
            note: "Isolated workspace; includes prefix replay, queue delay, Node commits and native queries. Not a full-range/flop or default large-journal performance guarantee.",
          },
          null,
          2,
        ),
      );
      assert.equal(
        report.nodes.filter((n) => n.status === "completed").length,
        2,
        JSON.stringify(report),
      );
      assert.equal(report.nodes[0].gapBb, undefined);
      assert(
        service.state.exposures.includes("real-analysis:possible"),
        "reading a completed report records reference exposure",
      );
      for (const node of report.nodes.filter((n) => n.status === "completed")) {
        const snapshot = inputs.find(
          (i) => i.sequence === node.sequence,
        )!.snapshot;
        const q = await call<{
          items: { actionEvBb: number[]; allocation: number[] }[];
        }>(
          node.street === 2
            ? "real_turn_solution_query"
            : "real_solution_query",
          {
            solutionId: node.solutionId,
            path: node.street === 2 ? node.turnPath : node.path,
            player: node.player,
            combos: [snapshot.heroCards.join("")],
            inRangeOnly: false,
          },
        );
        assert.deepEqual(
          node.actions!.map((a) => a.evBb),
          q.items[0].actionEvBb,
        );
        assert.deepEqual(
          node.actions!.map((a) => a.frequency),
          q.items[0].allocation,
        );
        if (node.quality === "target-met")
          assert.equal(
            node.gapBb,
            Math.max(
              0,
              Math.max(...q.items[0].actionEvBb) -
                q.items[0].actionEvBb[node.chosenIndex!],
            ),
          );
      }
      const jobsBefore = Object.keys(service.state.real!.jobs).length;
      let cachedReport = await call<ReviewReport>("game_review_retry", {
        handId,
        profile: "standard",
      });
      for (
        let i = 0;
        i < 100 && ["queued", "running"].includes(cachedReport.status);
        i++
      ) {
        await wait(50);
        cachedReport = await call("game_review_report", { handId });
      }
      assert.equal(cachedReport.status, "completed");
      assert.equal(
        Object.keys(service.state.real!.jobs).length,
        jobsBefore,
        "same immutable model reuses completed native solution",
      );
      assert.deepEqual(
        cachedReport.nodes.map((n) => n.solutionId),
        report.nodes.map((n) => n.solutionId),
      );
      const opened = await call<{ sourceId: string; caseId: string }>(
        "game_review_open",
        { handId, decision: report.nodes[3].sequence },
      );
      assert.equal(opened.caseId, report.nodes[3].caseId);
      const requestId = crypto.randomUUID(),
        args = { handId, requestId, expectedRevision: service.state.revision };
      const cancelled = await raw("game_review_cancel", args),
        duplicate = await raw("game_review_cancel", args);
      assert.deepEqual(cancelled, duplicate);
      service.close();
      service = new AnalysisService(new DiskStore(dir, "local"));
      const recovered = await call<ReviewReport>("game_review_report", {
        handId,
      });
      assert.equal(recovered.status, "cancelled");
      assert.equal(recovered.nodes[3].solutionId, report.nodes[3].solutionId);
      const next = await call<HandView>("game_create", { players: 2 });
      assert(!next.complete);
      for (const tool of [
        "game_review_report",
        "game_review_retry",
        "game_review_cancel",
        "game_review_open",
      ]) {
        const denied = await raw(tool, {
          handId,
          ...(tool === "game_review_open" ? { decision: 0 } : {}),
        });
        assert.equal(denied.ok, false);
        if (!denied.ok) assert.equal(denied.code, "INFORMATION_RESTRICTED");
      }
      let current = next;
      for (let i = 0; !current.complete && i < 100; i++) {
        const action = current.legal.find(
          (a) => a.kind === "check" || a.kind === "call",
        )!;
        current = await call<HandView>("game_act", {
          handId: current.id,
          handRevision: current.revision,
          kind: action.kind,
        });
      }
      assert(current.complete);
      const database = new DatabaseSync(join(dir, "hands.sqlite"));
      try {
        assert(
          database
            .prepare("SELECT handId FROM auto_reports WHERE handId=?")
            .get(current.id),
          "terminal action automatically registers a report without a report-read request",
        );
      } finally {
        database.close();
      }
    } finally {
      service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
