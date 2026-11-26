import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore } from "../../runtime/store.ts";
import type { TurnPath } from "../../contracts/solver/turn.ts";
import type {
  RealJob,
  RealCase,
  RealSpec,
  RealSolution,
  ResearchView,
} from "../../src/modules/analysis/real-domain.ts";
const fixture = JSON.parse(
  readFileSync("benchmarks/solver/m1-turn-cases.json", "utf8"),
);
test(
  "M1 actual 128x128: two frozen weighted boards, bounded pages/global aggregate/chance, fixed views, backup and warm timings",
  { timeout: 60000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "m1-turn-"));
    let s = new AnalysisService(new DiskStore(dir));
    const call = async <T = any>(
      tool: string,
      a: Record<string, unknown> = {},
    ): Promise<T> => {
      const r = await s.executeAsync(tool, {
        workspaceId: "local",
        requestId: crypto.randomUUID(),
        expectedRevision: s.state.revision,
        ...a,
      });
      assert(r.ok, JSON.stringify(r));
      return (r as { data: T }).data;
    };
    const timings: number[] = [];
    let last: RealSolution;
    try {
      for (const c of fixture.cases.slice(0, 2)) {
        const created = await call<RealCase>("real_case_create", {
          name: c.caseId,
          board: c.board,
          pot: c.pot,
          stack: c.stack,
          betPercent: "50",
          turn: {
            kind: "hu-turn/4",
            turnBets: c.turnBets,
            riverBets: c.riverBets,
          },
          ranges: c.ranges.map((r: Record<string, number>) =>
            Object.fromEntries(
              Object.entries(r).map(([k, w]) => [k, w * 10000]),
            ),
          ),
        });
        const spec = await call<RealSpec>("real_spec_create", {
          caseId: created.ref.id,
        });
        assert(
          (await call("real_preflight", { specId: spec.ref.id })).supported,
        );
        let job = await call<RealJob>("real_analysis_start", {
          specId: spec.ref.id,
        });
        for (let i = 0; !job.result && i < 1000; i++) {
          await new Promise((r) => setTimeout(r, 10));
          job = await call("real_analysis_get", { jobId: job.ref.id });
          if (job.status === "failed") throw Error(job.error);
        }
        assert(job.result);
        const sol = s.state.real!.solutions[job.result.id];
        last = sol;
        assert.deepEqual(sol.handCounts, [128, 128]);
        assert.equal(sol.queryModel, "native-turn-paged/4");
        assert.equal(sol.quality, "target-met");
        assert.deepEqual(sol.nodes, []);
        const root = await call("real_turn_solution_query", {
          solutionId: sol.ref.id,
          limit: 100,
        });
        const page = await call("real_turn_solution_query", {
          solutionId: sol.ref.id,
          offset: 100,
          limit: 100,
        });
        assert.equal(root.total, 128);
        assert.equal(root.items.length, 100);
        assert.equal(page.items.length, 28);
        assert.equal(
          new Set([...root.items, ...page.items].map((r) => r.combo)).size,
          128,
        );
        assert.deepEqual(root.aggregate, page.aggregate);
        assert(
          Math.abs(
            root.aggregate.classes.reduce(
              (n: number, r: any) => n + r.probability,
              0,
            ) - 1,
          ) < 1e-6,
        );
        assert(
          Math.abs(
            root.aggregate.frequencies.reduce(
              (n: number, r: any) => n + r.frequency,
              0,
            ) - 1,
          ) < 1e-5,
        );
        const path: TurnPath = [
          { kind: "action", index: 0 },
          { kind: "action", index: 0 },
        ];
        const chance = await call("real_turn_solution_query", {
          solutionId: sol.ref.id,
          path,
        });
        assert.equal(chance.node.kind, "chance");
        assert(
          Math.abs(
            chance.node.chanceCards.reduce(
              (n: number, r: any) => n + r.probability,
              0,
            ) - 1,
          ) < 1e-6,
        );
        const branch: TurnPath = [
          ...path,
          {
            kind: "deal",
            card: chance.node.chanceCards.find((r: any) => r.probability > 0)
              .card,
          },
        ];
        const river = await call("real_turn_solution_query", {
          solutionId: sol.ref.id,
          path: branch,
          player: 1,
        });
        assert.equal(river.node.board.length, 5);
        const view: ResearchView = {
          solution: sol.ref,
          path: [],
          turnPath: branch,
          labels: ["过牌", "过牌", "河牌"],
          player: 1,
          hand: "",
          hero: root.items[0].combo,
          metric: "ev",
          showAll: false,
          offset: 0,
        };
        await call("real_browse_save", { view });
        assert.deepEqual(
          await call("real_browse_get", { solutionId: sol.ref.id }),
          view,
        );
        for (let i = 0; i < 100; i++) {
          const t = performance.now();
          await call("real_turn_solution_query", {
            solutionId: sol.ref.id,
            limit: 100,
          });
          timings.push(performance.now() - t);
        }
      }
      const exported = await call("workspace_export"),
        backup = JSON.parse(
          s.store.getBytes(s.state.artifacts[exported.ref.id].hash).toString(),
        );
      await call("workspace_import", { backup });
      const view = await call("real_browse_get", { solutionId: last!.ref.id });
      assert.equal(view.player, 1);
      assert.equal(view.turnPath.length, 3);
      s.close();
      s = new AnalysisService(new DiskStore(dir));
      assert.deepEqual(
        await call("real_browse_get", { solutionId: last!.ref.id }),
        view,
      );
      assert.equal(
        (
          await call("real_turn_solution_query", {
            solutionId: last!.ref.id,
            path: view.turnPath,
          })
        ).node.board.length,
        5,
      );
      timings.sort((a, b) => a - b);
      mkdirSync(".artifacts/solver/m1-capacity", { recursive: true });
      writeFileSync(
        ".artifacts/solver/m1-capacity/application-timings.json",
        JSON.stringify(
          {
            method:
              "warm authoritative service calls, same two root pages; excludes HTTP/render/animation",
            samples: timings.length,
            p50: timings[Math.floor(timings.length * 0.5)],
            p95: timings[Math.floor(timings.length * 0.95)],
            max: timings.at(-1),
          },
          null,
          2,
        ),
      );
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
