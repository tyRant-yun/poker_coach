import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { handClasses } from "../study/domain";
import { Board, ComboCards, Icon } from "../../shared/ui";
import { callAnalysis, connectAnalysis } from "./client";
import { EvidenceCard } from "./EvidenceCard";
import type { Connection } from "./client";
import type {
  AnalysisNode,
  Attempt,
  Experiment,
  PolicyRecord,
  Input,
  Job,
  Ref,
  Situation,
  SolutionManifest,
  Spec,
  ToolName,
} from "./domain";
import s from "./AnalysisPage.module.css";
type Summary = {
  revision: number;
  totalSituations: number;
  selectedSituation?: Situation;
  nextCursor?: string;
  situations: Situation[];
  jobs: Job[];
  solutions: (Omit<SolutionManifest, "nodes"> & { nodeCount: number })[];
  experiments: Experiment[];
  attempts: Attempt[];
  independent?: { question: string; prompt?: string; options?: string[] };
  presets: {
    id: string;
    label: string;
    format: string;
    positions: string[];
    contexts: string[];
    stack: number;
    rake: number;
    sizing: number;
  }[];
  imports: Ref[];
  policies: Pick<
    PolicyRecord,
    | "ref"
    | "situation"
    | "range"
    | "nodeId"
    | "playerId"
    | "submitted"
    | "assisted"
  >[];
};
type Row = {
  combo: string;
  weight: number;
  allocation?: Record<string, number>;
  dead: boolean;
};
type Rows = {
  node: Omit<AnalysisNode, "weights" | "policies">;
  items: Row[];
  total: number;
  nextCursor?: string;
};
type RangePage = {
  ref: Ref;
  protected: string[];
  items: { combo: string; weight: number }[];
  source?: { range: Ref; nodeId: string; model: string };
  classes: {
    label: string;
    mass: number;
    allocation?: Record<string, number>;
  }[];
};
type Aggregate = {
  mass: number;
  frequencies: Record<string, number | null>;
  classes: {
    label: string;
    mass: number;
    allocation?: Record<string, number>;
  }[];
};
const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "模拟执行中",
  postprocessing: "校验结果",
  completed: "执行结束",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  failed: "失败",
  interrupted: "已中断",
  available: "示例可用",
  uncovered: "未覆盖",
  unsupported: "不支持",
  "demo-target-met": "演示质量目标已满足",
  "demo-incomplete": "演示质量不足",
  "not-evaluated": "未评价质量",
};
const colors = ["#79aee8", "#e6ad6b", "#b697e4"];
export function AnalysisPage() {
  const [connection, setConnection] = useState<Connection>(),
    [summary, setSummary] = useState<Summary>(),
    [selected, setSelected] = useState(
      () => new URLSearchParams(window.location.search).get("case") ?? "",
    ),
    [tree, setTree] = useState<Omit<AnalysisNode, "weights" | "policies">[]>(
      [],
    ),
    [treeVersion, setTreeVersion] = useState(""),
    [solutionId, setSolutionId] = useState(""),
    [rows, setRows] = useState<Rows>(),
    [aggregate, setAggregate] = useState<Aggregate>(),
    [rangePage, setRangePage] = useState<RangePage>();
  const [message, setMessage] = useState("正在连接唯一本地工作区…"),
    [busy, setBusy] = useState(false),
    [preset, setPreset] = useState("H-SRP"),
    [format, setFormat] = useState("all"),
    [filterPosition, setFilterPosition] = useState("all"),
    [filterContext, setFilterContext] = useState("all"),
    [filterStack, setFilterStack] = useState(""),
    [filterRake, setFilterRake] = useState(""),
    [filterSizing, setFilterSizing] = useState(""),
    [player, setPlayer] = useState(""),
    [hand, setHand] = useState("AA"),
    [combo, setCombo] = useState("AhAd"),
    [weight, setWeight] = useState("100"),
    [frequency, setFrequency] = useState("50"),
    [policyId, setPolicyId] = useState(""),
    [experimentId, setExperimentId] = useState(""),
    [hypothesis, setHypothesis] = useState(
      "如果对手在此节点采用更多保守行动，策略会怎样变化？",
    ),
    [conclusion, setConclusion] = useState(""),
    [outcome, setOutcome] = useState<
      "ideal" | "slow" | "fail-once" | "resource-limit" | "incomplete-quality"
    >("ideal"),
    [metrics, setMetrics] = useState<unknown>(),
    [feedback, setFeedback] = useState<unknown>(),
    [nextQuestion, setNextQuestion] = useState<{
      ref: Ref;
      options: string[];
    }>(),
    [attemptId, setAttemptId] = useState(""),
    [answer, setAnswer] = useState("不能，需要核对来源和条件"),
    [rake, setRake] = useState("0"),
    [stack, setStack] = useState("100"),
    [sizing, setSizing] = useState("2.5"),
    [board, setBoard] = useState(""),
    [mode, setMode] = useState<"reference" | "range" | "policy">("reference"),
    [policyView, setPolicyView] = useState<{
      ref: Ref;
      situation: Ref;
      submitted: boolean;
      classes: Aggregate["classes"];
      filled: number;
      targetCount: number;
    }>();
  const conn = useRef(connection),
    selection = useRef(selected);
  conn.current = connection;
  selection.current = selected;
  const lastCurrent = useRef<Situation | undefined>(undefined);
  const actual =
    summary?.selectedSituation?.ref.id === selected
      ? summary.selectedSituation
      : summary?.situations.find((x) => x.ref.id === selected);
  if (actual) lastCurrent.current = actual;
  const current =
      actual ?? (summary?.independent ? lastCurrent.current : undefined),
    node = tree.find((n) => n.id === current?.nodeId),
    activePlayer =
      player ||
      node?.actor ||
      current?.players.find((p) => p.status === "active")?.id ||
      "BTN",
    range = current?.ranges[activePlayer];
  type EditScope = {
    situation: Ref;
    range?: Ref;
    policyId?: string;
    playerId: string;
  };
  const editScopes = useRef<
    Partial<Record<"range" | "policy" | "conditions", EditScope>>
  >({});
  const [pending, setPending] = useState(false);
  const touch = (group: "range" | "policy" | "conditions") => {
    if (current && !editScopes.current[group])
      editScopes.current[group] = {
        situation: current.ref,
        range,
        policyId: policyId
          ? policyView?.ref
            ? `${policyView.ref.id}@${policyView.ref.version}`
            : policyId
          : undefined,
        playerId: activePlayer,
      };
    setPending(true);
  };
  const clearScope = (group: "range" | "policy" | "conditions") => {
    delete editScopes.current[group];
    setPending(Object.keys(editScopes.current).length > 0);
  };
  const canLeave = () => {
    if (pending) {
      setMessage(
        "还有未应用输入；请先应用，明确放弃，或从原版本建立独立分支。",
      );
      return false;
    }
    return true;
  };
  useEffect(() => {
    const onClose = (event: BeforeUnloadEvent) => {
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onClose);
    return () => window.removeEventListener("beforeunload", onClose);
  }, [pending]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("case", selected);
    else url.searchParams.delete("case");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
  }, [selected]);
  const pageCursor = useRef<string | undefined>(undefined);
  const refresh = useCallback(async (c = conn.current) => {
    if (!c) return;
    let result;
    try {
      result = await callAnalysis<Summary>(c, "workspace_get", {
        situationId: selection.current || undefined,
        cursor: pageCursor.current,
      });
    } catch (error) {
      if (!pageCursor.current) throw error;
      pageCursor.current = undefined;
      result = await callAnalysis<Summary>(c, "workspace_get", {
        situationId: selection.current || undefined,
      });
    }
    setSummary(result.data);
    setConnection({ ...c, revision: result.revision });
  }, []);
  useEffect(() => {
    let alive = true,
      inFlight = false;
    const sync = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        if (!conn.current) {
          const c = await connectAnalysis();
          if (!alive) return;
          try {
            sessionStorage.setItem("riverline-s1-workspace", c.workspaceId);
          } catch {}
          await refresh(c);
          if (alive) setMessage("已连接本机运行时 · 编辑和 MCP 共用版本");
        } else await refresh();
      } catch (error) {
        if (alive) {
          conn.current = undefined;
          setConnection(undefined);
          setMessage(
            `本地服务失联，正在重新连接；未应用输入保留。${String(error)}`,
          );
        }
      } finally {
        inFlight = false;
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!current || !connection) return;
    let alive = true;
    setTreeVersion("");
    setRows(undefined);
    setAggregate(undefined);
    setSolutionId("");
    setPolicyId("");
    if (!editScopes.current.conditions) {
      setRake(current.rake === null ? "" : String(current.rake * 100));
      setStack(String(current.stack / 100));
      setSizing(current.sizing === null ? "" : String(current.sizing / 100));
      setBoard(current.board.join(" "));
    } else
      setMessage("版本已变化，未应用的条件输入仍保留；保存时会检查原版本。");
    void callAnalysis<{ nodes: typeof tree }>(connection, "situation_tree", {
      situationId: current.ref.id,
    })
      .then((r) => {
        if (alive) {
          setTree(r.data.nodes);
          setTreeVersion(current.ref.contentHash);
        }
      })
      .catch((e) => setMessage(String(e)));
    return () => {
      alive = false;
    };
  }, [current?.ref.contentHash]); // fixed revision drives the view
  useEffect(() => {
    if (!range || !connection) return;
    let alive = true;
    void callAnalysis<RangePage>(connection, "range_get", {
      rangeId: range.id,
      limit: 200,
    })
      .then((r) => {
        if (alive) setRangePage(r.data);
      })
      .catch(() => setRangePage(undefined));
    return () => {
      alive = false;
    };
  }, [range?.contentHash, activePlayer]);
  useEffect(() => {
    if (!policyId || !connection || summary?.independent) {
      setPolicyView(undefined);
      return;
    }
    let alive = true;
    void callAnalysis<{
      ref: Ref;
      situation: Ref;
      submitted: boolean;
      classes: Aggregate["classes"];
      filled: number;
      targetCount: number;
    }>(connection, "artifact_inspect", { artifactId: policyId })
      .then((result) => {
        if (alive) setPolicyView(result.data);
      })
      .catch(() => setPolicyView(undefined));
    return () => {
      alive = false;
    };
  }, [policyId, summary?.revision]);
  useEffect(() => {
    if (!policyId && current) {
      const saved = summary?.policies
        ?.filter(
          (p) =>
            p.situation.contentHash === current.ref.contentHash &&
            p.nodeId === current.nodeId &&
            p.playerId === activePlayer,
        )
        .at(-1);
      if (saved) setPolicyId(saved.ref.id);
    }
  }, [summary?.revision, current?.ref.contentHash, activePlayer, policyId]);
  const perform = async <T,>(
    tool: ToolName,
    input: Partial<Input> = {},
  ): Promise<T | undefined> => {
    if (!conn.current) return;
    setBusy(true);
    try {
      const fresh = await callAnalysis<Summary>(conn.current, "workspace_get");
      const c = { ...conn.current, revision: fresh.revision };
      conn.current = c;
      setConnection(c);
      const result = await callAnalysis<T>(c, tool, input);
      conn.current = { ...c, revision: result.revision };
      setConnection(conn.current);
      await refresh(conn.current);
      if (tool === "range_edit_batch" && input.patch?.length)
        clearScope("range");
      if (tool === "policy_edit_batch" && input.patch?.length)
        clearScope("policy");
      if (
        tool === "situation_revise" &&
        (input.stack !== undefined ||
          input.rake !== undefined ||
          input.sizing !== undefined ||
          input.board !== undefined)
      )
        clearScope("conditions");
      setMessage(
        ([
          "workspace_get",
          "situation_tree",
          "range_get",
          "solution_node_strategy",
          "solution_combo_metrics",
          "solution_range_aggregate",
          "artifact_inspect",
          "artifact_page",
          "analysis_get",
        ].includes(tool)
          ? "已读取固定内容 · "
          : "已完成并保存 · ") + (result.refs[0]?.id ?? ""),
      );
      return result.data;
    } catch (error) {
      setMessage(String(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!canLeave()) return;
    const value = await perform<Situation>("situation_create", { preset });
    if (value) {
      setSelected(value.ref.id);
      setPlayer("");
    }
  };
  const load = async () => {
    if (!current) return;
    const spec = await perform<Spec>("analysis_spec_create", {
      situationId: current.ref.id,
    });
    if (!spec) return;
    const result = await perform<SolutionManifest>("solution_load", {
      specId: spec.ref.id,
    });
    if (result) {
      setSolutionId(result.ref.id);
      setMessage(`${statusLabels[result.availability]} · ${result.reason}`);
      if (result.availability === "available")
        await explore(result.ref.id, current.nodeId, activePlayer);
    }
  };
  const explore = async (id: string, nodeId: string, p = activePlayer) => {
    const data = await perform<Rows>("solution_node_strategy", {
      solutionId: id,
      nodeId,
      playerId: p,
      limit: 200,
    });
    if (data) setRows(data);
    const stats = await perform<Aggregate>("solution_range_aggregate", {
      solutionId: id,
      nodeId,
      playerId: p,
    });
    if (stats) setAggregate(stats);
  };
  const changeNode = async (id: string) => {
    if (!canLeave()) return;
    if (current) {
      await perform("situation_revise", {
        situationId: current.ref.id,
        nodeId: id,
      });
      setPlayer("");
    }
  };
  const editRange = async () => {
    if (!range) return;
    const targets = handClasses.find((h) => h.label === hand)?.combos ?? [
      combo,
    ];
    await perform("range_edit_batch", {
      rangeId: `${(editScopes.current.range?.range ?? range).id}@${(editScopes.current.range?.range ?? range).version}`,
      situationId: `${(editScopes.current.range?.situation ?? current!.ref).id}@${(editScopes.current.range?.situation ?? current!.ref).version}`,
      patch: targets.map((c) => ({
        combo: c,
        weight: Math.round(Number(weight) * 100),
      })),
    });
  };
  const editPolicy = async () => {
    if (!current || !node) return;
    const actions = node.actions;
    const value = Math.round(Number(frequency) * 100);
    const allocation = Object.fromEntries(
      actions.map((a, i) => [
        a.id,
        i === 0 ? value : i === 1 ? 10000 - value : 0,
      ]),
    );
    const p = await perform<{ ref: Ref }>("policy_edit_batch", {
      situationId: `${(editScopes.current.policy?.situation ?? current.ref).id}@${(editScopes.current.policy?.situation ?? current.ref).version}`,
      playerId: editScopes.current.policy?.playerId ?? activePlayer,
      policyId: editScopes.current.policy
        ? editScopes.current.policy.policyId
        : policyId || undefined,
      patch: (handClasses.find((h) => h.label === hand)?.combos ?? [combo])
        .filter((c) => !current.board.some((b) => c.includes(b)))
        .map((c) => ({ combo: c, allocation })),
    });
    if (p) setPolicyId(p.ref.id);
  };
  const metricsFor = async () =>
    setMetrics(
      await perform("solution_combo_metrics", {
        solutionId,
        nodeId: current?.nodeId,
        playerId: activePlayer,
        combos: [combo],
      }),
    );
  const makeExperiment = async () => {
    const value = await perform<Experiment>("experiment_create", {
      baselineId: solutionId,
      preset: "overfold",
      playerId: activePlayer,
      combos: [combo],
      allocation: Object.fromEntries(
        (node?.actions ?? []).map((a, i) => [
          a.id,
          i === 0 ? 8000 : i === 1 ? 2000 : 0,
        ]),
      ),
      hypothesis,
    });
    if (value) setExperimentId(value.ref.id);
  };
  async function exportBackup() {
    const artifact = await perform<{ ref: Ref; pages: number }>(
      "workspace_export",
    );
    if (!artifact) return;
    const chunks: Uint8Array[] = [];
    for (let page = 0; page < artifact.pages; page++) {
      const value = await perform<{ data: string }>("artifact_page", {
        artifactId: artifact.ref.id,
        page,
      });
      if (!value) return;
      chunks.push(Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0)));
    }
    const url = URL.createObjectURL(
      new Blob(chunks as BlobPart[], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "riverline-s1-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer()),
      digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const begin = await perform<{ ref: Ref }>("workspace_import", {
      backup: { phase: "begin", checksum: digest },
    });
    if (!begin) return;
    for (let at = 0; at < bytes.length; at += 65536) {
      const chunk = bytes.subarray(at, at + 65536);
      const data = btoa(
        Array.from(chunk, (c) => String.fromCharCode(c)).join(""),
      );
      if (
        !(await perform("workspace_import", {
          backup: { phase: "chunk", id: begin.ref.id, data },
        }))
      )
        return;
    }
    await perform("workspace_import", {
      backup: { phase: "commit", id: begin.ref.id },
    });
  }
  async function migrateLegacy() {
    const dbs = await indexedDB.databases();
    const name = dbs.some((d) => d.name === "riverline-demo-t1")
      ? "riverline-demo-t1"
      : dbs.some((d) => d.name === "riverline-demo")
        ? "riverline-demo"
        : null;
    if (!name) {
      setMessage("此浏览器没有可迁移的旧作品；原库未修改。");
      return;
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = db
          .transaction("workspace")
          .objectStore("workspace")
          .get("current");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await perform("workspace_import", { backup: value });
    } finally {
      db.close();
    }
  }
  const filteredPresets =
    summary?.presets.filter(
      (p) =>
        (format === "all" || p.format === format) &&
        (filterPosition === "all" || p.positions.includes(filterPosition)) &&
        (filterContext === "all" || p.contexts.includes(filterContext)) &&
        (!filterStack || p.stack === Number(filterStack) * 100) &&
        (!filterRake || p.rake === Number(filterRake) / 100) &&
        (!filterSizing || p.sizing === Number(filterSizing) * 100),
    ) ?? [];
  const groups = handClasses.map((h) => {
    const items = rows?.items.filter((r) => h.combos.includes(r.combo)) ?? [];
    const stats = (
      mode === "policy" ? policyView?.classes : aggregate?.classes
    )?.find((c) => c.label === h.label);
    const mass =
      (mode === "range"
        ? rangePage?.classes.find((c) => c.label === h.label)?.mass
        : stats?.mass) ?? items.reduce((n, r) => n + r.weight, 0);
    const allocation =
      (mode === "policy"
        ? stats?.allocation
        : (stats?.allocation ??
          Object.fromEntries(
            (node?.actions ?? []).map((a) => [
              a.id,
              items.reduce(
                (n, r) => n + (r.allocation?.[a.id] ?? 0) * r.weight,
                0,
              ) / (items.reduce((n, r) => n + r.weight, 0) || 1),
            ]),
          ))) ?? {};
    return { ...h, mass, allocation };
  });
  return (
    <div className={s.shell}>
      <a
        href="/solver/real"
        style={{
          position: "fixed",
          right: 24,
          top: 10,
          zIndex: 10,
          color: "#9de4c3",
          background: "#203b35",
          padding: "6px 12px",
          borderRadius: 6,
        }}
      >
        真实 HU 河牌研究 →
      </a>
      <aside className={s.sidebar}>
        <a className={s.brand} href="/solver">
          <img src="/riverline.svg" alt="" />
          riverline<span>ANALYSIS LAB · S1</span>
        </a>
        <span className={s.eyebrow}>研究 · 范围与 Solver</span>
        <h2>
          把一条行动线，
          <br />
          变成可追溯的证据。
        </h2>
        <p>本地合成分析。输入、编辑、保存和 MCP 调用真实工作。</p>
        <div className={s.connection}>
          <i />
          {connection
            ? `${connection.workspaceId} · r${summary?.revision ?? 0}`
            : "尚未连接"}
          <small>唯一本地业务工作区</small>
        </div>
        <label>
          桌型筛选
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="all">全部</option>
            <option>HU</option>
            <option>6-max</option>
          </select>
        </label>
        <details>
          <summary>筛选位置、回应与金额</summary>
          <label>
            位置筛选
            <select
              aria-label="位置筛选"
              value={filterPosition}
              onChange={(e) => setFilterPosition(e.target.value)}
            >
              {["all", "UTG", "HJ", "CO", "BTN", "SB", "BB"].map((p) => (
                <option key={p} value={p}>
                  {p === "all" ? "全部" : p}
                </option>
              ))}
            </select>
          </label>
          <label>
            行动上下文
            <select
              aria-label="行动上下文"
              value={filterContext}
              onChange={(e) => setFilterContext(e.target.value)}
            >
              {[
                "all",
                "未开池",
                "面对开池",
                "面对3-bet",
                "面对4-bet",
                "squeeze",
                "收盲",
              ].map((p) => (
                <option key={p} value={p}>
                  {p === "all" ? "全部" : p}
                </option>
              ))}
            </select>
          </label>
          <label>
            起始筹码 bb
            <input
              aria-label="筛选筹码"
              value={filterStack}
              onChange={(e) => setFilterStack(e.target.value)}
            />
          </label>
          <label>
            抽水 %
            <input
              aria-label="筛选抽水"
              value={filterRake}
              onChange={(e) => setFilterRake(e.target.value)}
            />
          </label>
          <label>
            开池加注至 bb
            <input
              aria-label="筛选尺寸"
              value={filterSizing}
              onChange={(e) => setFilterSizing(e.target.value)}
            />
          </label>
          <p>仅精确筛选已有路径。自定义条件在作品中保存；不匹配时不套参考。</p>
        </details>
        {!filteredPresets.length && summary && (
          <p>当前筛选未覆盖。已有作品和输入保留。</p>
        )}
        <label>
          选择示例路径
          <select
            aria-label="示例路径"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {filteredPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={s.primary}
          disabled={
            !connection || busy || !filteredPresets.some((p) => p.id === preset)
          }
          onClick={() => void create()}
        >
          创建分析作品 <Icon name="plus" />
        </button>
        <h3>
          我的作品 <small>{summary?.totalSituations ?? 0} · 最近一页</small>
        </h3>
        <div className={s.caseList}>
          {summary?.situations.map((c) => (
            <button
              data-testid={`case-${c.ref.id}`}
              key={c.ref.id}
              className={selected === c.ref.id ? s.selected : ""}
              onClick={() => {
                if (!canLeave()) return;
                setSelected(c.ref.id);
                setPlayer("");
              }}
            >
              <b>{c.name}</b>
              <small>
                {c.format} · {c.nodeId} · V{c.ref.version}
                {c.stale ? " · 需复核" : ""}
              </small>
            </button>
          ))}
        </div>
        {summary?.nextCursor && (
          <button
            disabled={busy}
            onClick={() => {
              pageCursor.current = summary.nextCursor;
              void refresh().catch((e) => setMessage(String(e)));
            }}
          >
            上一页作品
          </button>
        )}
        {pageCursor.current && (
          <button
            onClick={() => {
              pageCursor.current = undefined;
              void refresh();
            }}
          >
            回到最近作品
          </button>
        )}
        <details>
          <summary>旧版作品与备份</summary>
          <button onClick={() => void migrateLegacy()}>只读迁移旧库原件</button>
          <button onClick={() => void exportBackup()}>导出 S1 备份</button>
          <button
            onClick={async () => {
              if (
                confirm(
                  "重置本地 S1 分析索引？旧浏览器库保持不变，建议先导出备份。",
                )
              ) {
                await perform("workspace_reset", {
                  confirmation: "RESET LOCAL ANALYSIS",
                });
                setSelected("");
              }
            }}
          >
            重置 S1 分析索引
          </button>
          <label className={s.file}>
            校验并导入备份
            <input
              aria-label="导入 S1 备份"
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files?.[0]) void importFile(e.target.files[0]);
              }}
            />
          </label>
          <a href="/learn">打开原 T1 独立演示</a>
          <p>旧库保留原意；不与 S1 工作区双写。</p>
        </details>
      </aside>
      <main className={s.main}>
        <header>
          <span className={s.eyebrow}>
            CONFIGURE → EXPLORE → COMPARE → LEARN
          </span>
          <span className={s.badge}>合成示例 · 无真实求解</span>
        </header>
        <div className={s.message} role="status">
          {message}
        </div>
        {pending && (
          <section className={s.message}>
            <b>有未应用输入，当前内容尚未保存。</b>
            <button
              onClick={() => {
                editScopes.current = {};
                setPending(false);
                if (current) {
                  setRake(
                    current.rake === null ? "" : String(current.rake * 100),
                  );
                  setStack(String(current.stack / 100));
                  setSizing(
                    current.sizing === null ? "" : String(current.sizing / 100),
                  );
                  setBoard(current.board.join(" "));
                }
              }}
            >
              放弃未应用输入
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                const context =
                  editScopes.current.conditions ??
                  editScopes.current.range ??
                  editScopes.current.policy;
                const source = context?.situation ?? current?.ref;
                if (!source) return;
                const branch = await perform<Situation>("situation_fork", {
                  situationId: `${source.id}@${source.version}`,
                });
                if (branch) {
                  for (const key of [
                    "range",
                    "policy",
                    "conditions",
                  ] as const) {
                    const scope = editScopes.current[key];
                    if (scope)
                      editScopes.current[key] = {
                        ...scope,
                        situation: branch.ref,
                        range: branch.ranges[scope.playerId],
                        policyId: undefined,
                      };
                  }
                  setSelected(branch.ref.id);
                }
              }}
            >
              从原版本建立独立分支
            </button>
          </section>
        )}
        {summary?.independent ? (
          <section className={s.panel}>
            <h1>独立概念题进行中</h1>
            <p>{summary.independent.prompt}研究、指标和历史资源暂时隐藏。</p>
            <select
              aria-label="概念作答"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            >
              {(
                summary?.independent?.options ?? [
                  "不能，需要核对来源和条件",
                  "可以",
                ]
              ).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={async () => {
                const a = await perform<{ ref: Ref }>(
                  "teaching_attempt_submit",
                  { answer },
                );
                if (a) setAttemptId(a.ref.id);
              }}
            >
              固定首次作答
            </button>
            <button
              disabled={busy}
              onClick={() => void perform("teaching_reveal")}
            >
              登记辅助并阅读研究
            </button>
            <button disabled>加载示例参考</button>
          </section>
        ) : !current ? (
          <section className={s.welcome}>
            <span className={s.eyebrow}>YOUR NEXT QUESTION</span>
            <h1>
              范围从哪里来，
              <br />
              比矩阵长什么样更重要。
            </h1>
            <p>
              从 HU
              开始，沿行动查看范围变化；或选择六人翻前路径，携带固定来源进入单挑翻后。
            </p>
            <div className={s.featureGrid}>
              {[
                ["01", "固定输入", "每份解绑定范围、行动树与版本。"],
                ["02", "受控对照", "先提出假设，再核对比较资格。"],
                ["03", "证据消费", "分析与教学共用来源和允许信息规则。"],
              ].map(([n, title, text]) => (
                <article key={n}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
            <button
              className={s.primary}
              disabled={!connection || busy}
              onClick={() => void create()}
            >
              创建第一份 HU 分析
            </button>
          </section>
        ) : (
          <>
            <section className={s.heading}>
              <div>
                <span className={s.eyebrow}>
                  {current.preset} · V{current.ref.version}
                </span>
                <h1>{current.name}</h1>
                <p>
                  {current.review ? (
                    "桌型/参与者未完整确认 · 行动前事实草稿"
                  ) : (
                    <>
                      {current.format === "HU" ? "HU 桌" : "六人背景"} ·
                      当前活跃{" "}
                      {
                        current.players.filter((p) => p.status === "active")
                          .length
                      }{" "}
                      人 · 局部/子博弈示例
                    </>
                  )}{" "}
                  · 未计算真实条件到达概率
                </p>
              </div>
              <Board cards={current.board} />
            </section>
            <div className={s.toolbar}>
              <button
                className={s.primary}
                disabled={
                  busy ||
                  !!summary?.independent ||
                  treeVersion !== current.ref.contentHash
                }
                onClick={() => void load()}
              >
                加载示例参考
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  const spec = await perform<Spec>("analysis_spec_create", {
                    situationId: current.ref.id,
                  });
                  if (spec)
                    await perform("analysis_start", {
                      specId: spec.ref.id,
                      outcome,
                    });
                }}
              >
                运行模拟分析
              </button>
              <select
                aria-label="任务故障配置"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                <option value="ideal">正常任务</option>
                <option value="slow">慢任务</option>
                <option value="fail-once">首次失败</option>
                <option value="resource-limit">资源限制</option>
                <option value="incomplete-quality">质量不足</option>
              </select>
              <span>
                {current.stale ? "上游/范围已变更，需复核" : "固定输入已保存"}
              </span>
            </div>
            <div className={s.workbench}>
              <section className={s.tree}>
                <span className={s.eyebrow}>ACTION PATH</span>
                <h3>行动与公共牌</h3>
                <div className={s.treeNodes}>
                  {tree.map((n) => (
                    <button
                      data-testid={`node-${n.id}`}
                      key={n.id}
                      className={current.nodeId === n.id ? s.selected : ""}
                      disabled={busy}
                      onClick={() => void changeNode(n.id)}
                      style={{ paddingLeft: n.parent ? "22px" : "10px" }}
                    >
                      <small>
                        {n.via ?? "起点"} · {n.id}
                      </small>
                      <b>{n.label}</b>
                      {n.board.length > 0 && <span>{n.board.join(" ")}</span>}
                    </button>
                  ))}
                </div>
              </section>
              <section className={s.center}>
                <div className={s.ledger}>
                  <span>
                    底池
                    <b>
                      {((node?.pot ?? 0) / 100).toFixed(2)}
                      <small> bb</small>
                    </b>
                  </span>
                  <span>
                    行动方<b>{node?.actor || "—"}</b>
                  </span>
                  <span>
                    范围模型<b>自身路径权重</b>
                  </span>
                </div>
                {current.review && (
                  <p className={s.note}>
                    事实来自固定复盘节点；未确认：
                    {current.review.unknownFields.join("、")}
                    。未用预置范围填补未知。
                    <button
                      onClick={async () =>
                        setFeedback(
                          await perform("artifact_inspect", {
                            artifactId: current.review!.source.id,
                          }),
                        )
                      }
                    >
                      查看复盘来源
                    </button>
                  </p>
                )}
                <div className={s.players}>
                  {current.players.map((p) => (
                    <button
                      key={p.id}
                      className={activePlayer === p.id ? s.selected : ""}
                      disabled={p.status === "folded"}
                      onClick={() => {
                        setPlayer(p.id);
                        if (solutionId)
                          void explore(solutionId, current.nodeId, p.id);
                      }}
                    >
                      {p.position}
                      <b>{(p.remaining / 100).toFixed(2)}bb</b>
                      <small>
                        {p.status === "folded"
                          ? "已弃牌"
                          : activePlayer === p.id
                            ? "当前查看"
                            : "输入范围"}
                      </small>
                    </button>
                  ))}
                </div>
                {current.review && (
                  <label>
                    编辑范围槽位（对手尚未确认）
                    <select
                      aria-label="复盘范围槽位"
                      value={activePlayer}
                      onChange={(e) => {
                        if (canLeave()) setPlayer(e.target.value);
                      }}
                    >
                      {Object.keys(current.ranges).map((id) => (
                        <option key={id} value={id}>
                          {id === "opponent-unknown"
                            ? "对手未知范围"
                            : `${id} 行动者范围`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className={s.mode}>
                  <button
                    aria-pressed={mode === "reference"}
                    onClick={() => setMode("reference")}
                  >
                    参考策略
                  </button>
                  <button
                    aria-pressed={mode === "range"}
                    onClick={() => setMode("range")}
                  >
                    输入范围
                  </button>
                  <button
                    aria-pressed={mode === "policy"}
                    disabled={!policyView}
                    onClick={() => setMode("policy")}
                  >
                    我的策略
                  </button>
                  {mode === "policy" && policyView && (
                    <span>
                      已填写 {policyView.filled} / {policyView.targetCount}{" "}
                      个有效组合；未完整类别不显示行动频率。
                    </span>
                  )}
                  <span>169 类 / 1,326 组合 · 缺失不作零</span>
                </div>
                <div className={s.matrix} aria-label="全范围矩阵">
                  {groups.map((h) => {
                    const values = Object.values(h.allocation);
                    let end = 0;
                    const gradient = values
                      .map((v, i) => {
                        const start = end;
                        end += v / 100;
                        return `${colors[i % 3]} ${start}%,${colors[i % 3]} ${end}%`;
                      })
                      .join(",");
                    const background =
                      mode !== "range" && values.some((v) => v > 0)
                        ? `linear-gradient(90deg,${gradient})`
                        : h.mass > 0
                          ? "#344e62"
                          : "#1c2936";
                    return (
                      <button
                        key={h.label}
                        className={hand === h.label ? s.activeCell : ""}
                        style={{ background } as CSSProperties}
                        title={`${h.label} · 有效质量 ${h.mass}`}
                        onClick={() => {
                          if (!canLeave()) return;
                          setHand(h.label);
                          setCombo(h.combos[0]);
                        }}
                      >
                        {h.label}
                      </button>
                    );
                  })}
                </div>
                {!rows && (
                  <p className={s.note}>
                    矩阵当前未加载参考。输入范围可以编辑；点击“加载示例参考”查看固定策略。
                  </p>
                )}
                {aggregate && (
                  <div className={s.frequencies}>
                    {Object.entries(aggregate.frequencies).map(
                      ([a, value], i) => (
                        <span key={a}>
                          <i style={{ background: colors[i % 3] }} />
                          {a}{" "}
                          <b>
                            {value === null
                              ? "不可达"
                              : (value * 100).toFixed(1) + "%"}
                          </b>
                        </span>
                      ),
                    )}
                    <small>
                      分母：当前节点有效范围质量 {aggregate.mass.toFixed(1)}
                    </small>
                  </div>
                )}
                <div className={s.actions}>
                  {node?.actions.map((a) => {
                    const next = tree.find(
                      (n) => n.parent === node.id && n.via === a.id,
                    );
                    return (
                      <button
                        key={a.id}
                        disabled={busy || !next}
                        onClick={() => next && void changeNode(next.id)}
                      >
                        {a.label}
                        {!next ? " · 未展开" : ""}
                      </button>
                    );
                  })}
                  {current.nodeId === "flop-deal" && (
                    <button
                      className={s.primary}
                      onClick={async () => {
                        const value = await perform<Situation>(
                          "analysis_handoff",
                          { situationId: current.ref.id },
                        );
                        if (value) setSelected(value.ref.id);
                      }}
                    >
                      携带范围进入翻后
                    </button>
                  )}
                </div>
                <p className={s.note}>
                  {current.history.join(" → ") || "无此前行动"}
                  {node?.returned
                    ? ` · 未跟注退还 ${node.returned / 100}bb`
                    : ""}
                </p>
              </section>
              <aside className={s.detail}>
                <span className={s.eyebrow}>COMBO FOCUS</span>
                <h3>{hand} · 具体组合</h3>
                <div className={s.combos}>
                  {handClasses
                    .find((h) => h.label === hand)
                    ?.combos.map((c) => (
                      <button
                        key={c}
                        aria-pressed={c === combo}
                        onClick={() => {
                          if (canLeave()) setCombo(c);
                        }}
                      >
                        <ComboCards combo={c} />
                      </button>
                    ))}
                </div>
                <label>
                  输入权重（%）
                  <input
                    aria-label="输入权重"
                    type="number"
                    min="0"
                    max="100"
                    value={weight}
                    onChange={(e) => {
                      touch("range");
                      setWeight(e.target.value);
                    }}
                  />
                </label>
                <button
                  disabled={busy || !range}
                  onClick={() => void editRange()}
                >
                  批量应用到 {hand}
                </button>
                <button
                  disabled={busy || !range}
                  onClick={() => {
                    const combos = handClasses.find((h) => h.label === hand)
                      ?.combos ?? [combo];
                    const currentProtected = rangePage?.protected ?? [];
                    const unprotect = combos.every((c) =>
                      currentProtected.includes(c),
                    );
                    const protection = unprotect
                      ? currentProtected.filter((c) => !combos.includes(c))
                      : [...new Set([...currentProtected, ...combos])];
                    void perform("range_edit_batch", {
                      rangeId: range?.id,
                      protected: protection,
                    });
                  }}
                >
                  {(
                    handClasses.find((h) => h.label === hand)?.combos ?? []
                  ).every((c) => rangePage?.protected.includes(c))
                    ? "取消范围编辑保护"
                    : "保护所选范围"}
                </button>
                <div className={s.inline}>
                  <button
                    disabled={!range || busy}
                    onClick={() =>
                      void perform("range_undo", { rangeId: range?.id })
                    }
                  >
                    撤销范围
                  </button>
                  <button
                    disabled={!range || busy}
                    onClick={() =>
                      void perform("range_redo", { rangeId: range?.id })
                    }
                  >
                    重做
                  </button>
                </div>
                <p className={s.note}>
                  来源：
                  {rangePage?.source
                    ? `${rangePage.source.nodeId} / ${rangePage.source.model}`
                    : "当前输入范围"}
                  <br />
                  {range?.id}
                </p>
                <details>
                  <summary>构建我的策略</summary>
                  <p>与参考分开，提交后固定版本。</p>
                  <label>
                    已保存策略
                    <select
                      aria-label="已保存策略"
                      value={policyId}
                      onChange={(e) => {
                        if (canLeave()) setPolicyId(e.target.value);
                      }}
                    >
                      <option value="">选择策略</option>
                      {summary?.policies
                        ?.filter(
                          (p) =>
                            p.situation.id === current.ref.id &&
                            p.playerId === activePlayer &&
                            p.nodeId === current.nodeId,
                        )
                        .map((p) => (
                          <option key={p.ref.id} value={p.ref.id}>
                            {p.submitted ? "已固定" : "草稿"} · {p.ref.id} v
                            {p.ref.version}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={busy || !policyId || pending}
                    onClick={async () => {
                      const p = await perform<PolicyRecord>("policy_fork", {
                        policyId,
                        situationId: current.ref.id,
                      });
                      if (p) setPolicyId(p.ref.id);
                    }}
                  >
                    从当前策略建立草稿
                  </button>
                  <button
                    disabled={
                      busy || !policyId || pending || policyView?.submitted
                    }
                    onClick={() => void perform("policy_undo", { policyId })}
                  >
                    撤销策略编辑
                  </button>
                  <button
                    disabled={
                      busy || !policyId || pending || policyView?.submitted
                    }
                    onClick={() => void perform("policy_redo", { policyId })}
                  >
                    重做策略编辑
                  </button>
                  <label>
                    第一个行动频率（%）
                    <input
                      aria-label="策略频率"
                      value={frequency}
                      onChange={(e) => {
                        touch("policy");
                        setFrequency(e.target.value);
                      }}
                    />
                  </label>
                  <button disabled={busy} onClick={() => void editPolicy()}>
                    应用混频到 {hand}
                  </button>
                  <button
                    disabled={busy || pending || !!summary?.independent}
                    onClick={async () => {
                      const p = await perform<{ ref: Ref }>(
                        "policy_edit_batch",
                        {
                          situationId: current.ref.id,
                          playerId: activePlayer,
                          reveal: true,
                          policyId: policyView?.submitted
                            ? undefined
                            : policyId || undefined,
                        },
                      );
                      if (p) setPolicyId(p.ref.id);
                    }}
                  >
                    参考补全（记辅助）
                  </button>
                  <button
                    disabled={
                      busy || pending || !policyId || policyView?.submitted
                    }
                    onClick={async () => {
                      const p = await perform<{ ref: Ref }>("policy_submit", {
                        policyId,
                      });
                      if (p) setPolicyId(p.ref.id);
                    }}
                  >
                    固定提交策略
                  </button>
                  <button
                    disabled={busy || !policyId}
                    onClick={async () =>
                      setFeedback(
                        await perform("policy_evaluate", { policyId }),
                      )
                    }
                  >
                    评价固定策略
                  </button>
                  <small>{policyId}</small>
                </details>
                <button
                  disabled={busy || !solutionId}
                  onClick={() => void metricsFor()}
                >
                  查看此组合指标
                </button>
                {metrics !== undefined && (
                  <EvidenceCard
                    value={metrics}
                    onReference={async (r) =>
                      setFeedback(
                        await perform("artifact_inspect", {
                          artifactId: `${r.id}@${r.version}`,
                        }),
                      )
                    }
                  />
                )}
                <p className={s.note}>
                  指标仅作者合成；EV 单位
                  bb，当前节点原点、不含已投入、无抽水。未覆盖不填零。
                </p>
              </aside>
            </div>
            <details className={s.panel}>
              <summary>自定义条件与固定输入</summary>
              <div className={s.formGrid}>
                <label>
                  筹码（bb）
                  <input
                    aria-label="筹码"
                    value={stack}
                    onChange={(e) => {
                      touch("conditions");
                      setStack(e.target.value);
                    }}
                  />
                </label>
                <label>
                  抽水（%）
                  <input
                    aria-label="抽水"
                    value={rake}
                    onChange={(e) => {
                      touch("conditions");
                      setRake(e.target.value);
                    }}
                  />
                </label>
                <label>
                  开池尺度（bb）
                  <input
                    aria-label="开池尺度"
                    value={sizing}
                    onChange={(e) => {
                      touch("conditions");
                      setSizing(e.target.value);
                    }}
                  />
                </label>
                <label>
                  公共牌（空格分隔）
                  <input
                    aria-label="公共牌"
                    value={board}
                    onChange={(e) => {
                      touch("conditions");
                      setBoard(e.target.value);
                    }}
                  />
                </label>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void perform("situation_revise", {
                    situationId: `${(editScopes.current.conditions?.situation ?? current.ref).id}@${(editScopes.current.conditions?.situation ?? current.ref).version}`,
                    stack: Math.round(Number(stack) * 100),
                    rake: rake.trim() ? Number(rake) / 100 : undefined,
                    sizing: sizing.trim()
                      ? Math.round(Number(sizing) * 100)
                      : undefined,
                    board: board.trim() ? board.trim().split(/\s+/) : [],
                  })
                }
              >
                保存条件新版本
              </button>
              <p>其他条件可保存；没有配对资产时显示未覆盖，不套用最近结果。</p>
            </details>
            <section className={s.bottomGrid}>
              <article className={s.panel}>
                <span className={s.eyebrow}>CONTROLLED EXPERIMENT</span>
                <h2>先写假设，再看差异。</h2>
                <textarea
                  aria-label="实验假设"
                  value={hypothesis}
                  onChange={(e) => setHypothesis(e.target.value)}
                />
                <button
                  disabled={busy || !current}
                  onClick={async () => {
                    const mission = await perform<{
                      experiment: Ref;
                      baseline: Ref;
                      trace: unknown;
                    }>("analysis_agent_run", {
                      situationId: current.ref.id,
                      hypothesis,
                    });
                    if (mission) {
                      setExperimentId(mission.experiment.id);
                      setSolutionId(mission.baseline.id);
                      setFeedback(mission);
                    }
                  }}
                >
                  Agent 建立研究对照
                </button>
                <button
                  disabled={busy || !solutionId}
                  onClick={() => void makeExperiment()}
                >
                  固定基准并建立锁定变体
                </button>
                <select
                  aria-label="选择实验"
                  value={experimentId}
                  onChange={(e) => setExperimentId(e.target.value)}
                >
                  <option value="">选择已有实验</option>
                  {summary?.experiments.map((e) => (
                    <option value={e.ref.id} key={e.ref.id}>
                      {e.hypothesis}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || !experimentId}
                  onClick={async () =>
                    setFeedback(
                      await perform("experiment_compare", { experimentId }),
                    )
                  }
                >
                  核对比较资格
                </button>
                <textarea
                  aria-label="有条件结论"
                  value={conclusion}
                  onChange={(e) => setConclusion(e.target.value)}
                  placeholder="记录观察、条件与证据不足"
                />
                <button
                  disabled={busy || !experimentId}
                  onClick={() =>
                    void perform("experiment_conclude", {
                      experimentId,
                      conclusion,
                    })
                  }
                >
                  保存有条件结论
                </button>
              </article>
              <article className={s.panel}>
                <span className={s.eyebrow}>EVIDENCE → LEARNING</span>
                <h2>固定作答，再请求证据。</h2>
                <p>HU 与六人背景的 BTN 对 BB，能否直接共用一张无条件范围表？</p>
                <button
                  disabled={busy || pending || !!summary?.independent}
                  onClick={() => void perform("teaching_begin")}
                >
                  开始独立概念题
                </button>
                {summary?.independent && (
                  <button onClick={() => void perform("teaching_reveal")}>
                    登记辅助并阅读研究
                  </button>
                )}
                <select
                  aria-label="概念作答"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                >
                  {(
                    summary?.independent?.options ?? [
                      "不能，需要核对来源和条件",
                      "可以",
                    ]
                  ).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  onClick={async () => {
                    const a = await perform<{ ref: Ref }>(
                      "teaching_attempt_submit",
                      { answer },
                    );
                    if (a) setAttemptId(a.ref.id);
                  }}
                >
                  固定首次作答
                </button>
                <button
                  disabled={busy || !attemptId || !solutionId}
                  onClick={async () =>
                    setFeedback(
                      await perform("teaching_feedback", {
                        attemptId,
                        solutionId,
                      }),
                    )
                  }
                >
                  请求有来源反馈
                </button>
                <button
                  disabled={busy || !attemptId}
                  onClick={async () => {
                    const next = await perform<{ ref: Ref; options: string[] }>(
                      "teaching_next",
                      { attemptId },
                    );
                    setFeedback(next);
                    setNextQuestion(next);
                  }}
                >
                  安排改变条件的新题
                </button>
                {nextQuestion && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setAnswer(nextQuestion.options[0]);
                      await perform("teaching_begin", {
                        question: nextQuestion.ref.id,
                      });
                    }}
                  >
                    开始迁移概念题
                  </button>
                )}
              </article>
            </section>
            {feedback !== undefined && (
              <section className={s.panel}>
                <h3>固定证据与反馈</h3>
                <EvidenceCard
                  value={feedback}
                  onReference={async (r) =>
                    setFeedback(
                      await perform("artifact_inspect", {
                        artifactId:
                          r.kind === "theory" ||
                          r.kind === "content" ||
                          r.kind === "feedback" ||
                          r.kind === "comparison" ||
                          r.kind === "conclusion" ||
                          r.kind === "mission" ||
                          r.kind === "question-definition"
                            ? r.id
                            : `${r.id}@${r.version}`,
                      }),
                    )
                  }
                />
              </section>
            )}
          </>
        )}
        <section className={s.panel}>
          <span className={s.eyebrow}>PERSISTENT JOBS</span>
          <h2>任务与固定成果</h2>
          <p>浏览器关闭后继续执行；执行结束、数据覆盖与质量分别记录。</p>
          {summary?.jobs.length ? (
            summary.jobs.map((j) => (
              <div key={j.ref.id} className={s.job}>
                <div>
                  <b>{statusLabels[j.status]}</b>
                  <small>
                    {j.ref.id} · {j.stage}
                  </small>
                </div>
                {["queued", "running", "postprocessing"].includes(j.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform("analysis_cancel", { jobId: j.ref.id })
                    }
                  >
                    取消任务
                  </button>
                )}
                {["failed", "interrupted", "cancelled"].includes(j.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform("analysis_retry", { jobId: j.ref.id })
                    }
                  >
                    按原输入重试
                  </button>
                )}
                {j.result && (
                  <button
                    onClick={async () => {
                      const manifest = await perform<SolutionManifest>(
                        "solution_load",
                        { solutionId: j.result!.id },
                      );
                      if (manifest) {
                        setSolutionId(manifest.ref.id);
                        setMessage(
                          `${statusLabels[manifest.availability]} · ${statusLabels[manifest.quality]} · ${manifest.reason}`,
                        );
                        if (current && manifest.availability === "available")
                          await explore(manifest.ref.id, current.nodeId);
                      }
                    }}
                  >
                    打开固定结果
                  </button>
                )}
              </div>
            ))
          ) : (
            <p>尚无任务。可以先加载参考，无需填写完整策略。</p>
          )}
        </section>
        <footer>
          Riverline S1 · 实际本地编辑/版本/MCP · 作者合成策略与数值 · 没有真实
          Solver 或 LLM
        </footer>
      </main>
    </div>
  );
}
