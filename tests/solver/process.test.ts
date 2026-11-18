import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startEngine } from "../../runtime/engines/process-runner.ts";
import { riverInputSchema } from "../../contracts/solver/engine.ts";

const manifest = JSON.parse(
  readFileSync("benchmarks/solver/river-cases.json", "utf8"),
) as { cases: unknown[]; limits: unknown };
function input() {
  return riverInputSchema.parse({
    ...(manifest.cases[0] as object),
    schemaVersion: 1,
    limits: manifest.limits,
  });
}

test(
  "real IPC: complete handshake, fixed input hash, bounded events and staged native artifacts",
  { timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "riverline-engine-"));
    try {
      const events: string[] = [];
      const run = startEngine(input(), {
        directory: join(root, "attempt-1"),
        onEvent: (event) => events.push(event.kind),
      });
      const result = await run.result;
      assert.equal(result.status, "completed", result.error);
      assert.equal(events[0], "hello");
      assert.equal(events[1], "started");
      assert.equal(events.at(-1), "completed");
      assert.ok(events.length <= 103);
      const bytes = readFileSync(join(root, "attempt-1/input.json"));
      assert.equal(
        result.identity.specHash,
        createHash("sha256").update(bytes).digest("hex"),
      );
      const summary = JSON.parse(
        readFileSync(result.summary!.path, "utf8"),
      ) as { nodes: unknown[]; stopReason: string; input: unknown };
      assert.deepEqual(summary.nodes, []); // Full tree never travels in progress or summary.
      assert.equal(summary.stopReason, "iteration-limit");
      // bincode varint u32 marker precedes the logical 0x09f15790 magic.
      assert.deepEqual(
        [...readFileSync(result.native!.path).subarray(0, 5)],
        [0xfc, 0x90, 0x57, 0xf1, 0x09],
      );
      assert.throws(() =>
        startEngine(input(), { directory: join(root, "attempt-1") }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "real IPC: early cancel is confirmed before publishing a solution",
  { timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "riverline-engine-cancel-"));
    try {
      const run = startEngine(input(), { directory: join(root, "attempt") });
      run.cancel();
      const result = await run.result;
      assert.equal(result.status, "cancelled", result.error);
      assert.ok(
        result.cancelLatencyMs !== undefined && result.cancelLatencyMs < 2000,
      );
      assert.equal(existsSync(join(root, "attempt/solution.bin")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "real IPC: parent interruption and unsupported input never become completed",
  { timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "riverline-engine-failure-"));
    try {
      const run = startEngine(input(), {
        directory: join(root, "interrupted"),
      });
      run.interrupt();
      assert.equal((await run.result).status, "interrupted");
      const invalid = input();
      invalid.board[0] = invalid.board[1];
      const failed = await startEngine(invalid, {
        directory: join(root, "bad-board"),
      }).result;
      assert.equal(failed.status, "failed");
      assert.match(failed.error!, /duplicate board/);
      assert.throws(() =>
        riverInputSchema.parse({ ...input(), inventedField: true }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
