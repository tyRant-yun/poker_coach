import type { BotRequest } from "../../contracts/bot.ts";
import { hash } from "../store.ts";
export function baselineAction(s: BotRequest) {
  const rank = (c: string) => "23456789TJQKA".indexOf(c[0]),
    cards = s.ownCards;
  const strength =
    (rank(cards[0]) + rank(cards[1])) / 24 +
    (cards[0][0] === cards[1][0] ? 0.35 : 0) +
    (cards[0][1] === cards[1][1] ? 0.08 : 0);
  const noise =
    parseInt(hash([s.handId, s.sequence, "bot-heuristic/1"]).slice(0, 8), 16) /
    0xffffffff;
  const call = s.legal.find((a) => a.kind === "call"),
    raise = s.legal.find((a) => a.kind === "raise"),
    check = s.legal.find((a) => a.kind === "check");
  if (raise && ((strength > 0.85 && noise < 0.28) || noise < 0.035))
    return {
      kind: "raise" as const,
      amount: Math.min(
        raise.max!,
        Math.max(raise.min!, Math.max(...s.bets) + Math.round(s.pot * 0.65)),
      ),
    };
  if (
    call &&
    s.legal.some((a) => a.kind === "fold") &&
    ((call.amount! > 150 && strength < 0.45 && noise < 0.65) ||
      (call.amount! > 2000 && strength < 0.8))
  )
    return { kind: "fold" as const };
  return { kind: check ? ("check" as const) : ("call" as const) };
}
