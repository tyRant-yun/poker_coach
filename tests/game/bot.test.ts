import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { botRequestSchema } from "../../contracts/bot.ts";
import {
  BotRegistry,
  HuWorker,
  botCatalog,
} from "../../runtime/bots/registry.ts";
const golden = JSON.parse(readFileSync("contracts/bot-golden.json", "utf8"));
test(
  "actual child faults: parent stops a silent/late/crashed/malformed process within its declared window",
  { timeout: 10000 },
  async () => {
    for (const mode of ["silent", "late", "crash", "malformed"]) {
      const script = `console.log(JSON.stringify({ready:true,contract:'riverline-bot/1',source:'hu-v2.2.2-experimental'}));require('readline').createInterface({input:process.stdin}).on('line',()=>{${mode === "crash" ? "process.exit(2)" : mode === "malformed" ? "console.log('not-json')" : mode === "late" ? "setTimeout(()=>console.log('{}'),2000)" : ""}});`;
      const worker = new HuWorker({
          binary: process.execPath,
          args: ["-e", script],
        }),
        registry = new BotRegistry(worker);
      try {
        await registry.warm("hu-v2.2.2-experimental");
        const start = performance.now();
        const r = await registry.decide("hu-v2.2.2-experimental", {
          ...golden,
          budgetMs: 100,
        });
        assert.equal(r.executed, "legal-safe/1");
        assert.equal(r.action.kind, "fold");
        assert(performance.now() - start < 600);
      } finally {
        registry.close();
      }
    }
  },
);
test("Bot contract: centibb/public observations and nested strict fields reject leaks, units and malformed menus", () => {
  botRequestSchema.parse(golden);
  for (const patch of [
    { deck: [] },
    { holes: [] },
    { answer: {} },
    { bigBlind: 1 },
    { stacks: [99.5, 99] },
    { ownCards: ["As", "As"] },
    { board: ["2c"] },
    { dealerSeat: 2 },
    { legal: [{ kind: "raise", min: 300, max: 200 }] },
    { history: [{ actor: 0, kind: "check", street: 0, privateCards: ["Kd"] }] },
  ]) {
    assert.equal(
      botRequestSchema.safeParse({ ...golden, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  }
});
test("Bot boundary: stale/duplicate/illegal/crash/timeout replies execute an explicit legal fallback, fresh replies stay valid", async () => {
  let mode = "normal";
  const registry = new BotRegistry({
    start: async () => {},
    close: () => {},
    decide: async (r) => {
      if (mode === "crash" || mode === "timeout") throw Error(mode);
      return {
        requestId: r.requestId,
        handId: mode === "stale" ? crypto.randomUUID() : r.handId,
        revision: r.revision,
        sequence: mode === "duplicate" ? r.sequence + 1 : r.sequence,
        source: "hu-v2.2.2-experimental",
        action: { kind: "raise", amount: mode === "illegal" ? 10001 : 200 },
        elapsedMs: 1,
        fallback: null,
      };
    },
  });
  for (mode of ["stale", "duplicate", "illegal", "crash", "timeout"]) {
    const result = await registry.decide("hu-v2.2.2-experimental", golden);
    assert.equal(result.executed, "legal-safe/1");
    assert.equal(result.action.kind, "fold");
    assert(result.fallback);
  }
  mode = "normal";
  assert.equal(
    (await registry.decide("hu-v2.2.2-experimental", golden)).executed,
    "hu-v2.2.2-experimental",
  );
  registry.close();
});
test(
  "fixed HU Python consumer parses the same golden, rejects leaked fields, and restarts cleanly without platform I/O",
  { timeout: 20000 },
  async () => {
    assert.equal(
      botCatalog()[1].available,
      true,
      "npm run bot:setup required for acceptance",
    );
    const worker = new HuWorker();
    try {
      const r = await worker.decide(golden);
      assert.equal(r.source, "hu-v2.2.2-experimental");
      assert(
        golden.legal.some((a: { kind: string }) => a.kind === r.action.kind),
      );
      await assert.rejects(
        worker.decide({ ...golden, deck: [] } as typeof golden),
      );
      worker.close();
      const next = await worker.decide({
        ...golden,
        requestId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
      });
      assert.equal(next.sequence, 0);
    } finally {
      worker.close();
    }
  },
);
