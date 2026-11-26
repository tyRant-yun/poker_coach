import { handClasses } from "../../src/modules/analysis/content.ts";
export function aggregateRows(
  rows: { hand: string; compatibleMass: number; allocation: number[] | null }[],
  mass: number,
  actions: string[],
  actor: number | null,
  player: number,
) {
  return {
    denominator: mass,
    frequencies: actions.map((action, index) => ({
      action,
      frequency:
        mass > 0 && actor === player
          ? rows.reduce(
              (n, r) => n + r.compatibleMass * (r.allocation?.[index] ?? 0),
              0,
            ) / mass
          : null,
    })),
    classes: handClasses.map((h) => ({
      hand: h.label,
      probability:
        mass > 0
          ? rows
              .filter((r) => r.hand === h.label)
              .reduce((n, r) => n + r.compatibleMass, 0) / mass
          : null,
    })),
  };
}
