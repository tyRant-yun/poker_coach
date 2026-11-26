import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startRuntime } from "../../runtime/server.ts";
import { gameTools } from "../../src/modules/play/domain.ts";
import type {
  HandView,
  ResearchSource,
} from "../../src/modules/play/domain.ts";
import type { RealCase } from "../../src/modules/analysis/real-domain.ts";
import type { Reply } from "../../src/modules/analysis/domain.ts";

test(
  "whole-hand MCP: all 15 tools, shared HTTP state, reference guards and replay backup",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "hands-mcp-")),
      runtime = startRuntime({ port: 0, directory });
    await once(runtime.server, "listening");
    const address = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
    const client = new Client({ name: "hands-acceptance", version: "1" }),
      called = new Set<string>();
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("scripts/mcp.mjs")],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (v): v is [string, string] => v[1] !== undefined,
            ),
          ),
          RIVERLINE_RUNTIME: address,
        },
        stderr: "pipe",
      }),
    );
    const raw = async (name: string, input: Record<string, unknown> = {}) => {
      called.add(name);
      const result = await client.callTool({
        name,
        arguments: {
          workspaceId: "local",
          requestId: crypto.randomUUID(),
          expectedRevision: runtime.service.state.revision,
          ...input,
        },
      });
      return result.structuredContent as Reply;
    };
    const call = async <T>(
      name: string,
      input: Record<string, unknown> = {},
    ): Promise<T> => {
      const r = await raw(name, input);
      assert.equal(r.ok, true, JSON.stringify(r));
      return (r as { data: T }).data;
    };
    try {
      const list = await client.listTools();
      for (const name of Object.keys(gameTools))
        assert(list.tools.some((t) => t.name === name));
      assert.deepEqual(await call("game_list"), []);
      assert.equal((await call<unknown[]>("game_bot_list")).length, 2);
      let h = await call<HandView>("game_create", { players: 2 });
      const session = (await (
        await fetch(`${address}/api/analysis/session`)
      ).json()) as { token: string };
      const http = (await (
        await fetch(`${address}/api/analysis/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Riverline-Session": session.token,
          },
          body: JSON.stringify({
            tool: "game_get",
            input: { workspaceId: "local", handId: h.id },
          }),
        })
      ).json()) as { data: HandView };
      assert.deepEqual(http.data, h);
      await call("game_transition_query", {
        handId: h.id,
        handRevision: h.revision,
        batchId: h.transition!.batchId,
        limit: 2,
      });
      assert.equal((await raw("real_workspace_get")).ok, false);
      assert.equal((await raw("game_export")).ok, false);
      assert.equal((await client.listResources()).resources.length, 0);
      h = await call("game_mark", { handId: h.id, decision: h.events.length });
      for (let i = 0; !h.complete && i < 40; i++) {
        const a = h.legal.find((a) => a.kind === "check" || a.kind === "call")!;
        h = await call("game_act", {
          handId: h.id,
          handRevision: h.revision,
          kind: a.kind,
        });
      }
      assert(h.complete);
      const sequence = h.decisions.find((d) => d.street === 3)!.sequence;
      const view = await call<HandView>("game_review", {
        handId: h.id,
        decision: h.decisions[0].sequence,
      });
      assert.deepEqual(view.board, []);
      assert.deepEqual(view.revealed, []);
      const source = await call<ResearchSource>("game_research", {
        handId: h.id,
        decision: sequence,
      });
      assert(source.eligible);
      assert.deepEqual(
        await call("game_study_get", { studyId: source.id }),
        source,
      );
      await call("game_study_note", {
        studyId: source.id,
        note: "研究范围假设",
      });
      const cards = [..."23456789TJQKA"]
        .flatMap((r) => [..."cdhs"].map((s) => r + s))
        .filter((c) => !source.root!.board.includes(c));
      const c = await call<RealCase>("real_case_create", {
        name: "从整手派生",
        board: source.root!.board,
        pot: source.root!.pot,
        stack: source.root!.stack,
        betPercent: "50",
        ranges: [
          { [cards[0] + cards[1]]: 10000 },
          { [cards[2] + cards[3]]: 10000 },
        ],
      });
      const bound = await call<ResearchSource>("game_study_link", {
        studyId: source.id,
        caseId: c.ref.id,
      });
      assert.deepEqual(bound.caseRef, c.ref);
      const backup = await call("game_export");
      await call("game_import", { backup });
      const next = await call<HandView>("game_next", { handId: h.id });
      assert.notEqual(next.id, h.id);
      assert.equal(next.hero, h.hero, "Hero physical seat stays fixed");
      assert.notEqual(
        next.session!.positions[next.hero],
        h.session!.positions[h.hero],
      );
      await call("game_get", { handId: next.id });
      for (const tool of Object.keys(gameTools)) assert(called.has(tool), tool);
    } finally {
      await client.close();
      await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
