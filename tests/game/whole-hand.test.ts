import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore, hash } from "../../runtime/store.ts";
import { Rules } from "../../runtime/game/rules.ts";
import type {
  HandView,
  ResearchSource,
} from "../../src/modules/play/domain.ts";

function calls(service: AnalysisService) {
  const raw = (tool: string, input: Record<string, unknown> = {}) =>
    service.executeAsync(tool, {
      workspaceId: "local",
      requestId: crypto.randomUUID(),
      expectedRevision: service.state.revision,
      ...input,
    });
  const call = async <T>(
    tool: string,
    input: Record<string, unknown> = {},
  ): Promise<T> => {
    const r = await raw(tool, input);
    assert.equal(r.ok, true, JSON.stringify(r));
    return (r as { data: T }).data;
  };
  return { raw, call };
}
test("PokerKit: deterministic all-in runout, terminal chip conservation, and short all-in reopen rules", async () => {
  const rules = new Rules(),
    deck = [..."23456789TJQKA"].flatMap((r) => [..."cdhs"].map((s) => r + s));
  try {
    const actions = [
      { actor: 1, kind: "raise" as const, amount: 1000 },
      { actor: 0, kind: "call" as const },
    ];
    const a = await rules.replay({
      players: 2,
      deck,
      stacks: [1000, 1000],
      actions,
    });
    assert.equal(a.complete, true);
    assert.equal(a.board.length, 5);
    assert.equal(
      a.stacks.reduce((a, b) => a + b, 0),
      2000,
    );
    assert.equal(
      a.payoffs.reduce((a, b) => a + b, 0),
      0,
    );
    assert.deepEqual(
      a,
      await rules.replay({ players: 2, deck, stacks: [1000, 1000], actions }),
    );
    await assert.rejects(
      rules.replay({
        players: 2,
        deck,
        actions: [{ actor: 0, kind: "check" }],
      }),
    );
    const short = await rules.replay({
      players: 6,
      deck,
      stacks: [1000, 1000, 1000, 250, 1000, 1000],
      actions: [
        { actor: 2, kind: "raise", amount: 200 },
        { actor: 3, kind: "raise", amount: 250 },
        { actor: 4, kind: "fold" },
        { actor: 5, kind: "fold" },
        { actor: 0, kind: "fold" },
        { actor: 1, kind: "fold" },
      ],
    });
    assert.equal(short.actor, 2);
    assert(
      !short.legal.some((x) => x.kind === "raise"),
      "short all-in does not reopen original raiser",
    );
    const prefix = [
      "As",
      "Ah",
      "Ks",
      "Kh",
      "Qs",
      "Qh",
      "Js",
      "Jh",
      "8s",
      "8h",
      "6s",
      "6h",
      "2d",
      "2c",
      "3d",
      "7h",
      "2h",
      "9s",
      "2s",
      "Tc",
    ];
    const sideDeck = [...prefix, ...deck.filter((c) => !prefix.includes(c))];
    const side = await rules.replay({
      players: 6,
      deck: sideDeck,
      stacks: [1000, 2000, 3000, 1000, 1000, 1000],
      actions: [
        { actor: 2, kind: "raise", amount: 3000 },
        ...[3, 4, 5, 0, 1].map((actor) => ({ actor, kind: "call" as const })),
      ],
    });
    assert.equal(side.complete, true);
    assert.deepEqual(
      side.stacks,
      [6000, 2000, 1000, 0, 0, 0],
      "main pot, side pot, and unmatched contribution refund",
    );
  } finally {
    rules.close();
  }
});
test(
  "practice SQLite backup: replay-verified atomic restore, forged historical snapshot rejected",
  { timeout: 30000 },
  async () => {
    const a = mkdtempSync(join(tmpdir(), "hands-export-")),
      b = mkdtempSync(join(tmpdir(), "hands-import-"));
    const original = new AnalysisService(new DiskStore(a)),
      target = new AnalysisService(new DiskStore(b));
    try {
      const { call } = calls(original),
        into = calls(target);
      let hand = await call<HandView>("game_create", { players: 2 });
      for (let i = 0; !hand.complete && i < 40; i++) {
        const action = hand.legal.find(
          (a) => a.kind === "check" || a.kind === "call",
        )!;
        hand = await call("game_act", {
          handId: hand.id,
          handRevision: hand.revision,
          kind: action.kind,
        });
      }
      assert(hand.complete);
      const source = await call<ResearchSource>("game_research", {
        handId: hand.id,
        decision: hand.decisions[0].sequence,
      });
      await call("game_study_note", {
        studyId: source.id,
        note: "我需要检验翻前范围假设。",
      });
      const backup = await call<any>("game_export");
      const forged = structuredClone(backup);
      forged.payload.studies[0].snapshot.board = ["As"];
      forged.checksum = hash(forged.payload);
      assert.equal(
        (await into.raw("game_import", { backup: forged })).ok,
        false,
      );
      assert.deepEqual(
        await into.call("game_list"),
        [],
        "failed validation commits no partial hand",
      );
      await into.call("game_import", { backup });
      assert.deepEqual(await into.call("game_get", { handId: hand.id }), hand);
      assert.equal(
        (
          await into.call<ResearchSource>("game_study_get", {
            studyId: source.id,
          })
        ).note,
        "我需要检验翻前范围假设。",
      );
      assert.deepEqual(await into.call("game_import", { backup }), {
        importedHands: 0,
        importedStudies: 0,
      });
    } finally {
      original.close();
      target.close();
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  },
);
test(
  "whole hands: legal paths, privacy, idempotent actions, restart, historical prefix and river research provenance",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "riverline-hands-"));
    let service = new AnalysisService(new DiskStore(directory));
    try {
      let { call, raw } = calls(service);
      const createInput = { players: 2, requestId: crypto.randomUUID() };
      let hand = await call<HandView>("game_create", createInput);
      assert.deepEqual(await call("game_create", createInput), hand);
      assert.equal(hand.board.length, 0);
      assert.equal(hand.heroCards.length, 2);
      assert(!("holes" in hand));
      assert.deepEqual(hand.revealed, []);
      assert.equal((await raw("real_workspace_get")).ok, false);
      assert.equal((await raw("workspace_export")).ok, false);
      assert.deepEqual(service.resources(), []);
      assert.equal((await raw("game_review", { handId: hand.id })).ok, false);
      const id = hand.id;
      service.close();
      service = new AnalysisService(new DiskStore(directory));
      ({ call, raw } = calls(service));
      const restored = await call<HandView>("game_get", { handId: id });
      assert.deepEqual(restored, hand);
      assert.equal(
        (await raw("real_workspace_get")).ok,
        false,
        "restart preserves independent gate",
      );
      let river: number | undefined;
      let turnDecision: number | undefined;
      let lastActionInput: Record<string, unknown> | undefined;
      for (let turn = 0; !hand.complete && turn < 40; turn++) {
        if (hand.street === 3) river = hand.events.length;
        if (hand.street === 2) turnDecision = hand.events.length;
        const a = hand.legal.find(
          (a) => a.kind === "check" || a.kind === "call",
        )!;
        assert(a);
        const input = {
          handId: hand.id,
          handRevision: hand.revision,
          kind: a.kind,
          requestId: crypto.randomUUID(),
        };
        lastActionInput = input;
        const before = hand.revision;
        hand = await call<HandView>("game_act", input);
        assert.deepEqual(
          await call("game_act", input),
          hand,
          "duplicate receipt returns original result",
        );
        assert.equal(
          (
            await raw("game_act", {
              ...input,
              requestId: crypto.randomUUID(),
              handRevision: before,
            })
          ).ok,
          false,
        );
      }
      assert(hand.complete);
      assert.equal(
        hand.stacks.reduce((a, b) => a + b, 0),
        20000,
      );
      assert.equal(
        hand.payoffs.reduce((a, b) => a + b, 0),
        0,
      );
      const first = hand.decisions[0].sequence;
      const prefix = await call<HandView>("game_review", {
        handId: id,
        decision: first,
      });
      assert.deepEqual(prefix.board, []);
      assert.deepEqual(prefix.revealed, []);
      assert(prefix.events.length < hand.events.length);
      assert(!("deck" in prefix));
      assert(!("holes" in prefix));
      assert.notEqual(turnDecision, undefined);
      const turnSource = await call<ResearchSource>("game_research", {
        handId: id,
        decision: turnDecision,
      });
      assert(turnSource.eligible);
      assert.equal(turnSource.root!.board.length, 4);
      assert.deepEqual(turnSource.root!.board, hand.board.slice(0, 4));
      assert.equal(turnSource.snapshot.board.length, 4);
      assert.deepEqual(turnSource.snapshot.revealed, []);
      const turnBackup = await call<any>("game_export");
      await call("game_import", { backup: turnBackup });
      assert.equal(
        (
          await call<ResearchSource>("game_study_get", {
            studyId: turnSource.id,
          })
        ).root!.board.length,
        4,
      );
      if (river !== undefined) {
        const source = await call<ResearchSource>("game_research", {
          handId: id,
          decision: river,
        });
        assert(source.eligible);
        assert.equal(source.root!.board.length, 5);
        assert(source.root!.pot > 0);
        assert.equal(source.snapshot.revealed.length, 0);
        assert.deepEqual(
          await call("game_study_get", { studyId: source.id }),
          source,
        );
      }
      const researchInput = {
        handId: id,
        decision: first,
        requestId: crypto.randomUUID(),
      };
      await call("game_research", researchInput);
      const six = await call<HandView>("game_create", { players: 6 });
      assert.notEqual(six.id, restored.id);
      for (const [tool, input] of [
        ["game_research", researchInput],
        ["game_act", lastActionInput!],
        ["game_create", createInput],
      ] as const) {
        const denied = await raw(tool, input);
        assert.equal(
          denied.ok,
          false,
          "old receipts cannot bypass an active hand",
        );
        if (!denied.ok) assert.equal(denied.code, "INFORMATION_RESTRICTED");
      }
      let end = six;
      for (let turn = 0; !end.complete && turn < 40; turn++) {
        const a = end.legal.find(
          (a) => a.kind === "check" || a.kind === "call",
        )!;
        end = await call("game_act", {
          handId: end.id,
          handRevision: end.revision,
          kind: a.kind,
        });
      }
      assert(end.complete);
      assert.equal(
        end.stacks.reduce((a, b) => a + b, 0),
        60000,
      );
    } finally {
      service.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
