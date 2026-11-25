import { z } from "zod";
import { baseInput } from "../analysis/domain";

const identity = { handId: z.string().min(1) };
const write = baseInput.required({ requestId: true, expectedRevision: true });
export const gameSchemas = {
  game_list: baseInput.strict(),
  game_get: baseInput.extend(identity).strict(),
  game_create: write
    .extend({ players: z.union([z.literal(2), z.literal(6)]).default(6) })
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
  game_list: "列出整手练习摘要，不返回私牌或未来信息",
  game_get: "读取整手练习的当前安全视角及合法行动",
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
export type HandSummary = {
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
  root?: { board: string[]; pot: number; stack: number; path: GameAction[] };
  caseRef?: { id: string; version: number; contentHash: string; kind: string };
  note?: string;
};
export const positions = (players: number) =>
  players === 2 ? ["BB", "BTN/SB"] : ["SB", "BB", "UTG", "HJ", "CO", "BTN"];
export const streetNames = ["翻前", "翻牌", "转牌", "河牌", "已结束"];
