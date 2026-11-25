import { useEffect, useRef, useState } from "react";
import { connectAnalysis } from "./client";
import { Board, ComboCards } from "../../shared/ui";
import { handClasses } from "../study/domain";
import type { Reply, Ref } from "./domain";
import type {
  CaseTree,
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
  RealTool,
} from "./real-domain";
import s from "./RealAnalysisPage.module.css";
import { ProductNav } from "../play/ProductNav";
import { gameCall } from "../play/client";
import type { ResearchSource } from "../play/domain";

type Workspace = {
  revision: number;
  restricted: boolean;
  cases: RealCase[];
  selectedCase?: RealCase;
  selectedSolution?: Ref;
  specs: RealSpec[];
  jobs: RealJob[];
  solutions: Pick<RealSolution, "ref" | "spec" | "quality" | "iterations">[];
};
type Row = {
  combo: string;
  hand: string;
  inputWeight: number;
  ownReachWeight: number;
  conditionalProbability: number | null;
  availability: string;
  allocation: number[] | null;
  equity: number | null;
  evBb: number | null;
  actionEvBb: number[] | null;
};
type NodeView = {
  path: number[];
  terminal: boolean;
  actor: 0 | 1 | null;
  actions: string[];
  board: string[];
  potBb: number;
  investedBb: number[];
  returnedBb: number[];
};
type Query = {
  node: NodeView;
  items: Row[];
  total: number;
  nextOffset: number | null;
};
type Aggregate = {
  frequencies: { action: string; frequency: number | null }[];
  classes: { hand: string; probability: number | null }[];
  denominator: number;
};
const initial = {
  name: "HU 河牌研究",
  board: "2c 3d 7h 9s Jc",
  pot: "10",
  stack: "10",
  betPercent: "100",
  model: "simple",
  treeText: "下注至 5\n下注至 10\n过牌 > 下注至 5",
  oop: "AcAd:100\n5c4c:100",
  ip: "KhKd:100\n8c8d:100",
};
const statuses: Record<RealJob["status"], string> = {
  queued: "排队中",
  running: "真实计算中",
  postprocessing: "校验并保存",
  cancel_requested: "等待取消确认",
  cancelled: "已取消",
  completed: "执行完成",
  failed: "失败",
  interrupted: "已中断",
};
const pct = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(2)}%`;
const bb = (n: number | null) => (n === null ? "—" : `${n.toFixed(4)} bb`);
function label(action: string) {
  if (action === "Check") return "过牌";
  if (action === "Fold") return "弃牌";
  if (action === "Call") return "跟注";
  const amount = /\((\d+)\)/.exec(action);
  return `${action.startsWith("AllIn") ? "全下至" : action.startsWith("Raise") ? "加注至" : "下注至"} ${amount ? Number(amount[1]) / 100 : ""} bb`;
}
function centibb(text: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw Error("金额最多支持小数点后两位 bb，不会自动舍入");
  const [whole, fraction = ""] = text.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) throw Error("金额超出支持范围");
  return value;
}
function parseTree(text: string): CaseTree {
  return {
    kind: "explicit-river/v2",
    lines: text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) =>
        line.split(">").map((token) => {
          token = token.trim();
          if (token === "过牌") return { kind: "check" as const };
          if (token === "跟注") return { kind: "call" as const };
          if (token === "弃牌") return { kind: "fold" as const };
          const match = /^(下注至|加注至|全下至)\s*(\d+(?:\.\d{1,2})?)$/.exec(
            token,
          );
          if (!match)
            throw Error(
              `行动路径格式不正确：${token}；可用「过牌 > 下注至 5」`,
            );
          return {
            kind:
              match[1] === "下注至"
                ? ("bet" as const)
                : match[1] === "加注至"
                  ? ("raise" as const)
                  : ("all-in" as const),
            amount: centibb(match[2]),
          };
        }),
      ),
  };
}
function formatTree(tree: CaseTree) {
  return tree.lines
    .map((line) =>
      line
        .map((a) =>
          a.kind === "check"
            ? "过牌"
            : a.kind === "fold"
              ? "弃牌"
              : a.kind === "call"
                ? "跟注"
                : `${a.kind === "bet" ? "下注至" : a.kind === "raise" ? "加注至" : "全下至"} ${"amount" in a ? a.amount / 100 : ""}`,
        )
        .join(" > "),
    )
    .join("\n");
}
function parseRange(text: string) {
  const entries = text
      .trim()
      .split(/[\s,;]+/)
      .filter(Boolean),
    result: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.split(":").length > 2) throw Error(`范围格式不正确：${entry}`);
    const [combo, value = "100"] = entry.split(":");
    const number = Number(value);
    if (
      !/^(?:[2-9TJQKA][cdhs]){2}$/.test(combo) ||
      !Number.isFinite(number) ||
      number < 0 ||
      number > 100 ||
      Object.hasOwn(result, combo)
    )
      throw Error(`范围格式不正确：${entry}；请使用 AcAd:100`);
    result[combo] = number * 100;
  }
  return result;
}
async function invoke<T>(
  tool:
    | RealTool
    | "range_get"
    | "workspace_export"
    | "artifact_page"
    | "artifact_inspect",
  input: Record<string, unknown> = {},
): Promise<T> {
  const connection = await connectAnalysis();
  const response = await fetch("/api/analysis/call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Riverline-Session": connection.token,
    },
    body: JSON.stringify({
      tool,
      input: {
        workspaceId: connection.workspaceId,
        requestId: crypto.randomUUID(),
        expectedRevision: connection.revision,
        ...input,
      },
    }),
  });
  const reply = (await response.json()) as Reply;
  if (!reply.ok) throw Error(`${reply.code} · ${reply.message}`);
  return reply.data as T;
}
async function readRange(reference: Ref) {
  let cursor: string | undefined;
  const parts: string[] = [];
  do {
    const page = await invoke<{
      items: { combo: string; weight: number }[];
      nextCursor?: string;
    }>("range_get", {
      rangeId: `${reference.id}@${reference.version}`,
      limit: 200,
      cursor,
    });
    for (const r of page.items)
      if (r.weight > 0) parts.push(`${r.combo}:${r.weight / 100}`);
    cursor = page.nextCursor;
  } while (cursor);
  return parts.join("\n");
}

export function RealAnalysisPage() {
  const [practiceSource, setPracticeSource] = useState<ResearchSource>();
  const [researchNote, setResearchNote] = useState("");
  const [accessError, setAccessError] = useState("");
  const sourceId = useRef(
    new URLSearchParams(location.search).get("source") ?? "",
  );
  const [workspace, setWorkspace] = useState<Workspace>(),
    [draft, setDraft] = useState(initial),
    [selected, setSelected] = useState<RealCase>(),
    [spec, setSpec] = useState<RealSpec>(),
    [solution, setSolution] = useState<RealSolution>(),
    [solutionSpec, setSolutionSpec] = useState<RealSpec>(),
    [query, setQuery] = useState<Query>(),
    [matrixRows, setMatrixRows] = useState<Row[]>([]),
    [matrixMetric, setMatrixMetric] = useState<
      "strategy" | "weight" | "equity" | "ev"
    >("strategy"),
    [aggregate, setAggregate] = useState<Aggregate>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [player, setPlayer] = useState<0 | 1>(0),
    [path, setPath] = useState<number[]>([]),
    [hand, setHand] = useState(""),
    [offset, setOffset] = useState(0),
    [showAll, setShowAll] = useState(false),
    [queryTick, setQueryTick] = useState(0),
    [hero, setHero] = useState("AdAc");
  const selectedId = useRef(
      new URLSearchParams(location.search).get("case") ?? "",
    ),
    loaded = useRef(""),
    solutionId = useRef(""),
    loadedRanges = useRef<[string, string]>([initial.oop, initial.ip]),
    dirty = useRef(!!sourceId.current && !selectedId.current),
    restricted = useRef(false),
    loadingCase = useRef(""),
    loadTicket = useRef(0),
    alive = useRef(true);
  async function adopt(c: RealCase) {
    if (loadingCase.current === c.ref.contentHash) return;
    loadingCase.current = c.ref.contentHash;
    const ticket = ++loadTicket.current;
    try {
      const [oop, ip] = await Promise.all(c.ranges.map(readRange));
      if (
        !alive.current ||
        restricted.current ||
        dirty.current ||
        ticket !== loadTicket.current
      )
        return;
      setSelected(c);
      selectedId.current = c.ref.id;
      loaded.current = c.ref.contentHash;
      loadedRanges.current = [oop, ip];
      setDraft({
        name: c.name,
        board: c.board.join(" "),
        pot: String(c.pot / 100),
        stack: String(c.stack / 100),
        betPercent: c.betPercent,
        model: c.tree ? "explicit" : "simple",
        treeText: c.tree ? formatTree(c.tree) : initial.treeText,
        oop,
        ip,
      });
      history.replaceState(
        null,
        "",
        `/solver/real?case=${encodeURIComponent(c.ref.id)}${sourceId.current ? `&source=${encodeURIComponent(sourceId.current)}` : ""}`,
      );
    } catch (e) {
      if (alive.current) setMessage(String(e));
    } finally {
      if (ticket === loadTicket.current) loadingCase.current = "";
    }
  }
  async function sync() {
    const state = await invoke<Workspace>("real_workspace_get", {
      ...(selectedId.current ? { caseId: selectedId.current } : {}),
      ...(solutionId.current ? { solutionId: solutionId.current } : {}),
    });
    if (!alive.current) return;
    restricted.current = state.restricted;
    setWorkspace(state);
    if (state.restricted) {
      solutionId.current = "";
      setSolution(undefined);
      setQuery(undefined);
      setAggregate(undefined);
      return;
    }
    if (selectedId.current && !state.selectedCase) {
      selectedId.current = "";
      loaded.current = "";
      ++loadTicket.current;
      loadingCase.current = "";
      setSelected(undefined);
      setSpec(undefined);
      solutionId.current = "";
      setSolution(undefined);
      setSolutionSpec(undefined);
      setQuery(undefined);
      setAggregate(undefined);
      history.replaceState(null, "", "/solver/real");
      setMessage("原局面已不在当前工作区索引中，草稿保留，可另存为新作品。");
    }
    if (solutionId.current && !state.selectedSolution) {
      solutionId.current = "";
      setSolution(undefined);
      setSolutionSpec(undefined);
      setQuery(undefined);
      setAggregate(undefined);
      setMessage("该固定解不在当前恢复的工作区中，已清除旧结果显示。");
    }
    const current = state.selectedCase;
    if (current && current.ref.contentHash !== loaded.current && !dirty.current)
      void adopt(current);
  }
  useEffect(() => {
    if (!sourceId.current) return;
    let active = true;
    void gameCall<ResearchSource>("game_study_get", {
      studyId: sourceId.current,
    })
      .then((source) => {
        if (!active) return;
        setPracticeSource(source);
        setResearchNote(source.note ?? "");
        if (selectedId.current) return;
        if (source.caseRef) {
          selectedId.current = source.caseRef.id;
          dirty.current = false;
          void sync();
          return;
        }
        const root = source.root;
        const path: string[] = [],
          lines: string[] = [];
        let wagered = false;
        for (const action of root?.path ?? []) {
          path.push(
            action.kind === "raise"
              ? `${wagered ? "加注" : "下注"}至 ${action.amount! / 100}`
              : action.kind === "check"
                ? "过牌"
                : action.kind === "call"
                  ? "跟注"
                  : "弃牌",
          );
          if (action.kind === "raise") {
            lines.push(path.join(" > "));
            wagered = true;
          }
        }
        const bet = root
          ? Math.max(1, Math.min(root.stack, Math.round(root.pot / 2))) / 100
          : 1;
        setSelected(undefined);
        setSpec(undefined);
        setSolution(undefined);
        setQuery(undefined);
        setAggregate(undefined);
        setDraft({
          ...initial,
          name: `第 ${source.snapshot.number} 手 · 决策研究`,
          board: (root?.board ?? source.snapshot.board).join(" "),
          pot: String((root?.pot ?? source.snapshot.pot) / 100),
          stack: String(
            (root?.stack ??
              Math.min(
                ...source.snapshot.stacks.filter(
                  (_, i) => source.snapshot.active[i],
                ),
              )) / 100,
          ),
          model: "explicit",
          treeText: lines.length
            ? lines.join("\n")
            : `下注至 ${bet}\n过牌 > 下注至 ${bet}`,
          oop: "",
          ip: "",
        });
      })
      .catch((e) => {
        if (active) setMessage(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    alive.current = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await sync();
      } catch (e) {
        if (alive.current) {
          setMessage(String(e));
          if (String(e).includes("INFORMATION_RESTRICTED")) {
            restricted.current = true;
            setAccessError(
              String(e).replace(/^Error: INFORMATION_RESTRICTED · /, ""),
            );
            setSolution(undefined);
            setQuery(undefined);
            setMatrixRows([]);
          }
        }
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage("正在处理，请稍候…");
    try {
      await task();
      await sync();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  async function saveCase() {
    const pot = centibb(draft.pot),
      stack = centibb(draft.stack);
    const payload = {
      name: draft.name,
      board: draft.board.trim().split(/\s+/),
      pot,
      stack,
      betPercent: draft.betPercent,
      ...(draft.model === "explicit"
        ? { tree: parseTree(draft.treeText) }
        : selected
          ? { tree: null }
          : {}),
      ...(!selected ||
      draft.oop !== loadedRanges.current[0] ||
      draft.ip !== loadedRanges.current[1]
        ? { ranges: [parseRange(draft.oop), parseRange(draft.ip)] }
        : {}),
    };
    const c = selected
      ? await invoke<RealCase>("real_case_revise", {
          ...payload,
          caseId: `${selected.ref.id}@${selected.ref.version}`,
        })
      : await invoke<RealCase>("real_case_create", payload);
    dirty.current = false;
    await adopt(c);
    if (
      practiceSource?.eligible &&
      practiceSource.root?.board.join() === c.board.join()
    ) {
      setPracticeSource(
        await gameCall<ResearchSource>("game_study_link", {
          studyId: practiceSource.id,
          caseId: c.ref.id,
        }),
      );
    }
    setSpec(undefined);
    setMessage("局面与范围版本已保存。旧规格和旧解保持固定。");
  }
  async function freeze() {
    if (!selected) throw Error("请先保存局面和范围");
    if (dirty.current)
      throw Error("请先保存草稿，避免把未保存输入当成求解规格");
    const fixed = await invoke<RealSpec>("real_spec_create", {
      caseId: `${selected.ref.id}@${selected.ref.version}`,
    });
    setSpec(fixed);
    const check = await invoke<{ supported: boolean; reason?: string }>(
      "real_preflight",
      { specId: fixed.ref.id },
    );
    setMessage(
      check.supported
        ? "原生引擎预检通过，可以发起真实分析。"
        : `未支持：${check.reason}`,
    );
  }
  async function start() {
    if (!spec) throw Error("请先固定规格并预检");
    const j = await invoke<RealJob>("real_analysis_start", {
      specId: spec.ref.id,
    });
    setMessage(`真实作业已保存：${statuses[j.status]}。刷新页面不会取消计算。`);
  }
  async function openSolution(id: string) {
    const result = await invoke<RealSolution>("real_solution_load", {
      solutionId: id,
    });
    const source = await invoke<RealSpec>("artifact_inspect", {
      artifactId: `${result.spec.id}@${result.spec.version}`,
    });
    if (restricted.current) return;
    setSolution(result);
    solutionId.current = result.ref.id;
    setSolutionSpec(source);
    setPath([]);
    setHand("");
    setOffset(0);
    setMessage(
      result.quality === "target-met"
        ? "已读取固定真实解，质量目标达标。"
        : "执行已结束，但预算内未达到所请求的质量目标。请结合指标使用。",
    );
  }
  useEffect(() => {
    let active = true;
    if (!solution || restricted.current) return;
    setQuery(undefined);
    setAggregate(undefined);
    setMatrixRows([]);
    void Promise.all([
      invoke<Query>("real_solution_query", {
        solutionId: solution.ref.id,
        path,
        player,
        offset,
        limit: 30,
        inRangeOnly: !showAll,
        hand: hand || undefined,
      }),
      invoke<Aggregate>("real_range_aggregate", {
        solutionId: solution.ref.id,
        path,
        player,
      }),
      invoke<Query>("real_solution_query", {
        solutionId: solution.ref.id,
        path,
        player,
        limit: 200,
        inRangeOnly: true,
      }),
    ])
      .then(([q, a, m]) => {
        if (active && !restricted.current) {
          setQuery(q);
          setAggregate(a);
          setMatrixRows(m.items);
        }
      })
      .catch((e) => {
        if (active) setMessage(String(e));
      });
    return () => {
      active = false;
    };
  }, [
    solution?.ref.contentHash,
    JSON.stringify(path),
    player,
    offset,
    hand,
    showAll,
    queryTick,
  ]);
  const [heroRow, setHeroRow] = useState<Row>();
  useEffect(() => {
    let active = true;
    if (!solution || restricted.current) {
      setHeroRow(undefined);
      return;
    }
    setHeroRow(undefined);
    void invoke<Query>("real_solution_query", {
      solutionId: solution.ref.id,
      path,
      player,
      combos: [hero],
    })
      .then((q) => {
        if (active && !restricted.current) setHeroRow(q.items[0]);
      })
      .catch(() => {
        if (active) setHeroRow(undefined);
      });
    return () => {
      active = false;
    };
  }, [
    solution?.ref.contentHash,
    JSON.stringify(path),
    player,
    hero,
    queryTick,
  ]);
  async function backup() {
    const item = await invoke<{ ref: Ref; pages: number }>("workspace_export");
    const chunks: Uint8Array[] = [];
    for (let page = 0; page < item.pages; page++) {
      const part = await invoke<{ data: string }>("artifact_page", {
        artifactId: item.ref.id,
        page,
      });
      chunks.push(Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0)));
    }
    const url = URL.createObjectURL(
      new Blob(chunks as BlobPart[], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "riverline-analysis-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("已导出同一工作区备份，包含固定真实输入、原生解和节点制品。");
  }
  const update = (key: keyof typeof initial, value: string) => {
    dirty.current = true;
    setDraft((old) => ({ ...old, [key]: value }));
  };
  const conflict =
    workspace?.selectedCase &&
    selected &&
    workspace.selectedCase.ref.contentHash !== selected.ref.contentHash;
  const currentJobs =
    workspace?.jobs.filter(
      (j) =>
        (!selected && !practiceSource) ||
        workspace.specs.find((sp) => sp.ref.id === j.spec.id)?.situation.id ===
          selected?.ref.id,
    ) ?? [];
  if (workspace?.restricted || accessError)
    return (
      <main className={s.protected}>
        <ProductNav />
        <h1>独立作答进行中</h1>
        <p>{accessError || "请先完成作答，或登记使用参考后再进入研究。"}</p>
        <a href={accessError ? "/play" : "/solver"}>返回作答</a>
      </main>
    );
  return (
    <main className={s.page}>
      <ProductNav />
      <header className={s.header}>
        <div>
          <h1>河牌研究</h1>
          <p>两人 · 给定范围 · 自定义行动树</p>
        </div>
        <nav>
          {practiceSource && (
            <a href={`/hands?hand=${practiceSource.handId}`}>返回原手牌</a>
          )}
          <button onClick={() => void run(backup)} disabled={busy}>
            导出研究
          </button>
        </nav>
      </header>
      {practiceSource && (
        <details
          className={s.source}
          open={!solution}
          aria-label="原手牌研究来源"
        >
          <summary>原决策与研究笔记</summary>
          <div>
            <strong>
              来自第 {practiceSource.snapshot.number} 手 ·{" "}
              {practiceSource.sequence + 1} 号行动前
            </strong>
            <span>
              {practiceSource.eligible
                ? "以河牌开始时为根；双方范围需要你设定。"
                : "该节点暂不支持真实求解，可先保存研究问题。"}
            </span>
          </div>
          <details>
            <summary>原行动与分析边界</summary>
            <Board cards={practiceSource.snapshot.board} />
            <p>
              Hero{" "}
              <ComboCards combo={practiceSource.snapshot.heroCards.join("")} />{" "}
              · 当时底池 {practiceSource.snapshot.pot / 100} bb
            </p>
            <p>
              {practiceSource.snapshot.events
                .map(
                  (a) =>
                    `座位 ${a.actor + 1} ${a.kind}${a.amount ? ` ${a.amount / 100} bb` : ""}`,
                )
                .join(" → ") || "翻前首个决策"}
            </p>
            <p>
              两人局部模型，无抽水；原背景 {practiceSource.snapshot.players}{" "}
              人。输入范围属于研究假设，忽略弃牌私牌相关性；结果不代表整手或六人均衡。
            </p>
          </details>
          <label>
            研究问题
            <textarea
              aria-label="研究问题"
              value={researchNote}
              rows={2}
              onChange={(e) => setResearchNote(e.target.value)}
            />
          </label>
          <div className={s.actions}>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPracticeSource(
                    await gameCall<ResearchSource>("game_study_note", {
                      studyId: practiceSource.id,
                      note: researchNote,
                    }),
                  );
                  setMessage("研究问题已保存");
                })
              }
            >
              保存笔记
            </button>
            <a href="/solver/real">新建独立河牌研究</a>
          </div>
        </details>
      )}
      {message && (
        <div className={s.notice} role="status">
          {message}
        </div>
      )}
      <div className={s.layout}>
        <aside className={s.panel}>
          <fieldset
            disabled={busy || practiceSource?.eligible === false}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className={s.sectionHead}>
              <h2>局面与范围</h2>
              <button
                onClick={() => {
                  ++loadTicket.current;
                  loadingCase.current = "";
                  selectedId.current = "";
                  loaded.current = "";
                  dirty.current = false;
                  sourceId.current = "";
                  setPracticeSource(undefined);
                  setResearchNote("");
                  setSelected(undefined);
                  setSpec(undefined);
                  setDraft(initial);
                  history.replaceState(null, "", "/solver/real");
                }}
              >
                新建
              </button>
            </div>
            {conflict && (
              <div className={s.warning}>
                MCP 或另一入口已更新该作品；当前草稿保留。
                <button
                  onClick={() => {
                    dirty.current = false;
                    void adopt(workspace!.selectedCase!);
                  }}
                >
                  接收最新版本
                </button>
              </div>
            )}
            <label>
              作品名称
              <input
                aria-label="作品名称"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label>
              公共牌（以空格分隔）
              <input
                aria-label="公共牌"
                value={draft.board}
                onChange={(e) => update("board", e.target.value)}
              />
            </label>
            <div className={s.two}>
              <label>
                根底池 bb
                <input
                  aria-label="根底池 bb"
                  value={draft.pot}
                  onChange={(e) => update("pot", e.target.value)}
                />
              </label>
              <label>
                有效后手 bb
                <input
                  aria-label="有效后手 bb"
                  value={draft.stack}
                  onChange={(e) => update("stack", e.target.value)}
                />
              </label>
            </div>
            <label>
              河牌树模型
              <select
                aria-label="河牌树模型"
                value={draft.model}
                onChange={(e) => update("model", e.target.value)}
              >
                <option value="simple">单一下注</option>
                <option value="explicit">自定义行动树</option>
              </select>
            </label>
            {draft.model === "explicit" ? (
              <>
                <label>
                  下注与加注路径
                  <textarea
                    aria-label="下注与加注路径"
                    rows={8}
                    value={draft.treeText}
                    onChange={(e) => update("treeText", e.target.value)}
                  />
                </label>
                <p className={s.muted}>
                  每行新增一个进攻路径，父路径在前。例：下注至
                  5；下一行可写「下注至 5 &gt; 加注至 10」。金额为本街累计投入
                  bb；全下需写「全下至」。过牌、弃牌、跟注由引擎保留。最多 32
                  行、每行 12 个行动，不自动合并或缩树。
                </p>
              </>
            ) : (
              <label>
                OOP 下注 / 底池 %
                <input
                  aria-label="下注百分比"
                  value={draft.betPercent}
                  onChange={(e) => update("betPercent", e.target.value)}
                />
              </label>
            )}
            <p className={s.muted}>
              范围使用「具体组合:输入权重%」，每行一组。最多每方 200
              个正权重组合；不会把未覆盖输入换成预置结果。
            </p>
            <label>
              OOP 输入范围
              <textarea
                aria-label="OOP 输入范围"
                rows={4}
                value={draft.oop}
                onChange={(e) => update("oop", e.target.value)}
              />
            </label>
            <label>
              IP 输入范围
              <textarea
                aria-label="IP 输入范围"
                rows={4}
                value={draft.ip}
                onChange={(e) => update("ip", e.target.value)}
              />
            </label>
            <button
              className={s.primary}
              disabled={busy}
              onClick={() => void run(saveCase)}
            >
              保存局面与范围
            </button>
            <div className={s.actions}>
              <button
                disabled={busy || !selected}
                onClick={() => void run(freeze)}
              >
                固定规格并预检
              </button>
              <button disabled={busy || !spec} onClick={() => void run(start)}>
                运行真实分析
              </button>
            </div>
            {selected && (
              <p className={s.muted}>
                局面版本 {selected.ref.version} · 范围{" "}
                {selected.ranges.map((r) => `v${r.version}`).join(" / ")}
              </p>
            )}
            <h3>最近作品</h3>
            {workspace?.cases
              .slice()
              .reverse()
              .map((c) => (
                <button
                  className={s.work}
                  key={c.ref.id}
                  onClick={() => {
                    dirty.current = false;
                    sourceId.current = "";
                    setPracticeSource(undefined);
                    void adopt(c);
                    setSpec(undefined);
                  }}
                >
                  {c.name}
                  <small>
                    v{c.ref.version} · {c.pot / 100} bb 底池
                  </small>
                </button>
              ))}
          </fieldset>
        </aside>
        <section className={s.content}>
          <details
            className={s.panel}
            open={
              !solution ||
              currentJobs.some((j) =>
                [
                  "queued",
                  "running",
                  "postprocessing",
                  "cancel_requested",
                ].includes(j.status),
              )
            }
          >
            <summary>计算与结果</summary>
            {!currentJobs.length && <p>还没有真实作业。</p>}
            {currentJobs
              .slice()
              .reverse()
              .map((j) => (
                <div className={s.job} key={j.ref.id}>
                  <div>
                    <strong>{statuses[j.status]}</strong>
                    <small>
                      第 {j.attempt} 次尝试 · {j.iterations.toLocaleString()}{" "}
                      迭代{" "}
                      {j.exploitabilityBb !== null
                        ? `· 可利用性 ${j.exploitabilityBb.toFixed(6)} bb`
                        : ""}
                    </small>
                    {j.error && <p className={s.error}>{j.error}</p>}
                  </div>
                  <div className={s.actions}>
                    {j.result && (
                      <button
                        onClick={() =>
                          void run(() => openSolution(j.result!.id))
                        }
                      >
                        打开真实解
                      </button>
                    )}
                    {["queued", "running", "cancel_requested"].includes(
                      j.status,
                    ) && (
                      <button
                        onClick={() =>
                          void run(async () => {
                            await invoke("real_analysis_cancel", {
                              jobId: j.ref.id,
                            });
                            setMessage("取消请求已处理，请以作业状态为准。");
                          })
                        }
                      >
                        取消
                      </button>
                    )}
                    {["failed", "interrupted", "cancelled"].includes(
                      j.status,
                    ) && (
                      <button
                        onClick={() =>
                          void run(async () => {
                            await invoke("real_analysis_retry", {
                              jobId: j.ref.id,
                            });
                            setMessage("已用原固定规格创建新尝试。");
                          })
                        }
                      >
                        按原规格重试
                      </button>
                    )}
                  </div>
                </div>
              ))}
            <div className={s.actions}>
              {workspace?.solutions
                .filter(
                  (m) =>
                    !practiceSource ||
                    (!!selected &&
                      workspace.specs.find((sp) => sp.ref.id === m.spec.id)
                        ?.situation.id === selected.ref.id),
                )
                .slice()
                .reverse()
                .map((m) => (
                  <button
                    key={m.ref.id}
                    onClick={() => void run(() => openSolution(m.ref.id))}
                  >
                    固定解 · {m.quality === "target-met" ? "达标" : "预算结束"}{" "}
                    · {m.iterations} 次
                  </button>
                ))}
            </div>
          </details>
          {solution && (
            <>
              <section className={s.panel}>
                <div className={s.sectionHead}>
                  <h2>全范围与 Hero</h2>
                </div>
                {selected &&
                  solutionSpec &&
                  selected.ref.contentHash !==
                    solutionSpec.situation.contentHash && (
                    <p className={s.warning}>
                      当前局面或范围与此固定解不同。这里保留旧输入的真实解；请用新规格重新分析，不会把旧值套到新输入。
                    </p>
                  )}
                <p
                  className={
                    solution.quality === "target-met" ? s.muted : s.warning
                  }
                >
                  {" "}
                  {solution.quality === "target-met"
                    ? "质量目标达标"
                    : "质量目标未达到"}{" "}
                  · NashConv {solution.nashConvBb.toFixed(6)} bb
                </p>
                {query && (
                  <>
                    <Board cards={query.node.board} />
                    <div className={s.actions}>
                      <button
                        onClick={() => {
                          setPlayer(0);
                          setOffset(0);
                        }}
                      >
                        OOP
                      </button>
                      <button
                        onClick={() => {
                          setPlayer(1);
                          setOffset(0);
                        }}
                      >
                        IP
                      </button>
                      <button
                        onClick={() => {
                          setPath([]);
                          setOffset(0);
                        }}
                      >
                        回到根节点
                      </button>
                      {query.node.path.length > 0 && (
                        <button
                          onClick={() => {
                            setPath(path.slice(0, -1));
                            setOffset(0);
                          }}
                        >
                          上一步
                        </button>
                      )}
                    </div>
                    <p>
                      当前路径：
                      {path.length
                        ? path.map((v, i) => `${i + 1}:${v}`).join(" → ")
                        : "根节点"}{" "}
                      ·{" "}
                      {query.node.terminal
                        ? "终局"
                        : query.node.actor === 0
                          ? "OOP 行动"
                          : "IP 行动"}{" "}
                      · 底池 {query.node.potBb.toFixed(2)} bb
                    </p>
                    <div className={s.actions}>
                      {query.node.actions.map((a, i) => (
                        <button
                          key={a}
                          onClick={() => {
                            setPath([...path, i]);
                            setOffset(0);
                          }}
                        >
                          {label(a)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button onClick={() => setQueryTick((t) => t + 1)}>
                  重新读取节点
                </button>
                <div className={s.actions} aria-label="矩阵视图">
                  {(
                    [
                      ["strategy", "策略"],
                      ["weight", "范围占比"],
                      ["equity", "权益"],
                      ["ev", "EV"],
                    ] as const
                  ).map(([key, name]) => (
                    <button
                      key={key}
                      aria-pressed={matrixMetric === key}
                      onClick={() => setMatrixMetric(key)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className={s.matrix}>
                  {handClasses.map((h) => {
                    const mass =
                      aggregate?.classes.find((c) => c.hand === h.label)
                        ?.probability ?? 0;
                    const rows = matrixRows.filter(
                        (r) =>
                          r.hand === h.label &&
                          (r.conditionalProbability ?? 0) > 0,
                      ),
                      weight = rows.reduce(
                        (n, r) => n + r.conditionalProbability!,
                        0,
                      );
                    const metric = (key: "equity" | "evBb") =>
                      weight > 0 && rows.every((r) => r[key] !== null)
                        ? rows.reduce(
                            (n, r) => n + r.conditionalProbability! * r[key]!,
                            0,
                          ) / weight
                        : null;
                    let background: string | undefined;
                    if (
                      matrixMetric === "strategy" &&
                      weight > 0 &&
                      rows.every((r) => r.allocation)
                    ) {
                      let end = 0;
                      const stops = query?.node.actions.map((action, i) => {
                        const start = end;
                        end +=
                          (rows.reduce(
                            (n, r) =>
                              n + r.conditionalProbability! * r.allocation![i],
                            0,
                          ) /
                            weight) *
                          100;
                        const color =
                          action === "Fold"
                            ? "#647386"
                            : action === "Check" || action === "Call"
                              ? "#256eab"
                              : action.startsWith("AllIn")
                                ? "#794291"
                                : action.startsWith("Raise")
                                  ? "#a43535"
                                  : "#ac4c1a";
                        return `${color} ${start}% ${end}%`;
                      });
                      if (stops?.length)
                        background = `linear-gradient(to right,${stops.join(",")})`;
                    } else if (matrixMetric === "weight" && mass > 0)
                      background = `rgba(63,178,145,${Math.min(0.85, 0.2 + mass)})`;
                    return (
                      <button
                        key={h.label}
                        title={`${h.label} 条件占比 ${pct(mass)} · 权益 ${pct(metric("equity"))} · EV ${bb(metric("evBb"))}`}
                        className={hand === h.label ? s.chosen : ""}
                        style={{
                          background,
                          color:
                            matrixMetric === "strategy" && background
                              ? "#fff"
                              : undefined,
                        }}
                        onClick={() => {
                          setHand(hand === h.label ? "" : h.label);
                          setOffset(0);
                        }}
                      >
                        {h.label}
                        {matrixMetric === "equity" && mass > 0 && (
                          <small>
                            {metric("equity") === null
                              ? "—"
                              : `${(metric("equity")! * 100).toFixed(0)}%`}
                          </small>
                        )}
                        {matrixMetric === "ev" && mass > 0 && (
                          <small>{metric("evBb")?.toFixed(1) ?? "—"}</small>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className={s.muted}>
                  {matrixMetric === "strategy"
                    ? "分段表示当前行动频率；非行动方仅可查看范围与数值。"
                    : matrixMetric === "weight"
                      ? "各牌类在当前兼容组合分布中的占比。"
                      : "格内数值按当前兼容组合权重汇总；EV 单位 bb。"}
                </p>
                <label>
                  Hero 具体组合
                  <input
                    aria-label="Hero 具体组合"
                    value={hero}
                    onChange={(e) => setHero(e.target.value)}
                  />
                </label>
                {heroRow && (
                  <div className={s.hero}>
                    <ComboCards combo={heroRow.combo} />
                    <span>
                      {heroRow.availability === "available"
                        ? `权益 ${pct(heroRow.equity)} · EV ${bb(heroRow.evBb)}`
                        : heroRow.availability === "dead"
                          ? "与公共牌冲突"
                          : heroRow.availability === "unreachable"
                            ? "当前路径不可达"
                            : "不在输入范围中"}
                    </span>
                    {heroRow.allocation && (
                      <span>
                        {heroRow.allocation
                          .map(
                            (v, i) =>
                              `${label(query?.node.actions[i] ?? "")} ${pct(v)}`,
                          )
                          .join(" / ")}
                      </span>
                    )}
                  </div>
                )}
                <p className={s.muted}>
                  EV 以当前引擎节点为原点，历史投入视为沉没；终局 EV
                  包含未跟注返还，无抽水。组合比例在兼容私牌与当前路径上条件化，不是从根到达概率。
                </p>
                {heroRow?.allocation && (
                  <table aria-label="Hero 行动比较">
                    <thead>
                      <tr>
                        <th>行动</th>
                        <th>频率</th>
                        <th>行动 EV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heroRow.allocation.map((f, i) => (
                        <tr key={i}>
                          <td>{label(query?.node.actions[i] ?? "")}</td>
                          <td>{pct(f)}</td>
                          <td>{bb(heroRow.actionEvBb?.[i] ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className={s.actions}>
                  <button
                    onClick={() => {
                      setHand("");
                      setOffset(0);
                    }}
                  >
                    全部组合
                  </button>
                  <button
                    onClick={() => {
                      setShowAll(!showAll);
                      setOffset(0);
                    }}
                  >
                    {showAll ? "只看输入范围" : "显示全部 1,326 组合"}
                  </button>
                  {aggregate?.frequencies.map((a) => (
                    <span className={s.stat} key={a.action}>
                      {label(a.action)} {pct(a.frequency)}
                    </span>
                  ))}
                </div>
                <div
                  className={s.tableWrap}
                  role="region"
                  aria-label="具体组合表"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>具体组合</th>
                        <th>输入 / 路径权重</th>
                        <th>条件占比</th>
                        <th>权益</th>
                        <th>EV</th>
                        <th>动作频率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query?.items.map((r) => (
                        <tr key={r.combo} onClick={() => setHero(r.combo)}>
                          <td>
                            <ComboCards combo={r.combo} />
                          </td>
                          <td>
                            {pct(r.inputWeight)} / {pct(r.ownReachWeight)}
                          </td>
                          <td>{pct(r.conditionalProbability)}</td>
                          <td>{pct(r.equity)}</td>
                          <td>{bb(r.evBb)}</td>
                          <td>
                            {r.allocation
                              ? r.allocation
                                  .map(
                                    (n, i) =>
                                      `${label(query.node.actions[i])} ${pct(n)}`,
                                  )
                                  .join(" / ")
                              : r.availability === "dead"
                                ? "牌面冲突"
                                : r.availability === "unreachable"
                                  ? "不可达"
                                  : r.availability === "outside-input-range"
                                    ? "不在输入范围"
                                    : "该玩家当前不行动"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={s.actions}>
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 30))}
                  >
                    上一页
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 30, query?.total ?? 0)} /{" "}
                    {query?.total ?? 0}
                  </span>
                  <button
                    disabled={query?.nextOffset === null}
                    onClick={() => setOffset(query?.nextOffset ?? 0)}
                  >
                    下一页
                  </button>
                  {query &&
                    !query.node.terminal &&
                    query.node.actions.map((action, index) => (
                      <button
                        key={action}
                        onClick={() =>
                          void run(async () => {
                            const r = await invoke<{ ref: Ref }>(
                              "real_range_derive",
                              {
                                solutionId: solution.ref.id,
                                path,
                                action: index,
                              },
                            );
                            setMessage(
                              `已沿固定行动保存派生范围 ${r.ref.id}；来源与原解保留，编辑它会创建新假设。`,
                            );
                          })
                        }
                      >
                        保存{label(action)}后的范围
                      </button>
                    ))}
                </div>
                <details>
                  <summary>固定来源与计算说明</summary>
                  <p>
                    解 {solution.ref.id} · 规格 {solution.spec.id}
                  </p>
                  <p>
                    完整引擎提交 {solution.engineCommit} · {solution.algorithm}
                  </p>
                  <p>二进制 {solution.binaryHash}</p>
                  {solutionSpec && (
                    <p>
                      固定局面 v{solutionSpec.situation.version} · OOP 范围 v
                      {solutionSpec.ranges[0].version} / IP 范围 v
                      {solutionSpec.ranges[1].version} · 下注树{" "}
                      {solutionSpec.treeHash}
                    </p>
                  )}
                  <p>
                    本地原生解、节点制品与输入均随工作区备份保存。此解只属于给定范围与受限下注树，不代表整体扑克
                    GTO 或六人均衡。
                  </p>
                </details>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
