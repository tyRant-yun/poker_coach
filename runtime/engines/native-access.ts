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
import { hash } from "../store.ts";
import { nativePageSchema } from "../../contracts/solver/river-tree.ts";
import { validateNode } from "../analysis/native-node.ts";
import type { NativeNode } from "../analysis/native-node.ts";

const binary = fileURLToPath(
  new URL(
    `../../engines/postflop/target/release/riverline-solver${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
export type NativeContext = {
  bytes: Buffer;
  nativeHash: string;
  inputHash: string;
  counts: [number, number];
  cards: [string[], string[]];
};
function stage(context: NativeContext, path: number[]) {
  if (hash(context.bytes) !== context.nativeHash)
    throw Error("ARTIFACT_INCOMPLETE: native checksum differs");
  const directory = mkdtempSync(join(tmpdir(), "riverline-native-read-"));
  const native = join(directory, "solution.bin");
  writeFileSync(native, context.bytes, { flag: "wx" });
  const requests = ([0, 1] as const).flatMap((player) => {
    const result = [];
    for (let offset = 0; offset < context.counts[player]; offset += 100) {
      const index = `${player}-${offset}`,
        request = join(directory, `query-${index}.json`),
        output = join(directory, `page-${index}.json`);
      writeFileSync(
        request,
        JSON.stringify({
          schemaVersion: 1,
          nativeSha256: context.nativeHash,
          inputSha256: context.inputHash,
          path,
          player,
          offset,
          limit: 100,
          maxMemoryBytes: 268435456,
        }),
        { flag: "wx" },
      );
      result.push({ player, offset, request, output });
    }
    return result;
  });
  return { directory, native, requests };
}
function assemble(
  context: NativeContext,
  path: number[],
  files: ReturnType<typeof stage>,
): NativeNode {
  const pages = files.requests.map((r) => {
    if (statSync(r.output).size > 1048576)
      throw Error("ARTIFACT_INCOMPLETE: native page exceeds limit");
    const page = nativePageSchema.parse(
      JSON.parse(readFileSync(r.output, "utf8")),
    );
    if (
      page.nativeSha256 !== context.nativeHash ||
      hash(page.path) !== hash(path) ||
      page.player !== r.player ||
      page.offset !== r.offset ||
      page.total !== context.counts[r.player] ||
      page.rows.length !== Math.min(100, page.total - r.offset) ||
      page.nextOffset !==
        (r.offset + page.rows.length < page.total
          ? r.offset + page.rows.length
          : null) ||
      page.rows.some(
        (row, i) =>
          row.engineIndex !== r.offset + i ||
          row.combo !== context.cards[r.player][r.offset + i],
      )
    )
      throw Error("ARTIFACT_INCOMPLETE: native page identity/order differs");
    return page;
  });
  const first = pages[0];
  if (!first) throw Error("ARTIFACT_INCOMPLETE: no private cards");
  const node: NativeNode = {
    path,
    terminal: first.terminal,
    player: first.actingPlayer,
    actions: first.actions,
    invested: first.invested,
    weights: [[], []],
    compatibleWeights: [[], []],
    equity: [[], []],
    ev: [[], []],
    strategy: [],
    actionEv: [],
  };
  if (node.player !== null) {
    node.strategy = new Array(
      node.actions.length * context.counts[node.player],
    ).fill(0);
    node.actionEv = new Array(node.strategy.length).fill(0);
  }
  for (const page of pages) {
    if (
      hash([page.actions, page.invested, page.terminal, page.actingPlayer]) !==
      hash([first.actions, first.invested, first.terminal, first.actingPlayer])
    )
      throw Error("ARTIFACT_INCOMPLETE: native node pages differ");
    const p = page.player;
    for (const row of page.rows) {
      const i = row.engineIndex,
        reachable = row.ownPathWeight > 0 && row.compatibleWeight > 0;
      if (reachable && (row.ev === null || row.equity === null))
        throw Error("ARTIFACT_INCOMPLETE: live metrics missing");
      node.weights[p][i] = row.ownPathWeight;
      node.compatibleWeights[p][i] = row.compatibleWeight;
      // Internal sentinels only; the business projection emits null at every unreachable row.
      node.ev[p][i] = row.ev ?? 0;
      node.equity[p][i] = row.equity ?? 0;
      if (node.player === p && reachable) {
        if (
          row.strategy?.length !== node.actions.length ||
          row.actionEv?.length !== node.actions.length
        )
          throw Error("ARTIFACT_INCOMPLETE: live strategy missing");
        for (let a = 0; a < node.actions.length; a++) {
          node.strategy[a * context.counts[p] + i] = row.strategy[a];
          node.actionEv[a * context.counts[p] + i] = row.actionEv[a];
        }
      }
    }
  }
  return validateNode(node, context.counts);
}
export function verifyNativeRoot(context: NativeContext) {
  const files = stage(context, []);
  try {
    for (const r of files.requests) {
      const result = spawnSync(
        binary,
        ["query-river-tree", files.native, r.request, r.output],
        {
          windowsHide: true,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 65536,
        },
      );
      if (result.status !== 0)
        throw Error(
          `ARTIFACT_INCOMPLETE: ${result.stderr || result.error?.message || "native validation failed"}`,
        );
    }
    return assemble(context, [], files);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
}
/** Bounded ephemeral cache, outside workspace snapshots; query subprocesses never own business state. */
export class NativeNodeCache {
  private nodes = new Map<string, NativeNode>();
  private pending = new Map<string, Promise<void>>();
  key(
    context: Pick<NativeContext, "nativeHash" | "inputHash">,
    path: number[],
  ) {
    return `${context.nativeHash}:${context.inputHash}:${JSON.stringify(path)}`;
  }
  get(
    context: Pick<NativeContext, "nativeHash" | "inputHash">,
    path: number[],
  ) {
    return this.nodes.get(this.key(context, path));
  }
  async prepare(context: NativeContext, path: number[]) {
    const key = this.key(context, path);
    if (this.nodes.has(key)) {
      const node = this.nodes.get(key)!;
      this.nodes.delete(key);
      this.nodes.set(key, node);
      return;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 2)
      throw Error("RESOURCE_LIMIT: 原生查询槽已满，请稍后重试");
    const work = (async () => {
      const files = stage(context, path);
      try {
        for (const r of files.requests)
          await new Promise<void>((resolve, reject) => {
            execFile(
              binary,
              ["query-river-tree", files.native, r.request, r.output],
              { windowsHide: true, timeout: 5000, maxBuffer: 65536 },
              (error, _stdout, stderr) =>
                error
                  ? reject(
                      Error(`UNSUPPORTED_INPUT: ${stderr || error.message}`),
                    )
                  : resolve(),
            );
          });
        this.nodes.set(key, assemble(context, path, files));
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
    }
  }
}
