import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Reply } from "../../src/modules/analysis/domain";
import type {
  RealCase,
  RealSolution,
} from "../../src/modules/analysis/real-domain";

test.setTimeout(60000);
async function connect() {
  const client = new Client({ name: "real-solver-browser", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "runtime/mcp.ts"],
      env: {
        ...process.env,
        RIVERLINE_RUNTIME:
          process.env.RIVERLINE_RUNTIME ?? "http://127.0.0.1:5174",
      },
      stderr: "pipe",
    }),
  );
  return client;
}
async function tool<T>(
  client: Client,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const workspace = await client.callTool({
    name: "workspace_get",
    arguments: { workspaceId: "local" },
  });
  const revision = (workspace.structuredContent as Extract<Reply, { ok: true }>)
    .revision;
  const result = await client.callTool({
    name,
    arguments: {
      workspaceId: "local",
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      ...input,
    },
  });
  const reply = result.structuredContent as Reply;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
test.beforeEach(async () => {
  const client = await connect();
  try {
    const state = await tool<{ independent?: unknown }>(
      client,
      "workspace_get",
    );
    if (state.independent) await tool(client, "teaching_reveal");
  } finally {
    await client.close();
  }
});

test("R2 HU: new ranges and nonfixture input → real solve → Hero/full range → derive → refresh and export", async ({
  page,
}) => {
  const name = `真实旅程 ${Date.now()}`;
  await page.goto("/solver/real");
  await expect(
    page.getByRole("heading", { name: "河牌研究", exact: true }),
  ).toBeVisible();
  await page.getByLabel("作品名称", { exact: true }).fill(name);
  await page.getByText("公共牌牌码输入", { exact: true }).click();
  await page.getByText("范围文本输入", { exact: true }).click();
  await page.getByLabel("根底池 bb", { exact: true }).fill("12.34");
  await page.getByLabel("有效后手 bb", { exact: true }).fill("20");
  await page.getByText("行动树设置", { exact: true }).click();
  await page.getByLabel("下注百分比", { exact: true }).fill("50");
  if (
    !(await page
      .getByRole("button", { name: "保存局面与范围", exact: true })
      .isVisible())
  )
    await page.getByText("分步保存与计算", { exact: true }).click();
  await page
    .getByRole("button", { name: "保存局面与范围", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("局面与范围版本已保存");
  await page.getByRole("button", { name: "固定规格并预检" }).click();
  await expect(page.getByRole("status")).toContainText("原生引擎预检通过");
  await page.getByRole("button", { name: "运行真实分析", exact: true }).click();
  await expect(
    page.getByText("执行完成", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "打开真实解", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "全范围与 Hero", exact: true }),
  ).toBeVisible();
  await expect(page.locator('button[title*="条件占比"]')).toHaveCount(169);
  await page.getByText("Hero牌码输入", { exact: true }).click();
  await page.getByLabel("Hero 具体组合", { exact: true }).fill("AcAd");
  await expect(page.getByText(/权益 100.00%/).first()).toBeVisible();
  await page
    .getByRole("button", { name: "下注至 6.17 bb", exact: true })
    .click();
  await expect(page.getByText(/IP 行动/).first()).toBeVisible();
  await page.getByRole("button", { name: "IP", exact: true }).click();
  await page.getByLabel("Hero 具体组合", { exact: true }).fill("KhKd");
  await page.getByText("组合明细与派生范围", { exact: true }).click();
  await page.getByRole("button", { name: "保存跟注后的范围" }).click();
  await expect(page.getByRole("status")).toContainText("来源与原解保留");
  const url = page.url();
  await page.reload();
  await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue(name);
  await page
    .getByRole("button", { name: "打开真实解", exact: true })
    .first()
    .click();
  await expect(page.locator('button[title*="条件占比"]')).toHaveCount(169);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出研究", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("riverline-analysis-backup.json");
  mkdirSync(".artifacts/solver/r2", { recursive: true });
  await page.screenshot({
    path: ".artifacts/solver/r2/real-river-desktop.png",
    fullPage: true,
  });
  const client = await connect();
  try {
    const state = await tool<{
      cases: RealCase[];
      solutions: { ref: { id: string } }[];
    }>(client, "real_workspace_get");
    const c = state.cases.find((c) => c.name === name)!;
    expect(c.pot).toBe(1234);
    const solution = await tool<RealSolution>(client, "real_solution_load", {
      solutionId: state.solutions.at(-1)!.ref.id,
    });
    writeFileSync(
      ".artifacts/solver/r2/journey-evidence.json",
      JSON.stringify(
        {
          url,
          case: c.ref,
          solution: solution.ref,
          spec: solution.spec,
          engineCommit: solution.engineCommit,
          binaryHash: solution.binaryHash,
          native: solution.native,
          tests: [
            "real-input",
            "hero",
            "169-matrix",
            "derived-range",
            "refresh",
            "backup",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
});

test("R2 dual entry: UI → MCP revision → UI takeover, and concurrent edits preserve draft", async ({
  page,
}) => {
  const name = `双入口 ${Date.now()}`;
  await page.goto("/solver/real");
  await page.getByLabel("作品名称", { exact: true }).fill(name);
  if (
    !(await page
      .getByRole("button", { name: "保存局面与范围", exact: true })
      .isVisible())
  )
    await page.getByText("分步保存与计算", { exact: true }).click();
  await page
    .getByRole("button", { name: "保存局面与范围", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const client = await connect();
  try {
    const state = await tool<{ cases: RealCase[] }>(
        client,
        "real_workspace_get",
      ),
      c = state.cases.find((c) => c.name === name)!;
    expect(c).toBeTruthy();
    await tool(client, "real_case_revise", {
      caseId: c.ref.id,
      name: `MCP ${name}`,
      pot: 1400,
    });
    await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue(
      `MCP ${name}`,
    );
    await expect(page.getByLabel("根底池 bb", { exact: true })).toHaveValue(
      "14",
    );
    await page.getByLabel("作品名称", { exact: true }).fill(`UI ${name}`);
    if (
      !(await page
        .getByRole("button", { name: "保存局面与范围", exact: true })
        .isVisible())
    )
      await page.getByText("分步保存与计算", { exact: true }).click();
    await page
      .getByRole("button", { name: "保存局面与范围", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("版本已保存");
    expect(
      (
        await tool<{ cases: RealCase[] }>(client, "real_workspace_get")
      ).cases.find((x) => x.ref.id === c.ref.id)!.name,
    ).toBe(`UI ${name}`);
    await page.getByLabel("作品名称", { exact: true }).fill("保留本地草稿");
    await tool(client, "real_case_revise", {
      caseId: c.ref.id,
      name: "MCP 并发新版本",
    });
    await expect(page.getByText(/当前草稿保留/)).toBeVisible();
    if (
      !(await page
        .getByRole("button", { name: "保存局面与范围", exact: true })
        .isVisible())
    )
      await page.getByText("分步保存与计算", { exact: true }).click();
    await page
      .getByRole("button", { name: "保存局面与范围", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("REVISION_CONFLICT");
    await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue(
      "保留本地草稿",
    );
    await page
      .getByRole("button", { name: "接收最新版本", exact: true })
      .click();
    await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue(
      "MCP 并发新版本",
    );
  } finally {
    await client.close();
  }
});

test("R2 exceptions: unsupported board is preserved, and independent mode blocks real UI/MCP", async ({
  page,
}) => {
  await page.goto("/solver/real");
  await page.getByLabel("根底池 bb", { exact: true }).fill("0.29");
  await page
    .getByLabel("作品名称", { exact: true })
    .fill(`未覆盖 ${Date.now()}`);
  await page.getByText("公共牌牌码输入", { exact: true }).click();
  await page.getByLabel("公共牌", { exact: true }).fill("2c 2c 7h 9s Jc");
  if (
    !(await page
      .getByRole("button", { name: "保存局面与范围", exact: true })
      .isVisible())
  )
    await page.getByText("分步保存与计算", { exact: true }).click();
  await page
    .getByRole("button", { name: "保存局面与范围", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("版本已保存");
  await page
    .getByRole("button", { name: "固定规格并预检", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("未支持");
  await expect(page.getByLabel("公共牌", { exact: true })).toHaveValue(
    "2c 2c 7h 9s Jc",
  );
  await page.getByRole("button", { name: "运行真实分析", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UNSUPPORTED_INPUT");
  const client = await connect();
  try {
    await tool(client, "teaching_begin");
    await expect(
      page.getByRole("heading", { name: "独立作答进行中" }),
    ).toBeVisible();
    await expect(page.getByLabel("OOP 输入范围", { exact: true })).toHaveCount(
      0,
    );
    const denied = await client.callTool({
      name: "real_solution_query",
      arguments: { workspaceId: "local", solutionId: "unavailable" },
    });
    expect(
      (denied.structuredContent as Extract<Reply, { ok: false }>).code,
    ).toBe("INFORMATION_RESTRICTED");
  } finally {
    await tool(client, "teaching_reveal");
    await client.close();
  }
});

test("R2 restore: MCP restores the shared workspace, clears removed result context and preserves UI draft", async ({
  page,
}) => {
  const client = await connect();
  try {
    const backup = await tool<{ ref: { id: string }; pages: number }>(
        client,
        "workspace_export",
      ),
      chunks: Buffer[] = [];
    for (let i = 0; i < backup.pages; i++) {
      const part = await tool<{ data: string }>(client, "artifact_page", {
        artifactId: backup.ref.id,
        page: i,
      });
      chunks.push(Buffer.from(part.data, "base64"));
    }
    const snapshot = JSON.parse(Buffer.concat(chunks).toString());
    await page.goto("/solver/real");
    const name = `恢复后保留草稿 ${Date.now()}`;
    await page.getByLabel("作品名称", { exact: true }).fill(name);
    if (
      !(await page
        .getByRole("button", { name: "保存局面与范围", exact: true })
        .isVisible())
    )
      await page.getByText("分步保存与计算", { exact: true }).click();
    await page
      .getByRole("button", { name: "保存局面与范围", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("版本已保存");
    const solutions = await tool<{ solutions: { ref: { id: string } }[] }>(
      client,
      "real_workspace_get",
    );
    if (solutions.solutions.length) {
      await page
        .getByRole("button", { name: /固定解 ·/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "全范围与 Hero", exact: true }),
      ).toBeVisible();
    }
    await tool(client, "workspace_import", { backup: snapshot });
    await expect(page.getByRole("status")).toContainText("草稿保留，可另存");
    await expect(
      page.getByRole("heading", { name: "全范围与 Hero", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue(
      name,
    );
    await expect(
      page.getByRole("button", { name: "固定规格并预检", exact: true }),
    ).toBeDisabled();
  } finally {
    await client.close();
  }
});
