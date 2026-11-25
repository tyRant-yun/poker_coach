import { z } from "zod";
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
