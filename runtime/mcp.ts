import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolInput, tools } from "../src/modules/analysis/domain.ts";
const address = process.env.RIVERLINE_RUNTIME ?? "http://127.0.0.1:5174";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address))
  throw Error("只允许连接本机分析运行时");
async function request(path: string, body: unknown) {
  try {
    const session = (await (
      await fetch(`${address}/api/analysis/session`)
    ).json()) as { token: string };
    return (await (
      await fetch(`${address}/api/analysis/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Riverline-Session": session.token,
        },
        body: JSON.stringify(body),
      })
    ).json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: "RUNTIME_UNAVAILABLE",
      message: "本地业务运行时未启动，请运行 npm run dev 或 npm run runtime",
      retryable: true,
    };
  }
}
const server = new Server(
  { name: "riverline-analysis", version: "0.3.0" },
  { capabilities: { tools: {}, resources: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, description]) => ({
    name,
    description,
    inputSchema: z.toJSONSchema(toolInput) as {
      type: "object";
      [key: string]: unknown;
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const result = await request("call", {
    tool: params.name,
    input: params.arguments,
  });
  const summary =
    result.ok === false
      ? { code: result.code, message: result.message }
      : {
          tool: params.name,
          workspaceId: result.workspaceId,
          revision: result.revision,
          artifactRefs: result.artifactRefs,
        };
  return {
    isError: result.ok === false,
    structuredContent: result,
    content: [{ type: "text" as const, text: JSON.stringify(summary) }],
  };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const result = await request("resources", {});
  return {
    resources: (result.resources ?? []) as {
      uri: string;
      name: string;
      mimeType: string;
    }[],
  };
});
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  const result = await request("resource", { uri: params.uri });
  return {
    contents: [
      {
        uri: params.uri,
        mimeType: "application/json",
        text: JSON.stringify(result),
      },
    ],
  };
});
await server.connect(new StdioServerTransport());
