import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore } from "../../runtime/store.ts";
import { makeSeating, validateSeating } from "../../runtime/game/seating.ts";
import type {
  HandView,
  FramePage,
  HandSummary,
} from "../../src/modules/play/domain.ts";
test("seat mapping: every HU/six-max fixed position and complete rotation preserves identity and canonical ring", () => {
  for (const players of [2, 6] as const) {
    for (let fixedPosition = 0; fixedPosition < players; fixedPosition++) {
      const s = makeSeating(players, {
        positionMode: "fixed",
        fixedPosition,
        botId: "baseline-heuristic/1",
      });
      validateSeating(s, players, fixedPosition);
      assert.equal(s.heroSeat, players - 1);
    }
    let s = makeSeating(players, {
      positionMode: "rotate",
      fixedPosition: 0,
      botId: "baseline-heuristic/1",
    });
    const first = s;
    const positions = new Set<number>();
    for (let h = 0; h < players; h++) {
      validateSeating(s, players, s.ruleToPhysical.indexOf(s.heroSeat));
      positions.add(s.dealerSeat);
      assert.deepEqual(s.playerIds, first.playerIds);
      assert.equal(s.sessionId, first.sessionId);
      s = makeSeating(
        players,
        {
          positionMode: "rotate",
          fixedPosition: 0,
          botId: "baseline-heuristic/1",
        },
        s,
      );
    }
    assert.equal(positions.size, players);
    assert.equal(s.dealerSeat, first.dealerSeat);
    const restored = {
      ...first,
      heroSeat: 0,
      playerIds: Array.from({ length: players }, (_, i) =>
        i === 0 ? "hero" : `other-${i}`,
      ),
    };
    const continued = makeSeating(
      players,
      {
        positionMode: "rotate",
        fixedPosition: 0,
        botId: "baseline-heuristic/1",
      },
      restored,
    );
    validateSeating(
      continued,
      players,
      continued.ruleToPhysical.indexOf(continued.heroSeat),
    );
    assert.equal(continued.heroSeat, 0);
    assert.deepEqual(continued.playerIds, restored.playerIds);
    assert.throws(() =>
      validateSeating(
        { ...first, ruleToPhysical: [...first.ruleToPhysical].reverse() },
        players,
        players - 1,
      ),
    );
  }
});
test(
  "actual rules: all fixed Hero positions, physical frames, rotated HU Bot sessions, filtered review and imported replay",
  { timeout: 60000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "m1-seats-"));
    const service = new AnalysisService(new DiskStore(dir));
    const call = async <T>(
      tool: string,
      input: Record<string, unknown> = {},
    ): Promise<T> => {
      const r = await service.executeAsync(tool, {
        workspaceId: "local",
        requestId: crypto.randomUUID(),
        expectedRevision: service.state.revision,
        ...input,
      });
      assert(r.ok, JSON.stringify(r));
      return (r as { data: T }).data;
    };
    const finish = async (h: HandView) => {
      for (let i = 0; !h.complete && i < 90; i++) {
        const a = h.legal.find((a) => a.kind === "check" || a.kind === "call")!;
        h = await call("game_act", {
          handId: h.id,
          handRevision: h.revision,
          kind: a.kind,
        });
      }
      assert(h.complete);
      return h;
    };
    try {
      for (const players of [2, 6] as const)
        for (let fixedPosition = 0; fixedPosition < players; fixedPosition++) {
          let h = await call<HandView>("game_create", {
            players,
            positionMode: "fixed",
            fixedPosition,
          });
          assert.equal(h.hero, players - 1);
          assert.equal(
            h.session!.positions[h.hero],
            players === 2
              ? ["BB", "BTN/SB"][fixedPosition]
              : ["SB", "BB", "UTG", "HJ", "CO", "BTN"][fixedPosition],
          );
          assert.equal(h.actor, h.complete ? null : h.hero);
          const page = await call<FramePage>("game_transition_query", {
            handId: h.id,
            handRevision: h.revision,
            batchId: h.transition!.batchId,
            limit: 16,
          });
          assert(page.items.length);
          for (const f of page.items) {
            assert.equal(f.view.hero, h.hero);
            assert(!("holes" in f.view));
          }
          if (!h.complete)
            h = await call("game_mark", {
              handId: h.id,
              decision: h.events.length,
            });
          h = await finish(h);
          assert.equal(
            h.stacks.reduce((a, b) => a + b, 0),
            players * 10000,
          );
          const filtered = await call<HandSummary[]>("game_list", {
            position: h.session!.positions[h.hero],
            markedOnly: true,
          });
          assert(filtered.some((x) => x.id === h.id));
        }
      let h = await call<HandView>("game_create", {
        players: 2,
        botId: "hu-v2.2.2-experimental",
      });
      h = await finish(h);
      const first = h;
      h = await call("game_next", { handId: h.id });
      h = await finish(h);
      assert.equal(h.hero, first.hero);
      assert.equal(h.session!.sessionId, first.session!.sessionId);
      assert.deepEqual(h.session!.playerIds, first.session!.playerIds);
      assert.notEqual(h.session!.dealerSeat, first.session!.dealerSeat);
      assert(
        h.botDecisions!.some((d) => d.executed === "hu-v2.2.2-experimental"),
      );
      const backup = await call("game_export");
      await call("game_import", { backup });
      const restored = await call<HandView>("game_get", { handId: h.id });
      assert.deepEqual(restored.session, h.session);
      assert.deepEqual(restored.events, h.events);
      const old = await call<HandView>("game_review", {
        handId: first.id,
        decision: first.decisions[0].sequence,
      });
      assert.deepEqual(old.board, []);
      assert.deepEqual(old.revealed, []);
    } finally {
      service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
