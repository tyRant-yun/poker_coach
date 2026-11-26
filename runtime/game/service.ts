import { randomInt, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { DiskStore, hash } from "../store.ts";
import { contractVersion } from "../../src/modules/analysis/domain.ts";
import type { Reply } from "../../src/modules/analysis/domain.ts";
import { BotRegistry, botCatalog } from "../bots/registry.ts";
import { makeSeating, validateSeating } from "./seating.ts";
import {
  seatContext,
  seatingSchema,
  positions,
} from "../../src/modules/play/seating.ts";
import type { Seating } from "../../src/modules/play/seating.ts";
import type { BotDecisionRecord } from "../../src/modules/play/domain.ts";
import { gameSchemas } from "../../src/modules/play/domain.ts";
import type {
  GameAction,
  GameTool,
  HandSummary,
  HandView,
  ResearchSource,
  RuleView,
  Transition,
} from "../../src/modules/play/domain.ts";
import { Rules } from "./rules.ts";
import type { ReviewInput } from "../../src/modules/play/review.ts";

type Hand = {
  seating?: Seating;
  botDecisions?: BotDecisionRecord[];
  transition?: Transition;
  id: string;
  number: number;
  revision: number;
  players: 2 | 6;
  hero: number;
  deck: string[];
  actions: GameAction[];
  marks: number[];
  state: RuleView;
  created: string;
};
class GameFault extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const demand = (
  condition: unknown,
  message: string,
  code = "VALIDATION_ERROR",
) => {
  if (!condition) throw new GameFault(code, message);
};
const shuffle = () => {
  const cards = [..."23456789TJQKA"].flatMap((r) =>
    [..."cdhs"].map((s) => r + s),
  );
  for (let i = 51; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
};
export class GameService {
  private db: DatabaseSync;
  private rules = new Rules();
  private providers = new BotRegistry();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: DiskStore) {
    this.db = new DatabaseSync(join(store.directory, "hands.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hands(id TEXT PRIMARY KEY, number INTEGER NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, hash TEXT NOT NULL, reply TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studies(id TEXT PRIMARY KEY, document TEXT NOT NULL);`);
    this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES('workspace',?)")
      .run(store.state.workspaceId);
    const owner = this.db
      .prepare("SELECT value FROM metadata WHERE name='workspace'")
      .get() as { value: string };
    if (owner.value !== store.state.workspaceId) {
      this.db.close();
      throw Error("练习数据库属于其他工作区");
    }
  }
  close() {
    this.rules.close();
    this.providers.close();
    this.db.close();
  }
  restricted() {
    const row = this.db
      .prepare("SELECT document FROM hands ORDER BY number DESC LIMIT 1")
      .get() as { document: string } | undefined;
    return !!row && !JSON.parse(row.document).state.complete;
  }
  async reviewInputs(handId: string): Promise<ReviewInput[]> {
    const hand = this.get(handId);
    demand(hand.state.complete, "完成本手后生成报告", "INFORMATION_RESTRICTED");
    const result: ReviewInput[] = [];
    for (let sequence = 0; sequence < hand.actions.length; sequence++) {
      if (hand.actions[sequence].actor !== hand.hero) continue;
      const before = hand.actions.slice(0, sequence),
        state = await this.replay(hand, before);
      let start = sequence;
      while (start > 0 && hand.state.events[start - 1].street === state.street)
        start--;
      const rootActions = hand.actions.slice(0, start),
        root = await this.replay(hand, rootActions);
      const physical = (a: GameAction) => ({
        ...a,
        actor: hand.seating?.ruleToPhysical[a.actor] ?? a.actor,
      });
      result.push({
        sequence,
        snapshot: this.project(hand, state, before),
        root: this.project(hand, root, rootActions),
        prefix: hand.actions.slice(start, sequence).map(physical),
        chosen: physical(hand.actions[sequence]),
      });
    }
    return result;
  }
  private get(id: string): Hand {
    const row = this.db
      .prepare("SELECT document FROM hands WHERE id=?")
      .get(id) as { document: string } | undefined;
    demand(row, "找不到这手牌", "NOT_FOUND");
    return JSON.parse(row!.document) as Hand;
  }
  private source(id: string): ResearchSource {
    const row = this.db
      .prepare("SELECT document FROM studies WHERE id=?")
      .get(id) as { document: string } | undefined;
    demand(row, "找不到研究来源", "NOT_FOUND");
    return JSON.parse(row!.document);
  }
  private save(hand: Hand) {
    this.db
      .prepare(
        "INSERT INTO hands VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      )
      .run(hand.id, hand.number, JSON.stringify(hand));
  }
  private project(
    hand: Hand,
    state = hand.state,
    actions = hand.actions,
  ): HandView {
    const { holes, shown, ...safe } = state;
    const physical = (r: number) => hand.seating?.ruleToPhysical[r] ?? r;
    const reorder = <T>(values: T[]) => {
      if (!values.length) return values;
      const out = Array<T>(values.length);
      values.forEach((v, r) => (out[physical(r)] = v));
      return out;
    };
    return {
      ...safe,
      ...(state === hand.state && actions === hand.actions && hand.transition
        ? { transition: hand.transition }
        : {}),
      ...(hand.seating ? { session: seatContext(hand.seating) } : {}),
      ...(hand.botDecisions
        ? {
            botDecisions: hand.botDecisions
              .filter((d) => d.sequence < actions.length)
              .map((d) => ({ ...d, actor: physical(d.actor) })),
          }
        : {}),
      actor: state.actor === null ? null : physical(state.actor),
      stacks: reorder(state.stacks),
      bets: reorder(state.bets),
      active: reorder(state.active),
      payoffs: reorder(state.payoffs),
      events: state.events.map((e) => ({ ...e, actor: physical(e.actor) })),
      id: hand.id,
      revision: hand.revision,
      number: hand.number,
      hero: physical(hand.hero),
      heroCards: holes[hand.hero],
      revealed:
        state.complete && state.board.length === 5 ? reorder(shown) : [],
      marks: hand.marks.filter((n) => n <= actions.length),
      decisions: state.events.flatMap((action, sequence) =>
        action.actor === hand.hero
          ? [
              {
                sequence,
                street: action.street,
                kind: action.kind,
                ...(action.amount === undefined
                  ? {}
                  : { amount: action.amount }),
                marked: hand.marks.includes(sequence),
              },
            ]
          : [],
      ),
    };
  }
  private async replay(hand: Hand, actions = hand.actions) {
    return this.rules.replay({
      players: hand.players,
      deck: hand.deck,
      actions,
    });
  }
  private async bots(hand: Hand) {
    // Legal, card-aware, versioned heuristic. These actions are not GTO claims.
    for (
      let i = 0;
      !hand.state.complete && hand.state.actor !== hand.hero;
      i++
    ) {
      demand(i < 200, "对手行动超过本手限制");
      const s = hand.state,
        actor = s.actor!,
        view = this.project(hand),
        physical = hand.seating?.ruleToPhysical[actor] ?? actor;
      const botId = hand.seating?.botId ?? "baseline-heuristic/1";
      const reply = await this.providers.decide(botId, {
        contract: "riverline-bot/1",
        requestId: randomUUID(),
        handId: hand.id,
        sessionId: hand.seating?.sessionId ?? hand.id,
        revision: hand.revision,
        sequence: hand.actions.length,
        playerId: hand.seating?.playerIds[physical] ?? `legacy-${actor}`,
        originPlayers: hand.players,
        actor: physical,
        dealerSeat: hand.seating?.dealerSeat ?? hand.players - 1,
        street: s.street,
        ownCards: s.holes[actor],
        board: s.board,
        stacks: view.stacks,
        bets: view.bets,
        active: view.active,
        pot: s.pot,
        smallBlind: 50,
        bigBlind: 100,
        handIndex: hand.seating?.handIndex ?? hand.number,
        history: view.events,
        legal: s.legal,
        seed: hash([hand.id, hand.actions.length, "bot-heuristic/1"]),
        budgetMs: 300,
      });
      const action: GameAction = { actor, ...reply.action };
      (hand.botDecisions ??= []).push({
        sequence: hand.actions.length,
        actor,
        requested: botId,
        executed: reply.executed,
        elapsedMs: reply.elapsedMs,
        ...(reply.fallback ? { fallback: reply.fallback } : {}),
      });
      hand.actions.push(action);
      hand.state = await this.replay(hand);
    }
  }
  private summary(hand: Hand): HandSummary {
    return {
      ...(hand.seating
        ? {
            position: seatContext(hand.seating).positions[
              hand.seating.heroSeat
            ],
            sessionId: hand.seating.sessionId,
            botId: hand.seating.botId,
          }
        : { position: positions(hand.players)[hand.hero] }),
      id: hand.id,
      number: hand.number,
      hero: hand.seating?.heroSeat ?? hand.hero,
      players: hand.players,
      complete: hand.state.complete,
      decisions: hand.actions.filter((a) => a.actor === hand.hero).length,
      marked: hand.marks.length,
      net: hand.state.complete ? hand.state.payoffs[hand.hero] : null,
      created: hand.created,
    };
  }
  execute(name: GameTool, raw: unknown): Promise<Reply> {
    const task = this.queue.then(() => this.call(name, raw));
    this.queue = task.catch(() => {});
    return task;
  }
  private async call(name: GameTool, raw: unknown): Promise<Reply> {
    try {
      const input = gameSchemas[name].parse(raw);
      demand(
        input.workspaceId === this.store.state.workspaceId,
        "工作区不匹配",
      );
      demand(
        !this.store.state.independent,
        "请先完成当前独立题，再进入整手练习",
        "INFORMATION_RESTRICTED",
      );
      const write = ![
        "game_list",
        "game_bot_list",
        "game_get",
        "game_transition_query",
        "game_review",
        "game_study_get",
        "game_export",
      ].includes(name);
      const key = `${name}:${input.requestId ?? ""}`,
        payloadHash = hash(input);
      if (write) {
        const receipt = this.db
          .prepare("SELECT hash,reply FROM receipts WHERE id=?")
          .get(key) as { hash: string; reply: string } | undefined;
        if (receipt) {
          demand(
            receipt.hash === payloadHash,
            "同一请求不能提交不同内容",
            "IDEMPOTENCY_CONFLICT",
          );
          const cached = JSON.parse(receipt.reply) as Reply;
          // A receipt must obey the current observation boundary as well as its original one.
          // Keep retries of the active hand safe; do not reopen past research or showdown data.
          if (this.restricted()) {
            demand(
              ["game_create", "game_next", "game_act", "game_mark"].includes(
                name,
              ),
              "完成当前整手后再查看历史或研究",
              "INFORMATION_RESTRICTED",
            );
            const handId = cached.ok
              ? (cached.data as { id?: string }).id
              : undefined;
            demand(
              handId && !this.get(handId).state.complete,
              "完成当前整手后再读取旧行动回执",
              "INFORMATION_RESTRICTED",
            );
          }
          return cached;
        }
        demand(
          input.expectedRevision === this.store.state.revision,
          "工作区已更新，请刷新后重试",
          "REVISION_CONFLICT",
        );
      }
      const arg = input as z.infer<typeof gameSchemas.game_act> & {
        decision?: number;
        players?: 2 | 6;
        studyId?: string;
        caseId?: string;
        note?: string;
        backup?: unknown;
        positionMode?: "rotate" | "fixed" | "random";
        fixedPosition?: number;
        botId?: Seating["botId"];
        position?: string;
        street?: number;
        markedOnly?: boolean;
      };
      if (this.restricted()) {
        demand(
          [
            "game_list",
            "game_bot_list",
            "game_get",
            "game_transition_query",
            "game_act",
            "game_mark",
          ].includes(name),
          "完成当前整手后再查看历史、研究或开始下一手",
          "INFORMATION_RESTRICTED",
        );
        if (name === "game_get" || name === "game_transition_query")
          demand(
            !this.get(arg.handId).state.complete,
            "完成当前整手后再查看历史手牌",
            "INFORMATION_RESTRICTED",
          );
      }
      let result: unknown,
        saveHand: Hand | undefined,
        saveSource: ResearchSource | undefined;
      const importHands: Hand[] = [],
        importSources: ResearchSource[] = [];
      if (name === "game_bot_list") result = botCatalog();
      else if (name === "game_list") {
        result = (
          this.db
            .prepare(
              "SELECT document FROM hands ORDER BY number DESC LIMIT 1000",
            )
            .all() as { document: string }[]
        )
          .map((r) => JSON.parse(r.document) as Hand)
          .filter(
            (h) =>
              (!arg.position ||
                (h.seating
                  ? seatContext(h.seating).positions[h.seating.heroSeat]
                  : positions(h.players)[h.hero]) === arg.position) &&
              (!arg.markedOnly || h.marks.length > 0) &&
              (arg.street === undefined ||
                h.state.events.some(
                  (e) => e.actor === h.hero && e.street === arg.street,
                )),
          )
          .slice(0, 100)
          .map((h) => this.summary(h));
      } else if (name === "game_create" || name === "game_next") {
        let players = arg.players ?? 6;
        let previousLayout: Seating | undefined;
        if (name === "game_next") {
          const previous = this.get(arg.handId);
          demand(previous.state.complete, "请先完成当前这手牌");
          players = previous.players;
          const latest = this.db
            .prepare("SELECT id FROM hands ORDER BY number DESC LIMIT 1")
            .get() as { id: string };
          demand(latest.id === previous.id, "请从最近一手继续会话，或新建练习");
          previousLayout = previous.seating;
        }
        const unfinished = this.db
          .prepare("SELECT document FROM hands ORDER BY number DESC LIMIT 1")
          .get() as { document: string } | undefined;
        demand(
          !unfinished || JSON.parse(unfinished.document).state.complete,
          "已有未完成手牌，请先继续",
        );
        const number = Number(
          (
            this.db
              .prepare("SELECT COALESCE(MAX(number),0)+1 AS n FROM hands")
              .get() as { n: number }
          ).n,
        );
        const seating = makeSeating(
          players,
          {
            positionMode: previousLayout?.mode ?? arg.positionMode ?? "rotate",
            fixedPosition:
              previousLayout?.fixedPosition ?? arg.fixedPosition ?? 0,
            botId: previousLayout?.botId ?? arg.botId ?? "baseline-heuristic/1",
          },
          previousLayout,
        );
        demand(
          players === 2 || seating.botId === "baseline-heuristic/1",
          "HU候选只支持原生单挑桌",
        );
        demand(
          botCatalog().some((b) => b.id === seating.botId && b.available),
          "对手发行包不可用，请运行 npm run bot:setup",
        );
        await this.providers.warm(seating.botId);
        const hand: Hand = {
          seating,
          botDecisions: [],
          id: randomUUID(),
          number,
          revision: 0,
          players,
          hero: seating.ruleToPhysical.indexOf(seating.heroSeat),
          deck: shuffle(),
          actions: [],
          marks: [],
          state: undefined!,
          created: new Date().toISOString(),
        };
        hand.state = await this.replay(hand);
        await this.bots(hand);
        hand.transition = {
          batchId: hash([hand.id, hand.revision, hand.actions]),
          fromRevision: -1,
          toRevision: hand.revision,
          fromAction: 0,
          toAction: hand.actions.length,
        };
        saveHand = hand;
        result = this.project(hand);
      } else if (name === "game_transition_query") {
        const query = gameSchemas.game_transition_query.parse(input),
          hand = this.get(query.handId),
          t = hand.transition;
        demand(
          t &&
            t.batchId === query.batchId &&
            t.toRevision === query.handRevision &&
            hand.revision === query.handRevision,
          "动作批次已变化，请同步当前回合",
          "REVISION_CONFLICT",
        );
        const replayed = await this.rules.replay({
          players: hand.players,
          deck: hand.deck,
          actions: hand.actions.slice(0, t!.toAction),
          trace: {
            afterActions: t!.fromAction,
            includeInitial: t!.fromRevision === -1,
            offset: query.offset,
            limit: query.limit,
          },
        });
        const page = replayed.trace!;
        demand(query.offset <= page.total, "动作帧游标超出范围");
        const { transition: _, ...base } = this.project(hand);
        result = {
          batchId: t!.batchId,
          revision: hand.revision,
          total: page.total,
          nextOffset: page.nextOffset,
          items: page.frames.map((f) => {
            const { shown, ...safe } = f.snapshot;
            return {
              id: `${t!.batchId}:${f.sequence}`,
              sequence: f.sequence,
              kind: f.kind,
              actor:
                f.actor === null
                  ? null
                  : (hand.seating?.ruleToPhysical[f.actor] ?? f.actor),
              amount: f.amount,
              returned:
                f.returned && hand.seating
                  ? physicalArray(f.returned, hand.seating)
                  : f.returned,
              view: {
                ...base,
                ...safe,
                actor:
                  f.actor === null
                    ? null
                    : (hand.seating?.ruleToPhysical[f.actor] ?? f.actor),
                stacks: hand.seating
                  ? physicalArray(f.snapshot.stacks, hand.seating)
                  : f.snapshot.stacks,
                bets: hand.seating
                  ? physicalArray(f.snapshot.bets, hand.seating)
                  : f.snapshot.bets,
                active: hand.seating
                  ? physicalArray(f.snapshot.active, hand.seating)
                  : f.snapshot.active,
                payoffs: hand.seating
                  ? physicalArray(f.snapshot.payoffs, hand.seating)
                  : f.snapshot.payoffs,
                botDecisions: base.botDecisions?.filter(
                  (d) => d.sequence < f.actionCount,
                ),
                legal: [],
                revealed: hand.seating
                  ? physicalArray(shown, hand.seating)
                  : shown,
                events: base.events.slice(0, f.actionCount),
                decisions: base.decisions.filter(
                  (d) => d.sequence < f.actionCount,
                ),
                marks: base.marks.filter((n) => n < f.actionCount),
              },
            };
          }),
        };
        demand(
          Buffer.byteLength(JSON.stringify(result)) <= 65536,
          "动作帧分页超过64KiB，请缩小页数",
        );
      } else if (name === "game_get")
        result = this.project(this.get(arg.handId));
      else if (name === "game_act" || name === "game_mark") {
        const hand = this.get(arg.handId);
        const fromRevision = hand.revision,
          fromAction = hand.actions.length;
        demand(
          !hand.state.complete && hand.state.actor === hand.hero,
          "当前不是你的行动节点",
        );
        if (name === "game_mark") {
          demand(
            arg.decision === hand.actions.length,
            "该决策已变化，请刷新",
            "REVISION_CONFLICT",
          );
          hand.marks = [...new Set([...hand.marks, arg.decision!])];
        } else {
          demand(
            hand.revision === arg.handRevision,
            "该手牌已变化，请刷新后重试",
            "REVISION_CONFLICT",
          );
          const legal = hand.state.legal.find((a) => a.kind === arg.kind);
          demand(legal, "当前行动不合法");
          if (arg.kind === "raise")
            demand(
              Number.isInteger(arg.amount) &&
                arg.amount! >= legal!.min! &&
                arg.amount! <= legal!.max!,
              "金额不在合法范围内",
            );
          else demand(arg.amount === undefined, "此行动不需要下注额");
          hand.actions.push({
            actor: hand.hero,
            kind: arg.kind,
            ...(arg.kind === "raise" ? { amount: arg.amount } : {}),
          });
          hand.state = await this.replay(hand);
          await this.bots(hand);
        }
        hand.revision++;
        if (name === "game_act")
          hand.transition = {
            batchId: hash([hand.id, hand.revision, hand.actions]),
            fromRevision,
            toRevision: hand.revision,
            fromAction,
            toAction: hand.actions.length,
          };
        saveHand = hand;
        result = this.project(hand);
      } else if (name === "game_review" || name === "game_research") {
        const hand = this.get(arg.handId);
        demand(
          hand.state.complete,
          "完成本手后查看复盘与研究",
          "INFORMATION_RESTRICTED",
        );
        if (name === "game_review" && arg.decision === undefined)
          result = this.project(hand);
        else {
          const seq = arg.decision!;
          demand(
            hand.actions[seq]?.actor === hand.hero,
            "请选择一次真实 Hero 决策",
          );
          const state = await this.replay(hand, hand.actions.slice(0, seq));
          const snapshot = this.project(
            hand,
            state,
            hand.actions.slice(0, seq),
          );
          if (name === "game_review") result = snapshot;
          else {
            const id = `study-${hand.id}-${seq}`,
              source: ResearchSource = {
                id,
                handId: hand.id,
                sequence: seq,
                handHash: hash([hand.deck, hand.actions]),
                snapshot,
                eligible:
                  [4, 5].includes(state.board.length) &&
                  state.active.filter(Boolean).length === 2,
                reason:
                  "当前可计算两人转牌或河牌局部模型；输入范围需要你设定，其余节点可保存研究笔记。",
              };
            if (source.eligible) {
              let start = seq;
              while (
                start > 0 &&
                hand.state.events[start - 1].street === state.street
              )
                start--;
              const root = await this.replay(
                hand,
                hand.actions.slice(0, start),
              );
              source.root = {
                heroPlayer: root.actor === hand.hero ? 0 : 1,
                board: root.board,
                pot: root.pot,
                stack: Math.min(
                  ...root.stacks.filter((_, i) => root.active[i]),
                ),
                path: hand.actions.slice(start, seq).map((a) => ({
                  ...a,
                  actor: hand.seating?.ruleToPhysical[a.actor] ?? a.actor,
                })),
              };
            }
            const existing = this.db
              .prepare("SELECT document FROM studies WHERE id=?")
              .get(id) as { document: string } | undefined;
            result = existing ? JSON.parse(existing.document) : source;
            saveSource = result as ResearchSource;
          }
        }
      } else if (name === "game_study_get") result = this.source(arg.studyId!);
      else if (name === "game_study_note") {
        const source = this.source(arg.studyId!);
        source.note = arg.note;
        saveSource = source;
        result = source;
      } else if (name === "game_study_link") {
        const source = this.source(arg.studyId!),
          c = this.store.state.real?.cases[arg.caseId!];
        demand(c, "研究案例不存在");
        demand(
          source.eligible && source.root?.board.join() === c!.board.join(),
          "研究来源与案例牌面不匹配",
        );
        source.caseRef = c!.ref;
        saveSource = source;
        result = source;
      } else if (name === "game_export") {
        const payload = {
          version: "riverline-hands/1",
          hands: (
            this.db
              .prepare("SELECT document FROM hands ORDER BY number LIMIT 1000")
              .all() as { document: string }[]
          ).map((r) => JSON.parse(r.document)),
          studies: (
            this.db
              .prepare("SELECT document FROM studies LIMIT 1000")
              .all() as { document: string }[]
          ).map((r) => JSON.parse(r.document)),
        };
        demand(
          Number(
            (
              this.db.prepare("SELECT COUNT(*) AS n FROM hands").get() as {
                n: number;
              }
            ).n,
          ) <= 1000,
          "练习备份超过当前1000手上限，请保留数据库并联系维护者",
        );
        result = { payload, checksum: hash(payload), privateReplayData: true };
      } else if (name === "game_import") {
        const backup = arg.backup;
        const card = z.string().regex(/^[2-9TJQKA][cdhs]$/),
          action = z
            .object({
              actor: z.number().int().min(0).max(5),
              kind: z.enum(["fold", "check", "call", "raise"]),
              amount: z.number().int().positive().max(10000).optional(),
            })
            .strict();
        const bundle = z
          .object({
            payload: z
              .object({
                version: z.literal("riverline-hands/1"),
                hands: z
                  .array(
                    z
                      .object({
                        id: z.string().uuid(),
                        number: z.number().int().positive(),
                        revision: z.number().int().nonnegative(),
                        players: z.union([z.literal(2), z.literal(6)]),
                        hero: z.number().int().min(0).max(5),
                        deck: z.array(card).length(52),
                        actions: z.array(action).max(300),
                        marks: z.array(z.number().int().nonnegative()).max(100),
                        state: z.unknown(),
                        created: z.string().datetime(),
                        seating: seatingSchema.optional(),
                        botDecisions: z
                          .array(
                            z
                              .object({
                                sequence: z.number().int().nonnegative(),
                                actor: z.number().int().min(0).max(5),
                                requested: z.string(),
                                executed: z.string(),
                                elapsedMs: z.number().finite().nonnegative(),
                                fallback: z.string().max(120).optional(),
                              })
                              .strict(),
                          )
                          .max(300)
                          .optional(),
                        transition: z
                          .object({
                            batchId: z.string(),
                            fromRevision: z.number().int().min(-1),
                            toRevision: z.number().int().nonnegative(),
                            fromAction: z.number().int().nonnegative(),
                            toAction: z.number().int().nonnegative(),
                          })
                          .strict()
                          .optional(),
                      })
                      .strict(),
                  )
                  .max(1000),
                studies: z.array(z.unknown()).max(1000),
              })
              .strict(),
            checksum: z.string(),
            privateReplayData: z.literal(true),
          })
          .strict()
          .parse(backup);
        demand(hash(bundle.payload) === bundle.checksum, "练习备份校验失败");
        const unique = new Set<string>(),
          numbers = new Set<number>();
        for (const value of bundle.payload.hands) {
          demand(
            !unique.has(value.id) && value.hero < value.players,
            "备份手牌身份无效",
          );
          unique.add(value.id);
          demand(!numbers.has(value.number), "备份含重复手牌序号");
          numbers.add(value.number);
          const hand = value as Hand;
          if (hand.seating)
            validateSeating(hand.seating, hand.players, hand.hero);
          if (hand.botDecisions)
            demand(
              hand.botDecisions.every(
                (d, i, all) =>
                  d.requested ===
                    (hand.seating?.botId ?? "baseline-heuristic/1") &&
                  (d.executed === d.requested ||
                    d.executed === "legal-safe/1") &&
                  d.actor !== hand.hero &&
                  hand.actions[d.sequence]?.actor === d.actor &&
                  (i === 0 || d.sequence > all[i - 1].sequence),
              ),
              "Bot记录与行动前缀不一致",
            );
          const replayed = await this.replay(hand);
          if (hand.transition) {
            const t = hand.transition;
            demand(
              t.toAction === hand.actions.length &&
                t.fromAction <= t.toAction &&
                t.fromRevision < t.toRevision &&
                t.toRevision <= hand.revision &&
                t.batchId === hash([hand.id, t.toRevision, hand.actions]),
              "备份动作批次身份无效",
            );
          }
          demand(
            replayed.complete && hash(replayed) === hash(hand.state),
            "备份规则重放不一致或含未完成手牌",
          );
          demand(
            hand.marks.every((n) => hand.actions[n]?.actor === hand.hero),
            "疑问记录不是Hero决策",
          );
          const exists = this.db
            .prepare("SELECT document FROM hands WHERE id=?")
            .get(hand.id) as { document: string } | undefined;
          demand(
            !exists || hash(JSON.parse(exists.document)) === hash(hand),
            "本地同一手牌内容冲突",
          );
          const collision = this.db
            .prepare("SELECT id FROM hands WHERE number=? AND id<>?")
            .get(hand.number, hand.id);
          demand(!collision, "本地已有同序号的其他手牌，请导入空工作区");
          if (!exists) importHands.push(hand);
        }
        for (const value of bundle.payload.studies) {
          const source = z
            .object({
              id: z.string(),
              handId: z.string().uuid(),
              sequence: z.number().int().nonnegative(),
              handHash: z.string(),
              snapshot: z.unknown(),
              eligible: z.boolean(),
              reason: z.string(),
              root: z.unknown().optional(),
              caseRef: z.unknown().optional(),
              note: z.string().max(5000).optional(),
            })
            .strict()
            .parse(value) as ResearchSource;
          const hand = bundle.payload.hands.find(
            (h) => h.id === source.handId,
          ) as Hand | undefined;
          demand(
            hand &&
              hand.actions[source.sequence]?.actor === hand.hero &&
              source.id === `study-${hand.id}-${source.sequence}` &&
              source.handHash === hash([hand.deck, hand.actions]),
            "研究来源与备份手牌不匹配",
          );
          const prior = await this.replay(
            hand!,
            hand!.actions.slice(0, source.sequence),
          );
          demand(
            hash(
              this.project(
                hand!,
                prior,
                hand!.actions.slice(0, source.sequence),
              ),
            ) === hash(source.snapshot),
            "研究快照不是原始行动前信息",
          );
          // Recreate the research origin using the rule replay rather than trusting imported model metadata.
          source.eligible =
            [4, 5].includes(prior.board.length) &&
            prior.active.filter(Boolean).length === 2;
          if (source.eligible) {
            let start = source.sequence;
            while (
              start > 0 &&
              hand!.state.events[start - 1].street === prior.street
            )
              start--;
            const root = await this.replay(
              hand!,
              hand!.actions.slice(0, start),
            );
            source.root = {
              heroPlayer: root.actor === hand!.hero ? 0 : 1,
              board: root.board,
              pot: root.pot,
              stack: Math.min(...root.stacks.filter((_, i) => root.active[i])),
              path: hand!.actions.slice(start, source.sequence).map((a) => ({
                ...a,
                actor: hand!.seating?.ruleToPhysical[a.actor] ?? a.actor,
              })),
            };
          } else delete source.root;
          delete source.caseRef; // Analysis is a separate backup, never silently bind a local similarly named case.
          const exists = this.db
            .prepare("SELECT id FROM studies WHERE id=?")
            .get(source.id);
          if (!exists) importSources.push(source);
        }
        result = {
          importedHands: importHands.length,
          importedStudies: importSources.length,
        };
      }
      demand(
        !this.store.state.independent,
        "独立题期间禁止切换上下文",
        "INFORMATION_RESTRICTED",
      );
      const reply: Reply = {
        ok: true,
        contractVersion,
        workspaceId: this.store.state.workspaceId,
        revision: this.store.state.revision,
        requestId: input.requestId,
        artifactRefs: [],
        data: result,
      };
      demand(
        Buffer.byteLength(JSON.stringify(reply)) <= 1048576,
        "结果超过1MiB，请保留数据库并缩小备份",
      );
      if (write) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          if (saveHand) this.save(saveHand);
          for (const hand of importHands) this.save(hand);
          for (const source of importSources)
            this.db
              .prepare("INSERT INTO studies VALUES(?,?)")
              .run(source.id, JSON.stringify(source));
          if (saveSource)
            this.db
              .prepare(
                "INSERT INTO studies VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
              )
              .run(saveSource.id, JSON.stringify(saveSource));
          this.db
            .prepare("INSERT INTO receipts VALUES(?,?,?)")
            .run(key, payloadHash, JSON.stringify(reply));
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
      return reply;
    } catch (error) {
      return {
        ok: false,
        code: error instanceof GameFault ? error.code : "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "无法完成操作",
        retryable: false,
      };
    }
  }
}

function physicalArray<T>(values: T[], layout: Seating): T[] {
  if (!values.length) return values;
  const result = Array<T>(values.length);
  values.forEach((v, r) => (result[layout.ruleToPhysical[r]] = v));
  return result;
}
