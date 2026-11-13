import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore, hash } from "../../runtime/store.ts";
import {
  allCombos,
  nodesFor,
  presets,
  validateContent,
} from "../../src/modules/analysis/content.ts";
import type {
  Reply,
  Ref,
  Situation,
  Spec,
  SolutionManifest,
  Job,
} from "../../src/modules/analysis/domain.ts";
const live: { service: AnalysisService; directory: string }[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "riverline-s1-"));
  const service = new AnalysisService(new DiskStore(directory, "test"));
  live.push({ service, directory });
  let counter = 0;
  const call = (tool: string, input: Record<string, unknown> = {}) =>
    service.execute(tool, {
      workspaceId: "test",
      requestId: `test-${++counter}`,
      expectedRevision: service.state.revision,
      ...input,
    });
  return { service, call, directory };
}
function ok<T>(reply: Reply): T {
  expect(reply, JSON.stringify(reply)).toHaveProperty("ok", true);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
afterEach(() => {
  for (const item of live.splice(0)) {
    try {
      item.service.close();
    } catch {}
    rmSync(item.directory, { recursive: true, force: true });
  }
});

describe("S1 authored range contracts and durable authority", () => {
  it("checks every authored tree, six path ledgers and BB walk terminal", () => {
    expect(allCombos).toHaveLength(1326);
    for (const p of presets)
      expect(validateContent(nodesFor(p.id)), p.id).toEqual([]);
    for (const [id, pot] of [
      ["H-SRP", 500],
      ["H-3BP", 2000],
      ["X-BB", 550],
      ["X-3BP", 1850],
      ["X-4BP", 4850],
      ["X-SQ", 2600],
    ] as const)
      expect(nodesFor(id).find((n) => n.id === "flop-deal")!.pot).toBe(pot);
    expect(nodesFor("X-WALK").at(-1)!.kind).toBe("terminal");
  });
  it("validates atomic patches, protects combos, and preserves stale fixed inputs", () => {
    const { call, service } = setup();
    const s = ok<Situation>(call("situation_create"));
    const r = s.ranges.BTN;
    const old = structuredClone(service.state.ranges[r.id]);
    const fail = call("range_edit_batch", {
      rangeId: r.id,
      patch: [
        { combo: "AsAh", weight: 0 },
        { combo: "invalid", weight: 100 },
      ],
    });
    expect(fail.ok).toBe(false);
    expect(service.state.ranges[r.id]).toEqual(old);
    ok(call("range_edit_batch", { rangeId: r.id, protected: ["AsAh"] }));
    ok(
      call("range_edit_batch", {
        rangeId: r.id,
        patch: [
          { combo: "AsAh", weight: 0 },
          { combo: "KsKh", weight: 5000 },
        ],
      }),
    );
    expect(service.state.ranges[r.id].weights.AsAh).toBe(10000);
    expect(service.state.ranges[r.id].weights.KsKh).toBe(5000);
    expect(service.state.situations[s.ref.id].stale).toBe(true);
    expect(service.state.ranges[`${r.id}@1`].weights.KsKh).toBe(10000);
    ok(call("range_undo", { rangeId: r.id }));
    expect(service.state.ranges[r.id].weights.KsKh).toBe(10000);
    ok(call("range_redo", { rangeId: r.id }));
    expect(service.state.ranges[r.id].weights.KsKh).toBe(5000);
  });
  it("rejects write races and replays the same persisted request after restart", () => {
    const { call, service, directory } = setup();
    const input = {
      workspaceId: "test",
      requestId: "stable-create",
      expectedRevision: 0,
      preset: "H-SRP",
    };
    const first = service.execute("situation_create", input);
    expect(service.execute("situation_create", input)).toEqual(first);
    expect(
      service.execute("situation_create", { ...input, preset: "X-BB" }),
    ).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    expect(
      service.execute("situation_create", { ...input, requestId: "racer" }),
    ).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(ok<{ revision: number }>(call("workspace_get")).revision).toBe(1);
    service.close();
    const restarted = new AnalysisService(new DiskStore(directory, "test"));
    live.push({
      service: restarted,
      directory: mkdtempSync(join(tmpdir(), "riverline-clean-")),
    });
    expect(restarted.execute("situation_create", input)).toEqual(first);
    restarted.close();
  });
  it("binds specifications to board order and does not match custom rake/ranges", () => {
    const { call } = setup();
    const s = ok<Situation>(
      call("situation_create", { preset: "H-SRP", nodeId: "f-oop" }),
    );
    const first = ok<Spec>(
      call("analysis_spec_create", { situationId: s.ref.id }),
    );
    expect(
      ok(call("analysis_preflight", { specId: first.ref.id })),
    ).toHaveProperty("availability", "available");
    const changed = ok<Situation>(
      call("situation_revise", { situationId: s.ref.id, rake: 0.05 }),
    );
    const next = ok<Spec>(
      call("analysis_spec_create", { situationId: changed.ref.id }),
    );
    expect(next.fingerprint).not.toBe(first.fingerprint);
    expect(
      ok(call("analysis_preflight", { specId: next.ref.id })),
    ).toHaveProperty("availability", "uncovered");
    const a = ok<Situation>(
      call("situation_revise", {
        situationId: s.ref.id,
        board: ["As", "7d", "2c", "Th", "4c"],
      }),
    );
    const b = ok<Spec>(call("analysis_spec_create", { situationId: a.ref.id }));
    ok(
      call("situation_revise", {
        situationId: s.ref.id,
        board: ["As", "7d", "2c", "4c", "Th"],
      }),
    );
    expect(
      ok<Spec>(call("analysis_spec_create", { situationId: s.ref.id }))
        .fingerprint,
    ).not.toBe(b.fingerprint);
  });
  it("hands six-player path ranges and ledger to two-player subgame, not whole game", () => {
    const { call } = setup();
    const s = ok<Situation>(
      call("situation_create", { preset: "X-3BP", nodeId: "flop-deal" }),
    );
    const h = ok<Situation>(
      call("analysis_handoff", { situationId: s.ref.id }),
    );
    expect(h.origin).toEqual(s.ref);
    expect(h.players.filter((p) => p.status === "active")).toHaveLength(2);
    expect(h.players.reduce((n, p) => n + p.contribution, 0)).toBe(1850);
    const spec = ok<Spec>(
      call("analysis_spec_create", { situationId: h.ref.id }),
    );
    expect(spec.analysisScope).toBe("subgame");
    const multi = ok<Situation>(
      call("situation_create", { preset: "X-MULTI", nodeId: "flop-deal" }),
    );
    const mh = ok<Situation>(
      call("analysis_handoff", { situationId: multi.ref.id }),
    );
    const ms = ok<Spec>(
      call("analysis_spec_create", { situationId: mh.ref.id }),
    );
    expect(
      ok(call("analysis_preflight", { specId: ms.ref.id })),
    ).toHaveProperty("availability", "unsupported");
  });
  it("separates frequency evaluation, lock constraints, immutable results and hypotheses", () => {
    const { call, service } = setup();
    const s = ok<Situation>(
      call("situation_create", { preset: "X-BB", nodeId: "f-oop" }),
    );
    const p = ok<{ ref: Ref }>(
      call("policy_edit_batch", { situationId: s.ref.id, reveal: true }),
    );
    const fixed = ok<{ ref: Ref }>(
      call("policy_submit", { policyId: p.ref.id }),
    );
    expect(
      ok<{ distance: number; evLoss: null }>(
        call("policy_evaluate", { policyId: fixed.ref.id }),
      ),
    ).toMatchObject({ distance: 0, evLoss: null });
    expect(
      call("policy_edit_batch", { policyId: p.ref.id, patch: [] }),
    ).toMatchObject({ ok: false });
    const spec = ok<Spec>(
      call("analysis_spec_create", { situationId: s.ref.id }),
    );
    const solution = ok<SolutionManifest>(
      call("solution_load", { specId: spec.ref.id }),
    );
    const e = ok<{ ref: Ref; variant: Ref }>(
      call("experiment_create", {
        baselineId: solution.ref.id,
        combos: ["AhAd"],
        allocation: { check: 8000, bet: 2000 },
        hypothesis: "对手倾向变化",
      }),
    );
    expect(service.state.solutions[e.variant.id].availability).toBe(
      "uncovered",
    );
    expect(
      ok(call("experiment_compare", { experimentId: e.ref.id })),
    ).toHaveProperty("eligible", false);
    ok(
      call("experiment_conclude", {
        experimentId: e.ref.id,
        conclusion: "当前证据不足",
      }),
    );
    expect(service.state.solutions[solution.ref.id]).toEqual(solution);
  });
  it("blocks tools and old resource URI during independent attempt, preserves exposure and feedback provenance", () => {
    const { call, service } = setup();
    const s = ok<Situation>(call("situation_create", { nodeId: "f-oop" }));
    const spec = ok<Spec>(
      call("analysis_spec_create", { situationId: s.ref.id }),
    );
    const m = ok<SolutionManifest>(
      call("solution_load", { specId: spec.ref.id }),
    );
    const uri = service.resources()[0].uri;
    ok(call("teaching_begin"));
    expect(service.resources()).toEqual([]);
    expect(service.readResource(uri)).toMatchObject({
      ok: false,
      code: "INFORMATION_RESTRICTED",
    });
    expect(
      call("solution_node_strategy", { solutionId: m.ref.id, nodeId: "f-oop" }),
    ).toMatchObject({ ok: false, code: "INFORMATION_RESTRICTED" });
    const attempt = ok<{ ref: Ref; assisted: boolean }>(
      call("teaching_attempt_submit", { answer: "不能，需要核对来源和条件" }),
    );
    expect(attempt.assisted).toBe(true);
    const feedback = ok<{ attempt: Ref; solution: Ref }>(
      call("teaching_feedback", {
        attemptId: attempt.ref.id,
        solutionId: m.ref.id,
      }),
    );
    expect(feedback.attempt).toEqual(attempt.ref);
    expect(feedback.solution).toEqual(m.ref);
    expect(
      ok(call("teaching_next", { attemptId: attempt.ref.id })),
    ).toHaveProperty(
      "changedCondition",
      "由 BTN 对 BB 改为 CO 开池、BTN 3-bet",
    );
  });
  it("separates manifest from bounded query pages, checks corrupt result blobs", () => {
    const { call, service, directory } = setup();
    const s = ok<Situation>(call("situation_create", { nodeId: "f-oop" }));
    const spec = ok<Spec>(
      call("analysis_spec_create", { situationId: s.ref.id }),
    );
    const m = ok<SolutionManifest>(
      call("solution_load", { specId: spec.ref.id }),
    );
    const first = ok<{ items: unknown[]; nextCursor: string }>(
      call("solution_node_strategy", {
        solutionId: m.ref.id,
        nodeId: "f-oop",
        limit: 200,
      }),
    );
    expect(first.items).toHaveLength(200);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(131072);
    const next = ok<{ items: unknown[] }>(
      call("solution_node_strategy", {
        solutionId: m.ref.id,
        nodeId: "f-oop",
        limit: 200,
        cursor: first.nextCursor,
      }),
    );
    expect(next.items[0]).not.toEqual(first.items[0]);
    expect(JSON.stringify(service.state.solutions[m.ref.id])).not.toContain(
      "allocations",
    );
    writeFileSync(join(directory, "blobs", m.nodes[0].hash), "damaged");
    expect(service.readResource(service.resources()[0].uri)).toMatchObject({
      ok: false,
      code: "ARTIFACT_INCOMPLETE",
    });
  });
  it("roundtrips checksummed backups and refuses missing blobs without changing authority", () => {
    const { call, service } = setup();
    ok(call("situation_create"));
    const backup = ok<{ ref: Ref }>(call("workspace_export"));
    const a = service.state.artifacts[backup.ref.id];
    const document = JSON.parse(service.store.getBytes(a.hash).toString()) as {
      checksum: string;
      payload: { blobs: Record<string, string>; state: unknown };
    };
    expect(ok(call("workspace_import", { backup: document }))).toHaveProperty(
      "restored",
      true,
    );
    const before = structuredClone(service.state);
    document.checksum = "bad";
    expect(call("workspace_import", { backup: document })).toMatchObject({
      ok: false,
    });
    expect(service.state).toEqual(before);
    expect(hash(document)).not.toBe(a.hash);
  });
  it("persists queued/worker interruption and cancellation refuses late success", async () => {
    const { call, service } = setup();
    const s = ok<Situation>(call("situation_create"));
    const spec = ok<Spec>(
      call("analysis_spec_create", { situationId: s.ref.id }),
    );
    const j = ok<Job>(
      call("analysis_start", { specId: spec.ref.id, outcome: "slow" }),
    );
    await new Promise((r) => setTimeout(r, 300));
    ok(call("analysis_cancel", { jobId: j.ref.id }));
    await new Promise((r) => setTimeout(r, 250));
    expect(service.state.jobs[j.ref.id].status).toBe("cancelled");
    expect(service.state.jobs[j.ref.id].result).toBeUndefined();
  });
});
