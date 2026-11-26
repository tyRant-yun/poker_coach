import { z } from "zod";
import { riverInputSchema } from "./engine.ts";
export const turnPathSchema = z
  .array(
    z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("action"),
          index: z.number().int().min(0).max(128),
        })
        .strict(),
      z
        .object({
          kind: z.literal("deal"),
          card: z.string().regex(/^[2-9TJQKA][cdhs]$/),
        })
        .strict(),
    ]),
  )
  .max(24);
export type TurnPath = z.infer<typeof turnPathSchema>;
export const turnProfileSchema = z
  .object({
    kind: z.literal("hu-turn/3"),
    turnBets: z.tuple([
      z.number().int().nonnegative().max(1000000),
      z.number().int().nonnegative().max(1000000),
    ]),
    riverBets: z.tuple([
      z.number().int().nonnegative().max(1000000),
      z.number().int().nonnegative().max(1000000),
    ]),
  })
  .strict();
export type TurnProfile = z.infer<typeof turnProfileSchema>;
export const turnInputSchema = riverInputSchema
  .omit({ sizes: true })
  .extend({
    schemaVersion: z.literal(3),
    board: riverInputSchema.shape.board.element.array().length(4),
    turnBets: turnProfileSchema.shape.turnBets,
    riverBets: turnProfileSchema.shape.riverBets,
    locks: z.tuple([]).default([]),
    limits: riverInputSchema.shape.limits
      .extend({
        maxMemoryBytes: z.number().int().min(1).max(268435456),
        maxSeconds: z.number().int().min(1).max(120),
      })
      .strict(),
  })
  .strict();
export type TurnInput = z.infer<typeof turnInputSchema>;
export const turnNodeSchema = z
  .object({
    path: turnPathSchema,
    privateCards: z.tuple([
      z.array(z.string()).max(16),
      z.array(z.string()).max(16),
    ]),
    kind: z.enum(["decision", "chance", "terminal"]),
    board: z
      .array(z.string().regex(/^[2-9TJQKA][cdhs]$/))
      .min(4)
      .max(5),
    terminal: z.boolean(),
    player: z.union([z.literal(0), z.literal(1)]).nullable(),
    actions: z.array(z.string()).max(3),
    chanceCards: z
      .array(
        z
          .object({
            card: z.string().regex(/^[2-9TJQKA][cdhs]$/),
            probability: z.number().finite().min(0).max(1).nullable(),
          })
          .strict(),
      )
      .max(48),
    invested: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    weights: z.tuple([
      z.array(z.number().finite().nonnegative()).max(16),
      z.array(z.number().finite().nonnegative()).max(16),
    ]),
    compatibleWeights: z.tuple([
      z.array(z.number().finite().nonnegative()).max(16),
      z.array(z.number().finite().nonnegative()).max(16),
    ]),
    equity: z.tuple([
      z.array(z.number().finite()).max(16),
      z.array(z.number().finite()).max(16),
    ]),
    ev: z.tuple([
      z.array(z.number().finite()).max(16),
      z.array(z.number().finite()).max(16),
    ]),
    actionEv: z.array(z.number().finite()).max(48),
    strategy: z.array(z.number().finite().min(0).max(1.000001)).max(48),
  })
  .strict();
export type TurnNode = z.infer<typeof turnNodeSchema>;
