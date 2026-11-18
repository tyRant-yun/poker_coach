import { it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStore, hash } from "../../runtime/store.ts";
import { AnalysisService } from "../../runtime/service.ts";
import {
  nodesFor,
  validateContent,
  allCombos,
} from "../../src/modules/analysis/content.ts";
import type {
  Reply,
  Ref,
  Situation,
  Spec,
  SolutionManifest,
} from "../../src/modules/analysis/domain.ts";
const data = <T>(r: Reply): T => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return (r as Extract<Reply, { ok: true }>).data as T;
};
it("content checks reject probability, money and dangling references instead of publishing a broken tree", () => {
  const original = nodesFor("H-SRP");
  const probability = structuredClone(original);
  probability[0].policies.BTN.AsAh = { raise: 20000 };
  expect(
    validateContent(probability).some((e) => e.includes("probability")),
  ).toBe(true);
  const money = structuredClone(original);
  money[0].pot += 1;
  expect(validateContent(money).some((e) => e.includes("ledger"))).toBe(true);
  const missing = structuredClone(original);
  missing[0].parent = "missing";
  expect(validateContent(missing).some((e) => e.includes("parent"))).toBe(true);
});
it("old submitted policy evaluations retain their input and paired synthetic report; empty ranges cannot submit", () => {
  const directory = mkdtempSync(join(tmpdir(), "riverline-fixed-evaluation-")),
    service = new AnalysisService(new DiskStore(directory));
  let i = 0;
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    service.execute(tool, {
      workspaceId: "local",
      requestId: String(++i),
      expectedRevision: service.state.revision,
      ...args,
    });
  try {
    const s = data<Situation>(call("situation_create", { nodeId: "f-oop" })),
      p = data<{ ref: Ref }>(
        call("policy_edit_batch", { situationId: s.ref.id, reveal: true }),
      );
    data(call("policy_submit", { policyId: p.ref.id }));
    const report = data<{ samplePolicyEv: { value: number }; situation: Ref }>(
      call("policy_evaluate", { policyId: p.ref.id }),
    );
    expect(report.samplePolicyEv.value).toBe(0.7);
    data(call("situation_revise", { situationId: s.ref.id, rake: 0.05 }));
    expect(
      data<{ samplePolicyEv: { value: number } }>(
        call("policy_evaluate", { policyId: p.ref.id }),
      ).samplePolicyEv.value,
    ).toBe(0.7);
    expect(report.situation).toEqual(s.ref);
    const empty = data<Situation>(
      call("situation_create", { nodeId: "f-oop" }),
    );
    data(
      call("range_edit_batch", {
        rangeId: empty.ranges.BB.id,
        patch: allCombos.map((combo) => ({ combo, weight: 0 })),
      }),
    );
    const draft = data<{ ref: Ref }>(
      call("policy_edit_batch", { situationId: empty.ref.id, reveal: true }),
    );
    expect(call("policy_submit", { policyId: draft.ref.id })).toMatchObject({
      ok: false,
    });
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("recovers a torn uncommitted log tail, but refuses corruption in a committed record", () => {
  const directory = mkdtempSync(join(tmpdir(), "riverline-wal-"));
  let store = new DiskStore(directory);
  try {
    const state = structuredClone(store.state);
    state.exposures.push("durable");
    store.commit(state);
    store.close();
    appendFileSync(join(directory, "journal.jsonl"), "{torn");
    store = new DiskStore(directory);
    expect(store.state.exposures).toContain("durable");
    store.close();
    const log = readFileSync(join(directory, "journal.jsonl"), "utf8");
    writeFileSync(
      join(directory, "journal.jsonl"),
      log.replace("durable", "changed"),
    );
    expect(() => new DiskStore(directory)).toThrow("日志损坏");
  } finally {
    try {
      store.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
// This integration case creates multiple persisted full-range projections.
// Allow filesystem variance without changing its assertions or solver budgets.
it(
  "caps output, rejects incompatible cursors and cannot pretend an arbitrary lock is a preset",
  { timeout: 15000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "riverline-constraint-")),
      service = new AnalysisService(new DiskStore(directory));
    let n = 0;
    const call = (tool: string, input: Record<string, unknown> = {}) =>
      service.execute(tool, {
        workspaceId: "local",
        requestId: String(++n),
        expectedRevision: service.state.revision,
        ...input,
      });
    try {
      const s = data<Situation>(
          call("situation_create", { preset: "X-BB", nodeId: "f-response" }),
        ),
        spec = data<Spec>(
          call("analysis_spec_create", { situationId: s.ref.id }),
        ),
        m = data<SolutionManifest>(
          call("solution_load", { specId: spec.ref.id }),
        );
      const e = data<{ variant: { id: string } }>(
        call("experiment_create", {
          baselineId: m.ref.id,
          preset: "overfold",
          playerId: "BB",
          combos: ["AhAd"],
          allocation: { fold: 1234, call: 8766 },
        }),
      );
      expect(service.state.solutions[e.variant.id].availability).toBe(
        "uncovered",
      );
      const known = data<{ variant: { id: string } }>(
        call("experiment_create", {
          baselineId: m.ref.id,
          preset: "overfold",
          playerId: "BB",
          combos: ["AhAd"],
          allocation: { fold: 8000, call: 2000 },
        }),
      );
      expect(service.state.solutions[known.variant.id].availability).toBe(
        "available",
      );
      const rows = data<{ nextCursor: string }>(
        call("solution_node_strategy", {
          solutionId: m.ref.id,
          nodeId: "f-response",
          limit: 10,
        }),
      );
      expect(
        call("solution_node_strategy", {
          solutionId: m.ref.id,
          nodeId: "f-response",
          playerId: "BTN",
          limit: 10,
          cursor: rows.nextCursor,
        }),
      ).toMatchObject({ ok: false });
      const raw = service.store.getBytes(m.nodes[0].hash);
      expect(hash(raw)).toBe(m.nodes[0].hash);
    } finally {
      service.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
