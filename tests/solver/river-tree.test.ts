import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  explicitRiverSchema,
  nativeQuerySchema,
  nativePageSchema,
} from "../../contracts/solver/river-tree.ts";
import { riverInputSchema } from "../../contracts/solver/engine.ts";

const binary = resolve(
  `engines/postflop/target/release/riverline-solver${process.platform === "win32" ? ".exe" : ""}`,
);
const manifest = JSON.parse(
  readFileSync("benchmarks/solver/river-tree-cases.json", "utf8"),
);
const sha = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

test(
  "explicit river CLI: immutable v2 input and bounded node pages match actual native reload",
  { timeout: 15000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "river-tree-pages-"));
    try {
      const input = explicitRiverSchema.parse({
        schemaVersion: 2,
        ...manifest.cases[1],
        limits: manifest.limits,
      });
      assert.equal(riverInputSchema.safeParse(input).success, false); // Old worker is intentionally not upgraded.
      const inFile = join(directory, "input.json"),
        output = join(directory, "output.json");
      writeFileSync(inFile, JSON.stringify(input));
      execFileSync(binary, ["validate-river-tree", inFile, output], {
        windowsHide: true,
        timeout: 10000,
      });
      const report = JSON.parse(readFileSync(output, "utf8"));
      assert.deepEqual(report.input, input);
      assert.equal(report.nodes.length, 12);
      const native = `${output}.native.bin`,
        digest = sha(native);
      let maxBytes = 0,
        queries = 0,
        nulls = 0;
      for (const node of report.nodes)
        for (const player of [0, 1] as const) {
          // Page one hand at a time, including deep nodes beyond the old two-action path.
          const rows = [];
          for (
            let offset = 0;
            offset < report.privateCards[player].length;
            offset++
          ) {
            const request = nativeQuerySchema.parse({
              schemaVersion: 1,
              nativeSha256: digest,
              path: node.path,
              player,
              offset,
              limit: 1,
              maxMemoryBytes: 268435456,
            });
            const requestPath = join(directory, `query-${queries}.json`),
              pagePath = join(directory, `page-${queries++}.json`);
            writeFileSync(requestPath, JSON.stringify(request));
            execFileSync(
              binary,
              ["query-river-tree", native, requestPath, pagePath],
              { windowsHide: true, timeout: 5000 },
            );
            const bytes = readFileSync(pagePath);
            maxBytes = Math.max(maxBytes, bytes.length);
            const page = nativePageSchema.parse(JSON.parse(bytes.toString()));
            assert.deepEqual(page.path, node.path);
            assert.equal(page.nativeSha256, digest);
            assert.equal(page.total, report.privateCards[player].length);
            assert.equal(
              page.nextOffset,
              offset + 1 < page.total ? offset + 1 : null,
            );
            assert.deepEqual(page.invested, node.invested);
            assert.deepEqual(page.actions, node.actions);
            assert.equal(page.rows.length, 1);
            const row = page.rows[0],
              count = page.total;
            assert.equal(row.combo, report.privateCards[player][offset]);
            assert.equal(row.ownPathWeight, node.weights[player][offset]);
            const reachable = row.ownPathWeight > 0 && row.compatibleWeight > 0;
            if (!reachable) {
              assert.equal(row.ev, null);
              nulls++;
            } else assert.equal(row.ev, node.ev[player][offset]);
            if (node.player === player && reachable) {
              assert.deepEqual(
                row.strategy,
                node.actions.map(
                  (_: string, a: number) => node.strategy[a * count + offset],
                ),
              );
              assert.deepEqual(
                row.actionEv,
                node.actions.map(
                  (_: string, a: number) => node.actionEv[a * count + offset],
                ),
              );
            } else {
              assert.equal(row.strategy, null);
              assert.equal(row.actionEv, null);
            }
            rows.push(row.combo);
          }
          assert.deepEqual(rows, report.privateCards[player]);
        }
      assert.ok(maxBytes < 4096);
      assert.ok(nulls > 0);
      const evidenceDir = resolve(".artifacts/solver/river-tree");
      // The benchmark runner creates this directory; standalone tests need not.
      if (existsSync(evidenceDir))
        writeFileSync(
          join(evidenceDir, "query-evidence.json"),
          JSON.stringify(
            {
              queries,
              maxBytes,
              unreachableRowsWithNullMetrics: nulls,
              nativeSha256: digest,
              inputSha256: sha(inFile),
            },
            null,
            2,
          ),
        );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "explicit river CLI: refuses altered native, illegal input, cursor and oversized query without an output",
  { timeout: 15000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "river-tree-refusal-"));
    try {
      const input = explicitRiverSchema.parse({
        schemaVersion: 2,
        ...manifest.cases[0],
        limits: manifest.limits,
      });
      const inFile = join(directory, "input.json"),
        output = join(directory, "output.json"),
        requestPath = join(directory, "query.json");
      writeFileSync(inFile, JSON.stringify(input));
      execFileSync(binary, ["validate-river-tree", inFile, output], {
        windowsHide: true,
        timeout: 10000,
      });
      const native = `${output}.native.bin`;
      const valid = {
        schemaVersion: 1,
        nativeSha256: sha(native),
        path: [],
        player: 0,
        offset: 0,
        limit: 1,
        maxMemoryBytes: 268435456,
      };
      for (const patch of [
        { nativeSha256: "0".repeat(64) },
        { path: [999] },
        { offset: 3 },
        { limit: 101 },
        { maxMemoryBytes: 1 },
        { unexpected: true },
      ]) {
        const failedOutput = join(directory, "must-not-exist.json");
        writeFileSync(requestPath, JSON.stringify({ ...valid, ...patch }));
        assert.throws(() =>
          execFileSync(
            binary,
            ["query-river-tree", native, requestPath, failedOutput],
            { windowsHide: true, timeout: 5000, stdio: "pipe" },
          ),
        );
        assert.equal(existsSync(failedOutput), false);
      }
      writeFileSync(requestPath, " ".repeat(16385));
      assert.throws(() =>
        execFileSync(
          binary,
          [
            "query-river-tree",
            native,
            requestPath,
            join(directory, "oversize.json"),
          ],
          { windowsHide: true, stdio: "pipe" },
        ),
      );
      const corrupt = join(directory, "corrupt.bin"),
        damaged = readFileSync(native);
      damaged[0] ^= 1;
      writeFileSync(corrupt, damaged);
      writeFileSync(
        requestPath,
        JSON.stringify({ ...valid, nativeSha256: sha(corrupt) }),
      );
      assert.throws(() =>
        execFileSync(
          binary,
          [
            "query-river-tree",
            corrupt,
            requestPath,
            join(directory, "corrupt-page.json"),
          ],
          { windowsHide: true, stdio: "pipe" },
        ),
      );
      assert.equal(existsSync(join(directory, "corrupt-page.json")), false);
      writeFileSync(requestPath, JSON.stringify(valid));
      assert.throws(() =>
        execFileSync(
          binary,
          [
            "query-river-tree",
            directory,
            requestPath,
            join(directory, "directory-page.json"),
          ],
          { windowsHide: true, stdio: "pipe" },
        ),
      );
      const { treeLines: _lines, ...common } = input;
      const legacyInput = riverInputSchema.parse({
        ...common,
        schemaVersion: 1,
        sizes: [
          ["50%", ""],
          ["", ""],
        ],
      });
      const legacyFile = join(directory, "legacy-input.json"),
        legacyOutput = join(directory, "legacy-output.json");
      writeFileSync(legacyFile, JSON.stringify(legacyInput));
      execFileSync(binary, ["validate-river", legacyFile, legacyOutput], {
        windowsHide: true,
        timeout: 10000,
      });
      const legacyNative = `${legacyOutput}.native.bin`;
      writeFileSync(
        requestPath,
        JSON.stringify({ ...valid, nativeSha256: sha(legacyNative) }),
      );
      assert.throws(
        () =>
          execFileSync(
            binary,
            [
              "query-river-tree",
              legacyNative,
              requestPath,
              join(directory, "legacy-page.json"),
            ],
            { windowsHide: true, stdio: "pipe" },
          ),
        /native model mismatch/,
      );
      const invalid = {
        ...input,
        treeLines: [[{ kind: "bet", amount: input.stack }]],
      };
      writeFileSync(inFile, JSON.stringify(invalid));
      assert.throws(() =>
        execFileSync(
          binary,
          ["validate-river-tree", inFile, join(directory, "invalid.json")],
          { windowsHide: true, stdio: "pipe" },
        ),
      );
      assert.equal(existsSync(join(directory, "invalid.json")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
