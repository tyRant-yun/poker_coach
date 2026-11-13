import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Reply, Ref } from "../../src/modules/analysis/domain.ts";

test(
  "SJ21: kill the actual runtime, reopen its disk journal and retry fixed input through real MCP",
  { timeout: 60000 },
  async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "riverline-process-recovery-"),
    );
    let processHandle: ChildProcess | undefined;
    let client: Client | undefined;
    async function start(port = 0) {
      const child = fork("runtime/server.ts", [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          RIVERLINE_DATA: directory,
          RIVERLINE_WORKSPACE: "recovery",
          RIVERLINE_PORT: String(port),
        },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      processHandle = child;
      const [ready] = (await once(child, "message")) as [
        { ready: boolean; port: number },
      ];
      assert.equal(ready.ready, true);
      client = new Client({ name: "riverline-process-recovery", version: "1" });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ["--import", "tsx", "runtime/mcp.ts"],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (v): v is [string, string] => v[1] !== undefined,
              ),
            ),
            RIVERLINE_RUNTIME: `http://127.0.0.1:${ready.port}`,
          },
          stderr: "pipe",
        }),
      );
      return ready.port;
    }
    async function call<T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      for (let i = 0; i < 5; i++) {
        const snapshot = await client!.callTool({
          name: "workspace_get",
          arguments: { workspaceId: "recovery" },
        });
        const revision = (
          snapshot.structuredContent as Extract<Reply, { ok: true }>
        ).revision;
        const response = await client!.callTool({
          name,
          arguments: {
            workspaceId: "recovery",
            requestId: crypto.randomUUID(),
            expectedRevision: revision,
            ...args,
          },
        });
        const r = response.structuredContent as Reply;
        if (!r.ok && r.code === "REVISION_CONFLICT") continue;
        assert.equal(r.ok, true, JSON.stringify(r));
        return (r as Extract<Reply, { ok: true }>).data as T;
      }
      throw Error("Repeated version conflict");
    }
    try {
      const port = await start();
      const s = await call<{ ref: Ref }>("situation_create", {
          preset: "H-SRP",
        }),
        spec = await call<{ ref: Ref }>("analysis_spec_create", {
          situationId: s.ref.id,
        });
      const job = await call<{ ref: Ref }>("analysis_start", {
        specId: spec.ref.id,
        outcome: "slow",
      });
      await new Promise((r) => setTimeout(r, 400));
      const exited = once(processHandle!, "exit");
      processHandle!.kill("SIGKILL");
      await exited;
      await client!.close();
      await start(port);
      const restored = await call<{ status: string; spec: Ref }>(
        "analysis_get",
        { jobId: job.ref.id },
      );
      assert.equal(restored.status, "interrupted");
      assert.deepEqual(restored.spec, spec.ref);
      const retry = await call<{ ref: Ref; spec: Ref; attempt: number }>(
        "analysis_retry",
        { jobId: job.ref.id },
      );
      assert.equal(retry.attempt, 2);
      assert.deepEqual(retry.spec, spec.ref);
      await call("analysis_cancel", { jobId: retry.ref.id });
      for (let i = 0; i < 30; i++) {
        const j = await call<{ status: string; result?: Ref }>("analysis_get", {
          jobId: retry.ref.id,
        });
        if (j.status === "cancelled") {
          assert.equal(j.result, undefined);
          return;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.fail("Cancellation was not acknowledged");
    } finally {
      await client?.close();
      if (processHandle && processHandle.exitCode === null) {
        const exit = once(processHandle, "exit");
        processHandle.kill("SIGKILL");
        await exit;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
