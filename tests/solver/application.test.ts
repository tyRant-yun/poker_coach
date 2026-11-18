import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const sample = JSON.parse(
  readFileSync("benchmarks/solver/river-cases.json", "utf8"),
).cases[0] as {
  board: string[];
  pot: number;
  stack: number;
  ranges: Record<string, number>[];
};
export const caseInput = {
  name: "真实河牌测试",
  board: sample.board,
  pot: sample.pot,
  stack: sample.stack,
  betPercent: "100",
  ranges: sample.ranges.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, w]) => [k, w * 10000])),
  ),
};
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "riverline-real-app-"));
  const service = new AnalysisService(new DiskStore(directory, "real-test"));
  return { service, directory };
}
function raw(
  service: AnalysisService,
  tool: string,
  input: Record<string, unknown> = {},
) {
  return service.execute(tool, {
    workspaceId: "real-test",
    requestId: crypto.randomUUID(),
    expectedRevision: service.state.revision,
    ...input,
  });
}
function call<T>(
  service: AnalysisService,
  tool: string,
  input: Record<string, unknown> = {},
): T {
  const r = raw(service, tool, input);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<Reply, { ok: true }>).data as T;
}
async function done(service: AnalysisService, id: string) {
  for (let i = 0; i < 500; i++) {
    const j = call<RealJob>(service, "real_analysis_get", { jobId: id });
    if (["completed", "failed", "cancelled", "interrupted"].includes(j.status))
      return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("job did not finish");
}
async function cleanup(service: AnalysisService, directory: string) {
  service.close();
  for (let i = 0; i < 100 && service.real.busy(); i++)
    await new Promise((r) => setTimeout(r, 10));
  rmSync(directory, { recursive: true, force: true });
}

test(
  "real application: frozen inputs, authoritative range edits, exact nodes, aggregate, derive and no fixture fallback",
  { timeout: 15000 },
  async () => {
    const { service, directory } = setup();
    try {
      const c = call<RealCase>(service, "real_case_create", caseInput),
        spec = call<RealSpec>(service, "real_spec_create", {
          caseId: c.ref.id,
        });
      assert.equal(
        call<{ supported: boolean }>(service, "real_preflight", {
          specId: spec.ref.id,
        }).supported,
        true,
      );
      call(service, "range_edit_batch", {
        rangeId: c.ranges[0].id,
        patch: [{ combo: "AdAc", weight: 5000 }],
      });
      assert.equal(service.state.real!.cases[c.ref.id].ref.version, 2);
      assert.equal(
        service.state.real!.specs[spec.ref.id].situation.contentHash,
        c.ref.contentHash,
      );
      const job = call<RealJob>(service, "real_analysis_start", {
          specId: spec.ref.id,
        }),
        finished = await done(service, job.ref.id);
      assert.equal(finished.status, "completed", finished.error);
      const solution = call<RealSolution>(service, "real_solution_load", {
        solutionId: finished.result!.id,
      });
      assert.equal(solution.dataKind, "engine-computed");
      assert.equal(solution.nodes.length, 6);
      const result = call<{
        items: {
          combo: string;
          allocation: number[] | null;
          evBb: number | null;
          inputWeight: number;
          availability: string;
        }[];
      }>(service, "real_solution_query", {
        solutionId: solution.ref.id,
        combos: ["AcAd", "5c4c", "2c2d"],
      });
      assert.equal(result.items[0].inputWeight, 1);
      assert.ok(result.items[0].evBb! > 10);
      assert.equal(result.items[2].availability, "dead");
      assert.equal(result.items[2].evBb, null);
      const folded = call<{
        node: { potBb: number; returnedBb: number[] };
        items: { evBb: number | null }[];
      }>(service, "real_solution_query", {
        solutionId: solution.ref.id,
        path: [1, 0],
        combos: ["AdAc"],
      });
      assert.equal(folded.node.potBb, 10);
      assert.deepEqual(folded.node.returnedBb, [10, 0]);
      assert.ok(Math.abs(folded.items[0].evBb! - 20) < 1e-5);
      const agg = call<{
        classes: { probability: number | null }[];
        frequencies: { frequency: number | null }[];
      }>(service, "real_range_aggregate", { solutionId: solution.ref.id });
      assert.ok(
        Math.abs(
          agg.classes.reduce((s, c) => s + (c.probability ?? 0), 0) - 1,
        ) < 1e-5,
      );
      assert.ok(
        Math.abs(
          agg.frequencies.reduce((s, a) => s + (a.frequency ?? 0), 0) - 1,
        ) < 1e-5,
      );
      const derived = call<{
        ref: { id: string };
        source: { solution: { id: string } };
      }>(service, "real_range_derive", {
        solutionId: solution.ref.id,
        action: 1,
      });
      assert.equal(derived.source.solution.id, solution.ref.id);
      assert.equal(service.state.ranges[derived.ref.id].origin, "derived");
      assert.equal(
        service.state.real!.solutions[solution.ref.id].ref.contentHash,
        solution.ref.contentHash,
      );
      const revised = call<RealCase>(service, "real_case_revise", {
        caseId: c.ref.id,
        board: ["2c", "2c", "7h", "9s", "Jc"],
      });
      const bad = call<RealSpec>(service, "real_spec_create", {
        caseId: revised.ref.id,
      });
      assert.equal(
        call<{ supported: boolean }>(service, "real_preflight", {
          specId: bad.ref.id,
        }).supported,
        false,
      );
      assert.equal(
        raw(service, "real_analysis_start", { specId: bad.ref.id }).ok,
        false,
      );
    } finally {
      await cleanup(service, directory);
    }
  },
);

test("real application: idempotency, strict schemas, version conflicts and teaching guards", async () => {
  const { service, directory } = setup();
  try {
    const args = {
      ...caseInput,
      requestId: "fixed",
      expectedRevision: service.state.revision,
    };
    const first = raw(service, "real_case_create", args),
      replay = raw(service, "real_case_create", args);
    assert.deepEqual(replay, first);
    const conflict = raw(service, "real_case_create", {
      ...args,
      name: "changed",
    });
    assert.equal(conflict.ok ? null : conflict.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(
      raw(service, "real_case_create", { ...caseInput, unknownField: true }).ok,
      false,
    );
    assert.equal(
      raw(service, "real_case_create", { ...caseInput, expectedRevision: 0 })
        .ok,
      false,
    );
    const next = structuredClone(service.state);
    next.independent = { question: "protected", keys: ["any"] };
    service.store.commit(next);
    assert.equal(
      raw(service, "real_solution_query", { solutionId: "any" }).ok,
      false,
    );
    assert.equal(raw(service, "real_case_create", caseInput).ok, false);
    assert.deepEqual(
      call<{ cases: unknown[] }>(service, "real_workspace_get").cases,
      [],
    );
  } finally {
    await cleanup(service, directory);
  }
});

test(
  "real application: cancelled queue, process cancellation, restart interruption and fixed-spec retry",
  { timeout: 15000 },
  async () => {
    const { directory, service } = setup();
    let current = service;
    try {
      const c = call<RealCase>(service, "real_case_create", caseInput),
        spec = call<RealSpec>(service, "real_spec_create", {
          caseId: c.ref.id,
          targetNashConvPotFraction: 1e-9,
        });
      const queued = call<RealJob>(service, "real_analysis_start", {
        specId: spec.ref.id,
      });
      const cancelled = call<RealJob>(service, "real_analysis_cancel", {
        jobId: queued.ref.id,
      });
      assert.equal(cancelled.status, "cancelled");
      const running = call<RealJob>(service, "real_analysis_start", {
        specId: spec.ref.id,
      });
      await new Promise((r) => setTimeout(r, 2));
      call(service, "real_analysis_cancel", { jobId: running.ref.id });
      assert.equal((await done(service, running.ref.id)).status, "cancelled");
      const interrupted = call<RealJob>(service, "real_analysis_start", {
        specId: spec.ref.id,
      });
      await new Promise((r) => setTimeout(r, 2));
      service.close();
      for (let i = 0; i < 100 && service.real.busy(); i++)
        await new Promise((r) => setTimeout(r, 10));
      current = new AnalysisService(new DiskStore(directory, "real-test"));
      assert.equal(
        call<RealJob>(current, "real_analysis_get", {
          jobId: interrupted.ref.id,
        }).status,
        "interrupted",
      );
      const retry = call<RealJob>(current, "real_analysis_retry", {
        jobId: interrupted.ref.id,
      });
      assert.equal(retry.spec.contentHash, spec.ref.contentHash);
      assert.equal(retry.attempt, 2);
      const final = await done(current, retry.ref.id);
      assert.equal(final.status, "completed", final.error);
      const late = raw(current, "real_analysis_cancel", {
        jobId: retry.ref.id,
      });
      assert.equal(late.ok ? null : late.code, "TOO_LATE");
    } finally {
      await cleanup(current, directory);
    }
  },
);

test(
  "real application: backup restores native artifacts and rejects corruption and forged metadata",
  { timeout: 15000 },
  async () => {
    const { service, directory } = setup();
    try {
      const c = call<RealCase>(service, "real_case_create", caseInput),
        spec = call<RealSpec>(service, "real_spec_create", {
          caseId: c.ref.id,
        }),
        job = call<RealJob>(service, "real_analysis_start", {
          specId: spec.ref.id,
        }),
        finished = await done(service, job.ref.id);
      assert.equal(finished.status, "completed");
      const exported = call<{ ref: { id: string } }>(
        service,
        "workspace_export",
      );
      const a = service.state.artifacts[exported.ref.id];
      const backup = JSON.parse(service.store.getBytes(a.hash).toString());
      assert.equal(raw(service, "workspace_import", { backup }).ok, true);
      const revision = service.state.revision;
      const forged = structuredClone(backup);
      forged.payload.state.real.cases[c.ref.id].pot = 99999;
      forged.checksum = hash(forged.payload);
      assert.equal(
        raw(service, "workspace_import", { backup: forged }).ok,
        false,
      );
      assert.equal(service.state.revision, revision);
      const solution = call<RealSolution>(service, "real_solution_load", {
        solutionId: finished.result!.id,
      });
      writeFileSync(
        join(
          directory,
          "blobs",
          service.state.artifacts[solution.native.id].hash,
        ),
        "damaged",
      );
      const failed = raw(service, "real_solution_load", {
        solutionId: solution.ref.id,
      });
      assert.equal(failed.ok ? null : failed.code, "ARTIFACT_INCOMPLETE");
    } finally {
      await cleanup(service, directory);
    }
  },
);

test(
  "real application: 200-combo execution/transport stays bounded and budget exhaustion is not quality success",
  { timeout: 15000 },
  async () => {
    const { service, directory } = setup();
    try {
      const weights = Object.fromEntries(
        allCombos
          .filter((c) => legalCombo(c, sample.board))
          .slice(0, 200)
          .map((c) => [c, 10000]),
      );
      const c = call<RealCase>(service, "real_case_create", {
        ...caseInput,
        ranges: [weights, weights],
      });
      const spec = call<RealSpec>(service, "real_spec_create", {
        caseId: c.ref.id,
        maxIterations: 1,
      });
      const j = call<RealJob>(service, "real_analysis_start", {
        specId: spec.ref.id,
      });
      const completed = await done(service, j.ref.id);
      assert.equal(completed.status, "completed", completed.error);
      const solution = call<RealSolution>(service, "real_solution_load", {
        solutionId: completed.result!.id,
      });
      assert.equal(solution.quality, "budget-exhausted");
      assert.deepEqual(solution.handCounts, [200, 200]);
      const page = raw(service, "real_solution_query", {
        solutionId: solution.ref.id,
        limit: 200,
        inRangeOnly: true,
      });
      assert.equal(page.ok, true);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 120000);
      const summary = JSON.stringify(call(service, "real_workspace_get"));
      assert.ok(summary.length < 20000);
      assert.equal(summary.includes('"privateCards"'), false);
      assert.equal(summary.includes('"strategy"'), false);
      const tooMany = call<RealCase>(service, "real_case_revise", {
        caseId: c.ref.id,
        ranges: [
          {
            ...weights,
            [allCombos.filter((c) => legalCombo(c, sample.board))[200]]: 10000,
          },
          weights,
        ],
      });
      const unsupported = call<RealSpec>(service, "real_spec_create", {
        caseId: tooMany.ref.id,
      });
      assert.equal(
        call<{ supported: boolean }>(service, "real_preflight", {
          specId: unsupported.ref.id,
        }).supported,
        false,
      );
    } finally {
      await cleanup(service, directory);
    }
  },
);
