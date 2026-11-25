import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore, hash } from "../../runtime/store.ts";
import type { Reply, RangeRecord } from "../../src/modules/analysis/domain.ts";
import type {
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
} from "../../src/modules/analysis/real-domain.ts";

const manifest = JSON.parse(
  readFileSync("benchmarks/solver/river-tree-cases.json", "utf8"),
);
export function generalInput(index = 1) {
  const c = manifest.cases[index];
  return {
    name: "一般河牌应用",
    board: c.board,
    pot: c.pot,
    stack: c.stack,
    betPercent: "100",
    tree: { kind: "explicit-river/v2", lines: c.treeLines },
    ranges: c.ranges.map((r: Record<string, number>) =>
      Object.fromEntries(Object.entries(r).map(([c, w]) => [c, w * 10000])),
    ),
  };
}
function tools(service: AnalysisService) {
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
  ): Promise<T> => {
    const r = await raw(tool, input);
    assert.equal(r.ok, true, JSON.stringify(r));
    return (r as Extract<Reply, { ok: true }>).data as T;
  };
  const done = async (id: string) => {
    for (let i = 0; i < 500; i++) {
      const j = await call<RealJob>("real_analysis_get", { jobId: id });
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(j.status)
      )
        return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("timeout");
  };
  return { raw, call, done };
}
test(
  "general river application: real job, native-only artifacts, deep nodes/refunds, derived provenance and fixed old inputs",
  { timeout: 20000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "general-river-app-")),
      service = new AnalysisService(new DiskStore(directory));
    const { call, done, raw } = tools(service);
    try {
      const c = await call<RealCase>("real_case_create", generalInput());
      const spec = await call<RealSpec>("real_spec_create", {
        caseId: c.ref.id,
      });
      assert.equal(
        (
          await call<{ supported: boolean }>("real_preflight", {
            specId: spec.ref.id,
          })
        ).supported,
        true,
      );
      const j = await call<RealJob>("real_analysis_start", {
          specId: spec.ref.id,
        }),
        end = await done(j.ref.id);
      assert.equal(end.status, "completed", end.error);
      const solution = await call<RealSolution>("real_solution_load", {
        solutionId: end.result!.id,
      });
      assert.equal(solution.queryModel, "native-paged/2");
      assert.deepEqual(solution.nodes, []);
      assert.ok(JSON.stringify(service.state).length < 150000);
      const root = await call<any>("real_solution_query", {
        solutionId: solution.ref.id,
        player: 0,
        inRangeOnly: true,
      });
      assert.deepEqual(root.node.actions, ["Check", "Bet(500)"]);
      assert.equal(root.items.length, 2);
      const response = await call<any>("real_solution_query", {
        solutionId: solution.ref.id,
        path: [1, 2],
        player: 0,
      });
      assert.deepEqual(response.node.actions, ["Fold", "Call", "AllIn(2000)"]);
      assert.deepEqual(response.node.investedBb, [5, 10]);
      const folded = await call<any>("real_solution_query", {
        solutionId: solution.ref.id,
        path: [1, 2, 0],
        player: 1,
      });
      assert.equal(folded.node.terminal, true);
      assert.deepEqual(folded.node.returnedBb, [0, 5]);
      assert.equal(folded.node.potBb, 20);
      const called = await call<any>("real_solution_query", {
        solutionId: solution.ref.id,
        path: [1, 2, 2, 1],
        player: 1,
      });
      assert.deepEqual(called.node.investedBb, [20, 20]);
      assert.deepEqual(called.node.returnedBb, [0, 0]);
      assert.equal(called.node.potBb, 50);
      const aggregate = await call<any>("real_range_aggregate", {
        solutionId: solution.ref.id,
        path: [],
        player: 0,
      });
      assert.ok(
        Math.abs(
          aggregate.frequencies.reduce(
            (s: number, f: any) => s + f.frequency,
            0,
          ) - 1,
        ) < 1e-5,
      );
      const derived = await call<RangeRecord>("real_range_derive", {
        solutionId: solution.ref.id,
        path: [],
        action: 1,
      });
      assert.equal(
        derived.source!.solution!.contentHash,
        solution.ref.contentHash,
      );
      await call("real_case_revise", {
        caseId: c.ref.id,
        name: "新假设",
        tree: {
          kind: "explicit-river/v2",
          lines: [[{ kind: "bet", amount: 250 }]],
        },
      });
      const frozen = await call<any>("real_solution_query", {
        solutionId: solution.ref.id,
        player: 0,
      });
      assert.deepEqual(frozen.node.actions, root.node.actions);
      const bad = await raw("real_solution_query", {
        solutionId: solution.ref.id,
        path: [9],
      });
      assert.equal(bad.ok, false);
      await call("teaching_begin");
      assert.equal(
        (await raw("real_solution_query", { solutionId: solution.ref.id })).ok,
        false,
      );
    } finally {
      service.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "general river application: mixed old/new backup restores, and corruption or forged tree is rejected atomically",
  { timeout: 20000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "general-river-restore-")),
      service = new AnalysisService(new DiskStore(directory));
    const { call, done, raw } = tools(service);
    try {
      const c = await call<RealCase>("real_case_create", generalInput(0));
      const spec = await call<RealSpec>("real_spec_create", {
        caseId: c.ref.id,
      });
      const job = await call<RealJob>("real_analysis_start", {
          specId: spec.ref.id,
        }),
        end = await done(job.ref.id);
      assert.equal(end.status, "completed", end.error);
      const { tree: _tree, ...legacyInput } = generalInput(0);
      const legacy = await call<RealCase>("real_case_create", {
        ...legacyInput,
        name: "旧模型",
      });
      const legacySpec = await call<RealSpec>("real_spec_create", {
        caseId: legacy.ref.id,
      });
      const legacyJob = await call<RealJob>("real_analysis_start", {
        specId: legacySpec.ref.id,
      });
      assert.equal((await done(legacyJob.ref.id)).status, "completed");
      const before = structuredClone(service.state.real);
      const backup = await call<any>("workspace_export");
      const artifact = service.state.artifacts[backup.ref.id];
      const bytes = service.store.getBytes(artifact.hash);
      const payload = JSON.parse(bytes.toString());
      await call("workspace_reset", { confirmation: "RESET LOCAL ANALYSIS" });
      const imported = await raw("workspace_import", { backup: payload });
      assert.equal(imported.ok, true, JSON.stringify(imported));
      assert.equal(hash(service.state.real), hash(before));
      const q = await call<any>("real_solution_query", {
        solutionId: end.result!.id,
        path: [0],
        player: 1,
      });
      assert.deepEqual(q.node.actions, ["Check", "Bet(500)"]);
      const changed = structuredClone(payload);
      const source = changed.payload.state.real.cases[c.ref.id];
      source.tree.lines[0][0].amount = 1;
      changed.checksum = hash(changed.payload);
      const revision = service.state.revision;
      assert.equal(
        (await raw("workspace_import", { backup: changed })).ok,
        false,
      );
      assert.equal(service.state.revision, revision);
    } finally {
      service.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
