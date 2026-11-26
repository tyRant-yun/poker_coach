import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import type { HandSummary, HandView } from "../../src/modules/play/domain";
import type { Reply } from "../../src/modules/analysis/domain";

async function call<T>(
  request: APIRequestContext,
  tool: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const session = await (await request.get("/api/analysis/session")).json();
  const result = await request.post("/api/analysis/call", {
    headers: { "X-Riverline-Session": session.token },
    data: {
      tool,
      input: {
        workspaceId: "local",
        requestId: crypto.randomUUID(),
        expectedRevision: session.revision,
        ...input,
      },
    },
  });
  const reply = (await result.json()) as Reply;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return (reply as { data: T }).data;
}
async function finish(request: APIRequestContext) {
  const list = await call<HandSummary[]>(request, "game_list");
  if (!list[0] || list[0].complete) return;
  let h = await call<HandView>(request, "game_get", { handId: list[0].id });
  for (let i = 0; !h.complete && i < 45; i++) {
    const a = h.legal.find((a) => a.kind === "check" || a.kind === "call")!;
    h = await call(request, "game_act", {
      handId: h.id,
      handRevision: h.revision,
      kind: a.kind,
    });
  }
}
async function playHand(page: Page) {
  for (let i = 0; i < 45; i++) {
    if (
      await page
        .getByRole("button", { name: "复盘这手牌", exact: true })
        .isVisible()
    )
      return;
    const action = page
      .getByRole("button", { name: /^(过牌|跟注 \d)/ })
      .first();
    await expect(action).toBeEnabled();
    await action.click();
    await expect(page.getByRole("status")).toHaveCount(0);
  }
  throw Error("hand did not finish");
}
test.afterEach(async ({ request }) => {
  await finish(request);
});

test("full hand → historical decision → saved question → actual river tree research → original hand", async ({
  page,
  request,
}) => {
  await finish(request);
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await page.getByLabel("桌型", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await expect(
    page.getByRole("heading", { name: "整手练习", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "标记疑问", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "标记疑问", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已标记疑问", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "已标记疑问", exact: true }),
  ).toBeDisabled();
  mkdirSync(".artifacts/first-round/screenshots", { recursive: true });
  await page.screenshot({
    path: ".artifacts/first-round/screenshots/practice-desktop.png",
    fullPage: true,
  });
  await playHand(page);
  const list = await call<HandSummary[]>(request, "game_list"),
    hand = await call<HandView>(request, "game_get", { handId: list[0].id });
  expect(hand.complete).toBe(true);
  expect(hand.decisions.some((d) => d.street === 3)).toBe(true);
  await page.getByRole("button", { name: "复盘这手牌", exact: true }).click();
  await page
    .getByRole("button", { name: /^翻前 ·/ })
    .first()
    .click();
  await expect(page.getByText("返回整手结果", { exact: true })).toBeVisible();
  await expect(
    page.locator('[aria-label="当前牌桌"] [aria-label]'),
  ).not.toHaveCount(0);
  await page
    .getByRole("button", { name: /^河牌 ·/ })
    .first()
    .click();
  await page.getByRole("button", { name: "研究此决策", exact: true }).click();
  await expect(
    page.getByText("原决策与研究笔记", { exact: true }),
  ).toBeVisible();
  if (!(await page.getByLabel("研究问题", { exact: true }).isVisible()))
    await page.getByText("原决策与研究笔记", { exact: true }).click();
  await expect(page.getByLabel("研究问题", { exact: true })).toBeVisible();
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("下注尺度改变后，我的回应范围如何变化？");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("研究问题已保存");
  await page.reload();
  if (!(await page.getByLabel("研究问题", { exact: true }).isVisible()))
    await page.getByText("原决策与研究笔记", { exact: true }).click();
  await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
    "下注尺度改变后，我的回应范围如何变化？",
  );
  if (
    await page
      .getByRole("button", { name: "展开研究输入", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "展开研究输入", exact: true })
      .click();
  await expect(
    page.getByLabel("OOP 输入范围", { exact: true }),
  ).not.toHaveValue("");
  await page.getByText("范围文本输入", { exact: true }).click();
  const board = (
    await page.getByLabel("公共牌", { exact: true }).inputValue()
  ).split(" ");
  const cards = [..."23456789TJQKA"]
    .flatMap((r) => [..."cdhs"].map((s) => r + s))
    .filter((c) => !board.includes(c));
  await page
    .getByLabel("OOP 输入范围", { exact: true })
    .fill(`${cards[0]}${cards[1]}:100`);
  await page
    .getByLabel("IP 输入范围", { exact: true })
    .fill(`${cards[2]}${cards[3]}:100`);
  await page.getByText("分步保存与计算", { exact: true }).click();
  await page
    .getByRole("button", { name: "保存局面与范围", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page
    .getByRole("button", { name: "固定规格并预检", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("预检通过");
  await page.getByRole("button", { name: "运行真实分析", exact: true }).click();
  await page
    .getByRole("button", { name: "打开真实解", exact: true })
    .first()
    .click();
  await expect(page.locator('button[title*="条件占比"]')).toHaveCount(169);
  await page.getByRole("button", { name: "权益", exact: true }).click();
  await page.getByRole("button", { name: "EV", exact: true }).click();
  await page.screenshot({
    path: ".artifacts/first-round/screenshots/research-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "返回原手牌", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "手牌复盘", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("本手结束", { exact: false }).first(),
  ).toBeVisible();
});

test("6-max full hand: API/DOM references blocked until terminal, legal custom amounts, mobile layout", async ({
  page,
  request,
}) => {
  await finish(request);
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await page.getByLabel("桌型", { exact: true }).selectOption("6");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await expect(
    page.getByRole("button", { name: "标记疑问", exact: true }),
  ).toBeVisible();
  const list = await call<HandSummary[]>(request, "game_list");
  expect(list[0].players).toBe(6);
  const session = await (await request.get("/api/analysis/session")).json();
  const denied = await (
    await request.post("/api/analysis/call", {
      headers: { "X-Riverline-Session": session.token },
      data: { tool: "real_workspace_get", input: { workspaceId: "local" } },
    })
  ).json();
  expect(denied.code).toBe("INFORMATION_RESTRICTED");
  await page.getByRole("link", { name: "研究", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "独立作答进行中" }),
  ).toBeVisible();
  await expect(page.getByLabel("OOP 输入范围", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "返回作答", exact: true }).click();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  }
  await page.screenshot({
    path: ".artifacts/first-round/screenshots/practice-mobile.png",
    fullPage: true,
  });
  const input = page.getByLabel("下注/加注至 bb", { exact: true });
  if (await input.isVisible()) {
    await input.fill("0.01");
    await page.getByRole("button", { name: "下注/加注", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("金额不在合法范围");
  }
  await playHand(page);
  await page.getByRole("button", { name: "复盘这手牌", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "手牌复盘", exact: true }),
  ).toBeVisible();
});
