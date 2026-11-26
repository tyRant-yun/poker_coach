import { randomInt, randomUUID } from "node:crypto";
import { seatingSchema } from "../../src/modules/play/seating.ts";
import type { Seating } from "../../src/modules/play/seating.ts";
export function makeSeating(
  players: 2 | 6,
  config: {
    positionMode: "rotate" | "fixed" | "random";
    fixedPosition: number;
    botId: Seating["botId"];
  },
  previous?: Seating,
): Seating {
  if (config.fixedPosition >= players) throw Error("所选位置不属于当前桌型");
  const heroSeat = previous?.heroSeat ?? players - 1,
    handIndex = (previous?.handIndex ?? 0) + 1;
  const dealerSeat =
    config.positionMode === "fixed"
      ? (heroSeat - config.fixedPosition + players - 1) % players
      : config.positionMode === "random"
        ? randomInt(players)
        : previous
          ? (previous.dealerSeat + 1) % players
          : heroSeat;
  const sessionId = previous?.sessionId ?? randomUUID();
  return {
    version: "seating/1",
    sessionId,
    handIndex,
    mode: config.positionMode,
    fixedPosition: config.fixedPosition,
    dealerSeat,
    heroSeat,
    botId: config.botId,
    ruleToPhysical: Array.from(
      { length: players },
      (_, r) => (dealerSeat - (players - 1) + r + players) % players,
    ),
    playerIds:
      previous?.playerIds ??
      Array.from({ length: players }, (_, p) =>
        p === heroSeat ? "hero" : `${sessionId}:player-${p}`,
      ),
  };
}
export function validateSeating(value: unknown, players: number, hero: number) {
  const s = seatingSchema.parse(value);
  if (
    s.ruleToPhysical.length !== players ||
    s.playerIds.length !== players ||
    new Set(s.ruleToPhysical).size !== players ||
    new Set(s.playerIds).size !== players ||
    s.ruleToPhysical.some((n) => n >= players) ||
    s.dealerSeat >= players ||
    s.heroSeat >= players ||
    s.fixedPosition >= players ||
    s.ruleToPhysical[hero] !== s.heroSeat ||
    s.ruleToPhysical[players - 1] !== s.dealerSeat ||
    s.playerIds[s.heroSeat] !== "hero" ||
    (players === 6 && s.botId !== "baseline-heuristic/1")
  )
    throw Error("座位映射不一致");
  const expected = Array.from(
    { length: players },
    (_, r) => (s.dealerSeat - (players - 1) + r + players) % players,
  );
  if (expected.some((v, r) => v !== s.ruleToPhysical[r]))
    throw Error("按钮与规则位置映射不一致");
  if (s.mode === "fixed" && s.ruleToPhysical[s.fixedPosition] !== s.heroSeat)
    throw Error("固定位置与Hero不一致");
  return s;
}
