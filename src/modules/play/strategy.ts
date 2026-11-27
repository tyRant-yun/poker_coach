import { z } from "zod";
import type { ReviewInput, ReviewNode } from "./review";

const card = "[2-9TJQKA][cdhs]";
export const comboSchema = z.string().regex(new RegExp(`^(?:${card}){2}$`));
export const strategyActionSchema = z
  .object({
    position: z.enum(["BB", "BTN/SB"]),
    kind: z.enum(["fold", "check", "call", "raise"]),
    amount: z.number().int().positive().max(10000).optional(),
  })
  .strict()
  .refine(
    (a) => (a.kind === "raise") === (a.amount !== undefined),
    "只有raise-to动作需要精确金额",
  );
const weights = z.record(comboSchema, z.number().finite().min(0).max(1));
const nodeSchema = z
  .object({
    path: z.array(strategyActionSchema).max(30),
    actor: z.enum(["BB", "BTN/SB"]),
    actions: z.array(strategyActionSchema).min(1).max(12),
    rows: z.record(
      comboSchema,
      z
        .object({
          frequencies: z
            .array(z.number().finite().min(0).max(1))
            .min(1)
            .max(12),
          actionEvBb: z.array(z.number().finite()).min(1).max(12).optional(),
        })
        .strict(),
    ),
    continuation: z.string().min(1).max(1000),
  })
  .strict();
export const strategyPackSchema = z
  .object({
    schema: z.literal("riverline-strategy/1"),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    version: z.string().min(1).max(100),
    name: z.string().min(1).max(160),
    source: z
      .object({
        kind: z.enum(["solver-export", "published-data", "synthetic-test"]),
        url: z.string().url(),
        originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
        producer: z.string().min(1).max(300),
        settings: z.string().min(1).max(4000),
        quality: z.string().min(1).max(2000),
        credit: z.string().min(1).max(500),
        localUseBasis: z.string().min(1).max(2000),
      })
      .strict(),
    rules: z
      .object({
        players: z.literal(2),
        stackCentibb: z.literal(10000),
        smallBlind: z.literal(50),
        bigBlind: z.literal(100),
        ante: z.literal(0),
        rake: z.literal("none"),
        objective: z.literal("chipEV"),
      })
      .strict(),
    metric: z
      .object({
        unit: z.literal("bb"),
        origin: z.literal("current-node"),
        invested: z.literal("sunk"),
      })
      .strict(),
    rootRanges: z.tuple([weights, weights]), // BB, BTN/SB; joint mass conditioned on card compatibility.
    nodes: z.array(nodeSchema).min(1).max(500),
  })
  .strict();
export type StrategyPack = z.infer<typeof strategyPackSchema>;
export type StrategySummary = {
  hash: string;
  id: string;
  version: string;
  name: string;
  nodes: number;
  status: "candidate" | "accepted";
  source: StrategyPack["source"];
  acceptance?: string;
};

export function canonicalCombo(combo: string) {
  const cards = [combo.slice(0, 2), combo.slice(2)];
  if (cards[0] === cards[1]) throw Error("重复私牌");
  return cards.sort().join("");
}
export const pathKey = (path: z.infer<typeof strategyActionSchema>[]) =>
  JSON.stringify(path.map((a) => [a.position, a.kind, a.amount ?? null]));

export function validateStrategyPack(raw: unknown): StrategyPack {
  const pack = strategyPackSchema.parse(raw);
  const normalize = <T>(rows: Record<string, T>) => {
    const out: Record<string, T> = {};
    if (Object.keys(rows).length > 1326) throw Error("组合超过1326");
    for (const [c, row] of Object.entries(rows)) {
      const key = canonicalCombo(c);
      if (key in out) throw Error("正反序重复组合");
      out[key] = row;
    }
    return out;
  };
  pack.rootRanges = pack.rootRanges.map(
    normalize,
  ) as StrategyPack["rootRanges"];
  for (const r of pack.rootRanges)
    if (!Object.values(r).some((w) => w > 0)) throw Error("根范围为空");
  const seen = new Set<string>();
  for (const node of pack.nodes) {
    const key = pathKey(node.path);
    if (seen.has(key)) throw Error("重复节点路径");
    seen.add(key);
    if (node.actions.some((a) => a.position !== node.actor))
      throw Error("行动者不匹配");
    if (
      new Set(node.actions.map((a) => pathKey([a]))).size !==
      node.actions.length
    )
      throw Error("重复候选行动");
    node.rows = normalize(node.rows);
    for (const row of Object.values(node.rows)) {
      if (
        row.frequencies.length !== node.actions.length ||
        Math.abs(row.frequencies.reduce((a, b) => a + b, 0) - 1) > 1e-6
      )
        throw Error("行动频率维度或概率和错误");
      if (row.actionEvBb && row.actionEvBb.length !== node.actions.length)
        throw Error("行动EV维度错误");
      const fold = node.actions.findIndex((a) => a.kind === "fold");
      if (row.actionEvBb && fold >= 0 && Math.abs(row.actionEvBb[fold]) > 1e-6)
        throw Error("当前节点沉没成本原点的弃牌EV应为0，请核对原始数据口径");
    }
  }
  return pack;
}

export function publicPath(input: ReviewInput) {
  const s = input.snapshot;
  const positions = s.session?.positions ?? ["BB", "BTN/SB"];
  return s.events
    .filter((e) => e.street === 0)
    .map((a) => ({
      position: positions[a.actor] as "BB" | "BTN/SB",
      kind: a.kind,
      ...(a.kind === "raise" ? { amount: a.amount } : {}),
    }));
}

/** Exact under this factorized HU reference; compatibility is applied jointly, not by independent normalization. */
export function derivePreflopRanges(
  pack: StrategyPack,
  path: z.infer<typeof strategyActionSchema>[],
  board: string[] = [],
) {
  const ranges = structuredClone(pack.rootRanges);
  for (let i = 0; i < path.length; i++) {
    const node = pack.nodes.find(
      (n) => pathKey(n.path) === pathKey(path.slice(0, i)),
    );
    if (!node || node.actor !== path[i].position)
      throw Error("公开历史缺少策略节点");
    const action = node.actions.findIndex(
      (a) => pathKey([a]) === pathKey([path[i]]),
    );
    if (action < 0) throw Error("树外行动，未做尺寸近似");
    const player = node.actor === "BB" ? 0 : 1;
    for (const [c, w] of Object.entries(ranges[player])) {
      if (w <= 0) continue;
      const row = node.rows[c];
      if (!row) throw Error("范围内组合缺少频率，不能默认为零");
      ranges[player][c] = w * row.frequencies[action];
    }
  }
  for (const r of ranges)
    for (const c of Object.keys(r))
      if (board.includes(c.slice(0, 2)) || board.includes(c.slice(2))) r[c] = 0;
  let jointMass = 0;
  for (const [a, wa] of Object.entries(ranges[0]))
    if (wa > 0)
      for (const [b, wb] of Object.entries(ranges[1]))
        if (
          wb > 0 &&
          ![b.slice(0, 2), b.slice(2)].some(
            (c) => a.slice(0, 2) === c || a.slice(2) === c,
          )
        )
          jointMass += wa * wb;
  if (!jointMass) throw Error("参考路径联合到达概率为零");
  return {
    ranges,
    jointMass,
    model: "compatible-HU-product-conditioned-on-public-path" as const,
  };
}

export function evaluatePreflop(
  pack: StrategyPack,
  hash: string,
  input: ReviewInput,
): Partial<ReviewNode> | undefined {
  const s = input.snapshot;
  if (
    s.players !== 2 ||
    s.street !== 0 ||
    input.root.stacks.some((v, i) => v + input.root.bets[i] !== 10000)
  )
    return;
  const path = publicPath(input);
  const node = pack.nodes.find((n) => pathKey(n.path) === pathKey(path));
  const position = (s.session?.positions ?? ["BB", "BTN/SB"])[s.hero];
  if (!node || node.actor !== position) return;
  const lineage = derivePreflopRanges(pack, path);
  const combo = canonicalCombo(s.heroCards.join(""));
  if (!(lineage.ranges[position === "BB" ? 0 : 1][combo] > 0))
    throw Error("Hero组合不在参考路径支持集");
  const row = node.rows[combo];
  if (!row) throw Error("原组合无参考数据");
  const chosen = {
    position: position as "BB" | "BTN/SB",
    kind: input.chosen.kind,
    ...(input.chosen.kind === "raise" ? { amount: input.chosen.amount } : {}),
  };
  const chosenIndex = node.actions.findIndex(
    (a) => pathKey([a]) === pathKey([chosen]),
  );
  if (chosenIndex < 0) throw Error("原行动不在参考树内，未做尺寸近似");
  if (!row.actionEvBb)
    return {
      status: "facts",
      reason: "来源只有策略频率，没有行动EV；不计算EV损失。",
      reference: { id: pack.id, hash, name: pack.name },
      referenceStrategy: node.actions.map((a, i) => ({
        action: a.kind === "raise" ? `Raise(${a.amount})` : a.kind,
        frequency: row.frequencies[i],
      })),
    };
  const actions = node.actions.map((a, i) => ({
    action: a.kind === "raise" ? `Raise(${a.amount})` : a.kind,
    frequency: row.frequencies[i],
    evBb: row.actionEvBb![i],
  }));
  return {
    status: "completed",
    quality: "source-declared",
    actions,
    chosenIndex,
    gapBb: Math.max(
      0,
      Math.max(...row.actionEvBb) - row.actionEvBb[chosenIndex],
    ),
    reference: { id: pack.id, hash, name: pack.name },
    coverage: {
      source: "declared-reference",
      actions: "partial",
      continuation: "reference-tree",
      missingActions: ["参考树之外的合法尺寸"],
      evidence: [hash, pack.source.originalSha256],
    },
    reason: `使用已人工核验接纳的固定来源；质量依据：${pack.source.quality}。后续模型：${node.continuation}。仅为参考树内行动EV差。`,
  };
}
