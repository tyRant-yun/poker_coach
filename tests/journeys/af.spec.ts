import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { strategyFixture } from "../helpers/strategy-fixture";
async function finish(request: APIRequestContext) {
  const invoke = async (tool: string, input = {}) => {
    const session = await (await request.get("/api/analysis/session")).json();
    const r = await (
      await request.post("/api/analysis/call", {
        headers: { "X-Riverline-Session": session.token },
        data: {
          tool,
          input: {
            workspaceId: session.workspaceId,
            requestId: crypto.randomUUID(),
            expectedRevision: session.revision,
            ...input,
          },
        },
      })
    ).json();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.data;
  };
  const list = await invoke("game_list");
  if (!list[0] || list[0].complete) return;
  let hand = await invoke("game_get", { handId: list[0].id });
  for (let i = 0; !hand.complete && i < 45; i++) {
    const a =
      hand.legal.find((a: { kind: string }) => a.kind === "fold") ??
      hand.legal.find(
        (a: { kind: string }) => a.kind === "check" || a.kind === "call",
      );
    hand = await invoke("game_act", {
      handId: hand.id,
      handRevision: hand.revision,
      kind: a.kind,
    });
  }
}
test.beforeEach(async ({ request }) => finish(request));

test("AF FJ01: natural HU hand ends directly in charts, marked review is first, original decision survives research return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await page.getByLabel("桌型", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await page.getByRole("button", { name: "标记疑问", exact: true }).click();
  let complete = false;
  for (let i = 0; i < 45; i++) {
    if (
      await page
        .getByRole("button", { name: "复盘这手牌", exact: true })
        .isVisible()
    ) {
      complete = true;
      break;
    }
    const action = page
      .getByLabel("行动区", { exact: true })
      .getByRole("button", { name: /^(过牌|跟注 \d)/ })
      .first();
    await expect
      .poll(
        async () =>
          (await page
            .getByRole("button", { name: "复盘这手牌", exact: true })
            .isVisible()) || (await action.isEnabled().catch(() => false)),
      )
      .toBe(true);
    if (
      await page
        .getByRole("button", { name: "复盘这手牌", exact: true })
        .isVisible()
    ) {
      complete = true;
      break;
    }
    await action.click();
  }
  expect(complete).toBe(true);
  const panel = page.getByLabel("自动复盘报告", { exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("四街决定EV差时间线")).toBeVisible();
  expect((await panel.boundingBox())!.y).toBeLessThan(300);
  await expect(page.getByLabel("当前牌桌", { exact: true })).toBeHidden();
  await expect(
    page.getByRole("button", { name: "下一手", exact: true }),
  ).toBeInViewport();
  mkdirSync(".artifacts/af/screenshots", { recursive: true });
  await page.screenshot({
    path: ".artifacts/af/screenshots/hand-end-report.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "复盘这手牌", exact: true }).click();
  const selected = page.locator(
    '[aria-label="自动复盘报告"] button[aria-pressed="true"]',
  );
  await expect(selected.filter({ hasText: "疑问" })).not.toHaveCount(0);
  expect((await panel.boundingBox())!.y).toBeLessThan(
    (await page.getByLabel("当前牌桌", { exact: true }).boundingBox())!.y,
  );
  await page.getByRole("button", { name: "研究此决策", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "翻前决策研究", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回原手牌", exact: true }).click();
  await expect(page).toHaveURL(/decision=\d+/);
  await expect(panel.getByLabel("本决定建议")).toContainText("暂不评价");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/af/screenshots/report-mobile.png",
    fullPage: true,
  });
});

test("AF FJ02: native flop three-street preset → turn deal → same-solution refresh, Hero chart before matrix", async ({
  page,
}) => {
  await page.goto("/solver/real");
  await page.getByRole("button", { name: "翻牌三街研究", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "翻牌研究", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^公共牌 第/ })).toHaveCount(3);
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  const actions = page.getByRole("group", { name: "当前节点行动" });
  await actions
    .getByRole("button", { name: "下注至 1 bb", exact: true })
    .click();
  await actions.getByRole("button", { name: "跟注", exact: true }).click();
  await expect(page.getByLabel("合法转牌", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "转牌 3s", exact: true }).click();
  const path = page.getByRole("navigation", { name: "研究行动路径" });
  await expect(path).toContainText("转牌 3s");
  const url = page.url();
  await expect(
    page.getByLabel("研究位置保存状态", { exact: true }),
  ).toContainText("已保存");
  await page.reload();
  await expect(path).toContainText("转牌 3s");
  expect(page.url()).toBe(url);
  await expect(page.getByLabel("Hero行动EV图", { exact: true })).toBeVisible();
  expect(
    (await page.getByLabel("Hero行动EV图", { exact: true }).boundingBox())!.y,
  ).toBeLessThan(
    (await page.getByLabel("真实结果矩阵", { exact: true }).boundingBox())!.y,
  );
  await page.screenshot({
    path: ".artifacts/af/screenshots/flop-turn-research.png",
    fullPage: true,
  });
});

test("AF FJ03: imported synthetic strategy remains a visible candidate and cannot become a real answer", async ({
  page,
}) => {
  await page.goto("/hands");
  await expect(page.getByLabel("自动复盘报告", { exact: true })).toBeVisible();
  await page.getByText("翻前数据来源与导入", { exact: true }).click();
  await page
    .getByLabel("导入固定策略包（JSON）", { exact: true })
    .setInputFiles({
      name: "synthetic-protocol.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(strategyFixture())),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "待核验候选" }),
  ).toBeVisible();
  await expect(page.getByText(/合成协议测试，非策略答案/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "按已完成核验接纳", exact: true }),
  ).toBeDisabled();
});
