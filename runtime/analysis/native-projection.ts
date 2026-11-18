import { z } from "zod";
import type { RuntimeState, Ref } from "../../src/modules/analysis/domain.ts";
import { riverInputSchema } from "../../contracts/solver/engine.ts";
import { allCombos } from "../../src/modules/analysis/content.ts";
import { hash } from "../store.ts";

const floats = z.array(z.number().finite());
export const nodeSchema = z
  .object({
    path: z.array(z.number().int()),
    terminal: z.boolean(),
    player: z.union([z.literal(0), z.literal(1)]).nullable(),
    actions: z.array(z.string()),
    invested: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    weights: z.tuple([floats, floats]),
    compatibleWeights: z.tuple([floats, floats]),
    equity: z.tuple([floats, floats]),
    ev: z.tuple([floats, floats]),
    actionEv: floats,
    strategy: floats,
  })
  .strict();
export type NativeNode = z.infer<typeof nodeSchema>;
export function validateNode(
  value: unknown,
  counts: [number, number],
): NativeNode {
  const node = nodeSchema.parse(value);
  for (const p of [0, 1] as const)
    for (const field of [
      "weights",
      "compatibleWeights",
      "equity",
      "ev",
    ] as const)
      if (node[field][p].length !== counts[p])
        throw Error("ARTIFACT_INCOMPLETE: private-card dimensions differ");
  if (node.terminal) {
    if (
      node.player !== null ||
      node.actions.length ||
      node.strategy.length ||
      node.actionEv.length
    )
      throw Error("ARTIFACT_INCOMPLETE: invalid terminal projection");
  } else {
    if (
      node.player === null ||
      !node.actions.length ||
      node.strategy.length !== node.actions.length * counts[node.player] ||
      node.actionEv.length !== node.strategy.length
    )
      throw Error("ARTIFACT_INCOMPLETE: action-major dimensions differ");
    for (let i = 0; i < counts[node.player]; i++)
      if (
        node.weights[node.player][i] > 0 &&
        node.compatibleWeights[node.player][i] > 0
      ) {
        let sum = 0;
        for (let a = 0; a < node.actions.length; a++) {
          const v = node.strategy[a * counts[node.player] + i];
          if (v < 0 || v > 1.000001)
            throw Error("ARTIFACT_INCOMPLETE: invalid strategy probability");
          sum += v;
        }
        if (Math.abs(sum - 1) > 1e-5)
          throw Error("ARTIFACT_INCOMPLETE: strategy column sum differs");
      }
  }
  return node;
}

export function validateRealArtifacts(
  state: RuntimeState,
  read: (reference: Ref) => Buffer,
) {
  if (!state.real) return;
  const fixed = <T extends { ref: Ref }>(
    record: Record<string, T>,
    reference: Ref,
  ) => {
    const v =
      record[`${reference.id}@${reference.version}`] ?? record[reference.id];
    if (!v || v.ref.contentHash !== reference.contentHash)
      throw Error("ARTIFACT_INCOMPLETE: fixed reference missing");
    return v;
  };
  for (const spec of Object.values(state.real.specs)) {
    const bytes = read(spec.input);
    if (hash(bytes) !== spec.inputHash)
      throw Error("ARTIFACT_INCOMPLETE: input bytes changed");
    const input = riverInputSchema.parse(JSON.parse(bytes.toString()));
    const c = fixed(state.real.cases, spec.situation),
      ranges = spec.ranges.map((r) => fixed(state.ranges, r));
    const expectedRanges = ranges.map((r) =>
      Object.fromEntries(
        Object.entries(r.weights).map(([k, v]) => [k, v / 10000]),
      ),
    );
    if (
      hash(input.ranges) !== hash(expectedRanges) ||
      hash(input.board) !== hash(c.board) ||
      input.pot !== c.pot ||
      input.stack !== c.stack ||
      input.sizes[0][0] !== `${c.betPercent}%` ||
      input.locks.length ||
      input.limits.targetExploitability !==
        (c.pot * spec.targetNashConvPotFraction) / 2
    )
      throw Error("ARTIFACT_INCOMPLETE: specification binding differs");
  }
  const canonical = new Map(
    allCombos.flatMap((c) => [
      [c, c],
      [c.slice(2) + c.slice(0, 2), c],
    ]),
  );
  const paths = [[], [0], [0, 0], [1], [1, 0], [1, 1]];
  for (const solution of Object.values(state.real.solutions)) {
    const spec = fixed(state.real.specs, solution.spec),
      input = riverInputSchema.parse(JSON.parse(read(spec.input).toString())),
      summary = JSON.parse(read(solution.summary).toString()) as {
        engineCommit: string;
        algorithm: string;
        identity: { specHash: string };
        privateCards: [string[], string[]];
        iterations: number;
        exploitability: number;
        stopReason: string;
      };
    if (
      summary.engineCommit !== spec.engineCommit ||
      summary.algorithm !== spec.algorithm ||
      summary.identity.specHash !== spec.inputHash ||
      summary.iterations !== solution.iterations ||
      summary.iterations > input.limits.maxIterations ||
      !Number.isFinite(summary.exploitability) ||
      solution.nashConvBb !== 2 * solution.exploitabilityBb ||
      solution.exploitabilityBb !== summary.exploitability / 100 ||
      solution.stopReason !== summary.stopReason
    )
      throw Error("ARTIFACT_INCOMPLETE: result binding differs");
    const native = read(solution.native);
    if (
      native.length < 5 ||
      !native.subarray(0, 5).equals(Buffer.from([0xfc, 0x90, 0x57, 0xf1, 0x09]))
    )
      throw Error("ARTIFACT_INCOMPLETE: native header differs");
    for (const p of [0, 1] as const) {
      const cards = summary.privateCards[p].map((c) => canonical.get(c));
      const expected = Object.entries(input.ranges[p])
        .filter(([, v]) => v > 0)
        .map(([c]) => c);
      if (
        cards.some((c) => !c) ||
        new Set(cards).size !== cards.length ||
        cards.length !== solution.handCounts[p] ||
        hash([...cards].sort()) !== hash(expected.sort())
      )
        throw Error("ARTIFACT_INCOMPLETE: private-card mapping differs");
    }
    for (let i = 0; i < paths.length; i++) {
      const page = solution.nodes[i];
      if (!page || hash(page.path) !== hash(paths[i]))
        throw Error("ARTIFACT_INCOMPLETE: node index differs");
      const node = validateNode(
        JSON.parse(read(page.artifact).toString()),
        solution.handCounts,
      );
      if (hash(node.path) !== hash(page.path))
        throw Error("ARTIFACT_INCOMPLETE: node path differs");
    }
  }
}
