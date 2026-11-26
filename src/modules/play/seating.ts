import { z } from "zod";
export const positions = (players: number) =>
  players === 2 ? ["BB", "BTN/SB"] : ["SB", "BB", "UTG", "HJ", "CO", "BTN"];

export const botIdSchema = z.enum([
  "baseline-heuristic/1",
  "hu-v2.2.2-experimental",
]);
export const seatingSchema = z
  .object({
    version: z.literal("seating/1"),
    sessionId: z.string().uuid(),
    handIndex: z.number().int().positive(),
    mode: z.enum(["rotate", "fixed", "random"]),
    fixedPosition: z.number().int().min(0).max(5),
    dealerSeat: z.number().int().min(0).max(5),
    heroSeat: z.number().int().min(0).max(5),
    ruleToPhysical: z.array(z.number().int().min(0).max(5)).min(2).max(6),
    playerIds: z.array(z.string().min(1)).min(2).max(6),
    botId: botIdSchema,
  })
  .strict();
export type Seating = z.infer<typeof seatingSchema>;
export type SeatContext = Omit<Seating, "ruleToPhysical"> & {
  positions: string[];
};
export function seatContext(layout: Seating): SeatContext {
  const { ruleToPhysical, ...rest } = layout;
  const labels = positions(ruleToPhysical.length),
    mapped = Array<string>(labels.length);
  ruleToPhysical.forEach((physical, rule) => (mapped[physical] = labels[rule]));
  return { ...rest, positions: mapped };
}
