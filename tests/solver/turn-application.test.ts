import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore, hash } from "../../runtime/store.ts";
import { allCombos, legalCombo } from "../../src/modules/analysis/content.ts";
import type { Reply } from "../../src/modules/analysis/domain.ts";
import type {
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
} from "../../src/modules/analysis/real-domain.ts";
const manifest = JSON.parse(
  readFileSync("benchmarks/solver/turn-cases.json", "utf8"),
);
function input(index = 2) {
  const c = manifest.cases[index];
  return {
    name: "转牌应用",
    board: c.board,
    pot: c.pot,
    stack: c.stack,
    betPercent: "100",
    turn: { kind: "hu-turn/3", turnBets: c.turnBets, riverBets: c.riverBets },
    ranges: c.ranges.map((r: Record<string, number>) =>
      Object.fromEntries(Object.entries(r).map(([c, w]) => [c, w * 10000])),
    ),
  };
}
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "turn-application-"));
  let service = new AnalysisService(new DiskStore(directory));
  const raw = (tool: string, args: Record<string, unknown> = {}) =>
    service.executeAsync(tool, {
      workspaceId: "local",
      requestId: crypto.randomUUID(),
      expectedRevision: service.state.revision,
      ...args,
    });
  const call = async <T = any>(
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const r = await raw(tool, args);
    assert.equal(r.ok, true, JSON.stringify(r));
    return (r as Extract<Reply, { ok: true }>).data as T;
  };
  const done = async (id: string) => {
    for (let i = 0; i < 1500; i++) {
      const j = await call<RealJob>("real_analysis_get", { jobId: id });
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(j.status)
      )
        return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("turn job timeout");
  };
  const solve = async (value = input()) => {
    const c = await call<RealCase>("real_case_create", value),
      spec = await call<RealSpec>("real_spec_create", { caseId: c.ref.id }),
      job = await call<RealJob>("real_analysis_start", { specId: spec.ref.id }),
      end = await done(job.ref.id);
    assert.equal(end.status, "completed", end.error);
    return {
      c,
      spec,
      solution: service.state.real!.solutions[end.result!.id] as RealSolution,
    };
  };
  const close = async () => {
    service.close();
    for (let i = 0; i < 200 && service.real.busy(); i++)
      await new Promise((r) => setTimeout(r, 10));
  };
  return {
    directory,
    get service() {
      return service;
    },
    raw,
    call,
    done,
    solve,
    close,
    restart: async () => {
      await close();
      service = new AnalysisService(new DiskStore(directory));
    },
  };
}
test(
  "turn application: typed chance paths, actual native branches, immutable inputs and atomic backup/restore",
  { timeout: 20000 },
  async () => {
    const t = setup();
    try {
      const { c, spec, solution } = await t.solve();
      assert.equal(spec.scope, "given-range-turn-subgame");
      assert.equal(solution.queryModel, "native-turn/3");
      assert.deepEqual(solution.nodes, []);
      assert.equal(
        t.service.state.exposures.includes("real-analysis:possible"),
        false,
      );
      const root = await t.call("real_turn_solution_query", {
        solutionId: solution.ref.id,
      });
      assert.equal(
        t.service.state.exposures.includes("real-analysis:possible"),
        true,
        "direct turn queries record exposure even without solution_load",
      );
      assert.equal(root.node.kind, "decision");
      assert.deepEqual(root.node.actions, ["Check", "Bet(500)"]);
      const path = [
        { kind: "action", index: 0 },
        { kind: "action", index: 0 },
      ];
      const chance = await t.call("real_turn_solution_query", {
        solutionId: solution.ref.id,
        path,
      });
      assert.equal(chance.node.kind, "chance");
      assert.equal(chance.node.actor, null);
      assert.deepEqual(chance.node.actions, []);
      assert.equal(chance.items[0].allocation, null);
      assert.ok(
        Math.abs(
          chance.node.chanceCards.reduce(
            (n: number, c: any) => n + c.probability,
            0,
          ) - 1,
        ) < 1e-6,
      );
      assert.ok(
        chance.node.chanceCards.some((c: any) => c.probability < 1 / 48),
      );
      const branch = [...path, { kind: "deal", card: "Ac" }];
      const river = await t.call("real_turn_solution_query", {
        solutionId: solution.ref.id,
        path: branch,
      });
      assert.deepEqual(river.node.board, ["2c", "3d", "7h", "9s", "Ac"]);
      assert.equal(river.node.kind, "decision");
      assert.equal(
        river.items.find((r: any) => r.combo === "AdAc").availability,
        "dead",
      );
      assert.equal(river.items.find((r: any) => r.combo === "AdAc").evBb, null);
      for (const invalid of [
        [0],
        [{ kind: "deal", card: "Ac" }],
        [...path, { kind: "action", index: 0 }],
        [...path, { kind: "deal", card: "2c" }],
      ])
        assert.equal(
          (
            await t.raw("real_turn_solution_query", {
              solutionId: solution.ref.id,
              path: invalid,
            })
          ).ok,
          false,
        );
      assert.equal(
        (await t.raw("real_solution_query", { solutionId: solution.ref.id }))
          .ok,
        false,
      );
      await t.call("real_case_revise", {
        caseId: c.ref.id,
        turn: { kind: "hu-turn/3", turnBets: [0, 0], riverBets: [0, 0] },
      });
      assert.deepEqual(
        (
          await t.call("real_turn_solution_query", {
            solutionId: solution.ref.id,
          })
        ).node.actions,
        root.node.actions,
      );
      const exported = await t.call("workspace_export"),
        a = t.service.state.artifacts[exported.ref.id],
        backup = JSON.parse(t.service.store.getBytes(a.hash).toString());
      await t.call("workspace_reset", { confirmation: "RESET LOCAL ANALYSIS" });
      await t.call("workspace_import", { backup });
      await t.restart();
      assert.deepEqual(
        await t.call("real_turn_solution_query", {
          solutionId: solution.ref.id,
          path: branch,
        }),
        river,
      );
      const bad = structuredClone(backup);
      bad.payload.state.real.cases[c.ref.id].turn.riverBets[1] = 1;
      bad.checksum = hash(bad.payload);
      const revision = t.service.state.revision;
      assert.equal(
        (await t.raw("workspace_import", { backup: bad })).ok,
        false,
      );
      assert.equal(t.service.state.revision, revision);
      await t.call("teaching_begin");
      assert.equal(
        (
          await t.raw("real_turn_solution_query", {
            solutionId: solution.ref.id,
            path,
          })
        ).ok,
        false,
      );
    } finally {
      await t.close();
      rmSync(t.directory, { recursive: true, force: true });
    }
  },
);
test(
  "turn application: measured 16-combo budget, rejects 17 without truncation, cancel/interruption/retry",
  { timeout: 30000 },
  async () => {
    const t = setup();
    try {
      const value = input(),
        combos = allCombos.filter((c) => legalCombo(c, value.board)).slice(-32);
      value.ranges = [
        Object.fromEntries(combos.slice(0, 16).map((c) => [c, 10000])),
        Object.fromEntries(combos.slice(16).map((c) => [c, 10000])),
      ];
      const start = performance.now(),
        { c, solution } = await t.solve(value),
        elapsedMs = performance.now() - start;
      assert.deepEqual(solution.handCounts, [16, 16]);
      const summary = JSON.parse(
        t.service.store
          .getBytes(t.service.state.artifacts[solution.summary.id].hash)
          .toString(),
      );
      mkdirSync(".artifacts/solver/turn-n07", { recursive: true });
      writeFileSync(
        ".artifacts/solver/turn-n07/resource.json",
        JSON.stringify({ elapsedMs, summary }, null, 2),
      );
      const big = await t.call<RealCase>("real_case_revise", {
        caseId: c.ref.id,
        ranges: [
          {
            ...value.ranges[0],
            [allCombos.filter(
              (c) =>
                legalCombo(c, value.board) &&
                !Object.hasOwn(value.ranges[0], c),
            )[0]]: 10000,
          },
          value.ranges[1],
        ],
      });
      const spec = await t.call<RealSpec>("real_spec_create", {
          caseId: big.ref.id,
        }),
        check = await t.call("real_preflight", { specId: spec.ref.id });
      assert.equal(check.supported, false);
      assert.match(check.reason, /16/);
      assert.equal(
        (await t.raw("real_analysis_start", { specId: spec.ref.id })).ok,
        false,
      );
      const safe = await t.call<RealCase>("real_case_create", input(3)),
        strict = await t.call<RealSpec>("real_spec_create", {
          caseId: safe.ref.id,
          targetNashConvPotFraction: 1e-9,
        });
      // Synchronous command dispatch holds the queue until cancellation/restart is recorded.
      const sync = <T>(tool: string, args: Record<string, unknown>) => {
        const r = t.service.execute(tool, {
          workspaceId: "local",
          requestId: crypto.randomUUID(),
          expectedRevision: t.service.state.revision,
          ...args,
        });
        assert.equal(r.ok, true, JSON.stringify(r));
        return (r as Extract<Reply, { ok: true }>).data as T;
      };
      const queued = sync<RealJob>("real_analysis_start", {
        specId: strict.ref.id,
      });
      assert.equal(
        sync<RealJob>("real_analysis_cancel", { jobId: queued.ref.id }).status,
        "cancelled",
      );
      const running = await t.call<RealJob>("real_analysis_start", {
        specId: strict.ref.id,
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(t.service.real.busy(), true);
      await t.call("real_analysis_cancel", { jobId: running.ref.id });
      assert.equal((await t.done(running.ref.id)).status, "cancelled");
      const interrupted = await t.call<RealJob>("real_analysis_start", {
        specId: strict.ref.id,
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(t.service.real.busy(), true);
      await t.restart();
      assert.equal(
        (
          await t.call<RealJob>("real_analysis_get", {
            jobId: interrupted.ref.id,
          })
        ).status,
        "interrupted",
      );
      const retried = await t.call<RealJob>("real_analysis_retry", {
        jobId: interrupted.ref.id,
      });
      assert.equal(retried.spec.contentHash, strict.ref.contentHash);
      assert.equal(retried.attempt, 2);
      const end = await t.done(retried.ref.id);
      assert.equal(end.status, "completed", end.error);
    } finally {
      await t.close();
      rmSync(t.directory, { recursive: true, force: true });
    }
  },
);
