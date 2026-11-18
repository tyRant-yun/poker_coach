import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startRuntime } from "../../runtime/server.ts";
import { realTools } from "../../src/modules/analysis/real-domain.ts";
import type {
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
} from "../../src/modules/analysis/real-domain.ts";
import type { Reply } from "../../src/modules/analysis/domain.ts";

test(
  "real solver MCP: all 14 actions, same HTTP workspace, versioned artifacts, queue and permissions",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "riverline-real-mcp-")),
      runtime = startRuntime({ port: 0, directory, workspaceId: "real-mcp" });
    await once(runtime.server, "listening");
    const port = (runtime.server.address() as { port: number }).port;
    const client = new Client({ name: "real-engine-acceptance", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/mcp.mjs")],
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
    const evidence: { tool: string; ok: boolean; bytes: number }[] = [],
      called = new Set<string>();
    async function raw(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<Reply> {
      const r = await client.callTool({
        name,
        arguments: {
          workspaceId: "real-mcp",
          requestId: crypto.randomUUID(),
          expectedRevision: runtime.service.state.revision,
          ...args,
        },
      });
      const reply = r.structuredContent as Reply;
      evidence.push({
        tool: name,
        ok: reply.ok,
        bytes: Buffer.byteLength(JSON.stringify(reply)),
      });
      called.add(name);
      return reply;
    }
    async function call<T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      const reply = await raw(name, args);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      return (reply as Extract<Reply, { ok: true }>).data as T;
    }
    async function waitJob(id: string) {
      for (let n = 0; n < 500; n++) {
        const j = await call<RealJob>("real_analysis_get", { jobId: id });
        if (
          ["completed", "failed", "cancelled", "interrupted"].includes(j.status)
        )
          return j;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error("MCP job timeout");
    }
    try {
      await client.connect(transport);
      const listing = await client.listTools();
      for (const name of Object.keys(realTools))
        assert.ok(listing.tools.some((t) => t.name === name));
      const cap = await call<{ installed: boolean; dataKind: string }>(
        "real_capabilities",
      );
      assert.equal(cap.installed, true);
      assert.equal(cap.dataKind, "engine-computed");
      const c = await call<RealCase>("real_case_create", {
        name: "MCP 新局面",
        board: ["2c", "3d", "7h", "9s", "Jc"],
        pot: 1200,
        stack: 1200,
        betPercent: "100",
        ranges: [
          { AdAc: 10000, "5c4c": 10000 },
          { KdKc: 10000, "8d8c": 10000 },
        ],
      });
      const session = (await (
        await fetch(`http://127.0.0.1:${port}/api/analysis/session`)
      ).json()) as { token: string };
      const http = (await (
        await fetch(`http://127.0.0.1:${port}/api/analysis/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Riverline-Session": session.token,
          },
          body: JSON.stringify({
            tool: "real_case_revise",
            input: {
              workspaceId: "real-mcp",
              requestId: crypto.randomUUID(),
              expectedRevision: runtime.service.state.revision,
              caseId: c.ref.id,
              name: "HTTP 接手修改",
            },
          }),
        })
      ).json()) as Reply;
      assert.equal(http.ok, true);
      const workspace = await call<{ cases: RealCase[] }>("real_workspace_get");
      assert.equal(workspace.cases[0].name, "HTTP 接手修改");
      await call("real_case_revise", { caseId: c.ref.id, name: "MCP 再修改" });
      await call("range_get", { rangeId: c.ranges[0].id, limit: 10 });
      await call("range_edit_batch", {
        rangeId: c.ranges[0].id,
        patch: [{ combo: "AdAc", weight: 8000 }],
      });
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
      const job = await call<RealJob>("real_analysis_start", {
          specId: spec.ref.id,
        }),
        completed = await waitJob(job.ref.id);
      assert.equal(completed.status, "completed", completed.error);
      const solution = await call<RealSolution>("real_solution_load", {
        solutionId: completed.result!.id,
      });
      assert.equal(solution.dataKind, "engine-computed");
      assert.equal(solution.spec.contentHash, spec.ref.contentHash);
      const page = await call<{
        items: { combo: string; evBb: number | null }[];
      }>("real_solution_query", {
        solutionId: solution.ref.id,
        combos: ["AdAc"],
      });
      assert.ok(page.items[0].evBb! > 12);
      await call("real_range_aggregate", {
        solutionId: solution.ref.id,
        path: [1],
        player: 1,
      });
      await call("real_range_derive", {
        solutionId: solution.ref.id,
        action: 1,
      });
      const resources = await client.listResources();
      const resource = resources.resources.find((r) =>
        r.uri.includes("real-solutions"),
      );
      assert.ok(resource);
      await client.readResource({ uri: resource.uri });
      const strict = await call<RealSpec>("real_spec_create", {
          caseId: c.ref.id,
          targetNashConvPotFraction: 1e-9,
        }),
        cancelJob = await call<RealJob>("real_analysis_start", {
          specId: strict.ref.id,
        });
      const cancellation = await raw("real_analysis_cancel", {
        jobId: cancelJob.ref.id,
      });
      if (!cancellation.ok) assert.equal(cancellation.code, "TOO_LATE");
      const cancelled = await waitJob(cancelJob.ref.id);
      // A completed race remains complete. A deliberately queued second job gives a deterministic cancellation/retry case.
      let retrySource = cancelled;
      if (cancelled.status !== "cancelled") {
        const start = runtime.service.execute("real_analysis_start", {
          workspaceId: "real-mcp",
          requestId: crypto.randomUUID(),
          expectedRevision: runtime.service.state.revision,
          specId: strict.ref.id,
        }) as Extract<Reply, { ok: true }>;
        const queued = start.data as RealJob;
        const cancel = runtime.service.execute("real_analysis_cancel", {
          workspaceId: "real-mcp",
          requestId: crypto.randomUUID(),
          expectedRevision: runtime.service.state.revision,
          jobId: queued.ref.id,
        });
        assert.equal(cancel.ok, true);
        retrySource = await waitJob(queued.ref.id);
      }
      const retried = await call<RealJob>("real_analysis_retry", {
        jobId: retrySource.ref.id,
      });
      assert.equal(retried.attempt, 2);
      assert.equal((await waitJob(retried.ref.id)).status, "completed");
      await call("teaching_begin");
      const denied = await raw("real_solution_query", {
        solutionId: solution.ref.id,
      });
      assert.equal(denied.ok ? null : denied.code, "INFORMATION_RESTRICTED");
      assert.equal((await client.listResources()).resources.length, 0);
      const hidden = await client.readResource({ uri: resource.uri });
      assert.match(JSON.stringify(hidden), /INFORMATION_RESTRICTED/);
      const submitted = await call<{ assisted: boolean }>(
        "teaching_attempt_submit",
        { answer: "不能，需要核对来源和条件" },
      );
      assert.equal(submitted.assisted, true);
      await call("teaching_begin");
      await call("teaching_reveal");
      assert.deepEqual(
        Object.keys(realTools).filter((n) => !called.has(n)),
        [],
      );
      assert.ok(evidence.every((e) => e.bytes <= 120000));
      mkdirSync(".artifacts/solver/r2", { recursive: true });
      writeFileSync(
        ".artifacts/solver/r2/mcp-evidence.json",
        JSON.stringify(
          {
            engineCommit: solution.engineCommit,
            toolCount: Object.keys(realTools).length,
            case: c.ref,
            spec: spec.ref,
            result: solution.ref,
            calls: evidence,
          },
          null,
          2,
        ),
      );
    } finally {
      await client.close();
      await runtime.close();
      for (let i = 0; i < 100 && runtime.service.real.busy(); i++)
        await new Promise((r) => setTimeout(r, 10));
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
