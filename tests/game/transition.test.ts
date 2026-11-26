import { test } from "node:test";
import assert from "node:assert/strict";
import { Rules } from "../../runtime/game/rules.ts";
import { AnalysisService } from "../../runtime/service.ts";
import { DiskStore } from "../../runtime/store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FramePage, HandView } from "../../src/modules/play/domain.ts";
import { PlaybackClock } from "../../src/modules/play/presentation.ts";

test("playback clock: cancellation releases pending playback and permits a fresh clock wait", async () => {
  const clock = new PlaybackClock(),
    waiting = clock.wait(10000);
  clock.cancel();
  assert.equal(await waiting, false);
  assert.equal(await clock.wait(1), true);
  clock.cancel();
});

test("six-player operation frames conserve side pots, unmatched returns and every repeated call", async () => {
  const rules = new Rules();
  try {
    const deck = [..."23456789TJQKA"].flatMap((r) =>
      [..."cdhs"].map((s) => r + s),
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
    const input = {
      players: 6 as const,
      deck: [...prefix, ...deck.filter((c) => !prefix.includes(c))],
      stacks: [1000, 2000, 3000, 1000, 1000, 1000],
      actions: [
        { actor: 2, kind: "raise" as const, amount: 3000 },
        ...[3, 4, 5, 0, 1].map((actor) => ({ actor, kind: "call" as const })),
      ],
    };
    let offset: number | null = 0;
    const frames = [];
    while (offset !== null) {
      const r = await rules.replay({
        ...input,
        trace: { afterActions: 0, includeInitial: true, offset, limit: 8 },
      });
      frames.push(...r.trace!.frames);
      offset = r.trace!.nextOffset;
    }
    const acted = frames.filter((f) => f.kind === "player-acted");
    assert.deepEqual(
      acted.map((f) => f.actor),
      [2, 3, 4, 5, 0, 1],
    );
    const returned = frames.find((f) => f.kind === "uncalled-returned");
    assert(returned);
    assert.deepEqual(returned.returned, [0, 0, 1000, 0, 0, 0]);
    for (const f of frames)
      assert.equal(
        f.snapshot.stacks.reduce((n, v) => n + v, 0) + f.snapshot.pot,
        9000,
      );
    assert.deepEqual(
      frames.at(-1)!.snapshot.stacks,
      [6000, 2000, 1000, 0, 0, 0],
    );
  } finally {
    rules.close();
  }
});
test("PokerKit public operation frames: sequential all-in runout, exact ledger, tabled-only cards and bounded pages", async () => {
  const rules = new Rules();
  try {
    const input = {
      players: 2 as const,
      deck: [..."23456789TJQKA"].flatMap((r) => [..."cdhs"].map((s) => r + s)),
      actions: [
        { actor: 1, kind: "raise" as const, amount: 10000 },
        { actor: 0, kind: "call" as const },
      ],
    };
    let offset: number | null = 0;
    const frames = [];
    while (offset !== null) {
      const reply = await rules.replay({
        ...input,
        trace: { afterActions: 0, includeInitial: true, offset, limit: 3 },
      });
      assert(reply.trace);
      assert(reply.trace.frames.length <= 3);
      frames.push(...reply.trace.frames);
      offset = reply.trace.nextOffset;
    }
    assert.deepEqual(
      frames.map((f) => f.sequence),
      frames.map((_, i) => i),
    );
    assert.deepEqual(
      frames
        .filter((f) => f.kind === "board-dealt")
        .map((f) => f.snapshot.board.length),
      [3, 4, 5],
    );
    assert(frames.some((f) => f.kind === "pot-awarded"));
    assert.equal(frames.at(-1)!.kind, "hand-closed");
    for (const f of frames) {
      assert.equal(
        f.snapshot.stacks.reduce((n, v) => n + v, 0) + f.snapshot.pot,
        20000,
      );
      assert(!("holes" in f.snapshot));
      assert(!("deck" in f.snapshot));
    }
    const firstReveal = frames.findIndex((f) => f.kind === "cards-tabled");
    assert(firstReveal >= 0);
    for (const f of frames.slice(0, firstReveal))
      assert(f.snapshot.shown.every((c) => !c.length));
    const final = await rules.replay(input);
    assert.deepEqual(frames.at(-1)!.snapshot.stacks, final.stacks);
    assert.deepEqual(frames.at(-1)!.snapshot.board, final.board);
  } finally {
    rules.close();
  }
});
test("transition queries are version-bound, safe, paged, repeatable and obey the current independent-hand gate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "riverline-frames-")),
    service = new AnalysisService(new DiskStore(directory));
  const raw = (tool: string, input: Record<string, unknown> = {}) =>
    service.executeAsync(tool, {
      workspaceId: "local",
      expectedRevision: service.state.revision,
      requestId: crypto.randomUUID(),
      ...input,
    });
  const call = async <T>(tool: string, input: Record<string, unknown> = {}) => {
    const r = await raw(tool, input);
    assert(r.ok, JSON.stringify(r));
    return r.data as T;
  };
  try {
    let h = await call<HandView>("game_create", { players: 6 });
    const query = {
      handId: h.id,
      handRevision: h.revision,
      batchId: h.transition!.batchId,
      limit: 2,
    };
    const page = await call<FramePage>("game_transition_query", query);
    assert(page.items.length <= 2);
    assert.deepEqual(await call("game_transition_query", query), page);
    for (const f of page.items) {
      assert(!("holes" in f.view));
      assert(!("shown" in f.view));
      assert(!("deck" in f.view));
      assert(!f.view.revealed.some((c) => c.length));
    }
    h = await call<HandView>("game_act", {
      handId: h.id,
      handRevision: h.revision,
      kind: "fold",
    });
    assert.equal((await raw("game_transition_query", query)).ok, false);
    assert(h.complete);
    const past = {
      handId: h.id,
      handRevision: h.revision,
      batchId: h.transition!.batchId,
    };
    await call("game_transition_query", past);
    await call("game_next", { handId: h.id });
    const denied = await raw("game_transition_query", past);
    assert(!denied.ok);
    assert.equal(denied.code, "INFORMATION_RESTRICTED");
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
