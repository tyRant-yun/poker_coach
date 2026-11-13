import { z } from "zod";

export const contractVersion = "riverline-analysis/1" as const;
export const refSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  contentHash: z.string(),
  kind: z.string(),
});
export type Ref = z.infer<typeof refSchema>;
export type Weights = Record<string, number>;
export type Policy = Record<string, Record<string, number>>;
export type Action = {
  id: string;
  label: string;
  type: "fold" | "check" | "call" | "raise" | "bet";
  to?: number;
};
export type Player = {
  id: string;
  position: string;
  initial: number;
  remaining: number;
  contribution: number;
  status: "active" | "folded";
};
export type AnalysisNode = {
  id: string;
  parent?: string;
  via?: string;
  label: string;
  kind: "decision" | "chance" | "terminal" | "segment-end";
  actor: string;
  board: string[];
  pot: number;
  players: Player[];
  history: string[];
  actions: Action[];
  weights: Record<string, Weights>;
  policies: Record<string, Policy>;
  model: "own-action-reach";
  returned?: number;
};
export type Situation = {
  ref: Ref;
  revision: number;
  name: string;
  preset: string;
  format: "HU" | "6-max" | "unknown";
  board: string[];
  stack: number;
  rake: number | null;
  sizing: number | null;
  nodeId: string;
  players: Player[];
  history: string[];
  ranges: Record<string, Ref>;
  treeHash: string;
  stale: boolean;
  origin?: Ref;
  hypothesis?: string;
  review?: {
    source: Ref;
    handId: string;
    decisionId: string;
    pot: number;
    actor: string;
    history: string[];
    hero: string;
    unknownFields: string[];
  };
};
export type RangeRecord = {
  ref: Ref;
  playerId: string;
  weights: Weights;
  origin: "input" | "derived" | "user-hypothesis";
  source?: {
    path?: string[];
    range: Ref;
    policy?: Ref;
    nodeId: string;
    action: string;
    model: string;
  };
  history: Weights[];
  future: Weights[];
  protected: string[];
};
export type PolicyRecord = {
  ref: Ref;
  situation: Ref;
  range: Ref;
  playerId: string;
  nodeId: string;
  allocations: Policy;
  submitted: boolean;
  assisted: boolean;
  past: Policy[];
  future: Policy[];
  origin?: Ref;
};
export type Spec = {
  ref: Ref;
  situation: Situation;
  operation:
    | "load-reference"
    | "solve-equilibrium"
    | "evaluate-policy"
    | "resolve-with-lock";
  ranges: Record<string, RangeRecord>;
  policy?: PolicyRecord;
  lock?: {
    playerId: string;
    nodeId: string;
    combos: string[];
    allocation: Record<string, number>;
    preset?: "overfold" | "sticky";
  };
  fingerprint: string;
  analysisScope: "subgame" | "local-node";
  valueModel: "synthetic";
  algorithmVersion: string;
  engineVersion: string;
  treeHash: string;
  tableFormat: "HU" | "6-max" | "unknown";
  backgroundPlayerCount: number | null;
  participantsComplete: boolean;
  activePlayerIds: string[];
  analysisPlayerIds: string[];
  continuationValueModel: { kind: "synthetic"; version: string };
};
export type Job = {
  ref: Ref;
  spec: Ref;
  status:
    | "queued"
    | "running"
    | "postprocessing"
    | "cancel_requested"
    | "cancelled"
    | "completed"
    | "failed"
    | "interrupted";
  stage: string;
  attempt: number;
  events: { status: string; at: string }[];
  result?: Ref;
  outcome:
    | "ideal"
    | "slow"
    | "fail-once"
    | "resource-limit"
    | "incomplete-quality";
  error?: string;
};
export type Metric = {
  equity: number;
  ev: Record<string, number>;
  unit: "bb";
  origin: "current-node";
  invested: "excluded";
  rake: "none";
  dataKind: "synthetic";
};
export type SolutionManifest = {
  ref: Ref;
  spec: Ref;
  fingerprint: string;
  availability: "available" | "uncovered" | "unsupported";
  quality: "demo-target-met" | "demo-incomplete" | "not-evaluated";
  dataKind: "synthetic";
  engineVersion: string;
  algorithmVersion: string;
  analysisScope: string;
  valueModel: string;
  format: string;
  activePlayers: string[];
  reason: string;
  nodes: { id: string; hash: string; bytes: number }[];
  metricDefinition: {
    unit: string;
    origin: string;
    invested: string;
    rake: string;
    model: string;
  };
  metricsCoverage: string[];
};
export type SolutionPage = {
  node: AnalysisNode;
  metrics: Record<string, Record<string, Metric>>;
};
export type Experiment = {
  ref: Ref;
  baseline: Ref;
  variant?: Ref;
  hypothesis: string;
  lock: NonNullable<Spec["lock"]>;
  comparison?: Ref;
  conclusion?: Ref;
};
export type Attempt = {
  ref: Ref;
  question: string;
  answer: string;
  reason: string;
  assisted: boolean;
  source?: Ref;
  exposureKeys: string[];
  feedback?: Ref;
  next?: Ref;
};
export type Artifact = {
  purpose?: "workspace-backup";
  ref: Ref;
  hash: string;
  bytes: number;
  mediaType: string;
  indexHash?: string;
};
export type Reply =
  | {
      ok: true;
      contractVersion: typeof contractVersion;
      workspaceId: string;
      requestId?: string;
      revision: number;
      artifactRefs: Ref[];
      data: unknown;
      nextCursor?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      currentRevision?: number;
      retryable: boolean;
      fieldErrors?: unknown;
    };
export type RuntimeState = {
  schemaVersion: 1;
  contractVersion: typeof contractVersion;
  workspaceId: string;
  revision: number;
  situations: Record<string, Situation>;
  ranges: Record<string, RangeRecord>;
  policies: Record<string, PolicyRecord>;
  specs: Record<string, Spec>;
  jobs: Record<string, Job>;
  solutions: Record<string, SolutionManifest>;
  experiments: Record<string, Experiment>;
  attempts: Record<string, Attempt>;
  artifacts: Record<string, Artifact>;
  objects: Record<string, unknown>;
  exposures: string[];
  independent?: {
    question: string;
    keys: string[];
    prompt?: string;
    options?: string[];
  };
  imports: Record<string, { hash: string; ref: Ref }>;
  legacy?: unknown;
  receipts: Record<string, { hash: string; reply: Reply }>;
  changes: { sequence: number; tool: string; refs: Ref[] }[];
};
export const baseInput = z.object({
  workspaceId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});
const id = z.string().min(1),
  allocation = z.record(z.string(), z.number().int().min(0).max(10000));
const fields = {
  situationId: id.optional(),
  handId: id.optional(),
  decisionId: id.optional(),
  rangeId: id.optional(),
  policyId: id.optional(),
  specId: id.optional(),
  jobId: id.optional(),
  solutionId: id.optional(),
  experimentId: id.optional(),
  attemptId: id.optional(),
  artifactId: id.optional(),
  nodeId: id.optional(),
  playerId: id.optional(),
  confirmation: z.string().optional(),
  name: z.string().max(200).optional(),
  preset: id.optional(),
  position: id.optional(),
  operation: z
    .enum([
      "load-reference",
      "solve-equilibrium",
      "evaluate-policy",
      "resolve-with-lock",
    ])
    .optional(),
  stack: z.number().int().positive().optional(),
  rake: z.number().min(0).max(1).optional(),
  sizing: z.number().int().positive().optional(),
  board: z.array(z.string()).optional(),
  patch: z
    .array(
      z.object({
        combo: id,
        weight: z.number().int().min(0).max(10000).optional(),
        allocation: allocation.optional(),
      }),
    )
    .max(1326)
    .optional(),
  combos: z.array(id).max(200).optional(),
  allocation: allocation.optional(),
  protected: z.array(id).max(1326).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  sequence: z.number().int().nonnegative().optional(),
  outcome: z
    .enum([
      "ideal",
      "slow",
      "fail-once",
      "resource-limit",
      "incomplete-quality",
    ])
    .optional(),
  action: id.optional(),
  hypothesis: z.string().max(2000).optional(),
  conclusion: z.string().max(4000).optional(),
  baselineId: id.optional(),
  variantId: id.optional(),
  question: id.optional(),
  answer: z.string().max(2000).optional(),
  reason: z.string().max(4000).optional(),
  reveal: z.boolean().optional(),
  backup: z.unknown().optional(),
  page: z.number().int().nonnegative().optional(),
  uri: z.string().optional(),
};
export const toolInput = baseInput.extend(fields).strict();
export type Input = z.infer<typeof toolInput>;
export const tools = {
  workspace_get: "读取当前唯一工作区、版本与制品摘要",
  workspace_changes: "按序查询工作区变更引用",
  situation_tree: "读取局面行动树结构和覆盖，不返回策略答案",
  situation_create: "从声明的 HU/6-max 示例新建局面与范围",
  situation_fork: "从固定局面与范围创建独立研究分支，保留来源且不覆盖原作品",
  situation_revise: "修订局面、节点或自定义条件，保留旧版本",
  solver_capabilities: "查询五类分析能力、示例覆盖和资源边界",
  analysis_spec_create: "固定分析规格与范围/策略/约束",
  analysis_preflight: "校验固定规格及覆盖",
  range_get: "分页读取具体组合与范围来源",
  range_edit_batch: "原子批量编辑输入权重并创建新假设",
  range_derive: "沿固定策略行动派生自己的范围",
  range_undo: "撤销范围编辑",
  range_redo: "重做范围编辑",
  range_fork: "建立独立范围假设",
  policy_edit_batch: "批量编辑混合策略或从参考创建草稿",
  policy_submit: "校验并固定提交完整策略",
  policy_undo: "撤销策略编辑",
  policy_redo: "重做策略编辑",
  policy_fork: "从固定策略创建独立草稿",
  solution_load: "加载精确配对的合成参考并返回固定制品",
  analysis_start: "持久排队模拟分析，立即返回作业引用",
  analysis_get: "查询作业与结果引用",
  analysis_cancel: "请求取消长任务",
  analysis_retry: "用原固定规格重试任务",
  solution_node_strategy: "按需分页读取节点策略和范围",
  solution_combo_metrics: "批量读取明确覆盖的组合指标",
  solution_range_aggregate: "查询声明分母下的范围构成和频率",
  analysis_handoff: "携带固定翻前路径与范围建立翻后局面",
  policy_evaluate: "评价固定策略，频率差与合成 EV 分开",
  experiment_create: "建立固定基准和锁定变体",
  experiment_compare: "核对资格并保存受控比较",
  experiment_conclude: "保存有条件结论及修订",
  teaching_attempt_submit: "固定概念作答、理由与辅助身份",
  teaching_feedback: "读取可追溯概念反馈与分析证据",
  teaching_next: "安排改变相关条件的新题",
  teaching_begin: "进入受限独立题",
  teaching_reveal: "登记辅助身份后揭示证据",
  analysis_agent_run: "用同一应用服务执行范围来源检查、受控实验与证据结论脚本",
  workspace_reset: "显式重置本地分析索引，保留旧库与历史不明身份",
  workspace_export: "登记可能暴露并生成分块备份制品",
  workspace_import: "预检并导入本应用备份或旧库快照",
  artifact_page: "受控分页读取制品",
  artifact_inspect: "读取固定制品、规格和来源引用；大范围/策略只返回摘要",
  review_extract: "从已封存旧复盘的行动前快照提取 S1 草稿，未知范围和树不补造",
  teaching_record_exposure:
    "在共享账本登记旧版阅读可能暴露，不能清除历史或授予未见身份",
} as const;
export type ToolName = keyof typeof tools;
export const mutations = new Set<ToolName>(
  Object.keys(tools).filter(
    (n) =>
      ![
        "workspace_get",
        "workspace_changes",
        "situation_tree",
        "solver_capabilities",
        "range_get",
        "analysis_preflight",
        "analysis_get",
        "solution_node_strategy",
        "solution_combo_metrics",
        "solution_range_aggregate",
        "artifact_page",
        "artifact_inspect",
      ].includes(n),
  ) as ToolName[],
);
