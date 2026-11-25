import { randomInt, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { DiskStore, hash } from "../store.ts";
import { contractVersion } from "../../src/modules/analysis/domain.ts";
import type { Reply } from "../../src/modules/analysis/domain.ts";
import { gameSchemas } from "../../src/modules/play/domain.ts";
import type {
  GameAction,
  GameTool,
  HandSummary,
  HandView,
  ResearchSource,
  RuleView,
} from "../../src/modules/play/domain.ts";
import { Rules } from "./rules.ts";

type Hand = {
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
    this.db.close();
  }
  restricted() {
    const row = this.db
      .prepare("SELECT document FROM hands ORDER BY number DESC LIMIT 1")
      .get() as { document: string } | undefined;
    return !!row && !JSON.parse(row.document).state.complete;
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
    return {
      ...safe,
      id: hand.id,
      revision: hand.revision,
      number: hand.number,
      hero: hand.hero,
      heroCards: holes[hand.hero],
      revealed: state.complete && state.board.length === 5 ? shown : [],
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
        cards = s.holes[actor];
      const rank = (c: string) => "23456789TJQKA".indexOf(c[0]);
      const strength =
        (rank(cards[0]) + rank(cards[1])) / 24 +
        (cards[0][0] === cards[1][0] ? 0.35 : 0) +
        (cards[0][1] === cards[1][1] ? 0.08 : 0);
      const noise =
        parseInt(
          hash([hand.id, hand.actions.length, "bot-heuristic/1"]).slice(0, 8),
          16,
        ) / 0xffffffff;
      const call = s.legal.find((a) => a.kind === "call"),
        raise = s.legal.find((a) => a.kind === "raise"),
        check = s.legal.find((a) => a.kind === "check");
      let action: GameAction;
      if (raise && ((strength > 0.85 && noise < 0.28) || noise < 0.035)) {
        const wanted = Math.max(
          raise.min!,
          Math.max(...s.bets) + Math.round(s.pot * 0.65),
        );
        action = { actor, kind: "raise", amount: Math.min(raise.max!, wanted) };
      } else if (
        call &&
        s.legal.some((a) => a.kind === "fold") &&
        ((call.amount! > 150 && strength < 0.45 && noise < 0.65) ||
          (call.amount! > 2000 && strength < 0.8))
      )
        action = { actor, kind: "fold" };
      else action = { actor, kind: check ? "check" : "call" };
      hand.actions.push(action);
      hand.state = await this.replay(hand);
    }
  }
  private summary(hand: Hand): HandSummary {
    return {
      id: hand.id,
      number: hand.number,
      hero: hand.hero,
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
        "game_get",
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
      };
      if (this.restricted()) {
        demand(
          ["game_list", "game_get", "game_act", "game_mark"].includes(name),
          "完成当前整手后再查看历史、研究或开始下一手",
          "INFORMATION_RESTRICTED",
        );
        if (name === "game_get")
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
      if (name === "game_list") {
        result = (
          this.db
            .prepare(
              "SELECT document FROM hands ORDER BY number DESC LIMIT 100",
            )
            .all() as { document: string }[]
        ).map((r) => this.summary(JSON.parse(r.document)));
      } else if (name === "game_create" || name === "game_next") {
        let players = arg.players ?? 6;
        if (name === "game_next") {
          const previous = this.get(arg.handId);
          demand(previous.state.complete, "请先完成当前这手牌");
          players = previous.players;
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
        const hand: Hand = {
          id: randomUUID(),
          number,
          revision: 0,
          players,
          hero: (players - 1 - ((number - 1) % players) + players) % players,
          deck: shuffle(),
          actions: [],
          marks: [],
          state: undefined!,
          created: new Date().toISOString(),
        };
        hand.state = await this.replay(hand);
        await this.bots(hand);
        saveHand = hand;
        result = this.project(hand);
      } else if (name === "game_get")
        result = this.project(this.get(arg.handId));
      else if (name === "game_act" || name === "game_mark") {
        const hand = this.get(arg.handId);
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
                  state.board.length === 5 &&
                  state.active.filter(Boolean).length === 2,
                reason:
                  "当前可计算两人河牌局部模型；输入范围需要你设定，其余节点可保存研究笔记。",
              };
            if (source.eligible) {
              let start = seq;
              while (start > 0 && hand.state.events[start - 1].street === 3)
                start--;
              const root = await this.replay(
                hand,
                hand.actions.slice(0, start),
              );
              source.root = {
                board: root.board,
                pot: root.pot,
                stack: Math.min(
                  ...root.stacks.filter((_, i) => root.active[i]),
                ),
                path: hand.actions.slice(start, seq),
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
          const hand = value as Hand,
            replayed = await this.replay(hand);
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
            prior.board.length === 5 &&
            prior.active.filter(Boolean).length === 2;
          if (source.eligible) {
            let start = source.sequence;
            while (start > 0 && hand!.state.events[start - 1].street === 3)
              start--;
            const root = await this.replay(
              hand!,
              hand!.actions.slice(0, start),
            );
            source.root = {
              board: root.board,
              pot: root.pot,
              stack: Math.min(...root.stacks.filter((_, i) => root.active[i])),
              path: hand!.actions.slice(start, source.sequence),
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
