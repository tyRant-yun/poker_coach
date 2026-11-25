import { connectAnalysis } from "../analysis/client";
import type { Reply } from "../analysis/domain";
import type { GameTool } from "./domain";

export async function gameCall<T>(
  tool: GameTool,
  input: Record<string, unknown> = {},
): Promise<T> {
  const connection = await connectAnalysis();
  const response = await fetch("/api/analysis/call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Riverline-Session": connection.token,
    },
    body: JSON.stringify({
      tool,
      input: {
        workspaceId: connection.workspaceId,
        requestId: crypto.randomUUID(),
        expectedRevision: connection.revision,
        ...input,
      },
    }),
  });
  const reply = (await response.json()) as Reply;
  if (!reply.ok) throw Error(reply.message);
  return reply.data as T;
}
