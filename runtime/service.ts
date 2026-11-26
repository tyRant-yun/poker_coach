import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DiskStore, canonical, hash, ref, emptyState } from "./store.ts";
import { validateBackupState } from "./validation.ts";
import { RealAnalysisService } from "./analysis/real-service.ts";
import { GameService } from "./game/service.ts";
import { AutoReviewService } from "./game/auto-review.ts";
import { gameSchemas } from "../src/modules/play/domain.ts";
import { gameTools, type GameTool } from "../src/modules/play/domain.ts";
import { validateRealArtifacts } from "./analysis/native-projection.ts";
import { realTools } from "../src/modules/analysis/real-domain.ts";
import type { RealTool } from "../src/modules/analysis/real-domain.ts";
import { snapshotSchema } from "../src/persistence/schema.ts";
import {
  allCombos,
  handClasses,
  handByCombo,
  presets,
  nodesFor,
  legalCombo,
  derive,
  validateContent,
  pageFor,
  contentVersion,
} from "../src/modules/analysis/content.ts";
import {
  contractVersion,
  toolInput,
  mutations,
  tools,
} from "../src/modules/analysis/domain.ts";
import type {
  Ref,
  RuntimeState,
  ToolName,
  Input,
  Reply,
  Situation,
  RangeRecord,
  PolicyRecord,
  Spec,
  Job,
  SolutionManifest,
  SolutionPage,
  AnalysisNode,
  Experiment,
} from "../src/modules/analysis/domain.ts";

class Fault extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}
const demand = (test: unknown, message: string) => {
  if (!test) throw new Fault("VALIDATION_ERROR", message);
};
const required = (value: string | undefined) => {
  demand(value, "缺少对象引用");
  return value!;
};
function lookup<T>(items: Record<string, T>, id: string | undefined): T {
  const key = required(id);
  let value = Object.hasOwn(items, key) ? items[key] : undefined;
  if (!value && key.includes("@")) {
    const split = key.lastIndexOf("@"),
      latest = items[key.slice(0, split)];
    if (
      latest &&
      (latest as { ref?: Ref }).ref?.version === Number(key.slice(split + 1))
    )
      value = latest;
  }
  if (!value) throw new Fault("NOT_FOUND", "对象或固定版本不存在");
  return value;
}
function fixed<T extends { ref: Ref }>(
  items: Record<string, T>,
  reference: Ref,
): T {
  const item =
    items[`${reference.id}@${reference.version}`] ?? items[reference.id];
  if (!item || item.ref.contentHash !== reference.contentHash)
    throw new Fault("NOT_FOUND", "固定版本或哈希缺失");
  return item;
}
function keep<T extends { ref: Ref }>(items: Record<string, T>, value: T) {
  const old = items[value.ref.id];
  if (old) items[`${old.ref.id}@${old.ref.version}`] = structuredClone(old);
  items[value.ref.id] = value;
}
const unique = <T extends { ref: Ref }>(items: Record<string, T>) =>
  Object.entries(items)
    .filter(([id]) => !id.includes("@"))
    .map(([, v]) => v);
const sensitive = new Set<ToolName>([
  "review_extract",
  "teaching_record_exposure",
  "workspace_import",
  "policy_evaluate",
  "analysis_agent_run",
  "workspace_reset",
  "situation_tree",
  "solution_load",
  "solution_node_strategy",
  "solution_combo_metrics",
  "solution_range_aggregate",
  "range_get",
  "range_derive",
  "experiment_compare",
  "teaching_feedback",
  "artifact_page",
  "artifact_inspect",
  "workspace_export",
]);
export class AnalysisService {
  readonly real: RealAnalysisService;
  store: DiskStore;
  private workers = new Map<string, ChildProcess>();
  private stopped = false;
  constructor(store: DiskStore) {
    this.store = store;
    const next = structuredClone(store.state);
    let changed = false;
    for (const job of Object.values(next.jobs))
      if (
        ["queued", "running", "postprocessing", "cancel_requested"].includes(
          job.status,
        )
      ) {
        job.status =
          job.status === "cancel_requested" ? "cancelled" : "interrupted";
        job.stage = "运行器已中断；请按固定规格显式重试";
        job.events.push({ status: job.status, at: new Date().toISOString() });
        changed = true;
      }
    if (changed) store.commit(next);
    this.real = new RealAnalysisService(store);
  }
  get state() {
    return this.store.state;
  }
  private allowed(state: RuntimeState, tool: ToolName) {
    const independentAllowed = new Set<ToolName>([
      "workspace_get",
      "workspace_changes",
      "solver_capabilities",
      "analysis_get",
      "analysis_cancel",
      "teaching_attempt_submit",
      "teaching_reveal",
    ]);
    if (
      state.independent &&
      (sensitive.has(tool) || !independentAllowed.has(tool))
    )
      throw new Fault(
        "INFORMATION_RESTRICTED",
        "独立题期间不可读取参考、历史指标或答案资源。请提交作答，或明确登记辅助身份。",
      );
  }
  private exposed(state: RuntimeState, keys: string[]) {
    state.exposures = [...new Set([...state.exposures, ...keys])];
  }
  private node(s: Situation) {
    if (s.review) {
      return {
        id: s.nodeId,
        label: "复盘行动前事实（范围/树待补充）",
        kind: "segment-end" as const,
        actor: s.review.actor,
        board: s.board,
        pot: s.review.pot,
        players: s.players,
        history: s.review.history,
        actions: [],
        weights: {},
        policies: {},
        model: "own-action-reach" as const,
      };
    }
    return lookup(
      Object.fromEntries(nodesFor(s.preset).map((n) => [n.id, n])),
      s.nodeId,
    );
  }
  private recordRange(
    state: RuntimeState,
    playerId: string,
    weights: RangeRecord["weights"],
    source?: RangeRecord["source"],
  ) {
    const record: RangeRecord = {
      ref: ref("range", { playerId, weights, source }),
      playerId,
      weights,
      origin: source ? "derived" : "input",
      source,
      history: [],
      future: [],
      protected: [],
    };
    keep(state.ranges, record);
    return record;
  }
  private createSituation(
    state: RuntimeState,
    presetId: string,
    nodeId = "p0",
    name?: string,
  ) {
    const preset = presets.find((p) => p.id === presetId);
    demand(preset, "未覆盖的示例入口");
    const nodes = nodesFor(presetId),
      errors = validateContent(nodes);
    demand(!errors.length, errors[0] ?? "内容无效");
    const node = lookup(
      Object.fromEntries(nodes.map((n) => [n.id, n])),
      nodeId,
    );
    const ranges = Object.fromEntries(
      node.players
        .filter((p) => p.status === "active")
        .map((p) => [
          p.id,
          this.recordRange(
            state,
            p.id,
            node.weights[p.id],
            node.parent
              ? {
                  range: this.recordRange(state, p.id, nodes[0].weights[p.id])
                    .ref,
                  path: node.history,
                  nodeId: node.id,
                  action: node.via ?? "",
                  model: "own-action-reach",
                }
              : undefined,
          ).ref,
        ]),
    );
    const s: Situation = {
      ref: ref("situation", { preset: presetId, node: nodeId }),
      revision: 1,
      name: name ?? preset!.label,
      preset: presetId,
      format: preset!.format,
      board: node.board,
      stack: 10000,
      rake: 0,
      sizing: 250,
      nodeId,
      players: node.players,
      history: node.history,
      ranges,
      treeHash: hash(nodes),
      stale: false,
    };
    keep(state.situations, s);
    return s;
  }
  private revise(
    state: RuntimeState,
    s: Situation,
    changes: Partial<Situation>,
  ) {
    const value = {
      ...structuredClone(s),
      ...changes,
      revision: s.revision + 1,
    };
    value.ref = ref("situation", value, s.ref.id, s.ref.version + 1);
    keep(state.situations, value);
    return value;
  }
  private makeSpec(
    state: RuntimeState,
    s: Situation,
    input: Input,
    lock?: Spec["lock"],
  ): Spec {
    const policy = input.policyId
      ? lookup(state.policies, input.policyId)
      : undefined;
    const operation =
      input.operation ?? (lock ? "resolve-with-lock" : "load-reference");
    if (operation === "evaluate-policy")
      demand(policy?.submitted, "评价必须引用固定提交策略");
    if (operation === "resolve-with-lock")
      demand(lock, "重新分析必须有显式锁定约束");
    if (policy)
      demand(
        policy.situation.contentHash === s.ref.contentHash,
        "策略与局面版本不匹配",
      );
    const ranges = Object.fromEntries(
      Object.entries(s.ranges).map(([p, r]) => [
        p,
        structuredClone(
          lookup(
            state.ranges,
            `${r.id}@${r.version}` in state.ranges
              ? `${r.id}@${r.version}`
              : r.id,
          ),
        ),
      ]),
    );
    const semantic = {
      situation: s,
      ranges,
      operation,
      policy: operation === "evaluate-policy" ? policy : undefined,
      lock,
      treeHash: s.treeHash,
      tableFormat: s.format,
      backgroundPlayerCount:
        s.format === "HU" ? 2 : s.format === "6-max" ? 6 : null,
      participantsComplete: !s.review,
      activePlayerIds: s.players
        .filter((p) => p.status === "active")
        .map((p) => p.id),
      analysisPlayerIds: (s.review ? [] : s.players)
        .filter((p) => p.status === "active")
        .map((p) => p.id),
      continuationValueModel: {
        kind: "synthetic" as const,
        version: contentVersion,
      },
      engineVersion: contentVersion,
      algorithmVersion: "authored-mock-1",
      analysisScope: s.board.length ? "subgame" : "local-node",
      valueModel: "synthetic",
    };
    const spec: Spec = {
      ...semantic,
      analysisScope: s.board.length ? "subgame" : "local-node",
      valueModel: "synthetic",
      ref: ref("spec", semantic),
      fingerprint: hash(semantic),
    };
    keep(state.specs, spec);
    return spec;
  }
  private preflight(spec: Spec) {
    const s = spec.situation,
      n = this.node(s);
    if (s.review)
      return {
        availability: "uncovered",
        reason:
          "复盘行动前事实已保留；桌型、范围、投入分解和行动树尚未确认，没有套用其他局面数值。",
      };
    if (
      spec.engineVersion !== contentVersion ||
      s.treeHash !== hash(nodesFor(s.preset))
    )
      return {
        availability: "uncovered",
        reason: "原内容/树版本当前不可重放；固定历史结果保留，未替换为新版本。",
      };
    if (
      s.players.filter((p) => p.status === "active").length > 2 &&
      s.board.length
    )
      return {
        availability: "unsupported",
        reason: "本轮不支持多人翻后计算；局面与范围保留。",
      };
    if (
      s.stack !== 10000 ||
      s.rake !== 0 ||
      s.sizing !== 250 ||
      canonical(s.board) !== canonical(n.board) ||
      s.stale
    )
      return {
        availability: "uncovered",
        reason: "自定义条件、范围或上游变更没有配对示例；输入保留。",
      };
    for (const [p, r] of Object.entries(spec.ranges))
      if (canonical(r.weights) !== canonical(n.weights[p]))
        return {
          availability: "uncovered",
          reason: "自定义范围没有配对示例。",
        };
    if (spec.lock && !this.matchesLock(spec))
      return { availability: "uncovered", reason: "自定义锁定没有配对示例。" };
    if (n.kind === "terminal" || n.kind === "segment-end")
      return {
        availability: "unsupported",
        reason: "该节点为终局或声明片段末尾。",
      };
    if (s.board.length && !presets.find((p) => p.id === s.preset)!.post)
      return {
        availability: "uncovered",
        reason: "此路径只有翻前与交接预览，翻后参考尚未覆盖。",
      };
    return {
      availability: "available",
      reason: "作者编写的合成示例；不是实际求解。",
    };
  }
  private matchesLock(spec: Spec) {
    const l = spec.lock;
    if (!l) return false;
    const n = this.node(spec.situation);
    if (
      spec.situation.preset !== "X-BB" ||
      n.id !== "f-response" ||
      l.nodeId !== n.id ||
      l.playerId !== n.actor ||
      canonical(l.combos) !== canonical(["AhAd"])
    )
      return false;
    const allocation =
      l.preset === "overfold"
        ? { fold: 8000, call: 2000 }
        : l.preset === "sticky"
          ? { fold: 2000, call: 8000 }
          : null;
    return !!allocation && canonical(l.allocation) === canonical(allocation);
  }
  private saveSolution(state: RuntimeState, spec: Spec, incomplete = false) {
    const status = this.preflight(spec),
      nodes = spec.situation.review
        ? [this.node(spec.situation)]
        : nodesFor(spec.situation.preset);
    const root = this.node(spec.situation);
    const related = (n: AnalysisNode): boolean =>
      n.id === root.id ||
      (!!n.parent &&
        related(
          lookup(Object.fromEntries(nodes.map((x) => [x.id, x])), n.parent),
        ));
    const nodeRefs: SolutionManifest["nodes"] = [];
    if (spec.lock && status.availability === "available") {
      const l = spec.lock;
      const locked = nodes.find((n) => n.id === l.nodeId)!;
      for (const c of l.combos) locked.policies[l.playerId][c] = l.allocation;
      const affected = new Set([locked.id]);
      for (const n of nodes)
        if (n.parent && affected.has(n.parent)) {
          const parent = nodes.find((p) => p.id === n.parent)!;
          n.weights = structuredClone(parent.weights);
          if (parent.actor && n.via && parent.policies[parent.actor])
            n.weights[parent.actor] = derive(
              n.weights[parent.actor],
              parent.policies[parent.actor],
              n.via,
              n.board,
            );
          for (const player of n.players)
            n.weights[player.id] = Object.fromEntries(
              allCombos.map((c) => [
                c,
                legalCombo(c, n.board) ? (n.weights[player.id]?.[c] ?? 0) : 0,
              ]),
            );
          affected.add(n.id);
        }
    }
    if (status.availability === "available")
      for (const node of nodes.filter(related)) {
        const page = pageFor(node, spec.situation.preset, !!spec.lock);
        if (spec.lock) {
          const l = spec.lock;
          if (page.node.id === l.nodeId) {
            for (const combo of l.combos)
              if (page.node.policies[l.playerId]?.[combo])
                page.node.policies[l.playerId][combo] = l.allocation;
          }
        }
        const blob = this.store.put(page);
        nodeRefs.push({ id: node.id, ...blob });
      }
    const body = {
      spec: spec.ref,
      fingerprint: spec.fingerprint,
      ...status,
      quality:
        status.availability === "available"
          ? incomplete
            ? "demo-incomplete"
            : "demo-target-met"
          : "not-evaluated",
      dataKind: "synthetic",
      engineVersion: spec.engineVersion,
      algorithmVersion: spec.algorithmVersion,
      analysisScope: spec.analysisScope,
      valueModel: spec.valueModel,
      format: spec.situation.format,
      activePlayers: root.players
        .filter((p) => p.status === "active")
        .map((p) => p.id),
      nodes: nodeRefs,
      metricDefinition: {
        unit: "bb",
        origin: "current-node",
        invested: "excluded",
        rake: "none",
        model: "authored synthetic; own-action-reach, no joint conditioning",
      },
      metricsCoverage: ["AhAd", "KhKd", "QhJh"],
    };
    const manifest = {
      ...body,
      ref: ref("solution", body),
    } as SolutionManifest;
    keep(state.solutions, manifest);
    this.exposed(state, [`analysis:${spec.situation.preset}`]);
    return manifest;
  }
  private newJob(state: RuntimeState, spec: Spec, input: Input, attempt = 1) {
    demand(
      unique(state.jobs).filter((j) =>
        ["queued", "running", "postprocessing"].includes(j.status),
      ).length < 4,
      "模拟队列最多四项",
    );
    const job: Job = {
      ref: ref("job", { spec: spec.ref, attempt, nonce: randomUUID() }),
      spec: spec.ref,
      status: "queued",
      stage: "已持久排队，等待独立运行器",
      attempt,
      outcome: input.outcome ?? "ideal",
      events: [{ status: "queued", at: new Date().toISOString() }],
    };
    keep(state.jobs, job);
    return job;
  }
  private launch(jobId: string) {
    if (this.stopped) return;
    const job = this.state.jobs[jobId];
    if (!job || job.status !== "queued") return;
    const worker = fork(new URL("./mock-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    this.workers.set(jobId, worker);
    worker.on(
      "message",
      (message: { stage?: Job["status"]; error?: string; done?: boolean }) => {
        if (this.stopped) return;
        const next = structuredClone(this.state),
          j = next.jobs[jobId];
        if (
          !j ||
          ["cancelled", "completed", "failed", "interrupted"].includes(j.status)
        )
          return;
        if (j.status === "cancel_requested") {
          j.status = "cancelled";
          j.stage = "运行器已确认取消，拒收迟到结果";
          worker.kill();
        } else if (message.error) {
          j.status = "failed";
          j.error = message.error;
          j.stage = message.error;
          worker.kill();
        } else if (message.done) {
          try {
            const result = this.saveSolution(
              next,
              lookup(next.specs, j.spec.id),
              j.outcome === "incomplete-quality",
            );
            j.result = result.ref;
            j.status = "completed";
            j.stage = "执行结束；覆盖与质量请查看固定结果";
          } catch (error) {
            j.status = "failed";
            j.error = String(error);
          }
        } else if (message.stage) {
          j.status = message.stage;
          j.stage =
            message.stage === "running"
              ? "独立运行器正在读取合成资产"
              : "正在校验结果";
        }
        j.events.push({ status: j.status, at: new Date().toISOString() });
        this.store.commit(next);
      },
    );
    worker.on("close", (exitCode, exitSignal) => {
      this.workers.delete(jobId);
      if (this.stopped) return;
      const next = structuredClone(this.state),
        j = next.jobs[jobId];
      if (
        j &&
        ["queued", "running", "postprocessing", "cancel_requested"].includes(
          j.status,
        )
      ) {
        j.status =
          j.status === "cancel_requested" ? "cancelled" : "interrupted";
        j.stage = `运行器已停止 (${exitCode}/${exitSignal})`;
        j.events.push({ status: j.status, at: new Date().toISOString() });
        this.store.commit(next);
      }
    });
    worker.send({ outcome: job.outcome, attempt: job.attempt });
  }
  private game?: GameService;
  private autoReview?: AutoReviewService;
  private ensureGame() {
    this.game ??= new GameService(this.store);
    this.autoReview ??= new AutoReviewService(this.store, this.game, this.real);
  }
  private handRestricted() {
    if (!this.game && existsSync(join(this.store.directory, "hands.sqlite")))
      this.ensureGame();
    return this.game?.restricted() ?? false;
  }
  private handGuard(name: string): Reply | undefined {
    if (
      this.handRestricted() &&
      ![
        "solver_capabilities",
        "real_capabilities",
        "analysis_get",
        "real_analysis_get",
        "analysis_cancel",
        "real_analysis_cancel",
      ].includes(name)
    )
      return {
        ok: false,
        code: "INFORMATION_RESTRICTED",
        message: "请先完成当前整手练习，再查看研究与参考。",
        retryable: false,
      };
  }
  async executeAsync(name: string, raw: unknown): Promise<Reply> {
    if (Object.hasOwn(gameTools, name)) {
      this.ensureGame();
      if (
        [
          "game_review_report",
          "game_review_retry",
          "game_review_cancel",
          "game_review_open",
        ].includes(name)
      ) {
        try {
          const input = gameSchemas[name as GameTool].parse(raw) as {
            workspaceId: string;
            handId: string;
          };
          if (input.workspaceId !== this.store.state.workspaceId)
            throw Error("工作区不匹配");
          const data = await this.autoReview!.execute(name, input);
          if (this.game!.restricted() || this.state.independent)
            throw Error("INFORMATION_RESTRICTED: 请先完成当前作答");
          return {
            ok: true,
            contractVersion,
            workspaceId: this.state.workspaceId,
            revision: this.state.revision,
            artifactRefs: [],
            data,
          };
        } catch (e) {
          const message = (e as Error).message;
          return {
            ok: false,
            code: message.includes("INFORMATION_RESTRICTED")
              ? "INFORMATION_RESTRICTED"
              : message.includes("REVISION_CONFLICT")
                ? "REVISION_CONFLICT"
                : "VALIDATION_ERROR",
            message,
            retryable: false,
          };
        }
      }
      const reply = await this.game!.execute(name as GameTool, raw);
      if (reply.ok && ["game_act", "game_create", "game_next"].includes(name)) {
        const hand = reply.data as { id: string; complete: boolean };
        if (hand.complete) {
          try {
            this.autoReview!.enqueue(hand.id);
          } catch {
            /* A full queue must never reject a saved action. Opening review retries registration. */
          }
        }
      }
      return reply;
    }
    const guard = this.handGuard(name);
    if (guard) return guard;
    const reply = Object.hasOwn(realTools, name)
      ? await this.real.executeAsync(name as RealTool, raw)
      : this.execute(name, raw);
    return this.handGuard(name) ?? reply;
  }
  execute(name: string, raw: unknown): Reply {
    const guard = this.handGuard(name);
    if (guard) return guard;
    if (Object.hasOwn(realTools, name))
      return this.real.execute(name as RealTool, raw);
    try {
      if (!Object.hasOwn(tools, name))
        throw new Fault("NOT_FOUND", "未知业务工具");
      const tool = name as ToolName,
        parsed = toolInput.safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "工具输入无效",
          fieldErrors: parsed.error.issues,
          retryable: false,
        };
      const input = parsed.data;
      demand(input.workspaceId === this.state.workspaceId, "工作区不匹配");
      this.allowed(this.state, tool);
      if (tool === "artifact_inspect" && input.artifactId) {
        const match = /^(.*?)(?:@(\d+))?$/.exec(input.artifactId)!;
        const realSolution = this.state.real?.solutions[match[1]];
        if (
          realSolution &&
          (!match[2] || realSolution.ref.version === Number(match[2]))
        )
          return this.real.execute("real_solution_load", {
            workspaceId: input.workspaceId,
            requestId: input.requestId ?? randomUUID(),
            expectedRevision: input.expectedRevision ?? this.state.revision,
            solutionId: realSolution.ref.id,
          });
      }
      const write = mutations.has(tool);
      if (write) {
        demand(input.requestId, "写操作必须提供 requestId");
        demand(
          input.expectedRevision !== undefined,
          "写操作必须提供 expectedRevision",
        );
      }
      const key = `${tool}:${input.requestId ?? ""}`,
        payloadHash = hash(input),
        receipt = write ? this.state.receipts[key] : undefined;
      if (receipt) {
        if (receipt.hash !== payloadHash)
          throw new Fault("IDEMPOTENCY_CONFLICT", "同一 requestId 的负载不同");
        return receipt.reply;
      }
      if (write && input.expectedRevision !== this.state.revision)
        throw new Fault(
          "REVISION_CONFLICT",
          "工作区已变化；请读取新版本后重新应用或建立分支",
        );
      const verifyTarget = <T extends { ref: Ref }>(
        collection: Record<string, T>,
        id: string | undefined,
      ) => {
        if (!id) return;
        const target = lookup(collection, id),
          latest = collection[target.ref.id];
        if (!latest || latest.ref.contentHash !== target.ref.contentHash)
          throw new Fault(
            "REVISION_CONFLICT",
            "所编辑对象已更新，未应用输入保留；请核对新版本或从原版本建立分支。",
          );
      };
      if (
        ["situation_revise", "range_edit_batch", "policy_edit_batch"].includes(
          tool,
        )
      )
        verifyTarget(this.state.situations, input.situationId);
      if (["range_edit_batch", "range_undo", "range_redo"].includes(tool))
        verifyTarget(this.state.ranges, input.rangeId);
      if (
        [
          "policy_edit_batch",
          "policy_undo",
          "policy_redo",
          "policy_submit",
        ].includes(tool)
      )
        verifyTarget(this.state.policies, input.policyId);
      const next = write ? structuredClone(this.state) : this.state;
      if (
        ["workspace_import", "workspace_reset"].includes(tool) &&
        this.real.busy()
      )
        throw new Fault(
          "RESOURCE_LIMIT",
          "请先取消并确认真实作业停止，再导入或重置工作区",
        );
      const refs: Ref[] = [];
      const data = this.dispatch(next, tool, input, refs);
      if (write) {
        this.real.followRanges(next);
        if (tool === "workspace_import") this.real.recover(next);
      }
      const reply: Reply = {
        ok: true,
        contractVersion,
        workspaceId: next.workspaceId,
        requestId: input.requestId,
        revision: next.revision + (write ? 1 : 0),
        artifactRefs: refs,
        data,
      };
      if (Buffer.byteLength(JSON.stringify(reply)) > 120000)
        throw new Fault(
          "RESOURCE_LIMIT",
          "结果超过单页预算；请缩小分页或读取固定制品摘要。",
        );
      if (write) {
        next.receipts[key] = { hash: payloadHash, reply };
        next.changes.push({ sequence: next.revision + 1, tool, refs });
        this.store.commit(next);
        if (tool === "analysis_start" || tool === "analysis_retry") {
          const job = refs.find((r) => r.kind === "job");
          if (job) queueMicrotask(() => this.launch(job.id));
        }
        if (tool === "analysis_cancel") {
          const job = this.state.jobs[required(input.jobId)];
          const worker = this.workers.get(job.ref.id);
          if (worker) worker.kill();
          else {
            const confirmed = structuredClone(this.state);
            confirmed.jobs[job.ref.id].status = "cancelled";
            confirmed.jobs[job.ref.id].stage = "运行器已确认取消";
            this.store.commit(confirmed);
          }
        }
      }
      return reply;
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof Fault
            ? error.code
            : String(error).includes("ARTIFACT_INCOMPLETE")
              ? "ARTIFACT_INCOMPLETE"
              : "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "操作失败",
        currentRevision: this.state.revision,
        retryable:
          error instanceof Fault &&
          ["REVISION_CONFLICT", "RESOURCE_LIMIT"].includes(error.code),
      };
    }
  }
  private page<T>(
    state: RuntimeState,
    items: T[],
    input: Input,
    identity: string,
  ) {
    let offset = 0;
    if (input.cursor) {
      const cursor = z
        .object({
          offset: z.number().int().nonnegative(),
          identity: z.string(),
          policy: z.string(),
        })
        .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
      demand(
        cursor.identity === identity &&
          cursor.policy === hash([state.independent, state.exposures]),
        "分页版本/筛选或信息规则已变化",
      );
      offset = cursor.offset;
    }
    const result: T[] = [];
    for (const item of items.slice(offset, offset + (input.limit ?? 100))) {
      if (Buffer.byteLength(JSON.stringify([...result, item])) > 110000) break;
      result.push(item);
    }
    return {
      items: result,
      total: items.length,
      nextCursor:
        offset + result.length < items.length
          ? Buffer.from(
              JSON.stringify({
                offset: offset + result.length,
                identity,
                policy: hash([state.independent, state.exposures]),
              }),
            ).toString("base64url")
          : undefined,
    };
  }
  private readPage(state: RuntimeState, input: Input) {
    const manifest = lookup(state.solutions, input.solutionId),
      node = manifest.nodes.find((n) => n.id === input.nodeId);
    if (!node) throw new Fault("NOT_FOUND", "该解没有覆盖此节点");
    return { manifest, page: this.store.get<SolutionPage>(node.hash) };
  }
  private dispatch(
    state: RuntimeState,
    tool: ToolName,
    input: Input,
    refs: Ref[],
  ): unknown {
    const returnRef = <T extends { ref: Ref }>(value: T) => {
      refs.push(value.ref);
      return value;
    };
    switch (tool) {
      case "workspace_reset": {
        demand(
          input.confirmation === "RESET LOCAL ANALYSIS",
          "请明确确认重置本地分析工作区",
        );
        const preserved = {
          revision: state.revision,
          receipts: state.receipts,
          changes: state.changes,
        };
        delete state.real;
        Object.assign(state, emptyState(state.workspaceId), preserved, {
          exposures: ["reset:unknown"],
        });
        return {
          reset: true,
          legacyDatabases: "unchanged",
          exposure: "unknown-history",
        };
      }
      case "workspace_get": {
        const situations = unique(state.situations);
        const paging = state.independent
          ? { items: [] as Situation[], nextCursor: undefined }
          : this.page(
              state,
              [...situations].reverse(),
              { ...input, limit: Math.min(input.limit ?? 10, 20) },
              hash(situations.map((s) => s.ref)),
            );
        return {
          workspaceId: state.workspaceId,
          revision: state.revision,
          situations: [...paging.items].reverse(),
          totalSituations: state.independent ? 0 : situations.length,
          nextCursor: paging.nextCursor,
          selectedSituation: state.independent
            ? undefined
            : input.situationId
              ? state.situations[input.situationId]
              : undefined,
          jobs: state.independent ? [] : unique(state.jobs).slice(-10),
          solutions: (state.independent
            ? []
            : unique(state.solutions).slice(-10)
          ).map(({ nodes, ...s }) => ({ ...s, nodeCount: nodes.length })),
          experiments: state.independent
            ? []
            : unique(state.experiments).slice(-10),
          attempts: state.independent ? [] : unique(state.attempts).slice(-10),
          policies: state.independent
            ? []
            : unique(state.policies)
                .filter(
                  (p) =>
                    !input.situationId ||
                    p.situation.id === input.situationId.split("@")[0],
                )
                .slice(-20)
                .map((p) => ({
                  ref: p.ref,
                  situation: p.situation,
                  range: p.range,
                  nodeId: p.nodeId,
                  playerId: p.playerId,
                  submitted: p.submitted,
                  assisted: p.assisted,
                  origin: p.origin,
                })),
          independent: state.independent,
          exposures: state.exposures.length,
          presets: presets.map((p) => ({
            id: p.id,
            label: p.label,
            format: p.format,
            positions: [
              ...new Set(
                p.line
                  .filter(([, action]) => action !== "fold")
                  .map(([player]) => player),
              ),
            ],
            contexts:
              p.id === "X-WALK"
                ? ["收盲"]
                : [
                    "未开池",
                    "面对开池",
                    ...(p.line.filter(([, a]) => a === "raise").length >= 2
                      ? ["面对3-bet"]
                      : []),
                    ...(p.line.filter(([, a]) => a === "raise").length >= 3
                      ? ["面对4-bet"]
                      : []),
                    ...(p.id === "X-SQ" ? ["squeeze"] : []),
                  ],
            stack: 10000,
            rake: 0,
            sizing: 250,
          })),
          imports: Object.values(state.imports)
            .slice(-10)
            .map((i) => i.ref),
        };
      }
      case "workspace_changes":
        return {
          revision: state.revision,
          changes: state.changes
            .filter((c) => c.sequence > (input.sequence ?? 0))
            .slice(0, 200),
        };
      case "solver_capabilities":
        return {
          realEngine: this.real.capabilities(),
          contractVersion,
          dataKind: "synthetic",
          capabilities: [
            "HU-preflop",
            "HU-postflop",
            "6max-preflop",
            "6max-headsup-postflop",
            "multiway-postflop",
          ].map((id) => ({
            id,
            status:
              id === "multiway-postflop"
                ? "configuration-only"
                : "authored-fixtures",
            realEngine: "not-integrated",
            scope: "local/subgame, not whole-game equilibrium",
          })),
          limits: {
            jobs: 4,
            requestBytes: 1048576,
            responseBytes: 131072,
            page: 200,
            comboPatch: 1326,
          },
          model: "own-action-reach; no joint-card-conditioned probabilities",
          engineVersion: contentVersion,
          algorithmVersion: "authored-mock-1",
          contentManifest: presets.map((p) => {
            const nodes = nodesFor(p.id);
            return {
              id: p.id,
              version: contentVersion,
              contentHash: hash(nodes),
              nodeCount: nodes.length,
              checks: validateContent(nodes),
              identity: "authored-synthetic-self-checked",
              metricsCoverage: p.post ? ["AhAd", "KhKd", "QhJh"] : [],
              review: "not independently reviewed; not solver-verified",
            };
          }),
        };
      case "situation_tree": {
        const s = lookup(state.situations, input.situationId);
        return {
          situation: s.ref,
          nodes: (s.review ? [this.node(s)] : nodesFor(s.preset)).map(
            ({ weights: _, policies: __, ...n }) => n,
          ),
        };
      }
      case "situation_create":
        return returnRef(
          this.createSituation(
            state,
            input.preset ?? "H-SRP",
            input.nodeId ??
              (
                {
                  "X-HJ": "p1",
                  "X-CO": "p2",
                  "X-BTN": "p3",
                  "X-SB": "p4",
                  "X-WALK": "walk",
                } as Record<string, string>
              )[input.preset ?? ""] ??
              "p0",
            input.name,
          ),
        );
      case "situation_fork": {
        const source = lookup(state.situations, input.situationId);
        const ranges = Object.fromEntries(
          Object.entries(source.ranges).map(([player, reference]) => {
            const old = fixed(state.ranges, reference);
            return [
              player,
              this.recordRange(state, player, structuredClone(old.weights), {
                range: old.ref,
                nodeId: source.nodeId,
                action: "research-branch",
                model: "own-action-reach",
              }).ref,
            ];
          }),
        );
        const payload = {
          ...structuredClone(source),
          ranges,
          name: input.name ?? `${source.name} · 独立分支`,
          origin: source.ref,
          revision: 1,
        };
        const branch = {
          ...payload,
          ref: ref("situation", { ...payload, ref: undefined }),
        };
        keep(state.situations, branch);
        return returnRef(branch);
      }
      case "situation_revise": {
        const s = lookup(state.situations, input.situationId);
        let changes: Partial<Situation> = {};
        if (input.nodeId && s.review)
          demand(
            input.nodeId === s.nodeId,
            "复盘尚无已确认的后续行动树，不发放预置未来牌",
          );
        if (input.nodeId && !s.review) {
          const node = lookup(
            Object.fromEntries(nodesFor(s.preset).map((n) => [n.id, n])),
            input.nodeId,
          );
          changes = {
            nodeId: node.id,
            board: node.board,
            players: node.players,
            history: node.history,
          };
          const ownRanges = Object.values(s.ranges).map((r) =>
            lookup(state.ranges, r.id),
          );
          if (s.stale || ownRanges.some((r) => r.origin === "user-hypothesis"))
            changes.stale = true;
          else
            changes.ranges = Object.fromEntries(
              node.players
                .filter((p) => p.status === "active")
                .map((p) => [
                  p.id,
                  this.recordRange(state, p.id, node.weights[p.id], {
                    range:
                      s.ranges[p.id] ??
                      this.recordRange(
                        state,
                        p.id,
                        nodesFor(s.preset)[0].weights[p.id],
                      ).ref,
                    path: node.history,
                    nodeId: node.id,
                    action: node.via ?? "root",
                    model: "own-action-reach",
                  }).ref,
                ]),
            );
        }
        if (input.stack !== undefined) changes.stack = input.stack;
        if (input.rake !== undefined) changes.rake = input.rake;
        if (input.sizing !== undefined) changes.sizing = input.sizing;
        if (input.board) {
          demand(
            [0, 3, 4, 5].includes(input.board.length) &&
              new Set(input.board).size === input.board.length &&
              input.board.every((c) => /^[AKQJT2-9][shdc]$/.test(c)),
            "公共牌无效",
          );
          changes.board = input.board;
        }
        if (input.name) changes.name = input.name;
        return returnRef(this.revise(state, s, changes));
      }
      case "range_get": {
        const r = lookup(state.ranges, input.rangeId);
        return {
          ref: r.ref,
          playerId: r.playerId,
          origin: r.origin,
          source: r.source,
          protected: r.protected,
          classes: handClasses.map((h) => ({
            label: h.label,
            mass: h.combos.reduce((v, c) => v + (r.weights[c] ?? 0), 0),
          })),
          ...this.page(
            state,
            allCombos.map((combo) => ({
              combo,
              weight: r.weights[combo] ?? 0,
              label: handByCombo[combo],
            })),
            input,
            hash([r.ref, input.limit]),
          ),
        };
      }
      case "range_edit_batch":
      case "range_undo":
      case "range_redo":
      case "range_fork": {
        const old = lookup(state.ranges, input.rangeId),
          r = structuredClone(old);
        if (tool === "range_undo") {
          demand(r.history.length, "没有可撤销的编辑");
          r.future.push(r.weights);
          r.weights = r.history.pop()!;
        } else if (tool === "range_redo") {
          demand(r.future.length, "没有可重做的编辑");
          r.history.push(r.weights);
          r.weights = r.future.pop()!;
        } else if (tool === "range_edit_batch") {
          demand(
            input.patch?.length || input.protected,
            "需要批量编辑或保护清单",
          );
          for (const p of input.patch ?? [])
            demand(
              allCombos.includes(p.combo) && p.weight !== undefined,
              "权重 patch 无效",
            );
          r.history.push(structuredClone(r.weights));
          r.future = [];
          for (const p of input.patch ?? [])
            if (!r.protected.includes(p.combo)) r.weights[p.combo] = p.weight!;
          if (input.protected) {
            demand(
              input.protected.every((c) => allCombos.includes(c)),
              "保护清单包含无效组合",
            );
            r.protected = input.protected;
          }
        }
        r.origin = "user-hypothesis";
        r.source ??= {
          range: old.ref,
          nodeId: "user",
          action: "edit",
          model: "hypothesis",
        };
        r.ref = ref(
          "range",
          r,
          tool === "range_fork" ? undefined : r.ref.id,
          tool === "range_fork" ? 1 : r.ref.version + 1,
        );
        keep(state.ranges, r);
        for (const s of unique(state.situations))
          if (
            tool !== "range_fork" &&
            Object.values(s.ranges).some((v) => v.id === old.ref.id)
          )
            this.revise(state, s, {
              ranges: { ...s.ranges, [r.playerId]: r.ref },
              stale: true,
            });
        return returnRef({
          ...r,
          weights: undefined,
          history: undefined,
          future: undefined,
        });
      }
      case "range_derive": {
        const r = lookup(state.ranges, input.rangeId),
          p = lookup(state.policies, input.policyId);
        demand(
          p.range.id === r.ref.id && p.range.contentHash === r.ref.contentHash,
          "策略与范围版本不匹配",
        );
        const action = required(input.action);
        if (allCombos.some((c) => r.weights[c] > 0 && !p.allocations[c]))
          return {
            availability: "incomplete",
            reason: "范围内仍有组合未分配，未把缺失默认为零。",
            globalReachProbability: null,
          };
        demand(
          Object.values(p.allocations).some((a) => action in a),
          "动作不在策略中",
        );
        const weights = derive(r.weights, p.allocations, action, []);
        const result = this.recordRange(state, r.playerId, weights, {
          range: r.ref,
          policy: p.ref,
          nodeId: p.nodeId,
          action,
          model: "own-action-reach",
        });
        return returnRef({
          ref: result.ref,
          mass: Object.values(weights).reduce((a, b) => a + b, 0),
          availability: Object.values(weights).some((w) => w > 0)
            ? "available"
            : "unreachable",
          globalReachProbability: null,
          model: "own-action-reach",
        });
      }
      case "policy_edit_batch":
      case "policy_undo":
      case "policy_redo":
      case "policy_fork": {
        let p: PolicyRecord;
        if (input.policyId) {
          p = structuredClone(lookup(state.policies, input.policyId));
          demand(
            !p.submitted || tool === "policy_fork",
            "固定策略不可编辑；请创建分支",
          );
        } else {
          const s = lookup(state.situations, input.situationId),
            n = this.node(s),
            player = input.playerId ?? n.actor;
          demand(n.policies[player], "该节点没有可编辑决策");
          const r = lookup(state.ranges, s.ranges[player]?.id);
          p = {
            ref: ref("policy", {}),
            situation: s.ref,
            range: r.ref,
            playerId: player,
            nodeId: n.id,
            allocations: {},
            submitted: false,
            assisted: !!input.reveal,
            past: [],
            future: [],
          };
          if (input.reveal) {
            this.allowed(state, "solution_load");
            this.exposed(state, [`analysis:${s.preset}`]);
          }
        }
        if (tool === "policy_undo") {
          demand(p.past.length, "没有可撤销的策略");
          p.future.push(p.allocations);
          p.allocations = p.past.pop()!;
        } else if (tool === "policy_redo") {
          demand(p.future.length, "没有可重做的策略");
          p.past.push(p.allocations);
          p.allocations = p.future.pop()!;
        } else {
          const s = fixed(state.situations, p.situation),
            actions = this.node(s).actions.map((a) => a.id);
          if (tool === "policy_edit_batch" && input.situationId)
            demand(
              lookup(state.situations, input.situationId).ref.contentHash ===
                p.situation.contentHash,
              "策略绑定旧输入；请从当前策略建立草稿后编辑。",
            );
          for (const item of input.patch ?? []) {
            demand(
              allCombos.includes(item.combo) &&
                item.allocation &&
                Object.keys(item.allocation).every((a) =>
                  actions.includes(a),
                ) &&
                Object.values(item.allocation).reduce((a, b) => a + b, 0) ===
                  10000,
              "行动频率须完整且合计100%",
            );
          }
          p.past.push(structuredClone(p.allocations));
          p.future = [];
          if (input.reveal) {
            this.allowed(state, "solution_load");
            const n = this.node(s);
            demand(n.policies[p.playerId], "此节点没有该玩家参考");
            for (const [combo, allocation] of Object.entries(
              n.policies[p.playerId],
            ))
              if (!p.allocations[combo])
                p.allocations[combo] = structuredClone(allocation);
            p.assisted = true;
            this.exposed(state, [`analysis:${s.preset}`]);
          }
          for (const item of input.patch ?? [])
            p.allocations[item.combo] = item.allocation!;
        }
        const forked = tool === "policy_fork";
        if (forked) {
          const current = lookup(
            state.situations,
            input.situationId ?? p.situation.id,
          );
          demand(
            !!current.ranges[p.playerId] &&
              this.node(current).actor === p.playerId &&
              current.nodeId === p.nodeId,
            "请先选择同一玩家的决策节点，再建立策略修订",
          );
          p.origin = p.ref;
          p.situation = current.ref;
          p.range = current.ranges[p.playerId];
          p.nodeId = current.nodeId;
        }
        p.submitted = false;
        p.ref = ref(
          "policy",
          p,
          forked ? undefined : p.ref.id,
          forked ? 1 : p.ref.version + 1,
        );
        keep(state.policies, p);
        return returnRef({
          ref: p.ref,
          submitted: p.submitted,
          filled: Object.keys(p.allocations).length,
          assisted: p.assisted,
        });
      }
      case "policy_submit": {
        const old = lookup(state.policies, input.policyId),
          s = lookup(state.situations, old.situation.id),
          n = this.node(s),
          r = lookup(state.ranges, old.range.id);
        if (old.submitted)
          return returnRef({
            ref: old.ref,
            submitted: true,
            assisted: old.assisted,
          });
        demand(
          s.ref.contentHash === old.situation.contentHash &&
            r.ref.contentHash === old.range.contentHash,
          "输入已改变，请建立新的策略",
        );
        const targetCombos = allCombos.filter(
          (c) => r.weights[c] > 0 && legalCombo(c, s.board),
        );
        demand(targetCombos.length > 0, "当前范围不可达，不能提交空策略");
        for (const c of targetCombos)
          demand(
            old.allocations[c] &&
              n.actions.every((a) =>
                Number.isInteger(old.allocations[c][a.id]),
              ) &&
              Object.values(old.allocations[c]).reduce((a, b) => a + b, 0) ===
                10000,
            `组合 ${c} 尚未完整分配`,
          );
        const p = {
          ...structuredClone(old),
          submitted: true,
          ref: ref(
            "policy",
            { ...old, submitted: true },
            old.ref.id,
            old.ref.version + 1,
          ),
        };
        keep(state.policies, p);
        return returnRef({ ref: p.ref, submitted: true, assisted: p.assisted });
      }
      case "analysis_spec_create": {
        const s = lookup(state.situations, input.situationId),
          spec = this.makeSpec(state, s, input);
        const { ranges, policy, situation, ...summary } = spec;
        return returnRef({
          ...summary,
          situation: situation.ref,
          rangeRefs: Object.fromEntries(
            Object.entries(ranges).map(([p, r]) => [p, r.ref]),
          ),
          policyRef: policy?.ref,
        });
      }
      case "analysis_preflight":
        return this.preflight(lookup(state.specs, input.specId));
      case "solution_load": {
        const spec = input.specId
          ? lookup(state.specs, input.specId)
          : undefined;
        demand(input.solutionId || spec, "需要固定规格或结果引用");
        return returnRef(
          input.solutionId
            ? lookup(state.solutions, input.solutionId)
            : this.saveSolution(state, spec!),
        );
      }
      case "analysis_start":
        return returnRef(
          this.newJob(state, lookup(state.specs, input.specId), input),
        );
      case "analysis_get":
        return lookup(state.jobs, input.jobId);
      case "analysis_cancel": {
        const j = lookup(state.jobs, input.jobId);
        if (
          ["completed", "cancelled", "failed", "interrupted"].includes(j.status)
        )
          throw new Fault("TOO_LATE", "作业已结束；保留其原状态和固定结果");
        j.status = "cancel_requested";
        j.stage = "取消请求已保存，等待运行器确认";
        j.events.push({ status: j.status, at: new Date().toISOString() });
        return returnRef(j);
      }
      case "analysis_retry": {
        const old = lookup(state.jobs, input.jobId);
        demand(
          ["failed", "interrupted", "cancelled"].includes(old.status),
          "只可重试失败/中断/取消任务",
        );
        return returnRef(
          this.newJob(
            state,
            lookup(state.specs, old.spec.id),
            { ...input, outcome: old.outcome },
            old.attempt + 1,
          ),
        );
      }
      case "solution_node_strategy": {
        const { manifest, page } = this.readPage(state, input),
          p = input.playerId ?? page.node.actor;
        const rows = allCombos.map((combo) => ({
          combo,
          label: handByCombo[combo],
          weight: page.node.weights[p]?.[combo] ?? 0,
          allocation: page.node.policies[p]?.[combo],
          dead: !legalCombo(combo, page.node.board),
        }));
        const { weights: _, policies: __, ...node } = page.node;
        return {
          solution: manifest.ref,
          node,
          model: page.node.model,
          ...this.page(
            state,
            rows,
            input,
            hash([manifest.ref, page.node.id, p, input.limit]),
          ),
        };
      }
      case "solution_combo_metrics": {
        const { manifest, page } = this.readPage(state, input),
          p = input.playerId ?? page.node.actor;
        return {
          definition: manifest.metricDefinition,
          items: (input.combos ?? []).map((combo) => ({
            combo,
            availability: page.metrics[p]?.[combo] ? "available" : "uncovered",
            metric: page.metrics[p]?.[combo] ?? null,
          })),
        };
      }
      case "solution_range_aggregate": {
        const { manifest, page } = this.readPage(state, input),
          p = input.playerId ?? page.node.actor,
          w = page.node.weights[p] ?? {},
          policy = page.node.policies[p] ?? {},
          mass = allCombos.reduce(
            (s, c) => s + (legalCombo(c, page.node.board) ? (w[c] ?? 0) : 0),
            0,
          );
        const frequencies = Object.fromEntries(
          page.node.actions.map((a) => [
            a.id,
            mass && Object.keys(policy).length
              ? allCombos.reduce(
                  (s, c) =>
                    s +
                    (legalCombo(c, page.node.board)
                      ? ((w[c] ?? 0) * (policy[c]?.[a.id] ?? 0)) / 10000
                      : 0),
                  0,
                ) / mass
              : null,
          ]),
        );
        return {
          solution: manifest.ref,
          nodeId: page.node.id,
          playerId: p,
          mass,
          frequencies,
          model: "own-action-reach",
          globalReachProbability: null,
          ev: null,
          evAvailability: "uncovered",
          classes: handClasses.map((h) => {
            const mass = h.combos.reduce(
              (sum, c) =>
                sum + (legalCombo(c, page.node.board) ? (w[c] ?? 0) : 0),
              0,
            );
            return {
              label: h.label,
              mass,
              allocation: Object.fromEntries(
                page.node.actions.map((a) => [
                  a.id,
                  mass && Object.keys(policy).length
                    ? h.combos.reduce(
                        (sum, c) =>
                          sum +
                          (legalCombo(c, page.node.board)
                            ? (w[c] ?? 0) * (policy[c]?.[a.id] ?? 0)
                            : 0),
                        0,
                      ) / mass
                    : 0,
                ]),
              ),
            };
          }),
        };
      }
      case "analysis_handoff": {
        const s = lookup(state.situations, input.situationId),
          n = this.node(s);
        demand(n.id === "flop-deal", "请先沿翻前路径到发牌节点");
        demand(!s.stale, "上游已修改，不能套用原交接范围");
        const next = this.createSituation(
          state,
          s.preset,
          s.preset === "X-MULTI" ? "multi" : "f-oop",
          `${s.name} · 翻后`,
        );
        next.origin = s.ref;
        if (input.board) {
          demand(
            input.board.length === 3 &&
              new Set(input.board).size === 3 &&
              input.board.every((c) => /^[AKQJT2-9][shdc]$/.test(c)),
            "翻后交接需要三张不同有效翻牌",
          );
          next.board = input.board;
        }
        return returnRef(next);
      }
      case "policy_evaluate": {
        const p = lookup(state.policies, input.policyId);
        demand(p.submitted, "需要固定策略");
        const s = fixed(state.situations, p.situation),
          n = this.node(s),
          r = fixed(state.ranges, p.range);
        let sum = 0,
          mass = 0;
        const targets = allCombos.filter(
          (c) => r.weights[c] > 0 && legalCombo(c, s.board),
        );
        const completeReference = targets.every(
          (c) =>
            canonical(p.allocations[c]) ===
            canonical(n.policies[p.playerId]?.[c]),
        );
        const completeCheck =
          n.actions.some((a) => a.id === "check") &&
          targets.every((c) =>
            n.actions.every(
              (a) =>
                p.allocations[c]?.[a.id] === (a.id === "check" ? 10000 : 0),
            ),
          );
        const authoredPairs: Record<
          string,
          { reference: number; check: number }
        > = {
          "H-SRP": { reference: 0.7, check: 0.62 },
          "X-BB": { reference: 0.65, check: 0.57 },
          "X-3BP": { reference: 1.4, check: 1.25 },
        };
        const pair =
          !s.stale &&
          s.stack === 10000 &&
          s.rake === 0 &&
          s.sizing === 250 &&
          n.id === "f-oop" &&
          canonical(s.board) === canonical(n.board) &&
          canonical(r.weights) === canonical(n.weights[p.playerId])
            ? authoredPairs[s.preset]
            : undefined;
        const samplePolicyEv =
          pair && targets.length && (completeReference || completeCheck)
            ? {
                dataKind: "synthetic",
                template: completeReference ? "reference" : "all-check",
                value: completeReference ? pair.reference : pair.check,
                loss: completeReference ? 0 : pair.reference - pair.check,
                unit: "bb",
                origin: "current-node",
                invested: "excluded",
                rake: "none",
                policyFingerprint: hash(p.allocations),
                inputFingerprint: hash({
                  situation: s,
                  range: r.ref,
                  policy: p.ref,
                }),
                reason:
                  "作者为两份固定策略分别编写的配对收益示例；不是由频率距离换算或真实求值。",
              }
            : null;
        for (const c of allCombos)
          if (r.weights[c] > 0 && legalCombo(c, s.board)) {
            mass += r.weights[c];
            sum +=
              r.weights[c] *
              n.actions.reduce(
                (d, a) =>
                  d +
                  Math.abs(
                    (p.allocations[c]?.[a.id] ?? 0) -
                      (n.policies[p.playerId]?.[c]?.[a.id] ?? 0),
                  ) /
                    20000,
                0,
              );
          }
        const reference = {
          ref: ref("content", {
            version: contentVersion,
            preset: s.preset,
            node: n.id,
          }),
          version: contentVersion,
          preset: s.preset,
          nodeId: n.id,
          treeHash: s.treeHash,
          identity: "authored-synthetic",
        };
        state.objects[reference.ref.id] = reference;
        const result = {
          ref: ref("evaluation", { policy: p.ref }),
          policy: p.ref,
          situation: p.situation,
          reference: reference.ref,
          distance:
            mass &&
            !s.stale &&
            s.stack === 10000 &&
            s.rake === 0 &&
            s.sizing === 250 &&
            canonical(s.board) === canonical(n.board) &&
            canonical(r.weights) === canonical(n.weights[p.playerId])
              ? sum / mass
              : null,
          evLoss: null,
          samplePolicyEv,
          reason: "频率差只对作者示例分布；没有本策略整树 EV 证据。",
        };
        state.objects[result.ref.id] = result;
        return returnRef(result);
      }
      case "experiment_create": {
        const baseline = lookup(state.solutions, input.baselineId);
        demand(baseline.availability === "available", "基准必须有可用固定结果");
        const spec = lookup(state.specs, baseline.spec.id),
          n = this.node(spec.situation);
        const player = input.playerId ?? n.actor,
          combos = input.combos ?? ["AhAd"];
        const allocation =
          input.allocation ??
          Object.fromEntries(
            n.actions.map((a, i) => [
              a.id,
              i === 0 ? 8000 : i === 1 ? 2000 : 0,
            ]),
          );
        demand(
          combos.every(
            (c) =>
              allCombos.includes(c) &&
              legalCombo(c, n.board) &&
              (n.weights[player]?.[c] ?? 0) > 0,
          ) &&
            Object.keys(allocation).every((a) =>
              n.actions.some((x) => x.id === a),
            ) &&
            Object.values(allocation).reduce((s, v) => s + v, 0) === 10000,
          "锁定组合/动作分配无效",
        );
        const known: "overfold" | "sticky" | undefined =
          input.preset === "overfold" || input.preset === "sticky"
            ? input.preset
            : undefined;
        const lock = {
          playerId: player,
          nodeId: n.id,
          combos,
          allocation,
          preset: known,
        };
        const variantSpec = this.makeSpec(
          state,
          spec.situation,
          { ...input, operation: "resolve-with-lock" },
          lock,
        );
        const variant = this.saveSolution(state, variantSpec);
        const experiment: Experiment = {
          ref: ref("experiment", { baseline: baseline.ref, lock }),
          baseline: baseline.ref,
          variant: variant.ref,
          hypothesis: input.hypothesis ?? "条件性对手假设",
          lock,
        };
        keep(state.experiments, experiment);
        refs.push(variantSpec.ref, variant.ref);
        return returnRef(experiment);
      }
      case "experiment_compare": {
        const e = lookup(state.experiments, input.experimentId),
          a = lookup(state.solutions, e.baseline.id),
          b = lookup(state.solutions, input.variantId ?? e.variant?.id);
        const sa = lookup(state.specs, a.spec.id),
          sb = lookup(state.specs, b.spec.id);
        const eligible =
          hash(sa.situation) === hash(sb.situation) &&
          a.quality === b.quality &&
          a.availability === "available" &&
          b.availability === "available";
        const comparison = {
          ref: ref("comparison", { a: a.ref, b: b.ref }),
          baseline: a.ref,
          variant: b.ref,
          eligible,
          evDelta: null,
          reason: eligible
            ? "同条件合成策略对照；没有验证真实剥削收益。"
            : "输入/质量/覆盖不满足定量比较条件",
        };
        state.objects[comparison.ref.id] = comparison;
        e.comparison = comparison.ref;
        return returnRef(comparison);
      }
      case "experiment_conclude": {
        const e = lookup(state.experiments, input.experimentId);
        demand(e.comparison, "先核对比较资格");
        const conclusion = {
          ref: ref("conclusion", {
            experiment: e.ref,
            comparison: e.comparison,
            text: input.conclusion,
          }),
          experiment: e.ref,
          comparison: e.comparison,
          text: input.conclusion ?? "证据不足，保留假设。",
          limitations: "合成示例，不是已验证扑克结论",
          previous: e.conclusion,
        };
        state.objects[conclusion.ref.id] = conclusion;
        e.conclusion = conclusion.ref;
        return returnRef(conclusion);
      }
      case "analysis_agent_run": {
        const s = lookup(state.situations, input.situationId),
          trace: { tool: string; refs: Ref[]; observation: string }[] = [];
        const step = (
          name: ToolName,
          args: Partial<Input>,
          observation: string,
        ) => {
          this.allowed(state, name);
          const produced: Ref[] = [];
          const value = this.dispatch(
            state,
            name,
            { ...input, ...args },
            produced,
          );
          trace.push({ tool: name, refs: produced, observation });
          refs.push(...produced);
          return value;
        };
        step("solver_capabilities", {}, "已确认仅合成分析能力，不是实际求解");
        for (const range of Object.values(s.ranges))
          step(
            "range_get",
            { rangeId: range.id, limit: 1 },
            "读取当前固定范围版本与来源",
          );
        const spec = this.makeSpec(state, s, {
          ...input,
          operation: "load-reference",
        });
        refs.push(spec.ref);
        const baseline = step(
          "solution_load",
          { specId: spec.ref.id, solutionId: undefined },
          "加载与输入精确配对的基准制品",
        ) as SolutionManifest;
        const node = this.node(s);
        const allocation = Object.fromEntries(
          node.actions.map((a, i) => [
            a.id,
            i === 0 ? 8000 : i === 1 ? 2000 : 0,
          ]),
        );
        const experiment = step(
          "experiment_create",
          {
            baselineId: baseline.ref.id,
            combos: ["AhAd"],
            allocation,
            preset: "overfold",
            hypothesis: input.hypothesis ?? "对手行动分布改变的条件性示例",
          },
          "建立独立锁定变体，不修改基准",
        ) as Experiment;
        step(
          "experiment_compare",
          { experimentId: experiment.ref.id },
          "检查条件、覆盖与质量，缺失收益不补造",
        );
        step(
          "experiment_conclude",
          {
            experimentId: experiment.ref.id,
            conclusion:
              "当前只有作者合成策略对照；真实收益和错因仍需独立证据。",
          },
          "保存有局限的观察，可继续编辑研究",
        );
        const mission = {
          ref: ref("mission", {
            situation: s.ref,
            experiment: experiment.ref,
            trace,
          }),
          situation: s.ref,
          experiment: experiment.ref,
          baseline: baseline.ref,
          status: "completed",
          execution: "deterministic application commands; no LLM",
          trace,
        };
        state.objects[mission.ref.id] = mission;
        return returnRef(mission);
      }
      case "teaching_begin": {
        demand(!state.independent, "已有独立题");
        const definition = input.question
          ? (lookup(state.objects, input.question) as {
              prompt: string;
              options: string[];
              exposureKeys: string[];
            })
          : undefined;
        state.independent = {
          question: input.question ?? "S1-source-question",
          keys: definition?.exposureKeys ?? ["analysis:H-SRP", "analysis:X-BB"],
          prompt:
            definition?.prompt ??
            "HU 桌与六人背景的 BTN 对 BB 是否可直接共用无条件范围？",
          options: definition?.options ?? ["不能，需要核对来源和条件", "可以"],
        };
        return {
          question: state.independent.question,
          prompt: state.independent.prompt,
          options: state.independent.options,
          exposure: state.exposures.includes("reset:unknown")
            ? "unknown-history"
            : state.exposures.some((k) => state.independent!.keys.includes(k))
              ? "seen"
              : "no-record",
        };
      }
      case "teaching_record_exposure":
        this.exposed(state, [
          "legacy-reading:possible",
          ...presets.map((p) => `analysis:${p.id}`),
        ]);
        return {
          registered: true,
          identity: "possible-exposure",
          reason: "旧版阅读可能包含相关概念或参考；不获得未见身份。",
        };
      case "review_extract": {
        const snapshot = snapshotSchema.parse(state.legacy),
          hand = snapshot.product?.hands[required(input.handId)],
          decision = hand?.decisions.find((d) => d.id === input.decisionId);
        demand(hand?.confirmed && decision, "先选择已确认的行动前节点");
        demand(
          Number.isInteger(decision!.potMinor) &&
            decision!.potMinor > 0 &&
            Number.isInteger(decision!.stackMinor) &&
            decision!.stackMinor > 0 &&
            [0, 3, 4, 5].includes(decision!.board.length) &&
            new Set(decision!.board).size === decision!.board.length &&
            decision!.board.every((c) => /^[AKQJT2-9][shdc]$/.test(c)),
          "行动前金额/牌面需要确认",
        );
        const source = Object.values(state.imports).find(
          (i) => i.hash === hash(state.legacy),
        )?.ref;
        demand(source, "复盘来源尚未封存");
        const actor = decision!.actor,
          r = this.recordRange(state, actor, {}),
          opponent = this.recordRange(state, "opponent-unknown", {});
        const review = {
          source: source!,
          handId: hand!.id,
          decisionId: decision!.id,
          pot: decision!.potMinor,
          actor,
          history: [...decision!.actionHistory],
          hero: decision!.hero,
          unknownFields: [
            "桌型/背景人数",
            "对手位置与人数",
            "双方输入范围",
            "抽水/前注",
            "行动尺度",
            "投入分解",
            "完整行动树",
          ],
        };
        const payload = {
          name: input.name ?? `复盘事实 · ${decision!.label}`,
          preset: "review-snapshot",
          format: "unknown" as const,
          nodeId: `review-${decision!.id}`,
          board: [...decision!.board],
          stack: decision!.stackMinor,
          rake: null,
          sizing: null,
          treeHash: hash({ review, coverage: "unknown" }),
          stale: true,
          players: [
            {
              id: actor,
              position: actor,
              initial: decision!.stackMinor,
              remaining: decision!.stackMinor,
              contribution: 0,
              status: "active" as const,
            },
          ],
          ranges: { [actor]: r.ref, "opponent-unknown": opponent.ref },
          history: review.history,
          review,
        };
        const value: Situation = {
          ...payload,
          ref: ref("situation", payload),
          revision: 1,
        };
        keep(state.situations, value);
        return returnRef(value);
      }
      case "teaching_reveal": {
        demand(state.independent, "没有待揭示的题");
        this.exposed(state, state.independent!.keys);
        state.independent = undefined;
        return { assisted: true, reason: "主动阅读研究证据，辅助身份已登记" };
      }
      case "teaching_attempt_submit": {
        const question =
            state.independent?.question ??
            input.question ??
            "S1-source-question",
          definition = state.objects[question] as
            | { exposureKeys?: string[]; expected?: string }
            | undefined;
        const keys = state.independent?.keys ??
          definition?.exposureKeys ?? ["analysis:H-SRP", "analysis:X-BB"];
        const attempt = {
          ref: ref("attempt", {
            question,
            answer: input.answer,
            nonce: randomUUID(),
          }),
          question,
          answer: input.answer ?? "",
          reason: input.reason ?? "",
          assisted:
            state.exposures.includes("reset:unknown") ||
            keys.some((k) => state.exposures.includes(k)),
          exposureKeys: keys,
          source: input.solutionId
            ? lookup(state.solutions, input.solutionId).ref
            : undefined,
        };
        state.attempts[attempt.ref.id] = attempt;
        const definitionSnapshot = {
          ref: ref("question-definition", {
            question,
            expected: definition?.expected ?? "不能，需要核对来源和条件",
          }),
          expected: definition?.expected ?? "不能，需要核对来源和条件",
          kind: "concept-only",
        };
        state.objects[`definition:${attempt.ref.id}`] = definitionSnapshot;
        state.objects[definitionSnapshot.ref.id] = definitionSnapshot;
        state.independent = undefined;
        return returnRef(attempt);
      }
      case "teaching_feedback": {
        const a = lookup(state.attempts, input.attemptId),
          solution = lookup(state.solutions, input.solutionId),
          definition = lookup(state.objects, `definition:${a.ref.id}`) as {
            ref: Ref;
            expected: string;
          };
        const theory = {
          ref: ref(
            "theory",
            {
              text: "派生范围引用固定局面、策略和行动；局部分析不自动成为整体均衡。",
            },
            "S1-range-provenance",
          ),
          text: "派生范围引用固定局面、策略和行动；局部分析不自动成为整体均衡。",
          identity: "authored structural concept, not a strategic GTO claim",
        };
        state.objects[theory.ref.id] = theory;
        const feedback = {
          ref: ref("feedback", {
            attempt: a.ref,
            solution: solution.ref,
            definition: definition.ref,
          }),
          attempt: a.ref,
          solution: solution.ref,
          definition: definition.ref,
          policy: "S1-concept-1",
          conceptAccepted: a.answer === definition.expected,
          strategicEV: null,
          reasonStatus: "recorded-not-graded",
          text: "范围必须保留桌型、位置、此前行动与模型。此处只评价来源概念，不判断真实 GTO 动作或自由文本理解。",
          theoryRef: theory.ref,
        };
        state.objects[feedback.ref.id] = feedback;
        a.feedback = feedback.ref;
        this.exposed(state, a.exposureKeys);
        return returnRef(feedback);
      }
      case "teaching_next": {
        const a = lookup(state.attempts, input.attemptId);
        demand(a.feedback, "先形成固定反馈");
        const question = {
          ref: ref("question", { parent: a.ref, condition: "CO-vs-BTN-3bet" }),
          parentAttempt: a.ref,
          changedCondition: "由 BTN 对 BB 改为 CO 开池、BTN 3-bet",
          prompt: "CO 开池、BTN 3-bet、CO 跟注后，进入翻后的范围应从哪里来？",
          options: [
            "引用 CO 跟注 3-bet 后的固定范围与行动历史",
            "使用 BTN 未开池表",
          ],
          expected: "引用 CO 跟注 3-bet 后的固定范围与行动历史",
          exposureKeys: ["analysis:X-3BP"],
          kind: "concept-transfer",
          unseen:
            !state.exposures.includes("reset:unknown") &&
            !state.exposures.includes("analysis:X-3BP"),
        };
        state.objects[question.ref.id] = question;
        a.next = question.ref;
        const { expected: _, ...projection } = question;
        return returnRef(projection);
      }
      case "workspace_export": {
        this.exposed(state, [
          "backup:possible",
          ...presets.map((p) => `analysis:${p.id}`),
        ]);
        const clean = structuredClone(state);
        clean.receipts = {};
        // Generated backups are transport containers, not dependencies of product works.
        clean.artifacts = Object.fromEntries(
          Object.entries(clean.artifacts).filter(
            ([, a]) => a.purpose !== "workspace-backup",
          ),
        );
        const blobs: Record<string, string> = {};
        for (const m of Object.values(state.solutions))
          for (const n of m.nodes)
            blobs[n.hash] = this.store.getBytes(n.hash).toString("base64");
        for (const a of Object.values(clean.artifacts)) {
          blobs[a.hash] = this.store.getBytes(a.hash).toString("base64");
          if (a.indexHash) {
            blobs[a.indexHash] = this.store
              .getBytes(a.indexHash)
              .toString("base64");
            for (const block of this.store.get<{ blocks: string[] }>(
              a.indexHash,
            ).blocks)
              blobs[block] = this.store.getBytes(block).toString("base64");
          }
        }
        const payload = {
          format: "riverline-s1-backup/1",
          state: clean,
          blobs,
        };
        const artifact = this.store.artifact(
          Buffer.from(JSON.stringify({ checksum: hash(payload), payload })),
        );
        artifact.purpose = "workspace-backup";
        state.artifacts[artifact.ref.id] = artifact;
        return returnRef({
          ref: artifact.ref,
          bytes: artifact.bytes,
          pages: Math.ceil(artifact.bytes / 65536),
          format: "riverline-s1-backup/1",
        });
      }
      case "artifact_inspect": {
        const id = required(input.artifactId);
        const versionMatch = /^(.*)@(\d+)$/.exec(id);
        for (const collection of [
          state.situations,
          state.ranges,
          state.policies,
          state.specs,
          state.jobs,
          state.solutions,
          state.experiments,
          state.attempts,
          state.artifacts,
          state.objects,
          state.real?.cases ?? {},
          state.real?.specs ?? {},
          state.real?.jobs ?? {},
        ]) {
          const key = Object.hasOwn(collection, id)
            ? id
            : versionMatch && Object.hasOwn(collection, versionMatch[1])
              ? versionMatch[1]
              : undefined;
          if (!key) continue;
          const value = (collection as Record<string, unknown>)[key] as Record<
            string,
            unknown
          >;
          if (
            versionMatch &&
            (value.ref as Ref | undefined)?.version !== Number(versionMatch[2])
          )
            continue;
          if (collection === state.ranges) {
            const r = value as unknown as RangeRecord;
            return {
              ref: r.ref,
              playerId: r.playerId,
              origin: r.origin,
              source: r.source,
              mass: Object.values(r.weights).reduce((a, b) => a + b, 0),
              readTool: "range_get",
            };
          }
          if (collection === state.policies) {
            const p = value as unknown as PolicyRecord,
              r = fixed(state.ranges, p.range),
              s = fixed(state.situations, p.situation),
              actions = this.node(s).actions;
            const targets = allCombos.filter(
              (c) => r.weights[c] > 0 && legalCombo(c, s.board),
            );
            return {
              ref: p.ref,
              situation: p.situation,
              range: p.range,
              playerId: p.playerId,
              nodeId: p.nodeId,
              submitted: p.submitted,
              assisted: p.assisted,
              filled: targets.filter((c) => p.allocations[c]).length,
              targetCount: targets.length,
              classes: handClasses.map((h) => {
                const combos = h.combos.filter((c) => legalCombo(c, s.board)),
                  mass = combos.reduce(
                    (sum, c) => sum + (r.weights[c] ?? 0),
                    0,
                  );
                return {
                  label: h.label,
                  mass,
                  filled: combos.filter(
                    (c) => (r.weights[c] ?? 0) > 0 && p.allocations[c],
                  ).length,
                  targetCount: combos.filter((c) => (r.weights[c] ?? 0) > 0)
                    .length,
                  allocation: combos.every(
                    (c) => !(r.weights[c] > 0) || p.allocations[c],
                  )
                    ? Object.fromEntries(
                        actions.map((a) => [
                          a.id,
                          mass
                            ? combos.reduce(
                                (sum, c) =>
                                  sum +
                                  (r.weights[c] ?? 0) *
                                    (p.allocations[c]?.[a.id] ?? 0),
                                0,
                              ) / mass
                            : 0,
                        ]),
                      )
                    : undefined,
                };
              }),
              ...this.page(
                state,
                Object.entries(p.allocations).map(([combo, allocation]) => ({
                  combo,
                  allocation,
                })),
                input,
                hash(p.ref),
              ),
            };
          }
          if (collection === state.specs) {
            const spec = value as unknown as Spec;
            const { ranges, policy, situation, ...summary } = spec;
            return {
              ...summary,
              situation: situation.ref,
              rangeRefs: Object.fromEntries(
                Object.entries(ranges).map(([player, r]) => [player, r.ref]),
              ),
              policyRef: policy?.ref,
            };
          }
          if (
            collection === state.objects &&
            typeof value.expected === "string"
          ) {
            const { expected: _, ...safe } = value;
            return safe;
          }
          return value;
        }
        throw new Fault(
          "NOT_FOUND",
          "固定制品或来源版本缺失，未替换为当前对象",
        );
      }
      case "artifact_page": {
        const a = lookup(state.artifacts, input.artifactId),
          start = (input.page ?? 0) * 65536;
        demand(start < a.bytes || a.bytes === 0, "分页越界");
        const block = this.store.artifactPage(a, input.page ?? 0);
        return {
          ref: a.ref,
          page: input.page ?? 0,
          encoding: "base64",
          data: block.toString("base64"),
          bytes: a.bytes,
          pages: Math.ceil(a.bytes / 65536),
          hash: a.hash,
        };
      }
      case "workspace_import":
        return this.importBackup(state, input, refs);
    }
  }
  private importBackup(
    state: RuntimeState,
    input: Input,
    refs: Ref[],
  ): unknown {
    const raw = input.backup;
    const phase = z
      .object({
        phase: z.enum(["begin", "chunk", "commit"]),
        id: z.string().optional(),
        data: z.string().optional(),
        checksum: z.string().optional(),
      })
      .safeParse(raw);
    if (phase.success) {
      const p = phase.data;
      if (p.phase === "begin") {
        const session = ref("import-session", { nonce: randomUUID() });
        state.objects[session.id] = { chunks: [], checksum: p.checksum };
        refs.push(session);
        return { ref: session };
      }
      const session = lookup(state.objects, p.id) as {
        chunks: string[];
        checksum: string;
      };
      if (p.phase === "chunk") {
        demand(
          typeof p.data === "string" && p.data.length < 120000,
          "导入块过大",
        );
        const b = Buffer.from(p.data!, "base64");
        const stored = this.store.putBytes(b);
        demand(session.chunks.length < 1024, "导入超过64MiB本地预算");
        session.chunks.push(stored.hash);
        return { accepted: session.chunks.length };
      }
      const bytes = Buffer.concat(
        session.chunks.map((h) => this.store.getBytes(h)),
      );
      demand(bytes.length <= 67108864, "导入超过64MiB本地预算");
      demand(hash(bytes) === session.checksum, "导入归档哈希不匹配");
      const response = this.importBackup(
        state,
        { ...input, backup: JSON.parse(bytes.toString()) },
        refs,
      );
      delete state.objects[p.id!];
      return response;
    }
    const backup = z
      .object({
        checksum: z.string(),
        payload: z.object({
          format: z.literal("riverline-s1-backup/1"),
          state: z.unknown(),
          blobs: z.record(z.string(), z.string()),
        }),
      })
      .safeParse(raw);
    if (backup.success) {
      const { payload, checksum } = backup.data;
      demand(hash(payload) === checksum, "备份校验失败，当前工作区未修改");
      const incoming = validateBackupState(payload.state);
      demand(
        incoming.schemaVersion === 1 &&
          incoming.contractVersion === contractVersion &&
          incoming.workspaceId === state.workspaceId &&
          !!incoming.situations &&
          !!incoming.specs &&
          !!incoming.artifacts &&
          Array.isArray(incoming.exposures),
        "备份结构/工作区不匹配",
      );
      for (const [digest, value] of Object.entries(payload.blobs)) {
        const bytes = Buffer.from(value, "base64");
        demand(hash(bytes) === digest, "制品校验失败");
      }
      for (const m of Object.values(incoming.solutions)) {
        demand(
          m.dataKind === "synthetic" && !!incoming.specs[m.spec.id],
          "未知引擎/丢失规格",
        );
        for (const n of m.nodes)
          demand(payload.blobs[n.hash] !== undefined, "备份缺节点制品");
      }
      for (const a of Object.values(incoming.artifacts)) {
        demand(payload.blobs[a.hash] !== undefined, "备份缺归档制品");
        if (a.indexHash) {
          demand(payload.blobs[a.indexHash] !== undefined, "备份缺分块索引");
          const index = JSON.parse(
            Buffer.from(payload.blobs[a.indexHash], "base64").toString(),
          ) as { blocks: string[]; bytes: number };
          demand(
            index.bytes === a.bytes &&
              index.blocks.every((h) => payload.blobs[h] !== undefined),
            "备份缺分块制品",
          );
        }
      }
      validateRealArtifacts(incoming, (reference) => {
        const artifact = incoming.artifacts[reference.id];
        demand(
          artifact?.ref.contentHash === reference.contentHash,
          "真实制品引用不匹配",
        );
        const bytes = payload.blobs[artifact.hash];
        demand(bytes !== undefined, "备份缺真实制品");
        return Buffer.from(bytes, "base64");
      });
      for (const [digest, bytes] of Object.entries(payload.blobs)) {
        demand(
          this.store.putBytes(Buffer.from(bytes, "base64")).hash === digest,
          "制品无法写入",
        );
      }
      const receiptState = {
        receipts: state.receipts,
        revision: state.revision,
        changes: state.changes,
      };
      const exposures = [
        ...new Set([
          ...state.exposures,
          ...incoming.exposures,
          "backup:possible",
        ]),
      ];
      if (!incoming.real) delete state.real;
      Object.assign(state, incoming, receiptState, {
        exposures,
        independent: undefined,
      });
      return { restored: true, situations: unique(state.situations).length };
    }
    const legacy = snapshotSchema.safeParse(raw);
    demand(legacy.success, "不是有效备份或旧工作区");
    const digest = hash(raw);
    if (state.imports[digest]) {
      refs.push(state.imports[digest].ref);
      return { duplicate: true, ref: state.imports[digest].ref };
    }
    const blob = this.store.artifact(Buffer.from(JSON.stringify(raw)));
    state.artifacts[blob.ref.id] = blob;
    state.legacy = legacy.data;
    const active =
      legacy.data!.teaching?.sessions[
        legacy.data!.teaching?.activeSessionId ?? ""
      ];
    if (active?.status === "answering")
      state.independent = {
        question: active.questionId,
        keys: ["legacy:unknown", ...presets.map((p) => `analysis:${p.id}`)],
      };
    const legacyRef = ref("legacy-import", { hash: digest });
    state.objects[legacyRef.id] = {
      ref: legacyRef,
      original: blob.ref,
      hash: digest,
      identity: "legacy-readonly-unverified",
    };
    state.imports[digest] = { hash: digest, ref: legacyRef };
    this.exposed(state, [
      "legacy:unknown",
      "backup:possible",
      ...presets.map((p) => `analysis:${p.id}`),
    ]);
    refs.push(legacyRef);
    return {
      ref: legacyRef,
      preserved: true,
      identity: "legacy-readonly-unverified",
      reason: "原首次作答/引用封存，未知字段不补造；暴露历史保守处理。",
    };
  }
  resources(): { uri: string; name: string; mimeType: string }[] {
    if (this.handRestricted()) return [];
    if (this.state.independent) return [];
    return [
      ...unique(this.state.solutions).map((s) => ({
        uri: `riverline://${this.state.workspaceId}/solutions/${s.ref.id}/${s.ref.version}/manifest`,
        name: `${s.ref.id} · 合成结果清单`,
        mimeType: "application/json",
      })),
      ...Object.values(this.state.real?.solutions ?? {}).map((s) => ({
        uri: `riverline://${this.state.workspaceId}/real-solutions/${s.ref.id}/${s.ref.version}/manifest`,
        name: `${s.ref.id} · 真实河牌解清单`,
        mimeType: "application/json",
      })),
    ];
  }
  readResource(uri: string): Reply {
    const guard = this.handGuard("read-resource");
    if (guard) return guard;
    try {
      this.allowed(this.state, "solution_node_strategy");
      const realMatch =
        /^riverline:\/\/([^/]+)\/real-solutions\/([^/]+)\/(\d+)\/manifest$/.exec(
          uri,
        );
      if (realMatch) {
        demand(
          realMatch[1] === this.state.workspaceId &&
            this.state.real?.solutions[realMatch[2]]?.ref.version ===
              Number(realMatch[3]),
          "无效真实资源引用",
        );
        return this.real.execute("real_solution_load", {
          workspaceId: this.state.workspaceId,
          requestId: randomUUID(),
          expectedRevision: this.state.revision,
          solutionId: realMatch[2],
        });
      }
      const match =
        /^riverline:\/\/([^/]+)\/solutions\/([^/]+)\/(\d+)\/manifest$/.exec(
          uri,
        );
      demand(match && match[1] === this.state.workspaceId, "无效资源引用");
      const m = lookup(this.state.solutions, match![2]);
      demand(m.ref.version === Number(match![3]), "资源版本不匹配");
      for (const n of m.nodes) this.store.getBytes(n.hash);
      return {
        ok: true,
        contractVersion,
        workspaceId: this.state.workspaceId,
        revision: this.state.revision,
        artifactRefs: [m.ref],
        data: m,
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof Fault ? error.code : "ARTIFACT_INCOMPLETE",
        message: error instanceof Error ? error.message : "资源读取失败",
        retryable: false,
      };
    }
  }
  close() {
    this.autoReview?.close();
    this.game?.close();
    this.stopped = true;
    this.real.close();
    for (const worker of this.workers.values()) worker.kill();
    this.store.close();
  }
}
