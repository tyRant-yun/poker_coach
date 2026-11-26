import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { DiskStore, hash } from "../store.ts";
import type { GameService } from "./service.ts";
import type { RealAnalysisService } from "../analysis/real-service.ts";
import type {
  RealJob,
  RealCase,
  RealSpec,
  RealSolution,
  RealTool,
} from "../../src/modules/analysis/real-domain.ts";
import {
  autoConfiguration,
  nodeFacts,
  actionIndex,
} from "../../src/modules/play/review.ts";
import type {
  RangeProfile,
  ReviewInput,
  ReviewNode,
  ReviewReport,
} from "../../src/modules/play/review.ts";
import { handByCombo, presets } from "../../src/modules/analysis/content.ts";

type Query = {
  node: { actor: number | null; actions: string[] };
  items: {
    availability: string;
    equity: number | null;
    evBb: number | null;
    actionEvBb: number[] | null;
    allocation: number[] | null;
  }[];
};
export class AutoReviewService {
  private db: DatabaseSync;
  private stopped = false;
  private active?: { handId: string; token: string; jobId?: string };
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private store: DiskStore,
    private game: GameService,
    private real: RealAnalysisService,
  ) {
    this.db = new DatabaseSync(join(store.directory, "hands.sqlite"));
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS auto_reports(handId TEXT PRIMARY KEY, document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS auto_receipts(id TEXT PRIMARY KEY, hash TEXT NOT NULL, document TEXT NOT NULL)",
    );
    for (const row of this.db
      .prepare("SELECT document FROM auto_reports")
      .all() as { document: string }[]) {
      const report = JSON.parse(row.document) as ReviewReport;
      if (report.status === "running") {
        report.status = "interrupted";
        for (const n of report.nodes)
          if (n.status === "running" || n.status === "queued") {
            n.status = "failed";
            n.reason = "运行时已重启，可按相同参考重试。";
          }
        this.save(report);
      }
    }
    this.timer = setInterval(() => void this.pump(), 250);
    this.timer.unref();
  }
  private read(handId: string): ReviewReport | undefined {
    const row = this.db
      .prepare("SELECT document FROM auto_reports WHERE handId=?")
      .get(handId) as { document: string } | undefined;
    return row ? JSON.parse(row.document) : undefined;
  }
  private save(report: ReviewReport) {
    report.updated = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO auto_reports VALUES(?,?) ON CONFLICT(handId) DO UPDATE SET document=excluded.document",
      )
      .run(report.handId, JSON.stringify(report));
  }
  enqueue(handId: string, profile: RangeProfile = "standard", force = false) {
    const existing = this.read(handId);
    if (existing && !force) return existing;
    if (force && this.active?.handId === handId) this.cancel(handId);
    const pending = this.db
      .prepare(
        "SELECT count(*) AS n FROM auto_reports WHERE json_extract(document,'$.status')='queued'",
      )
      .get() as { n: number };
    if (pending.n >= 4) throw Error("自动报告队列已满，请先等待或取消其他报告");
    const report: ReviewReport = {
      version: "auto-review/1",
      handId,
      handHash: "",
      profile,
      status: "queued",
      updated: "",
      nodes: [],
    };
    this.save(report);
    return report;
  }
  private async invoke<T>(
    tool: RealTool,
    input: Record<string, unknown>,
  ): Promise<T> {
    if (this.stopped) throw Error("报告运行器已停止");
    const reply = await this.real.executeAsync(
      tool,
      {
        workspaceId: this.store.state.workspaceId,
        expectedRevision: this.store.state.revision,
        requestId: randomUUID(),
        ...input,
      },
      false,
    );
    if (!reply.ok) throw Error(`${reply.code}: ${reply.message}`);
    return reply.data as T;
  }
  private cancelled(token: string) {
    return (
      this.stopped ||
      this.active?.token !== token ||
      this.read(this.active.handId)?.status === "cancelled"
    );
  }
  cancel(handId: string) {
    const report = this.read(handId);
    if (!report) throw Error("报告不存在");
    if (this.active?.handId === handId && this.active.jobId) {
      this.real.execute(
        "real_analysis_cancel",
        {
          workspaceId: this.store.state.workspaceId,
          expectedRevision: this.store.state.revision,
          requestId: randomUUID(),
          jobId: this.active.jobId,
        },
        false,
      );
    }
    report.status = "cancelled";
    if (this.active?.handId === handId) this.active.token = randomUUID();
    report.nodes.forEach((n) => {
      if (["queued", "running"].includes(n.status)) {
        n.status = "cancelled";
        n.reason = "已取消自动分析";
      }
    });
    this.save(report);
    return report;
  }
  async execute(
    name: string,
    input: {
      handId: string;
      requestId?: string;
      expectedRevision?: number;
      profile?: RangeProfile;
      decision?: number;
    },
  ) {
    if (this.game.restricted() || this.store.state.independent)
      throw Error("INFORMATION_RESTRICTED: 完成当前整手或独立题后再查看报告");
    if (name === "game_review_report") {
      // Validate completion even before an old hand's derived cache exists.
      const hand = await this.game.execute("game_get", {
        workspaceId: this.store.state.workspaceId,
        handId: input.handId,
      });
      if (!hand.ok || !(hand.data as { complete: boolean }).complete)
        throw Error("INFORMATION_RESTRICTED: 本手尚未完成");
      const report = this.read(input.handId) ?? this.enqueue(input.handId);
      let invalidated = false;
      for (const node of report.nodes)
        if (
          node.solutionId &&
          !this.store.state.real?.solutions[node.solutionId]
        ) {
          node.status = "failed";
          node.reason = "当前研究工作区未包含原固定解，请重新分析。";
          delete node.actions;
          delete node.gapBb;
          delete node.equity;
          delete node.nodeEvBb;
          delete node.solutionId;
          delete node.caseId;
          invalidated = true;
        }
      if (invalidated) this.save(report);
      if (
        report.nodes.some((n) => n.actions) &&
        !this.store.state.exposures.includes("real-analysis:possible")
      ) {
        const next = structuredClone(this.store.state);
        next.exposures = [
          ...new Set([
            ...next.exposures,
            "real-analysis:possible",
            "backup:possible",
            ...presets.map((p) => `analysis:${p.id}`),
          ]),
        ];
        this.store.commit(next);
      }
      return report;
    }
    const key = `${name}:${input.requestId}`,
      fingerprint = hash(input);
    const receipt = this.db
      .prepare("SELECT hash,document FROM auto_receipts WHERE id=?")
      .get(key) as { hash: string; document: string } | undefined;
    if (receipt) {
      if (receipt.hash !== fingerprint) throw Error("同一请求标识内容不同");
      return JSON.parse(receipt.document);
    }
    if (input.expectedRevision !== this.store.state.revision)
      throw Error("REVISION_CONFLICT: 工作区已变化，请重试");
    let result: unknown;
    if (name === "game_review_retry") {
      const r = await this.game.execute("game_get", {
        workspaceId: this.store.state.workspaceId,
        handId: input.handId,
      });
      if (!r.ok || !(r.data as { complete: boolean }).complete)
        throw Error("本手尚未完成");
      result = this.enqueue(input.handId, input.profile, true);
    } else if (name === "game_review_cancel")
      result = this.cancel(input.handId);
    else {
      const report = this.read(input.handId),
        node = report?.nodes.find((n) => n.sequence === input.decision);
      if (!node?.solutionId || !node.caseId)
        throw Error("该节点尚无可打开的真实解");
      const call = async <T>(
        tool: "game_research" | "game_study_link",
        fields: Record<string, unknown>,
      ) => {
        const r = await this.game.execute(tool, {
          workspaceId: this.store.state.workspaceId,
          expectedRevision: this.store.state.revision,
          requestId: randomUUID(),
          ...fields,
        });
        if (!r.ok) throw Error(r.message);
        return r.data as T;
      };
      const source = await call<{ id: string }>("game_research", {
        handId: input.handId,
        decision: input.decision,
      });
      await call("game_study_link", {
        studyId: source.id,
        caseId: node.caseId,
      });
      const inputs = await this.game.reviewInputs(input.handId),
        chosen = inputs.find((i) => i.sequence === input.decision)!;
      await this.invoke("real_browse_save", {
        view: {
          solution: this.store.state.real!.solutions[node.solutionId].ref,
          path: node.path ?? [],
          turnPath: node.turnPath ?? [],
          labels: [],
          player: node.player,
          hand: "",
          hero: chosen.snapshot.heroCards.join(""),
          metric: "ev",
          showAll: false,
          offset: 0,
        },
      });
      result = {
        sourceId: source.id,
        caseId: node.caseId,
        solutionId: node.solutionId,
      };
    }
    if (this.game.restricted() || this.store.state.independent)
      throw Error("INFORMATION_RESTRICTED: 当前作答期间禁止读取报告");
    this.db
      .prepare("INSERT INTO auto_receipts VALUES(?,?,?)")
      .run(key, fingerprint, JSON.stringify(result));
    return result;
  }
  private async analyze(
    input: ReviewInput,
    node: ReviewNode,
    report: ReviewReport,
    token: string,
  ) {
    const config = autoConfiguration(input, report.profile);
    while (
      !this.cancelled(token) &&
      (this.real.busy() ||
        Object.values(this.store.state.real?.jobs ?? {}).some(
          (j) => j.status === "queued",
        ))
    )
      await wait(100);
    if (this.cancelled(token)) return;
    const start = performance.now();
    const c = await this.invoke<RealCase>("real_case_create", config.config);
    if (this.cancelled(token)) return;
    node.caseId = c.ref.id;
    node.player = config.hero;
    node.rangeClasses = config.ranges.map((r) => [
      ...new Set(Object.keys(r).map((c) => handByCombo[c])),
    ]) as [string[], string[]];
    node.rangeCounts = config.ranges.map((r) => Object.keys(r).length) as [
      number,
      number,
    ];
    const spec = await this.invoke<RealSpec>("real_spec_create", {
      caseId: c.ref.id,
      maxIterations: 5000,
      maxSeconds: 8,
    });
    if (this.cancelled(token)) return;
    const job = await this.invoke<RealJob>("real_analysis_start", {
      specId: spec.ref.id,
    });
    if (this.cancelled(token)) {
      if (!this.stopped)
        await this.invoke("real_analysis_cancel", { jobId: job.ref.id });
      return;
    }
    node.jobId = job.ref.id;
    this.active!.jobId = job.ref.id;
    node.status = "running";
    node.reason = "正在计算自动参考范围下的局部策略";
    this.save(report);
    let current = job;
    while (
      !this.cancelled(token) &&
      !["completed", "cancelled", "failed", "interrupted"].includes(
        current.status,
      )
    ) {
      await wait(100);
      current = await this.invoke<RealJob>("real_analysis_get", {
        jobId: job.ref.id,
      });
    }
    if (this.cancelled(token)) return;
    if (!current.result) throw Error(current.error ?? `作业${current.status}`);
    const solution = this.store.state.real!.solutions[
      current.result.id
    ] as RealSolution;
    node.solutionId = solution.ref.id;
    node.quality = solution.quality;
    const isTurn = input.root.board.length === 4,
      path: number[] = [],
      turnPath: { kind: "action"; index: number }[] = [];
    const query = () =>
      this.invoke<Query>(
        isTurn ? "real_turn_solution_query" : "real_solution_query",
        {
          solutionId: solution.ref.id,
          path: isTurn ? turnPath : path,
          player: config.hero,
          combos: [input.snapshot.heroCards.join("")],
          inRangeOnly: false,
        },
      );
    let q = await query();
    for (const action of config.path) {
      const index = actionIndex(q.node.actions, action);
      if (index < 0) throw Error("真实历史行动不在受限树内，不做近似评价");
      if (isTurn) turnPath.push({ kind: "action", index });
      else path.push(index);
      q = await query();
    }
    node.path = path;
    node.turnPath = turnPath;
    const row = q.items[0];
    if (
      q.node.actor !== config.hero ||
      row?.availability !== "available" ||
      !row.actionEvBb ||
      !row.allocation
    )
      throw Error("该Hero组合在参考策略路径不可达，不能补填EV");
    node.actions = q.node.actions.map((action, i) => ({
      action,
      evBb: row.actionEvBb![i],
      frequency: row.allocation![i],
    }));
    const chosenIndex = actionIndex(q.node.actions, input.chosen);
    if (chosenIndex < 0)
      throw Error("原始下注尺寸未精确进入行动树，不做近似评价");
    node.chosenIndex = chosenIndex;
    node.equity = row.equity ?? undefined;
    node.nodeEvBb = row.evBb ?? undefined;
    if (solution.quality === "target-met")
      node.gapBb = Math.max(
        0,
        Math.max(...row.actionEvBb) - row.actionEvBb[chosenIndex],
      );
    node.status = "completed";
    node.elapsedMs = performance.now() - start;
    node.reason =
      (isTurn
        ? "转牌单尺寸、无再加注，后续河牌过牌摊牌。"
        : "河牌有限行动树。") +
      (input.root.players === 6
        ? " 六人剩两人的局部参考，忽略弃牌相关性。"
        : "") +
      (solution.quality !== "target-met"
        ? " 预算结束未达质量目标，不给确定EV差判断。"
        : " 假设内EV差不等于整手损失。");
  }
  private async pump() {
    if (this.stopped || this.active) return;
    const row = this.db
      .prepare(
        "SELECT document FROM auto_reports WHERE json_extract(document,'$.status')='queued' LIMIT 1",
      )
      .get() as { document: string } | undefined;
    if (!row) return;
    const report = JSON.parse(row.document) as ReviewReport,
      token = randomUUID();
    this.active = { handId: report.handId, token };
    try {
      report.status = "running";
      this.save(report);
      const inputs = await this.game.reviewInputs(report.handId);
      if (this.cancelled(token)) return;
      report.handHash = hash(inputs);
      report.nodes = inputs.map(nodeFacts);
      const candidates = report.nodes
        .filter((n) => n.street >= 2)
        .sort(
          (a, b) => Number(b.marked) - Number(a.marked) || b.street - a.street,
        );
      for (const node of candidates) {
        try {
          autoConfiguration(
            inputs.find((i) => i.sequence === node.sequence)!,
            report.profile,
          );
          node.status = "queued";
          node.reason = "等待后台真实分析";
        } catch (e) {
          node.status = "unsupported";
          node.reason = String((e as Error).message);
        }
      }
      this.save(report);
      let count = 0;
      for (const node of candidates.filter((n) => n.status === "queued")) {
        if (this.cancelled(token)) return;
        if (count++ >= 8) {
          node.status = "unsupported";
          node.reason = "本手自动分析最多8个节点；可在研究中按需继续。";
          continue;
        }
        try {
          await this.analyze(
            inputs.find((i) => i.sequence === node.sequence)!,
            node,
            report,
            token,
          );
        } catch (e) {
          if (this.cancelled(token)) return;
          node.status = "failed";
          node.reason = (e as Error).message;
        }
        if (this.cancelled(token)) return;
        this.save(report);
      }
      report.status = "completed";
      this.save(report);
    } catch (e) {
      if (!this.stopped && !this.cancelled(token)) {
        report.status = "failed";
        report.error = (e as Error).message;
        this.save(report);
      }
    } finally {
      this.active = undefined;
    }
  }
  close() {
    clearInterval(this.timer);
    if (this.active) this.cancel(this.active.handId);
    this.stopped = true;
    // Async continuations check stopped before touching the closed database.
    this.db.close();
  }
}
