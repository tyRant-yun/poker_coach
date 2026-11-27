import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
async function call(
  request: APIRequestContext,
  tool: string,
  input: Record<string, unknown> = {},
) {
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
}
async function finish(request: APIRequestContext) {
  const list = await call(request, "game_list");
  if (!list[0] || list[0].complete) return;
  let h = await call(request, "game_get", { handId: list[0].id });
  for (let i = 0; !h.complete && i < 100; i++) {
    const a = h.legal.find((a: any) => a.kind === "check" || a.kind === "call");
    h = await call(request, "game_act", {
      handId: h.id,
      handRevision: h.revision,
      kind: a.kind,
    });
  }
}
test.beforeEach(async ({ request }) => finish(request));
test("M1 seats/Bot: fixed BB, actual HU candidate and stable Hero at desktop/mobile", async ({
  page,
  request,
}) => {
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await page.getByLabel("桌型", { exact: true }).selectOption("2");
  await page.getByText("位置与对手", { exact: true }).click();
  await page.getByLabel("位置安排", { exact: true }).selectOption("fixed");
  await page.getByLabel("Hero位置", { exact: true }).selectOption("0");
  await page
    .getByLabel("对手", { exact: true })
    .selectOption("hu-v2.2.2-experimental");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await expect(page.locator('[data-hero="true"]')).toHaveAttribute(
    "data-position",
    "BB",
  );
  const list = await call(request, "game_list"),
    h = await call(request, "game_get", { handId: list[0].id });
  expect(h.session.botId).toBe("hu-v2.2.2-experimental");
  // The real opponent can fold before Hero acts; finished hands open in report view.
  if (h.complete)
    await page
      .getByRole("button", { name: "查看本手牌桌", exact: true })
      .click();
  expect(
    h.botDecisions.some((d: any) => d.executed === "hu-v2.2.2-experimental"),
  ).toBe(true);
  mkdirSync(".artifacts/m1/screenshots", { recursive: true });
  await page.screenshot({
    path: ".artifacts/m1/screenshots/hu-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('[data-hero="true"]')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/m1/screenshots/hu-1024.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-hero="true"]')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/m1/screenshots/hu-mobile.png",
    fullPage: true,
  });
  await finish(request);
});
test("M1 research: 128 combinations, fixed river/player/metric/Hero survives refresh and focused layout", async ({
  page,
  request,
}) => {
  const f = JSON.parse(
    readFileSync("benchmarks/solver/m1-turn-cases.json", "utf8"),
  ).cases[0];
  const c = await call(request, "real_case_create", {
    name: "M1 浏览验收",
    board: f.board,
    pot: f.pot,
    stack: f.stack,
    betPercent: "50",
    turn: { kind: "hu-turn/4", turnBets: f.turnBets, riverBets: f.riverBets },
    ranges: f.ranges.map((r: Record<string, number>) =>
      Object.fromEntries(Object.entries(r).map(([k, w]) => [k, w * 10000])),
    ),
  });
  const spec = await call(request, "real_spec_create", { caseId: c.ref.id });
  let job = await call(request, "real_analysis_start", { specId: spec.ref.id });
  for (let i = 0; !job.result && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
    job = await call(request, "real_analysis_get", { jobId: job.ref.id });
  }
  expect(job.result).toBeTruthy();
  await page.goto(`/solver/real?case=${c.ref.id}&job=${job.ref.id}`);
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page
    .getByRole("group", { name: "当前节点行动" })
    .getByRole("button", { name: "过牌", exact: true })
    .click();
  await expect(page.getByText("IP 行动", { exact: false })).toBeVisible();
  await page
    .getByRole("group", { name: "当前节点行动" })
    .getByRole("button", { name: "过牌", exact: true })
    .click();
  const chance = await call(request, "real_turn_solution_query", {
    solutionId: job.result.id,
    path: [
      { kind: "action", index: 0 },
      { kind: "action", index: 0 },
    ],
  });
  const card = chance.node.chanceCards.find((r: any) => r.probability > 0).card;
  await page.getByRole("button", { name: new RegExp(`^河牌 ${card}`) }).click();
  await page.getByRole("button", { name: "IP", exact: true }).click();
  await page.getByRole("button", { name: "EV", exact: true }).click();
  await expect
    .poll(async () => {
      const v = await call(request, "real_browse_get", {
        solutionId: job.result.id,
      });
      return v?.turnPath.length === 3 && v?.player === 1 && v?.metric === "ev";
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "IP", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "EV", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "展开研究输入", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/m1/screenshots/research-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/m1/screenshots/research-1024.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/m1/screenshots/research-mobile.png",
    fullPage: true,
  });
});
