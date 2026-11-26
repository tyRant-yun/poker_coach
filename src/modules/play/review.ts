import { handClasses } from "../study/domain";
import type { HandView, GameAction } from "./domain";
import type { CaseTree } from "../analysis/real-domain";

export type RangeProfile = "tight" | "standard" | "wide";
export type ReviewInput = {
  snapshot: HandView;
  root: HandView;
  prefix: GameAction[];
  sequence: number;
  chosen: GameAction;
};
export type ReviewNode = {
  sequence: number;
  street: number;
  chosen: GameAction;
  marked: boolean;
  board: string[];
  potBb: number;
  callBb: number;
  requiredEquity: number | null;
  betPotFraction: number | null;
  status:
    | "facts"
    | "queued"
    | "running"
    | "completed"
    | "unsupported"
    | "failed"
    | "cancelled";
  reason: string;
  caseId?: string;
  jobId?: string;
  solutionId?: string;
  quality?: string;
  actions?: { action: string; evBb: number; frequency: number }[];
  chosenIndex?: number;
  gapBb?: number;
  equity?: number;
  nodeEvBb?: number;
  elapsedMs?: number;
  rangeClasses?: [string[], string[]];
  rangeCounts?: [number, number];
  player?: 0 | 1;
  path?: number[];
  turnPath?: { kind: "action"; index: number }[];
};
export type ReviewReport = {
  version: "auto-review/1";
  handId: string;
  handHash: string;
  profile: RangeProfile;
  status:
    | "queued"
    | "running"
    | "completed"
    | "cancelled"
    | "interrupted"
    | "failed";
  updated: string;
  nodes: ReviewNode[];
  error?: string;
};
const labels = {
  tight: "AA KK QQ JJ TT 99 AKs AQs KQs QJs AKo",
  standard: "AA KK QQ JJ TT 99 AKs AQs KQs QJs AKo 88 77 66 JTs ATs KJs T9s",
  wide: "AA KK QQ JJ TT 99 AKs AQs KQs QJs AKo 88 77 66 JTs ATs KJs T9s 55 44 98s",
};
export const profileNames = {
  tight: "较紧参考",
  standard: "标准参考",
  wide: "较宽参考",
};
export const rangeNotice =
  "自动参考范围 v1：有限牌类假设，未按历史推断对手范围，不是翻前GTO库；结果仅适用于该范围与行动树。";
export function referenceRanges(
  board: string[],
  heroCards: string[],
  hero: 0 | 1,
  profile: RangeProfile,
) {
  const heroClass = handClasses.find((h) =>
    h.combos.some(
      (c) =>
        c === heroCards.join("") || c === [...heroCards].reverse().join(""),
    ),
  )?.label;
  return ([0, 1] as const).map((p) => {
    const selected = new Set(labels[profile].split(" "));
    if (p === hero && heroClass) selected.add(heroClass);
    return Object.fromEntries(
      handClasses
        .filter((h) => selected.has(h.label))
        .flatMap((h) => h.combos)
        .filter(
          (c) => !board.includes(c.slice(0, 2)) && !board.includes(c.slice(2)),
        )
        .map((c) => [c, 10000]),
    );
  }) as [Record<string, number>, Record<string, number>];
}
export function nodeFacts(input: ReviewInput): ReviewNode {
  const s = input.snapshot,
    call = s.legal.find((a) => a.kind === "call")?.amount ?? 0;
  return {
    sequence: input.sequence,
    street: s.street,
    chosen: input.chosen,
    marked: s.marks.includes(input.sequence),
    board: s.board,
    potBb: s.pot / 100,
    callBb: call / 100,
    requiredEquity: call > 0 ? call / (s.pot + call) : null,
    betPotFraction:
      input.chosen.kind === "raise" && s.pot > 0
        ? (input.chosen.amount! - s.bets[s.hero]) / s.pot
        : null,
    status: "facts",
    reason:
      s.street < 2
        ? "该街尚未接入真实求解；仅展示当时事实与价格，不评价行动对错。"
        : "等待检查局部模型。",
  };
}
export function autoConfiguration(input: ReviewInput, profile: RangeProfile) {
  const { root, snapshot: s, prefix, chosen } = input;
  if (s.board.length < 4) throw Error("翻前/翻牌尚未接入真实分析");
  if (
    root.active.filter(Boolean).length !== 2 ||
    s.active.filter(Boolean).length !== 2
  )
    throw Error("该街起点为多人底池，暂不进行HU评价");
  if (root.actor === null || root.pot <= 0)
    throw Error("该节点没有可求解的行动");
  const active = root.active.flatMap((a, i) => (a ? [i] : [])),
    oop = root.actor;
  const hero: 0 | 1 = s.hero === oop ? 0 : 1;
  const stack = Math.min(...active.map((i) => root.stacks[i]));
  if (stack <= 0) throw Error("该街已全下，无待评价的行动");
  const ranges = referenceRanges(root.board, s.heroCards, hero, profile);
  const amount = (a: GameAction) => a.amount!;
  const path = [...prefix];
  const toTree = (actions: GameAction[]) => {
    let wager = false;
    return actions.map((a) => {
      if (a.kind !== "raise") return { kind: a.kind };
      const kind = a.amount === stack ? "all-in" : wager ? "raise" : "bet";
      wager = true;
      return { kind, amount: amount(a) };
    });
  };
  const raise = s.legal.find((a) => a.kind === "raise");
  const candidate =
    chosen.kind === "raise"
      ? chosen.amount!
      : raise
        ? Math.min(raise.max!, Math.max(raise.min!, Math.round(s.pot / 2)))
        : 0;
  if (s.board.length === 4) {
    const bets: [number, number] = [
      Math.min(stack, Math.max(1, Math.round(root.pot / 2))),
      Math.min(stack, Math.max(1, Math.round(root.pot / 2))),
    ];
    const wagers = [
      ...prefix,
      ...(chosen.kind === "raise" ? [chosen] : []),
    ].filter((a) => a.kind === "raise");
    if (wagers.length > 1)
      throw Error("转牌再加注尚未覆盖，保留精确原行动，不做尺寸近似");
    if (wagers.length)
      bets[wagers[0].actor === oop ? 0 : 1] = wagers[0].amount!;
    else if (candidate) bets[hero] = candidate;
    // Checkdown rivers keep the automatic tree small and make the limitation explicit.
    return {
      hero,
      ranges,
      path,
      config: {
        name: `手后参考 · ${s.number} · ${input.sequence + 1}`,
        board: root.board,
        pot: root.pot,
        stack,
        betPercent: "50",
        ranges,
        turn: {
          kind: "hu-turn/4" as const,
          turnBets: bets,
          riverBets: [0, 0] as [number, number],
        },
      },
    };
  }
  const lines: unknown[][] = [];
  if (prefix.some((a) => a.kind === "raise")) lines.push(toTree(prefix));
  if (candidate)
    lines.push(
      toTree([...prefix, { actor: s.hero, kind: "raise", amount: candidate }]),
    );
  if (!lines.length)
    lines.push([
      {
        kind: "bet",
        amount: Math.min(stack, Math.max(1, Math.round(root.pot / 2))),
      },
    ]);
  return {
    hero,
    ranges,
    path,
    config: {
      name: `手后参考 · ${s.number} · ${input.sequence + 1}`,
      board: root.board,
      pot: root.pot,
      stack,
      betPercent: "50",
      ranges,
      tree: { kind: "explicit-river/v2", lines } as CaseTree,
    },
  };
}
export function actionIndex(actions: string[], action: GameAction) {
  return actions.findIndex((label) => {
    const v = label.toLowerCase();
    if (action.kind !== "raise") return v === action.kind;
    return (
      /^(bet|raise|allin|all-in)/.test(v) &&
      Number(v.match(/\d+/)?.[0]) === action.amount
    );
  });
}
