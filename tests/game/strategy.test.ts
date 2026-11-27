import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateStrategyPack,
  derivePreflopRanges,
  evaluatePreflop,
} from "../../src/modules/play/strategy.ts";
import { StrategyService } from "../../runtime/analysis/strategy-service.ts";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore } from "../../runtime/store.ts";
import {
  reportSummary,
  decisionAdvice,
} from "../../src/modules/play/feedback.ts";
import type { ReviewReport } from "../../src/modules/play/review.ts";
import type { ReviewInput } from "../../src/modules/play/review.ts";

import { strategyFixture } from "../helpers/strategy-fixture.ts";

test("AF: strict data schema rejects corrupt frequencies, action dimensions and reversed duplicate combos", () => {
  const p = strategyFixture();
  const bad = structuredClone(p);
  bad.nodes[0].rows.AhAs = { frequencies: [1, 1] };
  assert.throws(() => validateStrategyPack(bad), /概率和/);
  const alias = structuredClone(p);
  alias.rootRanges[0].AdAc = 1;
  assert.throws(() => validateStrategyPack(alias), /重复组合/);
  const ev = structuredClone(p);
  ev.nodes[0].rows.AhAs = { frequencies: [1, 0], actionEvBb: [1] };
  assert.throws(() => validateStrategyPack(ev), /EV维度/);
});

test("AF: exact HU path propagation preserves blockers and mixed reach, refuses missing/zero/off-tree paths", () => {
  const p = strategyFixture();
  const r = derivePreflopRanges(p, [{ position: "BTN/SB", kind: "call" }]);
  assert.equal(r.ranges[1].AhAs, 0.25);
  assert.equal(r.ranges[1].KcKs, 0.8);
  // Four compatible pairs, independent oracle sum: 1*.25 + 1*.8 + 1*.25 + 1*.8.
  assert.equal(r.jointMass, 2.1);
  assert.throws(
    () =>
      derivePreflopRanges(p, [
        { position: "BTN/SB", kind: "raise", amount: 250 },
      ]),
    /树外/,
  );
  const missing = structuredClone(p);
  delete missing.nodes[0].rows.AhAs;
  assert.throws(
    () => derivePreflopRanges(missing, [{ position: "BTN/SB", kind: "call" }]),
    /不能默认为零/,
  );
  assert.throws(() => derivePreflopRanges(p, [], ["Ac", "Kh"]), /联合到达/);
  const blocked = structuredClone(p);
  blocked.rootRanges[1].AcKs = 1;
  assert.equal(
    derivePreflopRanges(blocked, []).jointMass,
    5,
    "five of six weighted pairs are compatible",
  );
  const zero = structuredClone(p);
  Object.values(zero.nodes[0].rows).forEach((r) => (r.frequencies = [0, 1]));
  assert.throws(
    () => derivePreflopRanges(zero, [{ position: "BTN/SB", kind: "call" }]),
    /联合到达/,
  );
});

test("AF: exact node action comparison keeps equal-value mixes valid and frequency-only sources unscored", () => {
  const p = strategyFixture();
  const input = {
    snapshot: {
      players: 2,
      street: 0,
      hero: 1,
      heroCards: ["As", "Ah"],
      events: [],
    },
    root: { stacks: [9900, 9950], bets: [100, 50] },
    chosen: { actor: 1, kind: "call" },
  } as unknown as ReviewInput;
  const equal = evaluatePreflop(p, "test-hash", input)!;
  assert.equal(equal.gapBb, 0);
  assert.equal(equal.actions![0].frequency, 0.25);
  delete p.nodes[0].rows.AhAs.actionEvBb;
  const frequencies = evaluatePreflop(p, "test-hash", input)!;
  assert.equal(frequencies.gapBb, undefined);
  assert.equal(frequencies.referenceStrategy![0].frequency, 0.25);
  const bad = strategyFixture();
  bad.nodes[0].rows.AhAs.actionEvBb![1] = -0.5;
  assert.throws(() => validateStrategyPack(bad), /原点的弃牌EV/);
});

test("AF: immutable candidate import, bounded query, persistence and synthetic-data acceptance rejection", () => {
  const dir = mkdtempSync(join(tmpdir(), "af-strategy-"));
  let s = new StrategyService(dir);
  try {
    const p = strategyFixture(),
      summary = s.import(p);
    assert.equal(summary.status, "candidate");
    assert.equal(s.import(p).hash, summary.hash);
    assert.equal(s.list().length, 1);
    assert.equal(s.query(summary.hash, [], "AhAs").availability, "available");
    assert.throws(
      () =>
        s.accept(
          summary.hash,
          "synthetic data must never become a real strategy answer",
        ),
      /合成/,
    );
    assert.throws(() => s.query("b".repeat(64), [], "AsAh"), /不存在/);
    s.close();
    s = new StrategyService(dir);
    assert.equal(s.list()[0].hash, summary.hash);
    assert.equal(s.list()[0].status, "candidate");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AF: shared application commands and information gate protect strategy import and reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "af-tools-")),
    s = new AnalysisService(new DiskStore(dir, "local"));
  const call = (name: string, extra = {}) =>
    s.executeAsync(name, {
      workspaceId: "local",
      expectedRevision: s.state.revision,
      requestId: crypto.randomUUID(),
      ...extra,
    });
  try {
    assert.equal(
      (await call("game_strategy_import", { pack: strategyFixture() })).ok,
      true,
    );
    assert.equal((await call("game_strategy_list")).ok, true);
    await call("game_create", { players: 2 });
    for (const name of ["game_strategy_list", "game_strategy_import"]) {
      const r = await call(
        name,
        name.endsWith("import") ? { pack: strategyFixture() } : {},
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "INFORMATION_RESTRICTED");
    }
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AF: unavailable is not zero loss, marked questions rank first, equal-value mixed actions are not errors", () => {
  const report = {
    nodes: [
      { sequence: 1, marked: false, status: "completed", gapBb: 2 },
      { sequence: 2, marked: true, status: "facts" },
    ],
    version: "auto-review/2",
  } as ReviewReport;
  const r = reportSummary(report);
  assert.equal(r.evaluated, 1);
  assert.equal(r.unknown, 1);
  assert.equal(r.priority, 2);
  assert.equal("totalLoss" in r, false);
  const a = decisionAdvice({
    ...report.nodes[0],
    gapBb: 0,
    actions: [
      { action: "Call", frequency: 0.01, evBb: 1 },
      { action: "Fold", frequency: 0.99, evBb: 1 },
    ],
  });
  assert.match(a.title, /价值接近/);
});
