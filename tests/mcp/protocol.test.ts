import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startRuntime } from "../../runtime/server.ts";
import { tools } from "../../src/modules/analysis/domain.ts";
import { realTools } from "../../src/modules/analysis/real-domain.ts";
import type {
  Reply,
  Ref,
  Situation,
  Spec,
  SolutionManifest,
  Experiment,
  Job,
  ToolName,
} from "../../src/modules/analysis/domain.ts";
import { hash } from "../../runtime/store.ts";
import {
  handDecisions,
  completeHandText,
} from "../../src/fixtures/scenarios.ts";
import { emptyProduct } from "../../src/modules/product/domain.ts";
import { fixtureVersion } from "../../src/fixtures/s01.ts";

test(
  "real MCP stdio: complete core tool manifest, shared runtime, fixed references, resources, jobs and teaching",
  { timeout: 120000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "riverline-mcp-")),
      runtime = startRuntime({ port: 0, directory, workspaceId: "protocol" });
    await once(runtime.server, "listening");
    const port = (runtime.server.address() as { port: number }).port;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/mcp.mjs")],
      cwd: tmpdir(),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (v): v is [string, string] => v[1] !== undefined,
          ),
        ),
        RIVERLINE_RUNTIME: `http://127.0.0.1:${port}`,
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "riverline-acceptance",
      version: "1.0.0",
    });
    const called = new Set<string>();
    const evidence: {
      tool: string;
      ok: boolean;
      code?: string;
      refs: Ref[];
      bytes: number;
    }[] = [];
    async function raw(tool: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({
        name: tool,
        arguments: {
          workspaceId: "protocol",
          requestId: crypto.randomUUID(),
          expectedRevision: runtime.service.state.revision,
          ...args,
        },
      });
      called.add(tool);
      const reply = result.structuredContent as Reply;
      assert.ok(
        reply && typeof reply.ok === "boolean",
        `missing structuredContent: ${tool}`,
      );
      evidence.push({
        tool,
        ok: reply.ok,
        code: reply.ok ? undefined : reply.code,
        refs: reply.ok ? reply.artifactRefs : [],
        bytes: Buffer.byteLength(JSON.stringify(reply)),
      });
      return reply;
    }
    async function call<T>(
      tool: ToolName,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      let reply = await raw(tool, args);
      if (!reply.ok && reply.code === "REVISION_CONFLICT")
        reply = await raw(tool, args);
      assert.equal(reply.ok, true, `${tool}: ${JSON.stringify(reply)}`);
      return (reply as Extract<Reply, { ok: true }>).data as T;
    }
    try {
      await client.connect(transport);
      const list = await client.listTools();
      assert.deepEqual(
        new Set(list.tools.map((t) => t.name)),
        new Set([...Object.keys(tools),...Object.keys(realTools)]),
      );
      const capabilities = await call<{ capabilities: unknown[] }>(
        "solver_capabilities",
      );
      assert.equal(capabilities.capabilities.length, 5);
      const situation = await call<Situation>("situation_create", {
        preset: "H-SRP",
        nodeId: "f-oop",
      });
      await call("workspace_get");
      await call("workspace_changes", { sequence: 0 });
      await call("situation_tree", { situationId: situation.ref.id });
      const rangeId = situation.ranges.BB.id;
      await call("range_get", { rangeId, limit: 200 });
      const forked = await call<{ ref: Ref }>("range_fork", { rangeId });
      await call("range_edit_batch", {
        rangeId: forked.ref.id,
        patch: [{ combo: "AhAd", weight: 5000 }],
      });
      await call("range_undo", { rangeId: forked.ref.id });
      await call("range_redo", { rangeId: forked.ref.id });
      const raceRevision = runtime.service.state.revision;
      const session = (await (
        await fetch(`http://127.0.0.1:${port}/api/analysis/session`)
      ).json()) as { token: string };
      const uiBody = {
        tool: "range_edit_batch",
        input: {
          workspaceId: "protocol",
          requestId: "ui-race",
          expectedRevision: raceRevision,
          rangeId: forked.ref.id,
          patch: [{ combo: "KhKd", weight: 4500 }],
        },
      };
      const [uiResult, mcpResult] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/api/analysis/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Riverline-Session": session.token,
          },
          body: JSON.stringify(uiBody),
        }).then((r) => r.json() as Promise<Reply>),
        raw("range_edit_batch", {
          requestId: "mcp-race",
          expectedRevision: raceRevision,
          rangeId: forked.ref.id,
          patch: [{ combo: "KhKd", weight: 6500 }],
        }),
      ]);
      assert.equal(
        [uiResult, mcpResult].filter((r) => r.ok).length,
        1,
        "UI and MCP must share one commit authority",
      );
      assert.equal(
        [uiResult, mcpResult].find((r) => !r.ok)?.code,
        "REVISION_CONFLICT",
      );
      const replayInput = {
        requestId: "fixed-replay",
        expectedRevision: runtime.service.state.revision,
        preset: "H-SRP",
      };
      const createdOnce = await raw("situation_create", replayInput);
      assert.deepEqual(await raw("situation_create", replayInput), createdOnce);
      const incompatible = await raw("situation_create", {
        ...replayInput,
        preset: "X-BB",
      });
      assert.equal(incompatible.ok, false);
      if (!incompatible.ok)
        assert.equal(incompatible.code, "IDEMPOTENCY_CONFLICT");
      const fresh = await call<Situation>("situation_create", {
        preset: "H-SRP",
        nodeId: "f-oop",
      });
      const draft = await call<{ ref: Ref }>("policy_edit_batch", {
        situationId: fresh.ref.id,
        reveal: true,
      });
      await call("policy_undo", { policyId: draft.ref.id });
      await call("policy_redo", { policyId: draft.ref.id });
      const fixed = await call<{ ref: Ref }>("policy_submit", {
        policyId: draft.ref.id,
      });
      await call("policy_fork", { policyId: fixed.ref.id });
      await call("policy_evaluate", { policyId: fixed.ref.id });
      await call("range_derive", {
        rangeId: fresh.ranges.BB.id,
        policyId: fixed.ref.id,
        action: "check",
      });
      const spec = await call<Spec>("analysis_spec_create", {
        situationId: fresh.ref.id,
      });
      await call("analysis_preflight", { specId: spec.ref.id });
      await call("artifact_inspect", { artifactId: spec.ref.id });
      const solution = await call<SolutionManifest>("solution_load", {
        specId: spec.ref.id,
      });
      const rows = await call<{ items: unknown[]; nextCursor: string }>(
        "solution_node_strategy",
        { solutionId: solution.ref.id, nodeId: "f-oop", limit: 200 },
      );
      assert.equal(rows.items.length, 200);
      assert.ok(rows.nextCursor);
      await call("solution_combo_metrics", {
        solutionId: solution.ref.id,
        nodeId: "f-oop",
        combos: ["AhAd", "AsKs"],
      });
      await call("solution_range_aggregate", {
        solutionId: solution.ref.id,
        nodeId: "f-oop",
      });
      await call("analysis_agent_run", {
        situationId: fresh.ref.id,
        hypothesis: "Agent 共用命令验收",
      });
      const resources = await client.listResources();
      assert.ok(resources.resources.length > 0);
      const uri = resources.resources.find((r) =>
        r.uri.includes(solution.ref.id),
      )!.uri;
      const resource = await client.readResource({ uri });
      assert.ok(resource.contents[0]);
      const experiment = await call<Experiment>("experiment_create", {
        baselineId: solution.ref.id,
        preset: "overfold",
        hypothesis: "受控示例",
        combos: ["AhAd"],
        allocation: { check: 8000, bet: 2000 },
      });
      await call("experiment_compare", { experimentId: experiment.ref.id });
      await call("experiment_conclude", {
        experimentId: experiment.ref.id,
        conclusion: "只保存合成观察，不推断真实收益",
      });
      const branch = await call<Situation>("situation_fork", {
        situationId: `${fresh.ref.id}@${fresh.ref.version}`,
      });
      assert.equal(branch.origin?.contentHash, fresh.ref.contentHash);
      assert.notEqual(branch.ref.id, fresh.ref.id);
      const preflop = await call<Situation>("situation_create", {
        preset: "X-3BP",
        nodeId: "flop-deal",
      });
      const handoff = await call<Situation>("analysis_handoff", {
        situationId: preflop.ref.id,
      });
      assert.equal(handoff.format, "6-max");
      await call("situation_revise", {
        situationId: handoff.ref.id,
        rake: 0.05,
      });
      const job = await call<Job>("analysis_start", {
        specId: spec.ref.id,
        outcome: "fail-once",
      });
      await waitJob(job.ref.id, "failed");
      const retry = await call<Job>("analysis_retry", { jobId: job.ref.id });
      await waitJob(retry.ref.id, "completed");
      const lateCancel = await raw("analysis_cancel", { jobId: retry.ref.id });
      assert.equal(lateCancel.ok, false);
      if (!lateCancel.ok) assert.equal(lateCancel.code, "TOO_LATE");
      const resourceLimited = await call<Job>("analysis_start", {
        specId: spec.ref.id,
        outcome: "resource-limit",
      });
      await waitJob(resourceLimited.ref.id, "failed");
      const slow = await call<Job>("analysis_start", {
        specId: spec.ref.id,
        outcome: "slow",
      });
      await call("analysis_cancel", { jobId: slow.ref.id });
      await waitJob(slow.ref.id, "cancelled");
      await call("teaching_begin");
      assert.equal(
        (
          await raw("solution_node_strategy", {
            solutionId: solution.ref.id,
            nodeId: "f-oop",
          })
        ).ok,
        false,
      );
      const blocked = await client.readResource({ uri });
      assert.equal(
        JSON.parse((blocked.contents[0] as { text: string }).text).code,
        "INFORMATION_RESTRICTED",
      );
      for (const [name, args] of [
        ["situation_create", { preset: "H-SRP", nodeId: "r-oop" }],
        ["workspace_import", { backup: {} }],
        ["policy_evaluate", { policyId: "unknown" }],
      ] as const) {
        const denied = await raw(name, args);
        assert.equal(denied.ok, false);
        if (!denied.ok) assert.equal(denied.code, "INFORMATION_RESTRICTED");
      }
      await call("teaching_reveal");
      await call("teaching_begin");
      const attempt = await call<{ ref: Ref }>("teaching_attempt_submit", {
        answer: "不能，需要核对来源和条件",
        solutionId: solution.ref.id,
      });
      await call("teaching_feedback", {
        attemptId: attempt.ref.id,
        solutionId: solution.ref.id,
      });
      await call("teaching_next", { attemptId: attempt.ref.id });
      await call("teaching_record_exposure");
      const legacy = {
        schemaVersion: 1,
        fixtureVersion,
        cases: {},
        product: {
          ...emptyProduct(),
          hands: {
            "s1-source-hand": {
              id: "s1-source-hand",
              kind: "complete",
              raw: completeHandText,
              confirmed: true,
              missing: [],
              createdAt: new Date().toISOString(),
              decisions: handDecisions,
            },
          },
        },
      };
      await call("workspace_import", { backup: legacy });
      const reviewed = await call<Situation>("review_extract", {
        handId: "s1-source-hand",
        decisionId: handDecisions[0].id,
      });
      assert.equal(reviewed.format, "unknown");
      assert.deepEqual(reviewed.board, handDecisions[0].board);
      assert.equal(reviewed.review!.pot, handDecisions[0].potMinor);
      assert.ok(!JSON.stringify(reviewed).includes("opponent showdown"));
      const reviewSpec = await call<{ ref: Ref }>("analysis_spec_create", {
        situationId: reviewed.ref.id,
      });
      assert.equal(
        (
          await call<{ availability: string }>("analysis_preflight", {
            specId: reviewSpec.ref.id,
          })
        ).availability,
        "uncovered",
      );
      const exported = await call<{ ref: Ref; pages: number }>(
        "workspace_export",
      );
      const chunks: Buffer[] = [];
      for (let page = 0; page < exported.pages; page++) {
        const part = await call<{ data: string }>("artifact_page", {
          artifactId: exported.ref.id,
          page,
        });
        chunks.push(Buffer.from(part.data, "base64"));
      }
      const archive = Buffer.concat(chunks);
      const beforeBadImport = runtime.service.state.revision;
      const invalid = await raw("workspace_import", {
        backup: {
          checksum: "bad",
          payload: { format: "riverline-s1-backup/1", state: {}, blobs: {} },
        },
      });
      assert.equal(invalid.ok, false);
      assert.equal(runtime.service.state.revision, beforeBadImport);
      const begin = await call<{ ref: Ref }>("workspace_import", {
        backup: { phase: "begin", checksum: hash(archive) },
      });
      for (let at = 0; at < archive.length; at += 65536)
        await call("workspace_import", {
          backup: {
            phase: "chunk",
            id: begin.ref.id,
            data: archive.subarray(at, at + 65536).toString("base64"),
          },
        });
      await call("workspace_import", {
        backup: { phase: "commit", id: begin.ref.id },
      });
      await call("workspace_reset", { confirmation: "RESET LOCAL ANALYSIS" });
      assert.equal(runtime.service.state.exposures[0], "reset:unknown");
      assert.deepEqual(
        [...Object.keys(tools)].filter((n) => !called.has(n)),
        [],
        "every public business tool must actually be invoked",
      );
      assert.ok(
        evidence.every((e) => e.bytes < 131072),
        "bounded tool response",
      );
      console.log(
        JSON.stringify({
          protocol: "stdio MCP",
          toolCount: list.tools.length,
          successfulCalls: evidence.filter((e) => e.ok).length,
          resourceReads: 2,
          largestResponseBytes: Math.max(...evidence.map((e) => e.bytes)),
        }),
      );
    } finally {
      mkdirSync(".artifacts/s1", { recursive: true });
      writeFileSync(
        ".artifacts/s1/mcp-protocol-evidence.json",
        JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            workspace: "ephemeral protocol fixture, removed after test",
            called: [...called],
            calls: evidence,
          },
          null,
          2,
        ),
      );
      await client.close();
      await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
    async function waitJob(jobId: string, status: string) {
      for (let i = 0; i < 100; i++) {
        const j = await call<Job>("analysis_get", { jobId });
        if (j.status === status) return;
        assert.notEqual(j.status, "interrupted", JSON.stringify(j));
        await new Promise((r) => setTimeout(r, 75));
      }
      assert.fail(`job did not reach ${status}`);
    }
  },
);
