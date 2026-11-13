import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startRuntime } from "../../runtime/server.ts";
import type { Reply } from "../../src/modules/analysis/domain.ts";

test(
  "AS-Q01/SJ19: 16MiB storage-only artifact through bounded real MCP pages",
  { timeout: 60000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "riverline-large-")),
      runtime = startRuntime({ port: 0, directory, workspaceId: "large" });
    await once(runtime.server, "listening");
    const bytes = Buffer.alloc(16 * 1024 * 1024, 0x52),
      artifact = runtime.service.store.artifact(
        bytes,
        "application/x-riverline-storage-test",
      );
    const next = structuredClone(runtime.service.state);
    next.artifacts[artifact.ref.id] = artifact;
    runtime.service.store.commit(next);
    const port = (runtime.server.address() as { port: number }).port,
      client = new Client({ name: "riverline-large-acceptance", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "runtime/mcp.ts"],
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
    try {
      await client.connect(transport);
      const digest = createHash("sha256");
      let maxBytes = 0;
      const started = performance.now();
      let peakRSS = process.memoryUsage().rss;
      for (let page = 0; page < 256; page++) {
        const reply = await client.callTool({
          name: "artifact_page",
          arguments: {
            workspaceId: "large",
            artifactId: artifact.ref.id,
            page,
          },
        });
        const value = reply.structuredContent as Reply;
        assert.equal(value.ok, true);
        const data = value.data as { data: string; pages: number };
        assert.equal(data.pages, 256);
        digest.update(Buffer.from(data.data, "base64"));
        maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(reply)));
        peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
      }
      assert.equal(digest.digest("hex"), artifact.hash);
      assert.ok(maxBytes < 131072);
      assert.ok(
        Buffer.byteLength(JSON.stringify(runtime.service.state)) < 10000,
        "workspace stores metadata, never the 16MiB artifact",
      );
      console.log(
        JSON.stringify({
          asset: "AS-Q01 storage-only, not poker data",
          bytes: bytes.length,
          pages: 256,
          maxMcpResponseBytes: maxBytes,
          elapsedMs: Math.round(performance.now() - started),
          testRuntimePeakRSS: peakRSS,
        }),
      );
    } finally {
      await client.close();
      await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
