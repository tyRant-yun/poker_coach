import { useEffect, useRef, useState } from "react";
import { connectAnalysis } from "./client";
import { Board, ComboCards } from "../../shared/ui";
import { handClasses } from "../study/domain";
import type { Reply, Ref } from "./domain";
import type {
  RealCase,
  RealSpec,
  RealJob,
  RealSolution,
  RealTool,
} from "./real-domain";
import s from "./RealAnalysisPage.module.css";

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
  return `${action.startsWith("AllIn") ? "全下至" : "下注至"} ${amount ? Number(amount[1]) / 100 : ""} bb`;
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
  const [workspace, setWorkspace] = useState<Workspace>(),
    [draft, setDraft] = useState(initial),
    [selected, setSelected] = useState<RealCase>(),
    [spec, setSpec] = useState<RealSpec>(),
    [solution, setSolution] = useState<RealSolution>(),
    [solutionSpec, setSolutionSpec] = useState<RealSpec>(),
    [query, setQuery] = useState<Query>(),
    [aggregate, setAggregate] = useState<Aggregate>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [player, setPlayer] = useState<0 | 1>(0),
    [path, setPath] = useState<number[]>([]),
    [hand, setHand] = useState(""),
    [offset, setOffset] = useState(0),
    [showAll, setShowAll] = useState(false),
    [hero, setHero] = useState("AdAc");
  const selectedId = useRef(
      new URLSearchParams(location.search).get("case") ?? "",
    ),
    loaded = useRef(""),
    solutionId = useRef(""),
    loadedRanges = useRef<[string, string]>([initial.oop, initial.ip]),
    dirty = useRef(false),
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
        oop,
        ip,
      });
      history.replaceState(
        null,
        "",
        `/solver/real?case=${encodeURIComponent(c.ref.id)}`,
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
    alive.current = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await sync();
      } catch (e) {
        if (alive.current) setMessage(String(e));
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
    const centibb = (text: string) => {
      if (!/^\d+(?:\.\d{1,2})?$/.test(text))
        throw Error("金额最多支持小数点后两位 bb，不会自动舍入");
      const [whole, fraction = ""] = text.split(".");
      const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (!Number.isSafeInteger(value)) throw Error("金额超出支持范围");
      return value;
    };
    const pot = centibb(draft.pot),
      stack = centibb(draft.stack);
    const payload = {
      name: draft.name,
      board: draft.board.trim().split(/\s+/),
      pot,
      stack,
      betPercent: draft.betPercent,
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
    ])
      .then(([q, a]) => {
        if (active && !restricted.current) {
          setQuery(q);
          setAggregate(a);
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
  ]);
  const [heroRow, setHeroRow] = useState<Row>();
  useEffect(() => {
    let active = true;
    if (!solution || restricted.current) {
      setHeroRow(undefined);
      return;
    }
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
  }, [solution?.ref.contentHash, JSON.stringify(path), player, hero]);
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
        !selected ||
        workspace.specs.find((sp) => sp.ref.id === j.spec.id)?.situation.id ===
          selected.ref.id,
    ) ?? [];
  if (workspace?.restricted)
    return (
      <main className={s.protected}>
        <h1>独立作答进行中</h1>
        <p>
          真实分析、结果和范围暂不可读取。请先完成作答或在研究工作台登记辅助身份。
        </p>
        <a href="/solver">返回作答与揭示入口</a>
      </main>
    );
  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <a href="/">Riverline</a>
          <span> / Solver</span>
          <h1>真实 HU 河牌研究</h1>
          <p>
            给定范围的两人局部解 · 无抽水 · OOP 过牌或单一下注，IP 过牌或弃牌 /
            跟注
          </p>
        </div>
        <nav>
          <a href="/solver">示例工作台</a>
          <button onClick={() => void run(backup)} disabled={busy}>
            导出工作区
          </button>
        </nav>
      </header>
      <div className={s.notice} role="status">
        {message ||
          "配置并保存范围，固定规格后运行真实分析。当前不支持加注、多街或六人整体均衡。"}
      </div>
      <div className={s.layout}>
        <aside className={s.panel}>
          <fieldset
            disabled={busy}
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
              OOP 下注 / 底池 %
              <input
                aria-label="下注百分比"
                value={draft.betPercent}
                onChange={(e) => update("betPercent", e.target.value)}
              />
            </label>
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
          <section className={s.panel}>
            <div className={s.sectionHead}>
              <h2>真实作业与固定解</h2>
              <span className={s.badge}>独立计算进程</span>
            </div>
            <p className={s.muted}>
              一次只运行一个真实计算。取消需等待确认；中断后用原规格重试，不承诺从旧迭代续算。
            </p>
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
          </section>
          {solution && (
            <>
              <section className={s.panel}>
                <div className={s.sectionHead}>
                  <h2>全范围与 Hero</h2>
                  <strong className={s.badge}>真实计算证据</strong>
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
                  执行完成 · 已覆盖当前受限模型 ·{" "}
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
                <div className={s.matrix}>
                  {handClasses.map((h) => {
                    const mass =
                      aggregate?.classes.find((c) => c.hand === h.label)
                        ?.probability ?? 0;
                    return (
                      <button
                        key={h.label}
                        title={`${h.label} 条件占比 ${pct(mass)}`}
                        className={hand === h.label ? s.chosen : ""}
                        style={{
                          background:
                            mass > 0
                              ? `rgba(63,178,145,${Math.min(0.85, 0.2 + mass)})`
                              : undefined,
                        }}
                        onClick={() => {
                          setHand(hand === h.label ? "" : h.label);
                          setOffset(0);
                        }}
                      >
                        {h.label}
                      </button>
                    );
                  })}
                </div>
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
