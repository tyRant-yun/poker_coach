import type { Input, Reply, ToolName } from "./domain";
export type Connection = {
  workspaceId: string;
  token: string;
  revision: number;
};
export async function connectAnalysis(): Promise<Connection> {
  const response = await fetch("/api/analysis/session");
  if (!response.ok) throw Error("本地运行时未连接。请使用 npm run dev 启动。");
  return response.json() as Promise<Connection>;
}
export async function callAnalysis<T>(
  connection: Connection,
  tool: ToolName,
  input: Partial<Input> = {},
): Promise<{
  data: T;
  revision: number;
  refs: Extract<Reply, { ok: true }>["artifactRefs"];
}> {
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
  const result = (await response.json()) as Reply;
  if (!result.ok) throw Error(`${result.code} · ${result.message}`);
  return {
    data: result.data as T,
    revision: result.revision,
    refs: result.artifactRefs,
  };
}
