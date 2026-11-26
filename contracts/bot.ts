import { z } from "zod";
const card = z.string().regex(/^[2-9TJQKA][cdhs]$/);
const chips = z.number().int().nonnegative().max(1000000);
export const botRequestSchema = z
  .object({
    contract: z.literal("riverline-bot/1"),
    requestId: z.string().uuid(),
    handId: z.string().uuid(),
    sessionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    sequence: z.number().int().min(0).max(300),
    playerId: z.string().min(1).max(100),
    originPlayers: z.union([z.literal(2), z.literal(6)]),
    actor: z.number().int().min(0).max(5),
    dealerSeat: z.number().int().min(0).max(5),
    street: z.number().int().min(0).max(3),
    ownCards: z.array(card).length(2),
    board: z.array(card).max(5),
    stacks: z.array(chips).min(2).max(6),
    bets: z.array(chips).min(2).max(6),
    active: z.array(z.boolean()).min(2).max(6),
    pot: chips,
    smallBlind: z.literal(50),
    bigBlind: z.literal(100),
    handIndex: z.number().int().positive(),
    history: z
      .array(
        z
          .object({
            actor: z.number().int().min(0).max(5),
            kind: z.enum(["fold", "check", "call", "raise"]),
            amount: chips.optional(),
            street: z.number().int().min(0).max(3),
          })
          .strict(),
      )
      .max(300),
    legal: z
      .array(
        z
          .object({
            kind: z.enum(["fold", "check", "call", "raise"]),
            amount: chips.optional(),
            min: chips.optional(),
            max: chips.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    seed: z.string().min(1).max(128),
    budgetMs: z.number().int().min(1).max(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      [v.stacks.length, v.bets.length, v.active.length].some(
        (n) => n !== v.originPlayers,
      ) ||
      v.actor >= v.originPlayers ||
      v.dealerSeat >= v.originPlayers ||
      v.history.some((e) => e.actor >= v.originPlayers) ||
      new Set([...v.ownCards, ...v.board]).size !==
        v.ownCards.length + v.board.length ||
      v.board.length !== [0, 3, 4, 5][v.street]
    )
      ctx.addIssue({ code: "custom", message: "观察维度/牌面/位置不一致" });
    if (
      new Set(v.legal.map((a) => a.kind)).size !== v.legal.length ||
      v.legal.some((a) =>
        a.kind === "raise"
          ? a.min === undefined || a.max === undefined || a.min > a.max
          : a.min !== undefined ||
            a.max !== undefined ||
            (a.kind === "call" && a.amount === undefined),
      )
    )
      ctx.addIssue({ code: "custom", message: "合法动作边界不一致" });
  });
export type BotRequest = z.infer<typeof botRequestSchema>;
export const botReplySchema = z
  .object({
    requestId: z.string().uuid(),
    handId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    source: z.literal("hu-v2.2.2-experimental"),
    action: z
      .object({
        kind: z.enum(["fold", "check", "call", "raise"]),
        amount: chips.optional(),
      })
      .strict(),
    elapsedMs: z.number().finite().nonnegative(),
    fallback: z.string().max(120).nullable(),
  })
  .strict();
export type BotReply = z.infer<typeof botReplySchema>;
