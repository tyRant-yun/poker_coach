import { execFile, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  turnPageSchema,
  turnPageQuerySchema,
} from "../../contracts/solver/turn.ts";
import type { TurnPath, TurnPage } from "../../contracts/solver/turn.ts";
import { hash } from "../store.ts";
import type { TurnContext } from "./turn-access.ts";
import { takeNativeQuerySlot } from "./query-budget.ts";
const binary = fileURLToPath(
  new URL(
    `../../engines/postflop/target/release/riverline-solver${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
export type PageSelection = { player: 0 | 1; indices: number[] };
function stage(c: TurnContext, path: TurnPath, selection: PageSelection) {
  if (hash(c.bytes) !== c.nativeHash || c.counts.some((n) => n > 128))
    throw Error("ARTIFACT_INCOMPLETE: turn/4 identity/capacity differs");
  const request = turnPageQuerySchema.parse({
    schemaVersion: 4,
    nativeSha256: c.nativeHash,
    inputSha256: c.inputHash,
    path,
    maxMemoryBytes: 268435456,
    ...selection,
  });
  const directory = mkdtempSync(join(tmpdir(), "riverline-turn-page-"));
  const native = join(directory, "solution.bin"),
    input = join(directory, "query.json"),
    output = join(directory, "page.json");
  writeFileSync(native, c.bytes, { flag: "wx" });
  writeFileSync(input, JSON.stringify(request), { flag: "wx" });
  return { directory, native, input, output };
}
function validate(
  c: TurnContext,
  path: TurnPath,
  s: PageSelection,
  output: string,
) {
  if (statSync(output).size > 131072)
    throw Error("ARTIFACT_INCOMPLETE: turn/4 page >128KiB");
  const page = turnPageSchema.parse(JSON.parse(readFileSync(output, "utf8")));
  const n = page.node,
    a = n.actions.length,
    actor = n.player === s.player,
    mass = page.aggregate.denominator;
  if (
    hash(page.path) !== hash(path) ||
    page.player !== s.player ||
    hash(page.counts) !== hash(c.counts) ||
    hash(n.board) !==
      hash([
        ...c.board,
        ...path.flatMap((p) => (p.kind === "deal" ? [p.card] : [])),
      ]) ||
    hash(page.rows.map((r) => r.index)) !== hash(s.indices) ||
    n.terminal !== (n.kind === "terminal") ||
    (n.kind !== "decision" && (n.player !== null || a !== 0)) ||
    (n.kind === "decision" && (n.player === null || !a)) ||
    (n.kind === "chance"
      ? n.board.length !== 4 || !n.chanceCards.length
      : n.chanceCards.length !== 0) ||
    page.rows.some(
      (r) =>
        r.combo !== c.cards[s.player][r.index] ||
        r.compatibleMass > mass + 1e-5 ||
        (actor
          ? r.strategy?.length !== a ||
            r.actionEv?.length !== a ||
            (r.weight > 0 &&
              r.compatibleMass > 0 &&
              Math.abs(r.strategy.reduce((s, v) => s + v, 0) - 1) > 1e-5)
          : r.strategy !== null || r.actionEv !== null),
    ) ||
    hash(page.aggregate.frequencies.map((f) => f.action)) !== hash(n.actions) ||
    page.aggregate.frequencies.some((f) =>
      mass > 0 && actor ? f.frequency === null : f.frequency !== null,
    ) ||
    (mass > 0 &&
      actor &&
      Math.abs(
        page.aggregate.frequencies.reduce((s, f) => s + (f.frequency ?? 0), 0) -
          1,
      ) > 1e-5) ||
    new Set(page.aggregate.classes.map((v) => v.hand)).size !==
      page.aggregate.classes.length ||
    (mass > 0
      ? page.aggregate.classes.some((c) => c.probability === null) ||
        Math.abs(
          page.aggregate.classes.reduce((s, c) => s + (c.probability ?? 0), 0) -
            1,
        ) > 1e-5
      : page.aggregate.classes.some((c) => c.probability !== null)) ||
    new Set(n.chanceCards.map((c) => c.card)).size !== n.chanceCards.length ||
    n.chanceCards.some((c) => n.board.includes(c.card)) ||
    (n.kind === "chance" &&
      (mass > 0
        ? n.chanceCards.some((c) => c.probability === null) ||
          Math.abs(
            n.chanceCards.reduce((s, c) => s + (c.probability ?? 0), 0) - 1,
          ) > 1e-6
        : n.chanceCards.some((c) => c.probability !== null)))
  )
    throw Error(
      "ARTIFACT_INCOMPLETE: turn/4 page dimensions, identity or aggregate differ",
    );
  return page;
}
export function verifyTurnPageRoot(c: TurnContext) {
  const s: PageSelection = {
      player: 0,
      indices: Array.from({ length: Math.min(100, c.counts[0]) }, (_, i) => i),
    },
    f = stage(c, [], s);
  try {
    const r = spawnSync(
      binary,
      ["query-turn-page", f.native, f.input, f.output],
      { windowsHide: true, encoding: "utf8", timeout: 5000, maxBuffer: 65536 },
    );
    if (r.status !== 0)
      throw Error(`ARTIFACT_INCOMPLETE: ${r.stderr || r.error?.message}`);
    return validate(c, [], s, f.output);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
}
export class TurnPageCache {
  private pages = new Map<string, TurnPage>();
  private pending = new Map<string, Promise<void>>();
  private key(
    c: Pick<TurnContext, "nativeHash" | "inputHash">,
    p: TurnPath,
    s: PageSelection,
  ) {
    return `${c.nativeHash}:${c.inputHash}:${JSON.stringify(p)}:${JSON.stringify(s)}`;
  }
  get(
    c: Pick<TurnContext, "nativeHash" | "inputHash">,
    p: TurnPath,
    s: PageSelection,
  ) {
    return this.pages.get(this.key(c, p, s));
  }
  async prepare(c: TurnContext, p: TurnPath, s: PageSelection) {
    const key = this.key(c, p, s);
    if (this.pages.has(key)) {
      const page = this.pages.get(key)!;
      this.pages.delete(key);
      this.pages.set(key, page);
      return;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const release = takeNativeQuerySlot();
    const work = (async () => {
      const f = stage(c, p, s);
      try {
        await new Promise<void>((yes, no) =>
          execFile(
            binary,
            ["query-turn-page", f.native, f.input, f.output],
            { windowsHide: true, timeout: 5000, maxBuffer: 65536 },
            (e, _o, err) =>
              e ? no(Error(`UNSUPPORTED_INPUT: ${err || e.message}`)) : yes(),
          ),
        );
        this.pages.set(key, validate(c, p, s, f.output));
        while (this.pages.size > 12)
          this.pages.delete(this.pages.keys().next().value!);
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
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
