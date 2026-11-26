import type { RuntimeState, Ref } from "../../src/modules/analysis/domain.ts";
import { verifyNativeRoot } from "../engines/native-access.ts";
import { verifyTurnRoot } from "../engines/turn-access.ts";
import { parseSolverInput, caseTreeHash } from "./model.ts";
import { allCombos } from "../../src/modules/analysis/content.ts";
import { hash } from "../store.ts";

import { validateNode } from "./native-node.ts";
export { validateNode } from "./native-node.ts";
export type { NativeNode } from "./native-node.ts";

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
  const parseInput = (bytes: Buffer) =>
    parseSolverInput(JSON.parse(bytes.toString()));
  for (const spec of Object.values(state.real.specs)) {
    const bytes = read(spec.input);
    if (hash(bytes) !== spec.inputHash)
      throw Error("ARTIFACT_INCOMPLETE: input bytes changed");
    const input = parseInput(bytes);
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
      (input.schemaVersion === 3
        ? !c.turn ||
          !!c.tree ||
          hash(input.turnBets) !== hash(c.turn.turnBets) ||
          hash(input.riverBets) !== hash(c.turn.riverBets)
        : input.schemaVersion === 2
          ? !!c.turn || !c.tree || hash(input.treeLines) !== hash(c.tree.lines)
          : !!c.turn || !!c.tree || input.sizes[0][0] !== `${c.betPercent}%`) ||
      input.locks.length ||
      spec.treeHash !== caseTreeHash(c) ||
      spec.scope !==
        (input.schemaVersion === 3
          ? "given-range-turn-subgame"
          : "given-range-river-subgame") ||
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
      input = parseInput(read(spec.input)),
      summary = JSON.parse(read(solution.summary).toString()) as {
        engineCommit: string;
        algorithm: string;
        identity: { specHash: string };
        privateCards: [string[], string[]];
        iterations: number;
        exploitability: number;
        stopReason: string;
        input?: unknown;
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
    if (input.schemaVersion === 3) {
      if (hash(summary.input) !== hash(input))
        throw Error("ARTIFACT_INCOMPLETE: turn summary input differs");
      if (
        solution.queryModel !== "native-turn/3" ||
        solution.nodes.length !== 0
      )
        throw Error("ARTIFACT_INCOMPLETE: unexpected turn projection");
      verifyTurnRoot({
        bytes: native,
        nativeHash: hash(native),
        inputHash: spec.inputHash,
        counts: solution.handCounts,
        cards: summary.privateCards,
        board: input.board,
      });
      continue;
    }
    if (input.schemaVersion === 2) {
      if (
        solution.queryModel !== "native-paged/2" ||
        solution.nodes.length !== 0
      )
        throw Error("ARTIFACT_INCOMPLETE: unexpected general tree projection");
      verifyNativeRoot({
        bytes: native,
        nativeHash: hash(native),
        inputHash: spec.inputHash,
        counts: solution.handCounts,
        cards: summary.privateCards,
      });
      continue;
    }
    if (solution.queryModel)
      throw Error("ARTIFACT_INCOMPLETE: legacy query model differs");
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
