import { z } from "zod";
import { baseInput } from "../analysis/domain";
import { botIdSchema } from "./seating";
import {
  comboSchema,
  strategyActionSchema,
  strategyPackSchema,
} from "./strategy";
import type { SeatContext } from "./seating";

const identity = { handId: z.string().min(1) };
const write = baseInput.required({ requestId: true, expectedRevision: true });
export const gameSchemas = {
  game_strategy_list: baseInput.strict(),
  game_strategy_import: write.extend({ pack: strategyPackSchema }).strict(),
  game_strategy_accept: write
    .extend({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      evidence: z.string().min(20).max(4000),
    })
    .strict(),
  game_strategy_query: baseInput
    .extend({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      path: z.array(strategyActionSchema).max(30),
      combo: comboSchema,
    })
    .strict(),
  game_list: baseInput
    .extend({
      position: z.string().optional(),
      street: z.number().int().min(0).max(3).optional(),
      markedOnly: z.boolean().optional(),
    })
    .strict(),
  game_bot_list: baseInput.strict(),
  game_review_report: baseInput.extend(identity).strict(),
  game_review_retry: write
    .extend({
      ...identity,
      profile: z.enum(["tight", "standard", "wide"]).default("standard"),
    })
    .strict(),
  game_review_cancel: write.extend(identity).strict(),
  game_review_open: write
    .extend({ ...identity, decision: z.number().int().nonnegative() })
    .strict(),
  game_get: baseInput.extend(identity).strict(),
  game_transition_query: baseInput
    .extend({
      ...identity,
      handRevision: z.number().int().nonnegative(),
      batchId: z.string().min(1),
      offset: z.number().int().min(0).max(4096).default(0),
      limit: z.number().int().min(1).max(16).default(16),
    })
    .strict(),
  game_create: write
    .extend({
      players: z.union([z.literal(2), z.literal(6)]).default(6),
      positionMode: z.enum(["rotate", "fixed", "random"]).default("rotate"),
      fixedPosition: z.number().int().min(0).max(5).default(0),
      botId: botIdSchema.default("baseline-heuristic/1"),
    })
    .strict(),
  game_next: write.extend(identity).strict(),
  game_act: write
    .extend({
      ...identity,
      handRevision: z.number().int().nonnegative(),
      kind: z.enum(["fold", "check", "call", "raise"]),
      amount: z.number().int().positive().max(10000).optional(),
    })
    .strict(),
  game_mark: write
    .extend({ ...identity, decision: z.number().int().nonnegative() })
    .strict(),
  game_review: baseInput
    .extend({
      ...identity,
      decision: z.number().int().nonnegative().optional(),
    })
    .strict(),
  game_research: write
    .extend({ ...identity, decision: z.number().int().nonnegative() })
    .strict(),
  game_study_get: baseInput.extend({ studyId: z.string().min(1) }).strict(),
  game_study_link: write
    .extend({ studyId: z.string().min(1), caseId: z.string().min(1) })
    .strict(),
  game_study_note: write
    .extend({ studyId: z.string().min(1), note: z.string().max(5000) })
    .strict(),
  game_export: baseInput.strict(),
  game_import: write.extend({ backup: z.unknown() }).strict(),
};
export type GameTool = keyof typeof gameSchemas;
export const gameTools: Record<GameTool, string> = {
  game_strategy_list:
    "列出固定策略包来源、范围及待核验/人工接纳状态；不输出整树",
  game_strategy_import: "校验并导入固定策略包为待核验候选，不自动作为正确答案",
  game_strategy_accept:
    "依据实际核验说明接纳策略包；结构校验不证明来源数值正确",
  game_strategy_query:
    "按固定策略包哈希、精确路径和组合读取策略/行动EV及原口径",
  game_review_report:
    "手后读取自动参考报告，包含四街事实、真实局部行动EV及未覆盖原因",
  game_review_retry: "按选定自动参考范围重新生成报告，不宣称推断真实对手范围",
  game_review_cancel: "取消该手后台自动报告并停止其在途真实作业",
  game_review_open: "从报告打开同一固定真实研究案例与解，无需手动填写范围",
  game_bot_list: "读取本地对手发行版本、支持桌型与实际可用状态，不返回策略答案",
  game_list: "列出整手练习摘要，不返回私牌或未来信息",
  game_get: "读取整手练习的当前安全视角及合法行动",
  game_transition_query:
    "按固定手牌版本分页读取规则产生的公共动作帧，不返回隐藏私牌",
  game_create: "创建从翻前开始的100BB整手练习",
  game_next: "完成后开始下一手，保留上一手及全部原始决策",
  game_act: "按当前手牌版本提交合法行动并推进对手行动",
  game_mark: "在Hero行动前节点标记疑问",
  game_review: "本手结束后读取行动前复盘，不含未来和对手私牌",
  game_research: "从固定整手决策创建研究来源，明确局部模型资格",
  game_study_get: "读取固定研究来源与手牌返回引用",
  game_study_link: "将真实研究案例固定版本绑定到原手决策",
  game_study_note: "保存原手决策的研究假设与笔记，不生成策略结论",
  game_export: "整手结束后导出练习备份，包含重放所需的完整私有发牌数据",
  game_import: "校验规则重放与研究来源后，将练习备份原子合并到当前工作区",
};
export type GameAction = {
  actor: number;
  kind: "fold" | "check" | "call" | "raise";
  amount?: number;
};
export type LegalAction = {
  kind: GameAction["kind"];
  amount?: number;
  min?: number;
  max?: number;
};
export type RuleView = {
  version: string;
  players: 2 | 6;
  actor: number | null;
  street: number;
  board: string[];
  stacks: number[];
  bets: number[];
  active: boolean[];
  pot: number;
  complete: boolean;
  payoffs: number[];
  holes: string[][];
  shown: string[][];
  legal: LegalAction[];
  events: (GameAction & { street: number })[];
};
export type HandView = Omit<RuleView, "holes" | "shown"> & {
  session?: SeatContext;
  botDecisions?: BotDecisionRecord[];
  transition?: Transition;
  id: string;
  revision: number;
  number: number;
  hero: number;
  heroCards: string[];
  revealed: string[][];
  marks: number[];
  decisions: {
    sequence: number;
    street: number;
    kind: string;
    amount?: number;
    marked: boolean;
  }[];
};
export type Transition = {
  batchId: string;
  fromRevision: number;
  toRevision: number;
  fromAction: number;
  toAction: number;
};
export type PublicFrame = {
  id: string;
  sequence: number;
  kind: string;
  actor: number | null;
  amount: number | null;
  returned: number[] | null;
  view: HandView;
};
export type FramePage = {
  batchId: string;
  revision: number;
  items: PublicFrame[];
  total: number;
  nextOffset: number | null;
};
export type RuleTrace = {
  frames: {
    sequence: number;
    kind: string;
    actor: number | null;
    amount: number | null;
    returned: number[] | null;
    actionCount: number;
    snapshot: Pick<
      RuleView,
      | "street"
      | "board"
      | "stacks"
      | "bets"
      | "active"
      | "pot"
      | "complete"
      | "payoffs"
      | "shown"
    >;
  }[];
  total: number;
  nextOffset: number | null;
};
export type HandSummary = {
  position?: string;
  sessionId?: string;
  botId?: string;
  id: string;
  number: number;
  hero: number;
  players: 2 | 6;
  complete: boolean;
  decisions: number;
  marked: number;
  net: number | null;
  created: string;
};
export type ResearchSource = {
  id: string;
  handId: string;
  sequence: number;
  handHash: string;
  snapshot: HandView;
  eligible: boolean;
  reason: string;
  root?: {
    board: string[];
    pot: number;
    stack: number;
    path: GameAction[];
    heroPlayer?: 0 | 1;
  };
  caseRef?: { id: string; version: number; contentHash: string; kind: string };
  note?: string;
};
export { positions } from "./seating";
export type BotDecisionRecord = {
  sequence: number;
  actor: number;
  requested: string;
  executed: string;
  elapsedMs: number;
  fallback?: string;
};
export const streetNames = ["翻前", "翻牌", "转牌", "河牌", "已结束"];
