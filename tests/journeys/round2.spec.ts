import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import type { HandSummary, HandView } from "../../src/modules/play/domain";
import { Rules } from "../../runtime/game/rules";
import { hash } from "../../runtime/store";
import type { ReviewReport } from "../../src/modules/play/review";
async function call<T>(
  request: APIRequestContext,
  tool: string,
  input: Record<string, unknown> = {},
) {
  const session = await (await request.get("/api/analysis/session")).json();
  const reply = await (
    await request.post("/api/analysis/call", {
      headers: { "X-Riverline-Session": session.token },
      data: {
        tool,
        input: {
          workspaceId: session.workspaceId,
          expectedRevision: session.revision,
          requestId: crypto.randomUUID(),
          ...input,
        },
      },
    })
  ).json();
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return reply.data as T;
}
async function finish(request: APIRequestContext) {
  const list = await call<HandSummary[]>(request, "game_list");
  if (!list.length || list[0].complete) return;
  let h = await call<HandView>(request, "game_get", { handId: list[0].id });
  for (let i = 0; !h.complete && i < 40; i++) {
    const kind = h.legal.some((a) => a.kind === "fold")
      ? "fold"
      : h.legal[0].kind;
    h = await call(request, "game_act", {
      handId: h.id,
      handRevision: h.revision,
      kind,
    });
  }
}
test.beforeEach(async ({ request }) => finish(request));

test("AR1: four streets → actual automatic EV → same-solution graphical research → reference retry", async ({
  page,
  request,
}) => {
  const list = await call<HandSummary[]>(request, "game_list"),
    rules = new Rules();
  const deck = [..."23456789TJQKA"].flatMap((r) =>
    [..."cdhs"].map((s) => r + s),
  );
  const actions = [
    { actor: 1, kind: "call" as const },
    { actor: 0, kind: "check" as const },
    ...[0, 1, 2].flatMap(() => [
      { actor: 0, kind: "check" as const },
      { actor: 1, kind: "check" as const },
    ]),
  ];
  let state;
  try {
    state = await rules.replay({ players: 2, deck, actions });
  } finally {
    rules.close();
  }
  const handId = crypto.randomUUID(),
    payload = {
      version: "riverline-hands/1",
      hands: [
        {
          id: handId,
          number: (list[0]?.number ?? 0) + 1,
          revision: 0,
          players: 2,
          hero: 0,
          deck,
          actions,
          marks: [4],
          state,
          created: new Date().toISOString(),
        },
      ],
      studies: [],
    };
  await call(request, "game_import", {
    backup: { payload, checksum: hash(payload), privateReplayData: true },
  });
  await page.goto(`/hands?hand=${handId}`);
  const panel = page.getByLabel("自动复盘报告", { exact: true });
  await expect(panel).toContainText("真实局部分析 2 / 4", { timeout: 30000 });
  const streets = panel.getByRole("navigation", { name: "复盘街道" });
  await streets.getByRole("button", { name: /^翻前/ }).click();
  await expect(panel).toContainText("暂无精确匹配且已核验接纳的翻前");
  await streets.getByRole("button", { name: /^翻牌/ }).click();
  await expect(page.getByLabel("当前牌桌")).toContainText("底池");
  await streets.getByRole("button", { name: /^转牌/ }).click();
  await expect(panel.getByLabel("真实行动EV比较")).toBeVisible();
  await panel.getByText("自动范围与计算条件", { exact: true }).click();
  await expect(panel.getByLabel("自动参考范围矩阵")).toBeVisible();
  mkdirSync(".artifacts/auto-review/screenshots", { recursive: true });
  await panel.screenshot({
    path: ".artifacts/auto-review/screenshots/report-desktop.png",
  });
  const report = await call<ReviewReport>(request, "game_review_report", {
    handId,
  });
  await panel
    .getByRole("button", { name: "图形深入研究", exact: true })
    .click();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page).toHaveURL(
    new RegExp(report.nodes.find((n) => n.street === 2)!.caseId!),
  );
  await page.getByRole("link", { name: "返回原手牌", exact: true }).click();
  await panel
    .getByRole("navigation", { name: "复盘街道" })
    .getByRole("button", { name: /^河牌/ })
    .click();
  await expect(panel.getByLabel("真实行动EV比较")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: ".artifacts/auto-review/screenshots/report-mobile.png",
  });
  await panel.getByText("自动范围与计算条件", { exact: true }).click();
  await panel
    .getByLabel("自动分析参考范围", { exact: true })
    .selectOption("tight");
  await panel.getByRole("button", { name: "重新分析", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await call<ReviewReport>(request, "game_review_report", { handId }))
          .profile,
    )
    .toBe("tight");
  await expect(panel).toContainText("真实局部分析 2 / 4", { timeout: 30000 });
});

test("NJ03: reduced motion, hidden-page cancellation and leaving during playback preserve the saved hand", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("fast");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await expect(
    page.getByRole("button", { name: "跳过动作播放", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "跳过动作播放", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await finish(request);
  await page.reload();
  await page.getByLabel("行动节奏", { exact: true }).selectOption("comfort");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await expect(
    page.getByRole("button", { name: "跳过动作播放", exact: true }),
  ).toBeVisible();
  const before = await call<HandSummary[]>(request, "game_list");
  await page.getByRole("link", { name: "研究", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "独立作答进行中", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/solver\/real/);
  const after = await call<HandSummary[]>(request, "game_list");
  expect(after[0].id).toBe(before[0].id);
  await finish(request);
});
test("NJ01/03: real operation frames drive the table, block actions during playback, skip safely and restore", async ({
  page,
  request,
}) => {
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("comfort");
  await page.getByLabel("桌型", { exact: true }).selectOption("6");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  await expect(
    page.getByRole("button", { name: "跳过动作播放", exact: true }),
  ).toBeVisible();
  const h = await call<HandSummary[]>(request, "game_list");
  expect(h[0].players).toBe(6);
  await expect(
    page.getByRole("button", { name: "标记疑问", exact: true }),
  ).toBeDisabled();
  mkdirSync(".artifacts/round2/screenshots", { recursive: true });
  await page.screenshot({
    path: ".artifacts/round2/screenshots/playing.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "跳过动作播放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "标记疑问", exact: true }),
  ).toBeEnabled();
  const before = await call<HandView>(request, "game_get", { handId: h[0].id });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "标记疑问", exact: true }),
  ).toBeEnabled();
  const after = await call<HandView>(request, "game_get", { handId: h[0].id });
  expect(after.revision).toBe(before.revision);
  expect(after.events).toEqual(before.events);
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await finish(request);
});
test("NJ04/05/06: graphical board/ranges → one operation → actual solver → interactive graphs → reload", async ({
  page,
}) => {
  await page.goto("/solver/real");
  await page.getByRole("button", { name: "多尺寸与加注", exact: true }).click();
  await page
    .getByRole("button", { name: "公共牌 第1张 2c", exact: true })
    .click();
  await page.getByRole("button", { name: "选择黑桃A", exact: true }).click();
  await page.getByRole("button", { name: "应用选牌", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("与已有范围组合冲突");
  await page.getByRole("button", { name: "取消更换", exact: true }).click();
  const oop = page.locator('section[aria-label="OOP图形范围"]');
  await oop.getByRole("button", { name: "编辑范围", exact: true }).click();
  await oop.getByRole("button", { name: "OOP AKs", exact: true }).click();
  await oop.getByLabel("OOP输入权重", { exact: true }).fill("35");
  await oop.getByRole("button", { name: "应用到本牌类", exact: true }).click();
  await expect(
    oop.getByRole("button", { name: "OOP组合 AcKc", exact: true }),
  ).toContainText("35%");
  await oop.getByRole("button", { name: "完成范围编辑", exact: true }).click();
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(
    page.getByLabel("当前范围行动分布", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Hero行动EV图", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "权益", exact: true }).click();
  await expect(page.getByLabel("矩阵色标", { exact: true })).toContainText(
    "100%",
  );
  await page.getByRole("button", { name: "EV", exact: true }).click();
  await expect(page.getByLabel("矩阵色标", { exact: true })).toContainText(
    "红色负值",
  );
  await page.getByRole("button", { name: /^Hero观察组合 第1张/ }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "下注至 5 bb", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("navigation", { name: "研究行动路径" }),
  ).toContainText("下注至 5 bb");
  await page.getByRole("button", { name: "IP", exact: true }).click();
  await expect(
    page.getByLabel("当前范围行动分布", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/round2/screenshots/research.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "展开研究输入", exact: true }).click();
  await page.getByRole("button", { name: /^公共牌 第1张/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: ".artifacts/round2/screenshots/cards-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^公共牌 第1张/ }),
  ).toBeFocused();
});

test("NJ09: genuine turn solve → conditional river choice → strategy branch → frozen backup and reload", async ({
  page,
  request,
}) => {
  await page.goto("/solver/real");
  await page.getByRole("button", { name: "转牌到河牌", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "转牌研究", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^公共牌 第/ })).toHaveCount(4);
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByLabel("Hero行动EV图", { exact: true })).toBeVisible();
  await page
    .getByRole("group", { name: "当前节点行动" })
    .getByRole("button", { name: "过牌", exact: true })
    .click();
  await page
    .getByRole("group", { name: "当前节点行动" })
    .getByRole("button", { name: "过牌", exact: true })
    .click();
  await expect(page.getByLabel("合法河牌", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("合法河牌", { exact: true }).getByRole("button"),
  ).toHaveCount(48);
  await page.getByRole("button", { name: "河牌 Ac", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "研究行动路径" }),
  ).toContainText("河牌 Ac");
  await expect(page.getByText("OOP 行动", { exact: false })).toBeVisible();
  await page
    .getByRole("group", { name: "当前节点行动" })
    .getByRole("button", { name: "过牌", exact: true })
    .click();
  await page.getByRole("button", { name: "IP", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下注至 7 bb", exact: true }),
  ).toBeVisible();
  // Hero remains fixed when changing branches/players; choose an explicit live IP observation.
  await page.getByText("Hero牌码输入", { exact: true }).click();
  await page.getByLabel("Hero 具体组合", { exact: true }).fill("KdKh");
  await expect(page.getByLabel("Hero行动EV图", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".artifacts/round2/screenshots/turn-river.png",
    fullPage: true,
  });
  const jobId = new URL(page.url()).searchParams.get("job");
  expect(jobId).toBeTruthy();
  const job = await call<any>(request, "real_analysis_get", { jobId });
  const solution = await call<any>(request, "real_solution_load", {
    solutionId: job.result.id,
  });
  const root = await call<any>(request, "real_turn_solution_query", {
    solutionId: solution.ref.id,
  });
  expect(root.node.board).toHaveLength(4);
  await page.reload();
  await expect(page.getByLabel("真实结果矩阵", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("heading", { name: "转牌研究", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "展开研究输入", exact: true }).click();
  await page.getByLabel("研究起点", { exact: true }).selectOption("river");
  await expect(page.getByRole("button", { name: /^公共牌 第/ })).toHaveCount(5);
  await expect(
    page.getByText("当前局面或范围与此固定解不同", { exact: false }),
  ).toBeVisible();
  // A finished hand contributes only the turn decision prefix; its actual river stays in hand history.
  let source: any;
  for (let attempt = 0; attempt < 4 && !source; attempt++) {
    let h = await call<HandView>(request, "game_create", { players: 2 });
    let decision: number | undefined;
    for (let i = 0; !h.complete && i < 40; i++) {
      if (h.street === 2) decision = h.events.length;
      const action = h.legal.find(
        (a) => a.kind === "check" || a.kind === "call",
      )!;
      h = await call<HandView>(request, "game_act", {
        handId: h.id,
        handRevision: h.revision,
        kind: action.kind,
      });
    }
    expect(h.complete).toBe(true);
    if (decision !== undefined)
      source = await call<any>(request, "game_research", {
        handId: h.id,
        decision,
      });
  }
  expect(source).toBeTruthy();
  expect(source.root.board).toHaveLength(4);
  expect(source.snapshot.revealed).toEqual([]);
  await page.goto(`/solver/real?source=${source.id}`);
  await expect(
    page.getByRole("heading", { name: "转牌研究", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^公共牌 第/ })).toHaveCount(4);
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("只研究转牌前缀，不固定实际河牌。");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("研究问题已保存");
  await page.reload();
  await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
    "只研究转牌前缀，不固定实际河牌。",
  );
  await page.getByRole("link", { name: "返回原手牌", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/hands\\?hand=${source.handId}`));
});

test("Practice viewport: table and actions stay above the fold through Bot playback and next hand", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 608 });
  await page.goto("/play");
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await page.getByLabel("桌型", { exact: true }).selectOption("6");
  await page.getByRole("button", { name: /^(开始练习|下一手)$/ }).click();
  const table = page.getByLabel("当前牌桌", { exact: true });
  const area = page.getByRole("region", { name: "行动区", exact: true });
  await expect(area).toBeVisible();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 1280, height: 608 },
  ]) {
    await page.setViewportSize(size);
    const box = await area.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
  mkdirSync(".artifacts/practice-layout", { recursive: true });
  await page.screenshot({ path: ".artifacts/practice-layout/desktop.png" });
  const before = await table.boundingBox();
  await page.getByLabel("行动节奏", { exact: true }).selectOption("fast");
  // Sample every animation frame to catch transient collapse, not just final positions.
  await page.evaluate(() => {
    const samples: { y: number; top: number; height: number }[] = [];
    (window as any).__layoutSamples = samples;
    (window as any).__layoutSampling = true;
    const sample = () => {
      const box = document
        .querySelector('[aria-label="当前牌桌"]')
        ?.getBoundingClientRect();
      if (box) samples.push({ y: scrollY, top: box.top, height: box.height });
      if ((window as any).__layoutSampling) requestAnimationFrame(sample);
    };
    sample();
  });
  await page
    .getByRole("button", { name: /^(过牌|跟注 [0-9])/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "跳过动作播放", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "跳过动作播放", exact: true }),
  ).toBeHidden({ timeout: 30000 });
  const samples = await page.evaluate(() => {
    (window as any).__layoutSampling = false;
    return (window as any).__layoutSamples as {
      y: number;
      top: number;
      height: number;
    }[];
  });
  expect(samples.length).toBeGreaterThan(3);
  expect(Math.max(...samples.map((s) => s.y))).toBe(0);
  expect(
    Math.max(...samples.map((s) => Math.abs(s.top - before!.y))),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...samples.map((s) => Math.abs(s.height - before!.height))),
  ).toBeLessThanOrEqual(1);
  await page.getByLabel("行动节奏", { exact: true }).selectOption("instant");
  await finish(request);
  await page.reload();
  const next = page.getByRole("button", { name: "下一手", exact: true });
  await expect(next).toHaveCount(1);
  await expect(table).toBeHidden();
  await expect(page.getByLabel("自动复盘报告", { exact: true })).toBeVisible();
  const nextBox = await next.boundingBox();
  expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(608);
  await page.screenshot({ path: ".artifacts/practice-layout/finished.png" });
  await next.click();
  await expect(area).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".artifacts/practice-layout/mobile.png" });
  await finish(request);
});
