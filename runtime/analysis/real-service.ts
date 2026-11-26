import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DiskStore, hash, ref } from "../store.ts";
import { NativeNodeCache } from "../engines/native-access.ts";
import { TurnNodeCache } from "../engines/turn-access.ts";
import { TurnPageCache } from "../engines/turn-page-access.ts";
import { turnSelection, projectTurnPage } from "./turn-query.ts";
import { parseSolverInput, caseTreeHash } from "./model.ts";
import type { SolverInput } from "./model.ts";
import { turnInputSchema } from "../../contracts/solver/turn.ts";
import type { TurnPath, TurnInput } from "../../contracts/solver/turn.ts";
import { aggregateRows } from "./aggregate.ts";
import { explicitRiverSchema } from "../../contracts/solver/river-tree.ts";
import { startEngine } from "../engines/process-runner.ts";
import { validateNode, validateRealArtifacts } from "./native-projection.ts";
import type { NativeNode } from "./native-projection.ts";
import {
  engineCommit,
  riverInputSchema,
} from "../../contracts/solver/engine.ts";
import {
  realContract,
  realSchemas,
  realReadTools,
} from "../../src/modules/analysis/real-domain.ts";
import type {
  RealSpec,
  RealJob,
  RealSolution,
  RealState,
  RealTool,
  RealInputs,
} from "../../src/modules/analysis/real-domain.ts";
import { contractVersion } from "../../src/modules/analysis/domain.ts";
import type {
  Ref,
  Reply,
  RuntimeState,
  RangeRecord,
} from "../../src/modules/analysis/domain.ts";
import {
  allCombos,
  handByCombo,
  handClasses,
  legalCombo,
  presets,
} from "../../src/modules/analysis/content.ts";

const binary = fileURLToPath(
  new URL(
    `../../engines/postflop/target/release/riverline-solver${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
const terminal = new Set(["completed", "cancelled", "failed", "interrupted"]);
const comboMap = new Map(
  allCombos.flatMap((c) => [
    [c, c],
    [c.slice(2) + c.slice(0, 2), c],
  ]),
);
const normalizeCombo = (c: string) => {
  const value = comboMap.get(c);
  if (!value) throw new RealFault("VALIDATION_ERROR", `非法组合 ${c}`);
  return value;
};
const unique = <T extends { ref: Ref }>(record: Record<string, T>) =>
  Object.entries(record)
    .filter(([k]) => !k.includes("@"))
    .map(([, v]) => v);
const save = <T extends { ref: Ref }>(record: Record<string, T>, value: T) => {
  if (record[value.ref.id])
    record[`${value.ref.id}@${record[value.ref.id].ref.version}`] =
      record[value.ref.id];
  record[value.ref.id] = value;
};
export function getFixed<T extends { ref: Ref }>(
  record: Record<string, T>,
  value: Ref,
): T {
  const result = record[`${value.id}@${value.version}`] ?? record[value.id];
  if (!result || result.ref.contentHash !== value.contentHash)
    throw new RealFault("NOT_FOUND", "固定引用缺失或已损坏");
  return result;
}
export class RealFault extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const demand = (condition: unknown, code: string, message: string) => {
  if (!condition) throw new RealFault(code, message);
};
export class RealAnalysisService {
  private active?: { jobId: string; run: ReturnType<typeof startEngine> };
  private stopped = false;
  private nativeNodes = new NativeNodeCache();
  private turnNodes = new TurnNodeCache();
  private turnPages = new TurnPageCache();
  constructor(private store: DiskStore) {
    mkdirSync(join(store.directory, "real-jobs"), { recursive: true });
    mkdirSync(join(store.directory, "real-preflight"), { recursive: true });
    if (
      store.state.real &&
      Object.values(store.state.real.jobs).some((j) => !terminal.has(j.status))
    ) {
      const next = structuredClone(store.state);
      this.recover(next);
      store.commit(next);
    }
  }
  private state(s: RuntimeState): RealState {
    return (s.real ??= {
      contract: realContract,
      cases: {},
      specs: {},
      jobs: {},
      solutions: {},
    });
  }
  recover(s: RuntimeState) {
    if (s.real)
      for (const job of Object.values(s.real.jobs))
        if (!terminal.has(job.status)) {
          job.status = "interrupted";
          job.error = "业务运行时或导入已中断原进程；请按固定规格重试";
          job.events.push({ status: job.status, at: new Date().toISOString() });
        }
  }
  busy() {
    return !!this.active;
  }
  close() {
    this.stopped = true;
    this.active?.run.interrupt();
  }
  capabilities() {
    return {
      contract: realContract,
      dataKind: "engine-computed",
      engineCommit,
      installed: existsSync(binary),
      model:
        "HU river: explicit bet/raise/all-in; HU turn: at most one fixed bet per player per street, no raises; no rake/bunching/locks",
      capabilities: [
        { id: "HU-preflop", status: "unsupported" },
        {
          id: "HU-postflop",
          status: "verified-explicit-river-and-bounded-turn",
          streets: ["river", "turn"],
        },
        { id: "6max-preflop", status: "unsupported" },
        { id: "6max-headsup-postflop", status: "unsupported" },
        { id: "multiway-postflop", status: "unsupported" },
      ],
      limits: {
        computeSlots: 1,
        queued: 4,
        positiveCombosPerPlayer: 200,
        turnPositiveCombosPerPlayer: 128,
        legacyTurnPositiveCombosPerPlayer: 16,
        explicitTreeLines: 32,
        treeLineDepth: 12,
        queryPathDepth: 16,
        nativeQuerySlots: 2,
        cachedNodes: 8,
        queryPage: 200,
        maxIterations: 100000,
        memoryEstimateBytes: 268435456,
        hardMemoryIsolation: false,
        resume: false,
      },
      quality:
        "NashConv = 2 × native exploitability; defined for this unraked two-player zero-sum subgame",
    };
  }
  private find<K extends "cases" | "specs" | "jobs" | "solutions">(
    s: RuntimeState,
    group: K,
    id: string,
  ): NonNullable<RuntimeState["real"]>[K][string] {
    const record = this.state(s)[group];
    let value = Object.hasOwn(record, id) ? record[id] : undefined;
    if (!value && id.includes("@")) {
      const split = id.lastIndexOf("@"),
        latest = Object.hasOwn(record, id.slice(0, split))
          ? record[id.slice(0, split)]
          : undefined;
      if (latest?.ref.version === Number(id.slice(split + 1))) value = latest;
    }
    if (!value) throw new RealFault("NOT_FOUND", `${group} 固定对象不存在`);
    return value as RealState[K][string];
  }
  private artifact<T>(s: RuntimeState, reference: Ref): T {
    const a = getFixed(s.artifacts, reference);
    return JSON.parse(this.store.getBytes(a.hash).toString("utf8")) as T;
  }
  private put(
    s: RuntimeState,
    bytes: Buffer,
    mediaType = "application/json",
  ): Ref {
    const a = this.store.artifact(bytes, mediaType);
    s.artifacts[a.ref.id] = a;
    return a.ref;
  }
  private input(s: RuntimeState, spec: RealSpec): SolverInput {
    const a = getFixed(s.artifacts, spec.input);
    demand(
      a.hash === spec.inputHash,
      "ARTIFACT_INCOMPLETE",
      "规格输入指纹不匹配",
    );
    const raw = this.artifact<{ schemaVersion: number }>(s, spec.input);
    return parseSolverInput(raw);
  }
  private preflight(s: RuntimeState, spec: RealSpec) {
    const input = this.input(s, spec);
    if (!existsSync(binary))
      return {
        supported: false,
        code: "ENGINE_UNAVAILABLE",
        reason: "请先运行 npm run solver:build",
      };
    if (
      input.ranges.some(
        (r) =>
          Object.values(r).filter((w) => w > 0).length >
          (input.schemaVersion === 3
            ? 16
            : input.schemaVersion === 4
              ? 128
              : 200),
      )
    )
      return {
        supported: false,
        code: "UNSUPPORTED_INPUT",
        reason: `当前模型上限为每方 ${input.schemaVersion === 3 ? 16 : input.schemaVersion === 4 ? 128 : 200} 个正权重组合；未删减输入`,
      };
    const path = join(
      this.store.directory,
      "real-preflight",
      `${spec.inputHash}.json`,
    );
    const bytes = this.store.getBytes(getFixed(s.artifacts, spec.input).hash);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
    demand(
      hash(readFileSync(path)) === spec.inputHash,
      "ARTIFACT_INCOMPLETE",
      "预检输入损坏",
    );
    const result = spawnSync(
      binary,
      [
        input.schemaVersion === 4
          ? "preflight-turn-page"
          : input.schemaVersion === 3
            ? "preflight-turn"
            : input.schemaVersion === 2
              ? "preflight-river-tree"
              : "preflight-river",
        path,
      ],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
      },
    );
    if (result.status !== 0)
      return {
        supported: false,
        code: "UNSUPPORTED_INPUT",
        reason:
          result.stderr?.trim() || result.error?.message || "原生预检失败",
      };
    const data = z
      .object({ ok: z.literal(true), estimatedBytes: z.number().nonnegative() })
      .parse(JSON.parse(result.stdout));
    return {
      supported: true,
      estimatedBytes: data.estimatedBytes,
      model: spec.scope,
      inputHash: spec.inputHash,
    };
  }
  followRanges(s: RuntimeState) {
    if (!s.real) return;
    for (const item of unique(s.real.cases)) {
      const ranges = item.ranges.map((r) => s.ranges[r.id]?.ref ?? r) as [
        Ref,
        Ref,
      ];
      if (ranges.some((r, p) => r.contentHash !== item.ranges[p].contentHash)) {
        const { ref: old, ...payload } = item;
        const next = { ...payload, ranges };
        save(s.real.cases, {
          ...next,
          ref: ref("real-case", next, old.id, old.version + 1),
        });
      }
    }
  }
  async executeAsync(name: RealTool, raw: unknown): Promise<Reply> {
    try {
      const parsed = realSchemas[name].safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.workspaceId !== this.store.state.workspaceId ||
        this.store.state.independent
      )
        return this.execute(name, raw);
      if (
        !realReadTools.has(name) &&
        this.store.state.receipts[`${name}:${parsed.data.requestId}`]
      )
        return this.execute(name, raw);
      if (name === "real_turn_solution_query") {
        const a = parsed.data as RealInputs["real_turn_solution_query"],
          solution = this.find(this.store.state, "solutions", a.solutionId);
        demand(
          solution.queryModel === "native-turn/3" ||
            solution.queryModel === "native-turn-paged/4",
          "UNSUPPORTED_INPUT",
          "此工具只读取转牌版本化路径",
        );
        const spec = getFixed(this.store.state.real!.specs, solution.spec),
          native = getFixed(this.store.state.artifacts, solution.native),
          summary = this.artifact<{ privateCards: [string[], string[]] }>(
            this.store.state,
            solution.summary,
          );
        const context = {
          bytes: this.store.getBytes(native.hash),
          nativeHash: native.hash,
          inputHash: spec.inputHash,
          counts: solution.handCounts,
          cards: summary.privateCards,
          board: this.input(this.store.state, spec).board,
        };
        if (solution.queryModel === "native-turn-paged/4") {
          const input = this.input(this.store.state, spec) as TurnInput;
          await this.turnPages.prepare(
            context,
            a.path,
            turnSelection(input, summary.privateCards, a).selection,
          );
        } else await this.turnNodes.prepare(context, a.path);
      }
      if (
        [
          "real_solution_query",
          "real_range_aggregate",
          "real_range_derive",
        ].includes(name)
      ) {
        const args = parsed.data as RealInputs["real_solution_query"];
        const solution = this.find(
          this.store.state,
          "solutions",
          args.solutionId,
        );
        if (solution.queryModel === "native-paged/2") {
          const spec = getFixed(this.store.state.real!.specs, solution.spec),
            native = getFixed(this.store.state.artifacts, solution.native);
          const summary = this.artifact<{ privateCards: [string[], string[]] }>(
            this.store.state,
            solution.summary,
          );
          await this.nativeNodes.prepare(
            {
              bytes: this.store.getBytes(native.hash),
              nativeHash: native.hash,
              inputHash: spec.inputHash,
              counts: solution.handCounts,
              cards: summary.privateCards,
            },
            args.path,
          );
        }
      }
      // Recheck current identity, permissions and revisions after the external reader returns.
      return this.execute(name, raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof RealFault
          ? error.code
          : ([
              "RESOURCE_LIMIT",
              "UNSUPPORTED_INPUT",
              "ARTIFACT_INCOMPLETE",
            ].find((c) => message.includes(c)) ?? "ARTIFACT_INCOMPLETE");
      return {
        ok: false,
        code,
        message,
        currentRevision: this.store.state.revision,
        retryable: code === "RESOURCE_LIMIT",
      };
    }
  }
  execute(name: RealTool, raw: unknown): Reply {
    try {
      const parsed = realSchemas[name].safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "真实工具输入无效",
          retryable: false,
          fieldErrors: parsed.error.issues,
        };
      const input = parsed.data;
      demand(
        input.workspaceId === this.store.state.workspaceId,
        "VALIDATION_ERROR",
        "工作区不匹配",
      );
      demand(
        !this.store.state.independent ||
          [
            "real_capabilities",
            "real_workspace_get",
            "real_analysis_get",
            "real_analysis_cancel",
          ].includes(name),
        "INFORMATION_RESTRICTED",
        "独立作答期间不可读取或生成分析证据，请先作答或登记辅助身份",
      );
      const write = !realReadTools.has(name),
        key = `${name}:${input.requestId ?? ""}`,
        payloadHash = hash(input),
        receipt = this.store.state.receipts[key];
      if (write) {
        demand(
          input.requestId && input.expectedRevision !== undefined,
          "VALIDATION_ERROR",
          "写操作需要 requestId 与 expectedRevision",
        );
        if (receipt) {
          demand(
            receipt.hash === payloadHash,
            "IDEMPOTENCY_CONFLICT",
            "同一请求标识的内容不同",
          );
          return receipt.reply;
        }
        demand(
          input.expectedRevision === this.store.state.revision,
          "REVISION_CONFLICT",
          "工作区已变化，请保留输入并读取新版本",
        );
      }
      const next = structuredClone(this.store.state),
        refs: Ref[] = [];
      const data = this.dispatch(next, name, raw, refs);
      const expose =
        [
          "real_solution_load",
          "real_solution_query",
          "real_turn_solution_query",
          "real_range_aggregate",
          "real_range_derive",
        ].includes(name) && !next.exposures.includes("real-analysis:possible");
      if (expose)
        next.exposures = [
          ...new Set([
            ...next.exposures,
            "real-analysis:possible",
            "backup:possible",
            ...presets.map((p) => `analysis:${p.id}`),
          ]),
        ];
      const changed = write || expose;
      const reply: Reply = {
        ok: true,
        contractVersion,
        workspaceId: next.workspaceId,
        requestId: input.requestId,
        revision: next.revision + (changed ? 1 : 0),
        artifactRefs: refs,
        data,
      };
      demand(
        Buffer.byteLength(JSON.stringify(reply)) <= 120000,
        "RESOURCE_LIMIT",
        "结果超过单页上限，请缩小分页",
      );
      if (changed) {
        if (write) next.receipts[key] = { hash: payloadHash, reply };
        next.changes.push({ sequence: next.revision + 1, tool: name, refs });
        this.store.commit(next);
      }
      if (name === "real_analysis_cancel")
        this.active?.jobId === (data as RealJob).ref.id
          ? this.active.run.cancel()
          : queueMicrotask(() => this.pump());
      if (name === "real_analysis_start" || name === "real_analysis_retry")
        queueMicrotask(() => this.pump());
      return reply;
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof RealFault
            ? error.code
            : error instanceof Error &&
                error.message.includes("ARTIFACT_INCOMPLETE")
              ? "ARTIFACT_INCOMPLETE"
              : "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : String(error),
        currentRevision: this.store.state.revision,
        retryable:
          error instanceof RealFault &&
          ["REVISION_CONFLICT", "RESOURCE_LIMIT"].includes(error.code),
      };
    }
  }
  private dispatch(
    s: RuntimeState,
    name: RealTool,
    raw: unknown,
    refs: Ref[],
  ): unknown {
    const parse = <K extends RealTool>(key: K) =>
      realSchemas[key].parse(raw) as RealInputs[K];
    const state = this.state(s);
    const returned = <T extends { ref: Ref }>(v: T) => {
      refs.push(v.ref);
      return v;
    };
    switch (name) {
      case "real_browse_save": {
        const a = parse(name),
          solution = getFixed(state.solutions, a.view.solution),
          turn =
            solution.queryModel === "native-turn/3" ||
            solution.queryModel === "native-turn-paged/4";
        demand(
          turn ? a.view.path.length === 0 : a.view.turnPath.length === 0,
          "VALIDATION_ERROR",
          "浏览路径模型不匹配",
        );
        demand(
          a.view.hand === "" ||
            handClasses.some((h) => h.label === a.view.hand),
          "VALIDATION_ERROR",
          "未知牌类",
        );
        normalizeCombo(a.view.hero);
        state.views ??= {};
        delete state.views[solution.ref.id];
        state.views[solution.ref.id] = a.view;
        while (Object.keys(state.views).length > 200)
          delete state.views[Object.keys(state.views)[0]];
        return a.view;
      }
      case "real_browse_get": {
        const solution = this.find(s, "solutions", parse(name).solutionId),
          view = state.views?.[solution.ref.id];
        return view && hash(view.solution) === hash(solution.ref) ? view : null;
      }
      case "real_capabilities":
        return this.capabilities();
      case "real_workspace_get":
        return {
          browse: s.independent
            ? undefined
            : Object.values(state.views ?? {})
                .reverse()
                .find((v) => {
                  const solution = state.solutions[v.solution.id],
                    spec = solution && getFixed(state.specs, solution.spec);
                  return (
                    !!solution &&
                    (!parse(name).caseId ||
                      spec.situation.id === parse(name).caseId)
                  );
                }),
          contract: realContract,
          revision: s.revision,
          restricted: !!s.independent,
          totalCases: unique(state.cases).length,
          selectedCase:
            s.independent || !parse(name).caseId
              ? undefined
              : Object.hasOwn(state.cases, parse(name).caseId!)
                ? state.cases[parse(name).caseId!]
                : undefined,
          selectedSolution:
            s.independent || !parse(name).solutionId
              ? undefined
              : Object.hasOwn(state.solutions, parse(name).solutionId!)
                ? state.solutions[parse(name).solutionId!].ref
                : undefined,
          cases: s.independent ? [] : unique(state.cases).slice(-10),
          specs: s.independent ? [] : unique(state.specs).slice(-10),
          jobs: unique(state.jobs)
            .slice(-10)
            .map((j) => (s.independent ? { ref: j.ref, status: j.status } : j)),
          solutions: s.independent
            ? []
            : unique(state.solutions)
                .slice(-10)
                .map(({ ref, spec, quality, iterations }) => ({
                  ref,
                  spec,
                  quality,
                  iterations,
                })),
        };
      case "real_case_create": {
        const a = parse(name),
          ranges = a.ranges.map((weights, p) => {
            const normalized: Record<string, number> = {};
            for (const [combo, value] of Object.entries(weights)) {
              const c = normalizeCombo(combo);
              demand(
                !Object.hasOwn(normalized, c),
                "VALIDATION_ERROR",
                "重复的等价组合",
              );
              normalized[c] = value;
            }
            const payload = {
              playerId: p === 0 ? "OOP" : "IP",
              weights: normalized,
            };
            const r: RangeRecord = {
              ...payload,
              ref: ref("range", payload),
              origin: "input",
              history: [],
              future: [],
              protected: [],
            };
            s.ranges[r.ref.id] = r;
            return r.ref;
          }) as [Ref, Ref];
        const payload = {
          name: a.name,
          board: a.board,
          pot: a.pot,
          stack: a.stack,
          betPercent: a.betPercent,
          ...(a.tree ? { tree: a.tree } : {}),
          ...(a.turn ? { turn: a.turn } : {}),
          ranges,
        };
        demand(
          a.turn ? a.board.length === 4 && !a.tree : a.board.length === 5,
          "UNSUPPORTED_INPUT",
          "转牌需使用转牌模型与四张公共牌，河牌需五张",
        );
        const c = { ...payload, ref: ref("real-case", payload) };
        state.cases[c.ref.id] = c;
        return returned(c);
      }
      case "real_case_revise": {
        const a = parse(name),
          old = this.find(s, "cases", a.caseId),
          { ref: previous, ...payload } = old;
        demand(
          state.cases[previous.id].ref.contentHash === previous.contentHash,
          "REVISION_CONFLICT",
          "局面版本已更新，保留输入并从新版本修订",
        );
        const next = {
          ...payload,
          ...Object.fromEntries(
            Object.entries(a).filter(
              ([k, v]) =>
                ["name", "board", "pot", "stack", "betPercent"].includes(k) &&
                v !== undefined,
            ),
          ),
        };
        if (a.tree === null) delete next.tree;
        else if (a.tree) next.tree = a.tree;
        if (a.turn === null) delete next.turn;
        else if (a.turn) next.turn = a.turn;
        demand(
          next.turn
            ? next.board.length === 4 && !next.tree
            : next.board.length === 5,
          "UNSUPPORTED_INPUT",
          "公共牌数量与模型不匹配",
        );
        demand(
          !(a.rangeIds && a.ranges),
          "VALIDATION_ERROR",
          "不能同时指定范围引用和范围内容",
        );
        if (a.ranges)
          next.ranges = a.ranges.map((weights, p) => {
            const previousRange = getFixed(s.ranges, old.ranges[p]),
              normalized: Record<string, number> = {};
            for (const [combo, value] of Object.entries(weights)) {
              const c = normalizeCombo(combo);
              demand(
                !Object.hasOwn(normalized, c),
                "VALIDATION_ERROR",
                "重复等价组合",
              );
              normalized[c] = value;
            }
            demand(
              previousRange.protected.every(
                (c) => (normalized[c] ?? 0) === (previousRange.weights[c] ?? 0),
              ),
              "VALIDATION_ERROR",
              "范围包含受保护组合，请先通过范围工具解除保护",
            );
            if (hash(normalized) === hash(previousRange.weights))
              return previousRange.ref;
            const r = structuredClone(previousRange);
            r.history.push(r.weights);
            r.future = [];
            r.weights = normalized;
            r.origin = "user-hypothesis";
            r.source ??= {
              range: previousRange.ref,
              nodeId: "user",
              action: "edit",
              model: "hypothesis",
            };
            r.ref = ref("range", r, r.ref.id, r.ref.version + 1);
            save(s.ranges, r);
            return r.ref;
          }) as [Ref, Ref];
        if (a.rangeIds)
          next.ranges = a.rangeIds.map((id, p) => {
            const r = s.ranges[id];
            demand(
              r && r.playerId === (p === 0 ? "OOP" : "IP"),
              "VALIDATION_ERROR",
              "范围玩家不匹配",
            );
            return r.ref;
          }) as [Ref, Ref];
        const c = {
          ...next,
          ref: ref("real-case", next, previous.id, previous.version + 1),
        };
        save(state.cases, c);
        return returned(c);
      }
      case "real_spec_create": {
        const a = parse(name),
          c = this.find(s, "cases", a.caseId),
          ranges = c.ranges.map((r) => getFixed(s.ranges, r));
        const commonInput = {
          caseId: c.ref.id,
          board: c.board,
          pot: c.pot,
          stack: c.stack,
          ranges: ranges.map((r) =>
            Object.fromEntries(
              Object.entries(r.weights).map(([k, v]) => [k, v / 10000]),
            ),
          ),
          limits: {
            maxIterations: a.maxIterations,
            targetExploitability: (c.pot * a.targetNashConvPotFraction) / 2,
            maxMemoryBytes: 268435456,
            maxSeconds: 120,
          },
          locks: [],
        };
        const input = c.turn
          ? turnInputSchema.parse({
              ...commonInput,
              schemaVersion: c.turn.kind === "hu-turn/4" ? 4 : 3,
              turnBets: c.turn.turnBets,
              riverBets: c.turn.riverBets,
            })
          : c.tree
            ? explicitRiverSchema.parse({
                ...commonInput,
                schemaVersion: 2,
                treeLines: c.tree.lines,
              })
            : riverInputSchema.parse({
                ...commonInput,
                schemaVersion: 1,
                sizes: [
                  [`${c.betPercent}%`, ""],
                  ["", ""],
                ],
              });
        const bytes = Buffer.from(JSON.stringify(input)),
          inputRef = this.put(s, bytes),
          payload = {
            situation: c.ref,
            ranges: c.ranges,
            input: inputRef,
            inputHash: hash(bytes),
            treeHash: caseTreeHash(c),
            targetNashConvPotFraction: a.targetNashConvPotFraction,
            engineCommit,
            algorithm: "upstream-dcfr-gamma3-v1",
            scope: c.turn
              ? ("given-range-turn-subgame" as const)
              : ("given-range-river-subgame" as const),
            operation: "solve-equilibrium" as const,
            valueModel: c.turn
              ? ("exact-turn-river-runouts" as const)
              : ("exact-river-terminal" as const),
            constraints: { kind: "none" as const },
            tableFormat: "HU" as const,
            backgroundPlayers: 2 as const,
            activePlayers: 2 as const,
            solvingPlayers: 2 as const,
          };
        const spec = { ...payload, ref: ref("real-spec", payload) };
        state.specs[spec.ref.id] = spec;
        refs.push(inputRef);
        return returned(spec);
      }
      case "real_preflight":
        return this.preflight(s, this.find(s, "specs", parse(name).specId));
      case "real_analysis_start":
        return returned(
          this.newJob(s, this.find(s, "specs", parse(name).specId), 1),
        );
      case "real_analysis_retry": {
        const old = this.find(s, "jobs", parse(name).jobId);
        demand(
          ["failed", "interrupted", "cancelled"].includes(old.status),
          "VALIDATION_ERROR",
          "只能重试失败、中断或已取消作业",
        );
        return returned(
          this.newJob(s, getFixed(state.specs, old.spec), old.attempt + 1),
        );
      }
      case "real_analysis_get":
        return this.find(s, "jobs", parse(name).jobId);
      case "real_analysis_cancel": {
        const j = this.find(s, "jobs", parse(name).jobId);
        demand(!terminal.has(j.status), "TOO_LATE", "作业已结束，保留原结果");
        j.status =
          this.active?.jobId === j.ref.id ? "cancel_requested" : "cancelled";
        j.events.push({ status: j.status, at: new Date().toISOString() });
        return returned(j);
      }
      case "real_solution_load": {
        const solution = this.find(s, "solutions", parse(name).solutionId);
        for (const r of [
          solution.native,
          solution.summary,
          ...solution.nodes.map((n) => n.artifact),
        ])
          this.store.getBytes(getFixed(s.artifacts, r).hash);
        return returned(solution);
      }
      case "real_solution_query": {
        const a = parse(name),
          v = this.view(s, a.solutionId, a.path, a.player);
        let rows = v.rows;
        if (a.combos)
          rows = a.combos.map((c) => {
            const canonical = normalizeCombo(c);
            return v.rows.find((row) => row.combo === canonical)!;
          });
        if (a.hand) rows = rows.filter((r) => r.hand === a.hand);
        if (a.inRangeOnly) rows = rows.filter((r) => r.inputWeight > 0);
        return {
          solution: v.solution.ref,
          node: v.node,
          definition: v.solution.metricDefinition,
          player: a.player,
          playerRole: a.player === 0 ? "OOP" : "IP",
          total: rows.length,
          items: rows
            .slice(a.offset, a.offset + a.limit)
            .map(({ index: _, ...row }) => row),
          nextOffset:
            a.offset + a.limit < rows.length ? a.offset + a.limit : null,
        };
      }
      case "real_turn_solution_query": {
        const a = parse(name);
        const solution = this.find(s, "solutions", a.solutionId);
        if (solution.queryModel === "native-turn-paged/4") {
          const spec = getFixed(s.real!.specs, solution.spec),
            input = this.input(s, spec) as TurnInput,
            summary = this.artifact<{ privateCards: [string[], string[]] }>(
              s,
              solution.summary,
            ),
            selection = turnSelection(input, summary.privateCards, a),
            page = this.turnPages.get(
              {
                nativeHash: getFixed(s.artifacts, solution.native).hash,
                inputHash: spec.inputHash,
              },
              a.path,
              selection.selection,
            );
          demand(page, "ARTIFACT_INCOMPLETE", "请通过异步查询读取转牌节点页");
          return projectTurnPage(solution, input, a, selection, page!);
        }
        const v = this.view(s, a.solutionId, [], a.player, a.path);
        let rows = v.rows;
        if (a.combos)
          rows = a.combos.map(
            (c) => v.rows.find((r) => r.combo === normalizeCombo(c))!,
          );
        if (a.hand) rows = rows.filter((r) => r.hand === a.hand);
        if (a.inRangeOnly) rows = rows.filter((r) => r.inputWeight > 0);
        return {
          solution: v.solution.ref,
          node: v.node,
          definition: v.solution.metricDefinition,
          player: a.player,
          total: rows.length,
          items: rows
            .slice(a.offset, a.offset + a.limit)
            .map(({ index: _, ...r }) => r),
          nextOffset:
            a.offset + a.limit < rows.length ? a.offset + a.limit : null,
          aggregate: aggregateRows(
            v.rows,
            v.mass,
            v.node.actions,
            v.node.actor,
            a.player,
          ),
        };
      }
      case "real_range_aggregate": {
        const a = parse(name),
          v = this.view(s, a.solutionId, a.path, a.player);
        return {
          solution: v.solution.ref,
          node: v.node,
          distribution: v.solution.metricDefinition.distribution,
          player: a.player,
          playerRole: a.player === 0 ? "OOP" : "IP",
          denominator: v.mass,
          frequencies: v.node.actions.map((action, index) => ({
            action,
            frequency:
              v.mass > 0 && v.node.actor === a.player
                ? v.rows.reduce(
                    (sum, r) =>
                      sum + r.compatibleMass * (r.allocation?.[index] ?? 0),
                    0,
                  ) / v.mass
                : null,
          })),
          classes: handClasses.map((h) => ({
            hand: h.label,
            probability:
              v.mass > 0
                ? v.rows
                    .filter((r) => r.hand === h.label)
                    .reduce((sum, r) => sum + r.compatibleMass, 0) / v.mass
                : null,
          })),
        };
      }
      case "real_range_derive": {
        const a = parse(name),
          solution = this.find(s, "solutions", a.solutionId),
          spec = getFixed(state.specs, solution.spec),
          page = this.rawNode(s, solution, a.path);
        demand(
          !page.terminal &&
            page.player !== null &&
            a.action < page.actions.length,
          "UNSUPPORTED_INPUT",
          "路径不是可派生的决策节点",
        );
        const p = page.player!,
          v = this.view(s, a.solutionId, a.path, p),
          source = {
            range: spec.ranges[p],
            solution: solution.ref,
            nodeId: JSON.stringify(a.path),
            path: a.path.map(String),
            action: page.actions[a.action],
            model: "own-action-reach-from-fixed-engine-strategy",
          };
        demand(
          v.rows.every((r) => r.ownReachWeight === 0 || r.allocation !== null),
          "UNAVAILABLE_METRIC",
          "存在未定义策略的正权重组合，未将缺失策略填成零",
        );
        const weights = Object.fromEntries(
          v.rows
            .filter((r) => r.index !== null)
            .map((r) => [
              r.combo,
              r.ownReachWeight * (r.allocation?.[a.action] ?? 0) * 10000,
            ]),
        );
        const payload = { playerId: p === 0 ? "OOP" : "IP", weights, source };
        const record: RangeRecord = {
          ...payload,
          ref: ref("range", payload),
          origin: "derived",
          history: [],
          future: [],
          protected: [],
        };
        s.ranges[record.ref.id] = record;
        return returned(recordSummary(record));
      }
    }
  }
  private newJob(s: RuntimeState, spec: RealSpec, attempt: number) {
    const check = this.preflight(s, spec);
    demand(
      check.supported,
      "code" in check ? String(check.code) : "UNSUPPORTED_INPUT",
      "reason" in check ? String(check.reason) : "未支持",
    );
    const state = this.state(s);
    demand(
      Object.values(state.jobs).filter((j) => !terminal.has(j.status)).length <
        4,
      "RESOURCE_LIMIT",
      "真实作业队列已满",
    );
    const payload = { spec: spec.ref, attempt };
    const job: RealJob = {
      ref: ref("real-job", payload),
      ...payload,
      status: "queued",
      events: [{ status: "queued", at: new Date().toISOString() }],
      iterations: 0,
      exploitabilityBb: null,
    };
    state.jobs[job.ref.id] = job;
    return job;
  }
  private rawNode(
    s: RuntimeState,
    solution: RealSolution,
    path: number[],
  ): NativeNode {
    demand(
      solution.queryModel !== "native-turn/3" &&
        solution.queryModel !== "native-turn-paged/4",
      "UNSUPPORTED_INPUT",
      "转牌解须使用 real_turn_solution_query 的行动/发牌路径",
    );
    if (solution.queryModel === "native-paged/2") {
      const spec = getFixed(this.state(s).specs, solution.spec),
        native = getFixed(s.artifacts, solution.native);
      const node = this.nativeNodes.get(
        { nativeHash: native.hash, inputHash: spec.inputHash },
        path,
      );
      demand(
        node,
        "NATIVE_QUERY_REQUIRED",
        "原生节点尚未准备，请通过异步应用入口读取",
      );
      return node!;
    }
    const page = solution.nodes.find(
      (n) => JSON.stringify(n.path) === JSON.stringify(path),
    );
    demand(page, "UNSUPPORTED_INPUT", "该路径不在固定树中");
    return validateNode(this.artifact(s, page!.artifact), solution.handCounts);
  }
  private view(
    s: RuntimeState,
    id: string,
    path: number[],
    player: 0 | 1,
    turnPath?: TurnPath,
  ) {
    const solution = this.find(s, "solutions", id),
      spec = getFixed(this.state(s).specs, solution.spec),
      input = this.input(s, spec),
      turnNode =
        solution.queryModel === "native-turn/3" && turnPath !== undefined
          ? this.turnNodes.get(
              {
                nativeHash: getFixed(s.artifacts, solution.native).hash,
                inputHash: spec.inputHash,
              },
              turnPath,
            )
          : undefined,
      page = turnNode
        ? { ...turnNode, path: [] }
        : this.rawNode(s, solution, path),
      summary = this.artifact<{ privateCards: [string[], string[]] }>(
        s,
        solution.summary,
      ),
      cards = summary.privateCards[player].map(normalizeCombo),
      indices = new Map(cards.map((c, i) => [c, i]));
    const mass = page.compatibleWeights[player].reduce((sum, w) => sum + w, 0);
    const rows = allCombos.map((combo) => {
      const i = indices.get(combo),
        dead = !legalCombo(combo, turnNode?.board ?? input.board),
        weight = i === undefined ? 0 : page.weights[player][i],
        compatible = i === undefined ? 0 : page.compatibleWeights[player][i],
        reachable = !dead && i !== undefined && weight > 0 && compatible > 0;
      return {
        combo,
        hand: handByCombo[combo],
        index: i ?? null,
        dead,
        inputWeight: input.ranges[player][combo] ?? 0,
        ownReachWeight: weight,
        compatibleMass: compatible,
        conditionalProbability: mass > 0 ? compatible / mass : null,
        availability: dead
          ? "dead"
          : i === undefined
            ? "outside-input-range"
            : !reachable
              ? "unreachable"
              : "available",
        allocation:
          reachable && page.player === player
            ? page.actions.map((_, a) => page.strategy[a * cards.length + i!])
            : null,
        equity: reachable ? page.equity[player][i!] : null,
        evBb: reachable ? page.ev[player][i!] / 100 : null,
        actionEvBb:
          reachable && page.player === player
            ? page.actions.map(
                (_, a) => page.actionEv[a * cards.length + i!] / 100,
              )
            : null,
      };
    });
    const returned =
      page.terminal && page.invested[0] !== page.invested[1]
        ? [
            Math.max(0, page.invested[0] - page.invested[1]),
            Math.max(0, page.invested[1] - page.invested[0]),
          ]
        : [0, 0];
    return {
      solution,
      rows,
      mass,
      node: {
        path: turnPath ?? path,
        ...(turnNode
          ? { kind: turnNode.kind, chanceCards: turnNode.chanceCards }
          : {}),
        terminal: page.terminal,
        actor: page.player,
        actions: page.actions,
        board: turnNode?.board ?? input.board,
        potBb:
          (input.pot +
            page.invested[0] +
            page.invested[1] -
            returned[0] -
            returned[1]) /
          100,
        investedBb: page.invested.map((v) => v / 100),
        returnedBb: returned.map((v) => v / 100),
      },
    };
  }
  private pump() {
    if (this.stopped || this.active || !this.store.state.real) return;
    const next = structuredClone(this.store.state),
      state = this.state(next);
    for (const j of Object.values(state.jobs))
      if (j.status === "cancel_requested") {
        j.status = "cancelled";
        j.events.push({ status: "cancelled", at: new Date().toISOString() });
      }
    const job = Object.values(state.jobs).find((j) => j.status === "queued");
    if (!job) {
      if (JSON.stringify(next.real) !== JSON.stringify(this.store.state.real))
        this.store.commit(next);
      return;
    }
    job.status = "running";
    job.events.push({ status: job.status, at: new Date().toISOString() });
    this.store.commit(next);
    try {
      const spec = getFixed(state.specs, job.spec),
        input = this.input(next, spec),
        directory = join(this.store.directory, "real-jobs", job.ref.id);
      const run = startEngine(input, {
        directory,
        jobId: job.ref.id,
        attempt: job.attempt,
        onEvent: (event) => {
          if (this.stopped || event.kind !== "progress") return;
          const progress = structuredClone(this.store.state),
            j = progress.real?.jobs[job.ref.id];
          if (!j || terminal.has(j.status)) return;
          j.iterations = Number(event.payload.iterations);
          j.exploitabilityBb = Number(event.payload.exploitability) / 100;
          this.store.commit(progress);
        },
      });
      this.active = { jobId: job.ref.id, run };
      void run.result
        .then((result) => {
          if (this.stopped) return;
          const updated = structuredClone(this.store.state),
            j = updated.real!.jobs[job.ref.id];
          try {
            j.binaryHash = result.binaryHash;
            j.cancelLatencyMs = result.cancelLatencyMs;
            if (result.status !== "completed") {
              j.status = result.status;
              j.error = result.error;
            } else if (j.status === "cancel_requested") {
              j.status = "cancelled";
            } else {
              j.status = "postprocessing";
              j.events.push({ status: j.status, at: new Date().toISOString() });
              const report = JSON.parse(
                readFileSync(result.summary!.path, "utf8"),
              ) as {
                privateCards: [string[], string[]];
                iterations: number;
                exploitability: number;
                stopReason: string;
                algorithm: string;
                input: SolverInput;
              };
              demand(
                report.input.locks.length === 0 &&
                  report.algorithm === spec.algorithm,
                "ARTIFACT_INCOMPLETE",
                "不支持的锁定或算法结果",
              );
              const native = this.put(
                  updated,
                  readFileSync(result.native!.path),
                  "application/x-riverline-native",
                ),
                summary = this.put(updated, readFileSync(result.summary!.path));
              const nodes = (result.nodes ?? []).map((n) => {
                const bytes = readFileSync(n.path);
                const page = validateNode(
                  JSON.parse(bytes.toString()),
                  report.privateCards.map((c) => c.length) as [number, number],
                );
                demand(
                  JSON.stringify(page.path) === JSON.stringify(n.history),
                  "ARTIFACT_INCOMPLETE",
                  "节点路径不匹配",
                );
                return { path: n.history, artifact: this.put(updated, bytes) };
              });
              const payload: Omit<RealSolution, "ref"> = {
                spec: spec.ref,
                dataKind: "engine-computed",
                execution: "completed",
                coverage: "complete-supported-model",
                availability: "available",
                quality:
                  report.stopReason === "quality-target"
                    ? "target-met"
                    : "budget-exhausted",
                exploitabilityBb: report.exploitability / 100,
                nashConvBb: (2 * report.exploitability) / 100,
                iterations: report.iterations,
                stopReason: report.stopReason,
                engineCommit,
                algorithm: report.algorithm,
                binaryHash: result.binaryHash,
                native,
                summary,
                nodes,
                ...(report.input.schemaVersion === 4
                  ? { queryModel: "native-turn-paged/4" as const }
                  : report.input.schemaVersion === 3
                    ? { queryModel: "native-turn/3" as const }
                    : report.input.schemaVersion === 2
                      ? { queryModel: "native-paged/2" as const }
                      : {}),
                handCounts: report.privateCards.map((c) => c.length) as [
                  number,
                  number,
                ],
                metricDefinition: {
                  unit: "bb",
                  origin: "current-node",
                  invested: "sunk",
                  uncalledRefund: "included-in-terminal-ev",
                  rake: "none",
                  distribution: "compatible-joint-weights-conditioned-on-path",
                  quality:
                    "unraked-nashconv-equals-two-times-native-exploitability",
                },
              };
              const solution = {
                ...payload,
                ref: ref("real-solution", payload),
              };
              demand(
                result.identity.specHash === spec.inputHash,
                "ARTIFACT_INCOMPLETE",
                "运行输入与固定规格指纹不一致",
              );
              const candidate = {
                ...updated,
                real: {
                  ...updated.real!,
                  specs: { [spec.ref.id]: spec },
                  solutions: { [solution.ref.id]: solution },
                },
              };
              validateRealArtifacts(candidate, (r) =>
                this.store.getBytes(getFixed(updated.artifacts, r).hash),
              );
              updated.real!.solutions[solution.ref.id] = solution;
              j.result = solution.ref;
              j.iterations = report.iterations;
              j.exploitabilityBb = report.exploitability / 100;
              j.status = "completed";
            }
          } catch (error) {
            j.status = "failed";
            j.error = String(error);
            delete j.result;
          }
          j.events.push({ status: j.status, at: new Date().toISOString() });
          this.store.commit(updated);
        })
        .finally(() => {
          this.active = undefined;
          if (!this.stopped) queueMicrotask(() => this.pump());
        });
    } catch (error) {
      const failed = structuredClone(this.store.state),
        j = failed.real!.jobs[job.ref.id];
      j.status = "failed";
      j.error = String(error);
      j.events.push({ status: j.status, at: new Date().toISOString() });
      this.store.commit(failed);
      queueMicrotask(() => this.pump());
    }
  }
}
function recordSummary(record: RangeRecord) {
  const { weights, history, future, ...summary } = record;
  return {
    ...summary,
    positiveCombos: Object.values(weights).filter((w) => w > 0).length,
  };
}
