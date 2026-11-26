import type { TurnPage } from "../../contracts/solver/turn.ts";
import type { TurnInput } from "../../contracts/solver/turn.ts";
import type {
  RealInputs,
  RealSolution,
} from "../../src/modules/analysis/real-domain.ts";
import {
  allCombos,
  handByCombo,
  handClasses,
  legalCombo,
} from "../../src/modules/analysis/content.ts";
const canonical = new Map(
  allCombos.flatMap((c) => [
    [c, c],
    [c.slice(2) + c.slice(0, 2), c],
  ]),
);
const normalize = (c: string) => {
  const value = canonical.get(c);
  if (!value) throw Error("VALIDATION_ERROR: invalid combo");
  return value;
};
type Query = RealInputs["real_turn_solution_query"];
export function turnSelection(
  input: TurnInput,
  cards: [string[], string[]],
  a: Query,
) {
  const indicesByCombo = new Map(
    cards[a.player].map((c, i) => [normalize(c), i]),
  );
  let combos = a.combos ? a.combos.map(normalize) : allCombos;
  if (a.hand) combos = combos.filter((c) => handByCombo[c] === a.hand);
  if (a.inRangeOnly)
    combos = combos.filter((c) => (input.ranges[a.player][c] ?? 0) > 0);
  const selected = combos.slice(a.offset, a.offset + a.limit);
  return {
    selected,
    total: combos.length,
    selection: {
      player: a.player,
      indices: [
        ...new Set(
          selected.flatMap((c) =>
            indicesByCombo.has(c) ? [indicesByCombo.get(c)!] : [],
          ),
        ),
      ],
    },
  };
}
export function projectTurnPage(
  solution: RealSolution,
  input: TurnInput,
  a: Query,
  selection: ReturnType<typeof turnSelection>,
  page: TurnPage,
) {
  const mass = page.aggregate.denominator,
    n = page.node,
    byCombo = new Map(page.rows.map((r) => [normalize(r.combo), r]));
  const rows = selection.selected.map((combo) => {
    const row = byCombo.get(combo),
      dead = !legalCombo(combo, n.board),
      weight = row?.weight ?? 0,
      compatible = row?.compatibleMass ?? 0,
      reachable = !dead && !!row && weight > 0 && compatible > 0;
    return {
      combo,
      hand: handByCombo[combo],
      dead,
      inputWeight: input.ranges[a.player][combo] ?? 0,
      ownReachWeight: weight,
      compatibleMass: compatible,
      conditionalProbability: mass > 0 ? compatible / mass : null,
      availability: dead
        ? "dead"
        : !row
          ? "outside-input-range"
          : !reachable
            ? "unreachable"
            : "available",
      allocation: reachable ? row.strategy : null,
      equity: reachable ? row.equity : null,
      evBb: reachable ? row.ev / 100 : null,
      actionEvBb: reachable
        ? (row.actionEv?.map((v) => v / 100) ?? null)
        : null,
    };
  });
  const returned = n.terminal
    ? [
        Math.max(0, n.invested[0] - n.invested[1]),
        Math.max(0, n.invested[1] - n.invested[0]),
      ]
    : [0, 0];
  return {
    solution: solution.ref,
    definition: solution.metricDefinition,
    player: a.player,
    total: selection.total,
    items: rows,
    nextOffset:
      a.offset + a.limit < selection.total ? a.offset + a.limit : null,
    node: {
      path: page.path,
      kind: n.kind,
      chanceCards: n.chanceCards,
      terminal: n.terminal,
      actor: n.player,
      actions: n.actions,
      board: n.board,
      potBb:
        (input.pot +
          n.invested[0] +
          n.invested[1] -
          returned[0] -
          returned[1]) /
        100,
      investedBb: n.invested.map((v) => v / 100),
      returnedBb: returned.map((v) => v / 100),
    },
    aggregate: {
      ...page.aggregate,
      classes: handClasses.map((h) => ({
        hand: h.label,
        probability:
          page.aggregate.classes.find((c) => c.hand === h.label)?.probability ??
          (mass > 0 ? 0 : null),
      })),
    },
  };
}
