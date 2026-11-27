import {
  turnInputSchema,
  flopInputSchema,
} from "../../contracts/solver/turn.ts";
import type { TurnInput, FlopInput } from "../../contracts/solver/turn.ts";
import { explicitRiverSchema } from "../../contracts/solver/river-tree.ts";
import type { ExplicitRiverInput } from "../../contracts/solver/river-tree.ts";
import { riverInputSchema } from "../../contracts/solver/engine.ts";
import type { RiverInput } from "../../contracts/solver/engine.ts";
import type { RealCase } from "../../src/modules/analysis/real-domain.ts";
import { hash } from "../store.ts";
export type SolverInput =
  | RiverInput
  | ExplicitRiverInput
  | TurnInput
  | FlopInput;
export function parseSolverInput(value: unknown): SolverInput {
  const raw = value as { schemaVersion: number };
  return raw?.schemaVersion === 5
    ? flopInputSchema.parse(value)
    : raw?.schemaVersion === 3 || raw?.schemaVersion === 4
      ? turnInputSchema.parse(value)
      : raw?.schemaVersion === 2
        ? explicitRiverSchema.parse(value)
        : riverInputSchema.parse(value);
}
export function caseTreeHash(c: RealCase) {
  return hash([
    c.board,
    c.pot,
    c.stack,
    c.turn ?? c.tree ?? c.betPercent,
    c.turn
      ? c.turn.kind
      : c.tree
        ? "explicit-river/v2"
        : "river-check-bet-call/v1",
  ]);
}
