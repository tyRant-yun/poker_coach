import { execFile, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { turnNodeSchema } from "../../contracts/solver/turn.ts";
import type { TurnNode, TurnPath } from "../../contracts/solver/turn.ts";
import { validateNode } from "../analysis/native-node.ts";
import { hash } from "../store.ts";
import { takeNativeQuerySlot } from "./query-budget.ts";
import type { NativeContext } from "./native-access.ts";

export type TurnContext = NativeContext & { board: string[]; version?: 4 | 5 };
const binary = fileURLToPath(
  new URL(
    `../../engines/postflop/target/release/riverline-solver${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
function stage(context: TurnContext, path: TurnPath) {
  if (
    hash(context.bytes) !== context.nativeHash ||
    context.counts.some((n) => n > 16)
  )
    throw Error("ARTIFACT_INCOMPLETE: turn native hash/dimensions differ");
  const directory = mkdtempSync(join(tmpdir(), "riverline-turn-read-")),
    native = join(directory, "solution.bin"),
    request = join(directory, "query.json"),
    output = join(directory, "node.json");
  writeFileSync(native, context.bytes, { flag: "wx" });
  writeFileSync(
    request,
    JSON.stringify({
      schemaVersion: 3,
      nativeSha256: context.nativeHash,
      inputSha256: context.inputHash,
      path,
      maxMemoryBytes: 268435456,
    }),
    { flag: "wx" },
  );
  return { directory, native, request, output };
}
function validate(
  context: TurnContext,
  path: TurnPath,
  output: string,
): TurnNode {
  if (statSync(output).size > 131072)
    throw Error("ARTIFACT_INCOMPLETE: turn node >128KiB");
  const raw = turnNodeSchema.parse(JSON.parse(readFileSync(output, "utf8")));
  if (
    hash(raw.path) !== hash(path) ||
    hash(raw.privateCards) !== hash(context.cards) ||
    hash(raw.board) !==
      hash([
        ...context.board,
        ...path.flatMap((s) => (s.kind === "deal" ? [s.card] : [])),
      ])
  )
    throw Error("ARTIFACT_INCOMPLETE: turn node identity differs");
  for (const p of [0, 1] as const)
    for (const field of [
      "weights",
      "compatibleWeights",
      "equity",
      "ev",
    ] as const)
      if (raw[field][p].length !== context.counts[p])
        throw Error("ARTIFACT_INCOMPLETE: turn dimensions differ");
  if (raw.kind === "chance") {
    if (
      raw.terminal ||
      raw.player !== null ||
      raw.actions.length ||
      raw.strategy.length ||
      raw.actionEv.length ||
      raw.board.length !== 4 ||
      !raw.chanceCards.length
    )
      throw Error("ARTIFACT_INCOMPLETE: invalid chance node");
    if (
      new Set(raw.chanceCards.map((c) => c.card)).size !==
        raw.chanceCards.length ||
      raw.chanceCards.some((c) => raw.board.includes(c.card))
    )
      throw Error("ARTIFACT_INCOMPLETE: invalid chance cards");
    const mass = raw.compatibleWeights[0].reduce((n, w) => n + w, 0),
      probs = raw.chanceCards.map((c) => c.probability);
    if (
      mass > 0
        ? probs.some((v) => v === null) ||
          Math.abs(probs.reduce<number>((n, v) => n + (v ?? 0), 0) - 1) > 1e-6
        : probs.some((v) => v !== null)
    )
      throw Error("ARTIFACT_INCOMPLETE: chance probabilities differ");
  } else {
    if (raw.terminal !== (raw.kind === "terminal") || raw.chanceCards.length)
      throw Error("ARTIFACT_INCOMPLETE: turn kind differs");
    const {
      kind: _,
      board: __,
      chanceCards: ___,
      privateCards: ____,
      ...node
    } = raw;
    validateNode({ ...node, path: [] }, context.counts);
  }
  return raw;
}
export function verifyTurnRoot(context: TurnContext) {
  const files = stage(context, []);
  try {
    const r = spawnSync(
      binary,
      ["query-turn", files.native, files.request, files.output],
      { windowsHide: true, encoding: "utf8", timeout: 5000, maxBuffer: 65536 },
    );
    if (r.status !== 0)
      throw Error(`ARTIFACT_INCOMPLETE: ${r.stderr || r.error?.message}`);
    return validate(context, [], files.output);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
}
export class TurnNodeCache {
  private nodes = new Map<string, TurnNode>();
  private pending = new Map<string, Promise<void>>();
  private key(c: Pick<TurnContext, "nativeHash" | "inputHash">, p: TurnPath) {
    return `${c.nativeHash}:${c.inputHash}:${JSON.stringify(p)}`;
  }
  get(c: Pick<TurnContext, "nativeHash" | "inputHash">, p: TurnPath) {
    return this.nodes.get(this.key(c, p));
  }
  async prepare(c: TurnContext, p: TurnPath) {
    const key = this.key(c, p);
    if (this.nodes.has(key)) {
      const node = this.nodes.get(key)!;
      this.nodes.delete(key);
      this.nodes.set(key, node);
      return;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const release = takeNativeQuerySlot();
    const work = (async () => {
      const files = stage(c, p);
      try {
        await new Promise<void>((resolve, reject) =>
          execFile(
            binary,
            ["query-turn", files.native, files.request, files.output],
            { windowsHide: true, timeout: 5000, maxBuffer: 65536 },
            (error, _stdout, stderr) =>
              error
                ? reject(Error(`UNSUPPORTED_INPUT: ${stderr || error.message}`))
                : resolve(),
          ),
        );
        this.nodes.set(key, validate(c, p, files.output));
        while (this.nodes.size > 8)
          this.nodes.delete(this.nodes.keys().next().value!);
      } finally {
        rmSync(files.directory, { recursive: true, force: true });
      }
    })();
    this.pending.set(key, work);
    try {
      await work;
    } finally {
      this.pending.delete(key);
      release();
    }
  }
}
