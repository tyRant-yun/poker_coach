import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore } from "../../runtime/store.ts";
import type {
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
} from "../../src/modules/analysis/real-domain.ts";
import type { TurnPath } from "../../contracts/solver/turn.ts";
const manifest = JSON.parse(
  readFileSync("benchmarks/solver/flop-cases.json", "utf8"),
);

test(
  "AF04: real three-street case/spec/job/native paging, chance navigation, fixed browsing and backup recovery",
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "flop-application-"));
    let service = new AnalysisService(new DiskStore(dir, "local"));
    const measurements: { tool: string; elapsedMs: number; path?: unknown }[] =
      [];
    const call = async <T = any>(
      name: string,
      extra: Record<string, unknown> = {},
    ): Promise<T> => {
      const started = performance.now();
      const r = await service.executeAsync(name, {
        workspaceId: "local",
        requestId: crypto.randomUUID(),
        expectedRevision: service.state.revision,
        ...extra,
      });
      measurements.push({
        tool: name,
        elapsedMs: performance.now() - started,
        ...(extra.path ? { path: extra.path } : {}),
      });
      assert.equal(r.ok, true, JSON.stringify(r));
      return (r as { data: T }).data;
    };
    try {
      const input = manifest.cases[3];
      const c = await call<RealCase>("real_case_create", {
        name: "翻牌三街真实适配测试",
        board: input.board,
        pot: input.pot,
        stack: input.stack,
        betPercent: "50",
        turn: {
          kind: "hu-flop/5",
          flopBets: input.flopBets,
          turnBets: input.turnBets,
          riverBets: input.riverBets,
        },
        ranges: input.ranges.map((r: Record<string, number>) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * 10000])),
        ),
      });
      const spec = await call<RealSpec>("real_spec_create", {
        caseId: c.ref.id,
      });
      assert.equal(spec.scope, "given-range-flop-subgame");
      assert.equal(spec.valueModel, "exact-flop-turn-river-runouts");
      assert.equal(
        (await call("real_preflight", { specId: spec.ref.id })).supported,
        true,
      );
      const j = await call<RealJob>("real_analysis_start", {
        specId: spec.ref.id,
      });
      let current = j;
      for (
        let i = 0;
        i < 250 &&
        !["completed", "failed", "cancelled"].includes(current.status);
        i++
      ) {
        await wait(50);
        current = await call("real_analysis_get", { jobId: j.ref.id });
      }
      assert.equal(current.status, "completed", current.error);
      const solution = await call<RealSolution>("real_solution_load", {
        solutionId: current.result!.id,
      });
      assert.equal(solution.queryModel, "native-flop-paged/5");
      const query = (path: TurnPath, player = 0) =>
        call("real_turn_solution_query", {
          solutionId: solution.ref.id,
          path,
          player,
          combos: [player === 0 ? "JhTh" : "AcAd"],
        });
      const root = await query([]);
      assert.equal(root.node.board.length, 3);
      assert(Math.abs(root.items[0].evBb - 1.0767676767676768) < 0.001);
      const path: TurnPath = [];
      let cursor = root;
      while (cursor.node.kind === "decision") {
        assert(path.length < 8, JSON.stringify({ path, node: cursor.node }));
        const actor = cursor.node.actor;
        const decision = await query(path, actor);
        const index = decision.items[0].allocation.findIndex(
          (f: number, i: number) =>
            f > 0 && decision.node.actions[i] !== "Fold",
        );
        assert(
          index >= 0,
          "declared fixture has a positive non-fold route to a deal",
        );
        path.push({ kind: "action", index });
        cursor = await query(path);
      }
      const chance = await query(path);
      assert.equal(chance.node.kind, "chance");
      assert(
        Math.abs(
          chance.node.chanceCards.reduce(
            (sum: number, c: { probability: number }) => sum + c.probability,
            0,
          ) - 1,
        ) < 1e-6,
      );
      const turnPath: TurnPath = [...path, { kind: "deal", card: "3s" }];
      const turn = await query(turnPath);
      assert.equal(turn.node.board.length, 4);
      const river = await query([
        ...turnPath,
        { kind: "action", index: 0 },
        { kind: "action", index: 0 },
        { kind: "deal", card: "4s" },
      ]);
      assert.equal(river.node.board.length, 5);
      const view = {
        solution: solution.ref,
        path: [],
        turnPath,
        labels: [
          ...path.map((p) =>
            p.kind === "action" ? `行动 ${p.index}` : p.card,
          ),
          "3s",
        ],
        player: 0,
        hand: "JTs",
        hero: "JhTh",
        metric: "ev",
        showAll: false,
        offset: 0,
      };
      await call("real_browse_save", { view });
      const exported = await call("workspace_export");
      const artifact = service.state.artifacts[exported.ref.id];
      const backup = JSON.parse(
        service.store.getBytes(artifact.hash).toString("utf8"),
      );
      await call("workspace_import", { backup });
      service.close();
      service = new AnalysisService(new DiskStore(dir, "local"));
      assert.deepEqual(
        await call("real_browse_get", { solutionId: solution.ref.id }),
        view,
      );
      assert.equal((await query(turnPath)).node.board.length, 4);
      mkdirSync(".artifacts/af", { recursive: true });
      writeFileSync(
        ".artifacts/af/flop-query-evidence.json",
        JSON.stringify(
          {
            sample:
              "F04 fixed one-combo-per-side three-street model; API call durations, not general full-range UI latency",
            measurements,
          },
          null,
          2,
        ),
      );
    } finally {
      service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
