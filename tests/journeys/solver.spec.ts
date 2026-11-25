import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  Input,
  Reply,
  Situation,
  Ref,
} from "../../src/modules/analysis/domain";
test.setTimeout(90000);
async function connect() {
  const client = new Client({ name: "riverline-ui-handoff", version: "1" });
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
  input: Partial<Input> = {},
): Promise<T> {
  let reply: Reply | undefined;
  for (let retry = 0; retry < 4; retry++) {
    const state = await client.callTool({
      name: "workspace_get",
      arguments: { workspaceId: "local" },
    });
    const revision = (state.structuredContent as Extract<Reply, { ok: true }>)
      .revision;
    const response = await client.callTool({
      name,
      arguments: {
        workspaceId: "local",
        requestId: crypto.randomUUID(),
        expectedRevision: revision,
        ...input,
      },
    });
    reply = response.structuredContent as Reply;
    if (reply.ok || reply.code !== "REVISION_CONFLICT") break;
  }
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  return (reply as Extract<Reply, { ok: true }>).data as T;
}

// A failed browser assertion must not leave an independent question blocking later cases.
test.afterEach(async () => {
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

test("SJ01/02/03/04/16/17: UI ↔ real MCP; complete matrix, immutable range edits and six-player handoff", async ({
  page,
}) => {
  await page.goto("/solver");
  await expect(page.getByRole("status")).toContainText("已连接");
  await page.getByRole("button", { name: "创建分析作品", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "HU · 单加注底池", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "加载示例参考", exact: true }).click();
  await expect(page.getByText(/分母：当前节点有效范围质量/)).toBeVisible();
  await expect(page.getByLabel("全范围矩阵").getByRole("button")).toHaveCount(
    169,
  );
  const client = await connect();
  try {
    const state = await tool<{ situations: Situation[] }>(
      client,
      "workspace_get",
    );
    const current = state.situations.at(-1)!;
    const oldHash = current.ranges.BTN.contentHash;
    await tool(client, "range_edit_batch", {
      rangeId: current.ranges.BTN.id,
      patch: [{ combo: "AsAh", weight: 5000 }],
    });
    await expect(
      page.getByText("上游/范围已变更，需复核", { exact: true }),
    ).toBeVisible();
    const after = await tool<{ situations: Situation[] }>(
      client,
      "workspace_get",
    );
    expect(after.situations.at(-1)!.ranges.BTN.contentHash).not.toBe(oldHash);
    const undoSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/analysis/call") &&
        response.request().postDataJSON()?.tool === "range_undo",
    );
    await page.getByRole("button", { name: "撤销范围", exact: true }).click();
    await (await undoSaved).json();
    const undone = await tool<{ items: { combo: string; weight: number }[] }>(
      client,
      "range_get",
      { rangeId: current.ranges.BTN.id, limit: 200 },
    );
    expect(undone.items.find((c) => c.combo === "AsAh")?.weight).toBe(10000);
    const created = await tool<Situation>(client, "situation_create", {
      preset: "X-3BP",
      nodeId: "flop-deal",
      name: "MCP 创建 · 六人来源交接",
    });
    await expect(page.getByTestId(`case-${created.ref.id}`)).toBeVisible();
    await page.getByTestId(`case-${created.ref.id}`).click();
    await page
      .getByRole("button", { name: "携带范围进入翻后", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "MCP 创建 · 六人来源交接 · 翻后",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/六人背景 · 当前活跃 2 人/)).toBeVisible();
    const snapshot = await tool<{ situations: Situation[] }>(
      client,
      "workspace_get",
    );
    const handoff = snapshot.situations.find(
      (s) => s.origin?.id === created.ref.id,
    )!;
    expect(handoff.players.reduce((n, p) => n + p.contribution, 0)).toBe(1850);
    expect(handoff.board).toEqual(["Kc", "8d", "3s"]);
    await page.screenshot({
      path: ".artifacts/s1/6max-handoff.png",
      fullPage: true,
    });
  } finally {
    await client.close();
  }
});

test("SJ07/08/09/11/12/20: custom coverage, policy evaluation, controlled experiment and sourced teaching", async ({
  page,
}) => {
  const client = await connect();
  try {
    const s = await tool<Situation>(client, "situation_create", {
      preset: "X-BB",
      nodeId: "f-oop",
      name: "S1 评价与教学验收",
    });
    await page.goto("/solver");
    await expect(page.getByTestId(`case-${s.ref.id}`)).toBeVisible();
    await page.getByTestId(`case-${s.ref.id}`).click();
    await page
      .getByRole("button", { name: "加载示例参考", exact: true })
      .click();
    await expect(page.getByText(/分母：当前节点有效范围质量/)).toBeVisible();
    await page.screenshot({
      path: ".artifacts/s1/hu-range-workbench.png",
      fullPage: true,
    });
    await page.getByText("构建我的策略", { exact: true }).click();
    await page
      .getByRole("button", { name: "参考补全（记辅助）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "固定提交策略", exact: true })
      .click();
    await page
      .getByRole("button", { name: "评价固定策略", exact: true })
      .click();
    await expect(
      page.getByText("固定证据与反馈", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("频率差只对作者示例分布；没有本策略整树 EV 证据。", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "固定基准并建立锁定变体", exact: true })
      .click();
    await page
      .getByRole("button", { name: "核对比较资格", exact: true })
      .click();
    await page
      .getByLabel("有条件结论")
      .fill("只说明合成对照，不能推断真实收益。");
    await page
      .getByRole("button", { name: "保存有条件结论", exact: true })
      .click();
    await page.screenshot({
      path: ".artifacts/s1/experiment-evidence.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "开始独立概念题", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "加载示例参考", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "固定首次作答", exact: true })
      .click();
    await page
      .getByRole("button", { name: "请求有来源反馈", exact: true })
      .click();
    await expect(
      page.getByText(
        "范围必须保留桌型、位置、此前行动与模型。此处只评价来源概念，不判断真实 GTO 动作或自由文本理解。",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: ".artifacts/s1/teaching-evidence.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "安排改变条件的新题", exact: true })
      .click();
    await expect(
      page.getByText("改变条件：由 BTN 对 BB 改为 CO 开池、BTN 3-bet", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByText("自定义条件与固定输入", { exact: true }).click();
    await page.getByLabel("抽水", { exact: true }).fill("5");
    await page
      .getByRole("button", { name: "保存条件新版本", exact: true })
      .click();
    await page
      .getByRole("button", { name: "加载示例参考", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("未覆盖");
    const summary = await tool<{ situations: Situation[] }>(
      client,
      "workspace_get",
    );
    expect(summary.situations.find((x) => x.ref.id === s.ref.id)!.rake).toBe(
      0.05,
    );
  } finally {
    await client.close();
  }
});

test("SJ10/21: real MCP task survives browser close, fail-once retries and cancellation confirms", async ({
  browser,
}) => {
  const client = await connect(),
    context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("/solver");
    const s = await tool<Situation>(client, "situation_create", {
      preset: "H-SRP",
      name: "关闭页面后的任务",
    });
    const spec = await tool<{ ref: Ref }>(client, "analysis_spec_create", {
      situationId: s.ref.id,
    });
    const j = await tool<{ ref: Ref }>(client, "analysis_start", {
      specId: spec.ref.id,
      outcome: "slow",
    });
    await context.close();
    const job = await tool<{ status: string }>(client, "analysis_get", {
      jobId: j.ref.id,
    });
    expect(["queued", "running", "postprocessing"]).toContain(job.status);
    await tool(client, "analysis_cancel", { jobId: j.ref.id });
    await expect
      .poll(
        async () =>
          (
            await tool<{ status: string }>(client, "analysis_get", {
              jobId: j.ref.id,
            })
          ).status,
      )
      .toBe("cancelled");
    const reopened = await browser.newPage();
    await reopened.goto("/solver");
    await expect(reopened.getByText(j.ref.id, { exact: false })).toBeVisible();
    await reopened.close();
  } finally {
    await client.close();
    await context.close();
  }
});

test("SJ03/04: walk the actual HU action path through turn and river with fixed source and totals", async ({
  page,
}) => {
  await page.goto("/solver");
  await expect(page.getByRole("status")).toContainText("已连接");
  await page.getByRole("button", { name: "创建分析作品", exact: true }).click();
  for (const id of [
    "p1",
    "flop-deal",
    "f-oop",
    "f-ip",
    "f-response",
    "f-end",
    "t-oop",
    "t-ip",
    "t-response",
    "t-end",
    "r-oop",
    "r-ip",
    "r-response",
    "r-end",
  ]) {
    await page.getByTestId(`node-${id}`).click();
    await expect(page.getByTestId(`node-${id}`)).toHaveClass(/selected/);
  }
  await expect(page.getByLabel("Th", { exact: true })).toBeVisible();
  await expect(page.getByLabel("4c", { exact: true })).toBeVisible();
  await expect(page.getByText(/BB call/).last()).toBeVisible();
  await page.getByTestId("node-t-oop").click();
  await page.getByRole("button", { name: "加载示例参考", exact: true }).click();
  await expect(page.getByText(/分母：当前节点有效范围质量/)).toBeVisible();
  await page.screenshot({
    path: ".artifacts/s1/hu-continuation.png",
    fullPage: true,
  });
});

test("SJ05/06/08: six positions, BB walk, 4-bet/squeeze ledgers and explicit multiway unsupported", async ({
  page,
}) => {
  const client = await connect();
  try {
    await page.goto("/solver");
    await expect(page.getByRole("status")).toContainText("已连接");
    for (const preset of ["X-UTG", "X-HJ", "X-CO", "X-BTN", "X-SB", "X-WALK"]) {
      await page.getByLabel("示例路径").selectOption(preset);
      await page
        .getByRole("button", { name: "创建分析作品", exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "6-max",
      );
    }
    await expect(page.getByTestId("node-walk")).toHaveClass(/selected/);
    await expect(page.getByText(/未跟注退还 0.5bb/)).toBeVisible();
    for (const [preset, pot] of [
      ["X-4BP", 4850],
      ["X-SQ", 2600],
    ] as const) {
      const s = await tool<Situation>(client, "situation_create", {
        preset,
        nodeId: "flop-deal",
      });
      expect(s.players.reduce((n, p) => n + p.contribution, 0)).toBe(pot);
    }
    const s = await tool<Situation>(client, "situation_create", {
      preset: "X-MULTI",
      nodeId: "multi",
    });
    await page.reload();
    await expect(page.getByTestId(`case-${s.ref.id}`)).toBeVisible();
    await page.getByTestId(`case-${s.ref.id}`).click();
    await page
      .getByRole("button", { name: "加载示例参考", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("不支持");
    await page.getByText("筛选位置、回应与金额", { exact: true }).click();
    await page.getByLabel("位置筛选", { exact: true }).selectOption("CO");
    await page
      .getByLabel("行动上下文", { exact: true })
      .selectOption("面对3-bet");
    await expect(
      page
        .getByLabel("示例路径")
        .getByRole("option", { name: "6-max · CO 对 BTN 3-bet", exact: true }),
    ).toHaveCount(1);
    await page.getByLabel("筛选抽水", { exact: true }).fill("5");
    await expect(
      page.getByText("当前筛选未覆盖。已有作品和输入保留。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "创建分析作品", exact: true }),
    ).toBeDisabled();
  } finally {
    await client.close();
  }
});

test("SJ12/15/20: Agent invokes shared commands, saves trace and creates a genuinely changed-condition attempt", async ({
  page,
}) => {
  const client = await connect();
  try {
    const s = await tool<Situation>(client, "situation_create", {
      preset: "X-BB",
      nodeId: "f-response",
      name: "Agent 与迁移闭环",
    });
    await page.goto("/solver");
    await expect(page.getByTestId(`case-${s.ref.id}`)).toBeVisible();
    await page.getByTestId(`case-${s.ref.id}`).click();
    await page
      .getByRole("button", { name: "加载示例参考", exact: true })
      .click();
    await expect(page.getByText(/分母：当前节点有效范围质量/)).toBeVisible();
    await page
      .getByRole("button", { name: "Agent 建立研究对照", exact: true })
      .click();
    await expect(
      page.getByText(
        "Agent 已按应用命令完成脚本，并保存以下工具轨迹；没有调用真实 LLM。",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("button", { name: "开始独立概念题", exact: true })
      .click();
    await page
      .getByRole("button", { name: "固定首次作答", exact: true })
      .click();
    await page
      .getByRole("button", { name: "请求有来源反馈", exact: true })
      .click();
    await page
      .getByRole("button", { name: "安排改变条件的新题", exact: true })
      .click();
    await page
      .getByRole("button", { name: "开始迁移概念题", exact: true })
      .click();
    await expect(
      page.getByText(
        "CO 开池、BTN 3-bet、CO 跟注后，进入翻后的范围应从哪里来？",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "固定首次作答", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "独立概念题进行中", exact: true }),
    ).toHaveCount(0);
    const snapshot = await tool<{
      attempts: { question: string; answer: string }[];
    }>(client, "workspace_get");
    expect(snapshot.attempts.at(-1)!.answer).toBe(
      "引用 CO 跟注 3-bet 后的固定范围与行动历史",
    );
    expect(snapshot.attempts.at(-1)!.question).not.toBe("S1-source-question");
  } finally {
    await client.close();
  }
});

test("SJ13/14: readonly legacy import is idempotent and current backup roundtrips through UI chunk protocol", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "创建研究案例", exact: true }).click();
  await expect(page.getByText(/^(已保存到本地|本地存储就绪)$/)).toBeVisible();
  const readLegacy = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const q = indexedDB.open("riverline-demo-t1");
        q.onsuccess = () => resolve(q.result);
      });
      const value = await new Promise<unknown>((resolve) => {
        const q = db
          .transaction("workspace")
          .objectStore("workspace")
          .get("current");
        q.onsuccess = () => resolve(q.result);
      });
      db.close();
      return value;
    });
  const original = await readLegacy();
  await page.goto("/solver");
  await expect(page.getByRole("status")).toContainText("已连接");
  await page.getByText("旧版作品与备份", { exact: true }).click();
  await page
    .getByRole("button", { name: "只读迁移旧库原件", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已完成并保存");
  await page
    .getByRole("button", { name: "只读迁移旧库原件", exact: true })
    .click();
  expect(await readLegacy()).toEqual(original);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 S1 备份", exact: true }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  await page
    .getByLabel("导入 S1 备份", { exact: true })
    .setInputFiles(backupPath!);
  await expect(page.getByRole("status")).toContainText("已完成并保存");
  expect(await readLegacy()).toEqual(original);
});

test("SJ17/19: pending inputs survive MCP conflict and branch; saved policy resumes after refresh", async ({
  page,
}) => {
  const client = await connect();
  try {
    const original = await tool<Situation>(client, "situation_create", {
      preset: "H-SRP",
      nodeId: "f-oop",
      name: "冲突与草稿接续",
    });
    await page.goto(`/solver?case=${original.ref.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "冲突与草稿接续",
    );
    await page
      .getByText("自定义条件与固定输入", { exact: false })
      .first()
      .click();
    await page.getByLabel("筹码", { exact: true }).fill("80");
    await tool(client, "situation_revise", {
      situationId: original.ref.id,
      stack: 9000,
    });
    await page
      .getByRole("button", { name: "保存条件新版本", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("所编辑对象已更新");
    await expect(page.getByLabel("筹码", { exact: true })).toHaveValue("80");
    await page
      .getByRole("button", { name: "从原版本建立独立分支", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存条件新版本", exact: true })
      .click();
    await expect(
      page.getByText("有未应用输入，当前内容尚未保存。", { exact: true }),
    ).toHaveCount(0);
    const source = await tool<{ situations: Situation[] }>(
      client,
      "workspace_get",
    );
    expect(
      source.situations.find((s) => s.ref.id === original.ref.id)!.stack,
    ).toBe(9000);
    const branch = source.situations.find(
      (s) => s.origin?.contentHash === original.ref.contentHash,
    )!;
    expect(branch.stack).toBe(8000);
    await page.getByText("构建我的策略", { exact: true }).click();
    await page.getByLabel("策略频率", { exact: true }).fill("40");
    await page
      .getByRole("button", { name: "应用混频到 AA", exact: true })
      .click();
    await expect(
      page.getByText("有未应用输入，当前内容尚未保存。", { exact: true }),
    ).toHaveCount(0);
    const policy = await page
      .getByLabel("已保存策略", { exact: true })
      .inputValue();
    expect(policy).toBeTruthy();
    await page.reload();
    await page.getByText("构建我的策略", { exact: true }).click();
    await expect(page.getByLabel("已保存策略", { exact: true })).toHaveValue(
      policy,
    );
    await page.getByRole("button", { name: "我的策略", exact: true }).click();
    await expect(page.getByText(/已填写 .*个有效组合/)).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".artifacts/s1/pending-version-resume.png",
      fullPage: true,
    });
  } finally {
    await client.close();
  }
});

test("SJ18/21: review facts enter S1 with unknowns; legacy route cannot bypass independent question", async ({
  page,
}) => {
  await page.goto("/review");
  await page.getByRole("button", { name: "导入完整样例", exact: true }).click();
  await page
    .getByRole("button", { name: "提取行动前事实到 S1", exact: true })
    .click();
  await expect(page).toHaveURL(/solver\?case=/);
  await expect(page.getByText(/未用预置范围填补未知/)).toBeVisible();
  await page.getByRole("button", { name: "加载示例参考", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("未覆盖");
  await page
    .getByRole("button", { name: "开始独立概念题", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "独立概念题进行中", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/learn");
  await expect(
    page.getByRole("heading", { name: "S1 独立题仍在进行", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "登记辅助并阅读旧版", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "S1 独立题仍在进行", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Solver 与范围 · S1", exact: true }),
  ).toBeVisible();
  await page.goto("/practice");
  await page.getByRole("button", { name: "开始策略诊断", exact: true }).click();
  await page
    .getByRole("button", { name: "修正概率合计不足 100%", exact: true })
    .click();
  await page.getByRole("button", { name: "提交作答", exact: true }).click();
  await expect(page.getByText(/辅助作答 ·/)).toBeVisible();
});
