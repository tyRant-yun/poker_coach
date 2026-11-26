import { z } from "zod";
import { baseInput, refSchema } from "./domain.ts";
import type { Ref } from "./domain.ts";
import {
  turnProfileSchema,
  turnPathSchema,
} from "../../../contracts/solver/turn.ts";
import type { TurnProfile } from "../../../contracts/solver/turn.ts";

export const realContract = "riverline-real-analysis/1" as const;
const id = z.string().min(1);
const writeInput = baseInput.required({
  requestId: true,
  expectedRevision: true,
});
const weights = z
  .record(z.string(), z.number().finite().min(0).max(10000))
  .describe("具体组合的输入权重，万分比单位；10000=100%，不是行动频率");
export const caseTreeSchema = z
  .object({
    kind: z.literal("explicit-river/v2"),
    lines: z
      .array(
        z
          .array(
            z.discriminatedUnion("kind", [
              z.object({ kind: z.enum(["check", "fold", "call"]) }).strict(),
              z
                .object({
                  kind: z.enum(["bet", "raise", "all-in"]),
                  amount: z.number().int().min(1).max(1_000_000),
                })
                .strict(),
            ]),
          )
          .min(1)
          .max(12),
      )
      .max(32),
  })
  .strict();
export type CaseTree = z.infer<typeof caseTreeSchema>;
export const researchViewSchema = z
  .object({
    solution: refSchema,
    path: z.array(z.number().int().min(0).max(128)).max(16),
    turnPath: turnPathSchema,
    labels: z.array(z.string().max(80)).max(24),
    player: z.union([z.literal(0), z.literal(1)]),
    hand: z.string().max(3),
    hero: z.string().regex(/^(?:[2-9TJQKA][cdhs]){2}$/),
    metric: z.enum(["strategy", "weight", "equity", "ev"]),
    showAll: z.boolean(),
    offset: z.number().int().min(0).max(1326),
  })
  .strict();
export type ResearchView = z.infer<typeof researchViewSchema>;
const configuration = {
  name: z.string().min(1).max(200),
  board: z
    .array(z.string().regex(/^[2-9TJQKA][cdhs]$/))
    .min(4)
    .max(5),
  pot: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .describe("根底池，整数 centibb；100=1bb"),
  stack: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .describe("当前根节点双方有效后手，整数 centibb；历史投入不计入后手"),
  betPercent: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .max(8),
};
export const realSchemas = {
  real_browse_save: writeInput.extend({ view: researchViewSchema }).strict(),
  real_browse_get: baseInput.extend({ solutionId: id }).strict(),
  real_capabilities: baseInput.strict(),
  real_workspace_get: baseInput
    .extend({ caseId: id.optional(), solutionId: id.optional() })
    .strict(),
  real_case_create: writeInput
    .extend({
      ...configuration,
      tree: caseTreeSchema.optional(),
      turn: turnProfileSchema.optional(),
      ranges: z.tuple([weights, weights]),
    })
    .strict(),
  real_case_revise: writeInput
    .extend({
      caseId: id,
      name: configuration.name.optional(),
      board: configuration.board.optional(),
      pot: configuration.pot.optional(),
      stack: configuration.stack.optional(),
      betPercent: configuration.betPercent.optional(),
      tree: caseTreeSchema.nullable().optional(),
      turn: turnProfileSchema.nullable().optional(),
      rangeIds: z.tuple([id, id]).optional(),
      ranges: z.tuple([weights, weights]).optional(),
    })
    .strict(),
  real_spec_create: writeInput
    .extend({
      caseId: id,
      targetNashConvPotFraction: z
        .number()
        .finite()
        .positive()
        .max(0.1)
        .default(0.001),
      maxIterations: z.number().int().min(1).max(100000).default(100000),
      maxSeconds: z.number().int().min(1).max(120).default(120),
    })
    .strict(),
  real_preflight: baseInput.extend({ specId: id }).strict(),
  real_analysis_start: writeInput.extend({ specId: id }).strict(),
  real_analysis_get: baseInput.extend({ jobId: id }).strict(),
  real_analysis_cancel: writeInput.extend({ jobId: id }).strict(),
  real_analysis_retry: writeInput.extend({ jobId: id }).strict(),
  real_solution_load: writeInput.extend({ solutionId: id }).strict(),
  real_solution_query: baseInput
    .extend({
      solutionId: id,
      path: z.array(z.number().int().min(0).max(128)).max(16).default([]),
      player: z.union([z.literal(0), z.literal(1)]).default(0),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100),
      combos: z.array(z.string()).max(200).optional(),
      hand: z.string().optional(),
      inRangeOnly: z.boolean().default(false),
    })
    .strict(),
  real_range_aggregate: baseInput
    .extend({
      solutionId: id,
      path: z.array(z.number().int().min(0).max(128)).max(16).default([]),
      player: z.union([z.literal(0), z.literal(1)]).default(0),
    })
    .strict(),
  real_turn_solution_query: baseInput
    .extend({
      solutionId: id,
      path: turnPathSchema.default([]),
      player: z.union([z.literal(0), z.literal(1)]).default(0),
      offset: z.number().int().min(0).max(1326).default(0),
      limit: z.number().int().min(1).max(100).default(30),
      hand: z.string().optional(),
      combos: z.array(z.string()).max(16).optional(),
      inRangeOnly: z.boolean().default(true),
    })
    .strict(),
  real_range_derive: writeInput
    .extend({
      solutionId: id,
      path: z.array(z.number().int().min(0).max(128)).max(15).default([]),
      action: z.number().int().min(0).max(128),
    })
    .strict(),
} as const;
export type RealTool = keyof typeof realSchemas;
export type RealInputs = { [K in RealTool]: z.infer<(typeof realSchemas)[K]> };
export const realTools: Record<RealTool, string> = {
  real_browse_save:
    "保存固定解的节点、玩家、牌类与Hero观察上下文，不改变输入或策略",
  real_browse_get: "读取同一固定解的上次浏览上下文",
  real_capabilities: "查询真实引擎的已验证模型、五类能力和运行限制",
  real_workspace_get: "读取同一工作区的真实作品、固定规格、作业及解摘要",
  real_case_create:
    "配置真实 HU 河牌局面、显式行动树及双方输入范围（权重万分比）",
  real_case_revise: "修订真实局面或绑定范围版本，保留历史",
  real_spec_create: "冻结局面、范围、下注树、数值语义和真实引擎规格",
  real_preflight: "用固定原生引擎预检真实规格，不改动输入",
  real_analysis_start: "按固定规格排队真实分析，返回持久作业引用",
  real_analysis_get: "查询真实作业的执行、进度、取消与固定结果",
  real_analysis_cancel: "保存取消请求并等待真实进程确认，完成后返回迟到",
  real_analysis_retry: "按原固定规格创建新的真实计算 attempt",
  real_solution_load: "读取固定真实解的版本、来源、质量和制品索引",
  real_solution_query: "按需读取真实节点、组合策略、指标和条件范围分布",
  real_turn_solution_query:
    "按版本化动作/发牌路径读取真实转牌节点、组合与机会概率，保留固定来源",
  real_range_aggregate: "按兼容组合分布汇总真实范围与策略，明确分母",
  real_range_derive: "沿真实固定策略创建有来源的派生范围，不覆盖原解",
};
export const realReadTools = new Set<RealTool>([
  "real_browse_get",
  "real_capabilities",
  "real_workspace_get",
  "real_preflight",
  "real_analysis_get",
  "real_solution_query",
  "real_turn_solution_query",
  "real_range_aggregate",
]);
export type RealCase = {
  ref: Ref;
  name: string;
  board: string[];
  pot: number;
  stack: number;
  betPercent: string;
  tree?: CaseTree;
  turn?: TurnProfile;
  ranges: [Ref, Ref];
};
export type RealSpec = {
  ref: Ref;
  situation: Ref;
  ranges: [Ref, Ref];
  input: Ref;
  inputHash: string;
  treeHash: string;
  targetNashConvPotFraction: number;
  engineCommit: string;
  algorithm: string;
  scope: "given-range-river-subgame" | "given-range-turn-subgame";
  operation: "solve-equilibrium";
  valueModel: "exact-river-terminal" | "exact-turn-river-runouts";
  constraints: { kind: "none" };
  tableFormat: "HU";
  backgroundPlayers: 2;
  activePlayers: 2;
  solvingPlayers: 2;
};
export type RealJob = {
  ref: Ref;
  spec: Ref;
  attempt: number;
  status:
    | "queued"
    | "running"
    | "postprocessing"
    | "cancel_requested"
    | "cancelled"
    | "completed"
    | "failed"
    | "interrupted";
  events: { status: string; at: string }[];
  iterations: number;
  exploitabilityBb: number | null;
  result?: Ref;
  error?: string;
  binaryHash?: string;
  cancelLatencyMs?: number;
};
export type RealSolution = {
  ref: Ref;
  spec: Ref;
  dataKind: "engine-computed";
  execution: "completed";
  coverage: "complete-supported-model";
  availability: "available";
  quality: "target-met" | "budget-exhausted";
  exploitabilityBb: number;
  nashConvBb: number;
  iterations: number;
  stopReason: string;
  engineCommit: string;
  algorithm: string;
  binaryHash: string;
  native: Ref;
  summary: Ref;
  nodes: { path: number[]; artifact: Ref }[];
  queryModel?: "native-paged/2" | "native-turn/3" | "native-turn-paged/4";
  handCounts: [number, number];
  metricDefinition: {
    unit: "bb";
    origin: "current-node";
    invested: "sunk";
    uncalledRefund: "included-in-terminal-ev";
    rake: "none";
    distribution: "compatible-joint-weights-conditioned-on-path";
    quality: "unraked-nashconv-equals-two-times-native-exploitability";
  };
};
export type RealState = {
  contract: typeof realContract;
  cases: Record<string, RealCase>;
  specs: Record<string, RealSpec>;
  jobs: Record<string, RealJob>;
  solutions: Record<string, RealSolution>;
  views?: Record<string, ResearchView>;
};
export const realStateSchema = z
  .object({
    contract: z.literal(realContract),
    cases: z.record(z.string(), z.object({ ref: refSchema }).passthrough()),
    specs: z.record(z.string(), z.object({ ref: refSchema }).passthrough()),
    jobs: z.record(z.string(), z.object({ ref: refSchema }).passthrough()),
    solutions: z.record(z.string(), z.object({ ref: refSchema }).passthrough()),
    views: z.record(z.string(), researchViewSchema).optional(),
  })
  .strict();
