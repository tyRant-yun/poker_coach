import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Board } from "../../shared/ui";
import { ProductNav } from "./ProductNav";
import { gameCall } from "./client";
import { positions, streetNames } from "./domain";
import type {
  HandSummary,
  HandView,
  LegalAction,
  ResearchSource,
} from "./domain";
import s from "./Play.module.css";
import { usePlayback } from "./presentation";
import { AutoReviewPanel } from "./AutoReviewPanel";

const amount = (n: number) => `${(n / 100).toFixed(n % 100 ? 2 : 0)} bb`;
const actionName = (kind: string) =>
  ({ check: "过牌", fold: "弃牌", call: "跟注", raise: "下注/加注至" })[kind] ??
  kind;
export function PlayPage() {
  const location = useLocation(),
    navigate = useNavigate(),
    reviewMode = location.pathname === "/hands";
  const [hands, setHands] = useState<HandSummary[]>([]),
    [showCompletedTable, setShowCompletedTable] = useState(false),
    [reviewLoading, setReviewLoading] = useState(false),
    [hand, setHand] = useState<HandView>(),
    [snapshot, setSnapshot] = useState<HandView>(),
    [decision, setDecision] = useState<number>(),
    [raise, setRaise] = useState(""),
    [players, setPlayers] = useState<2 | 6>(6),
    [positionMode, setPositionMode] = useState<"rotate" | "fixed" | "random">(
      "rotate",
    ),
    [fixedPosition, setFixedPosition] = useState(0),
    [botId, setBotId] = useState("baseline-heuristic/1"),
    [bots, setBots] = useState<
      {
        id: string;
        name: string;
        available: boolean;
        tableSizes: number[];
        description: string;
      }[]
    >([]),
    [filterPosition, setFilterPosition] = useState(""),
    [filterStreet, setFilterStreet] = useState(""),
    [markedOnly, setMarkedOnly] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const params = new URLSearchParams(location.search),
    selected = params.get("hand"),
    requestedDecision = params.get("decision");
  const selectionTicket = useRef(0);
  const playback = usePlayback(setError);
  const mounted = useRef(true),
    route = useRef(location.pathname + location.search),
    settings = useRef<HTMLDetailsElement>(null);
  route.current = location.pathname + location.search;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const listInput = () =>
    reviewMode
      ? {
          position: filterPosition || undefined,
          street: filterStreet === "" ? undefined : Number(filterStreet),
          markedOnly,
        }
      : {};
  useEffect(() => {
    void gameCall<typeof bots>("game_bot_list")
      .then(setBots)
      .catch(() => {});
  }, []);
  const setFilter = (fn: () => void) => {
    fn();
    navigate("/hands");
  };
  async function load() {
    const list = await gameCall<HandSummary[]>("game_list", listInput());
    setHands(list);
    const id = selected ?? list[0]?.id;
    if (id) {
      const current = await gameCall<HandView>("game_get", { handId: id });
      setHand(current);
    }
  }
  useEffect(() => {
    playback.cancel(false);
    ++selectionTicket.current;
    let alive = true;
    setReviewLoading(reviewMode);
    setSnapshot(undefined);
    setDecision(undefined);
    setHand((current) => (current?.id === selected ? current : undefined));
    setError("");
    void gameCall<HandSummary[]>("game_list", listInput())
      .then(async (list) => {
        if (!alive) return;
        setHands(list);
        const id = selected ?? list[0]?.id;
        if (id) {
          const h = await gameCall<HandView>("game_get", { handId: id });
          if (alive) {
            setHand(h);
            setPlayers(h.players);
            setPositionMode(h.session?.mode ?? "rotate");
            setFixedPosition(h.session?.fixedPosition ?? 0);
            setBotId(h.session?.botId ?? "baseline-heuristic/1");
            if (reviewMode && h.complete) {
              const explicit =
                requestedDecision !== null
                  ? Number(requestedDecision)
                  : undefined;
              const first =
                h.decisions.find((d) => d.sequence === explicit) ??
                h.decisions.find((d) => d.marked) ??
                h.decisions[0];
              if (first) {
                const before = await gameCall<HandView>("game_review", {
                  handId: h.id,
                  decision: first.sequence,
                });
                if (alive) {
                  setDecision(first.sequence);
                  setSnapshot(before);
                }
              }
            }
          }
        }
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      })
      .finally(() => {
        if (alive) setReviewLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    selected,
    requestedDecision,
    reviewMode,
    filterPosition,
    filterStreet,
    markedOnly,
  ]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setShowCompletedTable(false);
    if (settings.current) settings.current.open = false;
    const origin = route.current;
    const next =
      hand?.complete &&
      players === hand.players &&
      (!hand.session ||
        (positionMode === hand.session.mode &&
          fixedPosition === hand.session.fixedPosition &&
          botId === hand.session.botId));
    const h = await gameCall<HandView>(
      next ? "game_next" : "game_create",
      next
        ? { handId: hand.id }
        : { players, positionMode, fixedPosition, botId },
    );
    setSnapshot(undefined);
    setDecision(undefined);
    await playback.play(h, () => setHand(h));
    if (!mounted.current || route.current !== origin) return;
    navigate(`/play?hand=${h.id}`);
    setHands(await gameCall<HandSummary[]>("game_list", listInput()));
  };
  const exportHands = async () => {
    const backup = await gameCall("game_export"),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: "application/json" }),
      );
    const link = document.createElement("a");
    link.href = url;
    link.download = "riverline-hands-backup.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const act = async (a: LegalAction) => {
    if (!hand) return;
    const extra =
      a.kind === "raise"
        ? { amount: parseAmount(raise || String(a.min! / 100)) }
        : {};
    const h = await gameCall<HandView>("game_act", {
      handId: hand.id,
      handRevision: hand.revision,
      kind: a.kind,
      ...extra,
    });
    setRaise("");
    await playback.play(h, () => setHand(h));
    setHands(await gameCall<HandSummary[]>("game_list", listInput()));
  };
  const selectDecision = async (sequence: number) => {
    const ticket = ++selectionTicket.current,
      handId = hand!.id;
    const view = await gameCall<HandView>("game_review", {
      handId: hand!.id,
      decision: sequence,
    });
    if (mounted.current && ticket === selectionTicket.current) {
      setSnapshot(view);
      setDecision(sequence);
      navigate(`/hands?hand=${handId}&decision=${sequence}`, { replace: true });
    }
  };
  const study = async () => {
    const report = await gameCall<import("./review").ReviewReport>(
      "game_review_report",
      { handId: hand!.id },
    );
    if (report.nodes.find((n) => n.sequence === decision)?.solutionId) {
      const opened = await gameCall<{ sourceId: string; caseId: string }>(
        "game_review_open",
        { handId: hand!.id, decision },
      );
      navigate(
        `/solver/real?case=${encodeURIComponent(opened.caseId)}&source=${encodeURIComponent(opened.sourceId)}`,
      );
      return;
    }
    const source = await gameCall<ResearchSource>("game_research", {
      handId: hand!.id,
      decision,
    });
    navigate(`/solver/real?source=${encodeURIComponent(source.id)}`);
  };
  const view = snapshot ?? playback.frame?.view ?? hand,
    feedbackMode = !reviewMode && !!hand?.complete && !playback.playing,
    raiseAction = hand?.legal.find((a) => a.kind === "raise"),
    callAction = hand?.legal.find((a) => a.kind === "call");
  return (
    <main className={`${s.page} ${!reviewMode ? s.practice : ""}`}>
      <ProductNav />
      <div className={s.heading}>
        <div>
          <h1>{reviewMode ? "手牌复盘" : "整手练习"}</h1>
          <p hidden={!reviewMode}>
            {reviewMode
              ? "选一手牌，回到当时的决定。"
              : "从翻前打完一手，再看值得研究的决定。"}
          </p>
        </div>
        {!reviewMode && (
          <div className={s.start}>
            <>
              <label>
                桌型
                <select
                  aria-label="桌型"
                  value={players}
                  disabled={
                    busy || playback.playing || (!!hand && !hand.complete)
                  }
                  onChange={(e) => {
                    setPlayers(Number(e.target.value) as 2 | 6);
                    setFixedPosition(0);
                    if (e.target.value === "6")
                      setBotId("baseline-heuristic/1");
                  }}
                >
                  <option value={6}>6 人桌</option>
                  <option value={2}>单挑</option>
                </select>
              </label>
              {!hand && (
                <button
                  className={s.primary}
                  onClick={() => void run(create)}
                  disabled={busy}
                >
                  开始练习
                </button>
              )}
            </>
          </div>
        )}
        {!reviewMode && (
          <div className={s.playbackControls}>
            <label>
              行动节奏{" "}
              <select
                aria-label="行动节奏"
                value={playback.speed}
                onChange={(e) =>
                  playback.setSpeed(
                    e.target.value as "comfort" | "fast" | "instant",
                  )
                }
              >
                <option value="comfort">舒适</option>
                <option value="fast">快速</option>
                <option value="instant">即时</option>
              </select>
            </label>
            <div className={s.playbackStatus} hidden={!playback.playing}>
              <button
                aria-label="跳过动作播放"
                onClick={() => playback.cancel()}
              >
                跳过播放
              </button>
            </div>
          </div>
        )}
        {!reviewMode && (
          <details
            ref={settings}
            className={s.sessionSettings}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.open = false;
                e.currentTarget
                  .querySelector("summary")
                  ?.focus({ preventScroll: true });
              }
            }}
          >
            <summary>位置与对手</summary>
            <fieldset
              disabled={busy || playback.playing || (!!hand && !hand.complete)}
            >
              <label>
                位置安排
                <select
                  aria-label="位置安排"
                  value={positionMode}
                  onChange={(e) =>
                    setPositionMode(e.target.value as typeof positionMode)
                  }
                >
                  <option value="rotate">按钮轮转</option>
                  <option value="fixed">指定位置</option>
                  <option value="random">随机位置</option>
                </select>
              </label>
              {positionMode === "fixed" && (
                <label>
                  Hero位置
                  <select
                    aria-label="Hero位置"
                    value={fixedPosition}
                    onChange={(e) => setFixedPosition(Number(e.target.value))}
                  >
                    {positions(players).map((p, i) => (
                      <option key={p} value={i}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                对手
                <select
                  aria-label="对手"
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                >
                  <option value="baseline-heuristic/1">基础对手</option>
                  {bots
                    .filter(
                      (b) =>
                        b.id !== "baseline-heuristic/1" &&
                        b.tableSizes.includes(players),
                    )
                    .map((b) => (
                      <option key={b.id} value={b.id} disabled={!b.available}>
                        {b.name} · {b.available ? "实验候选" : "未安装"}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                {botId === "hu-v2.2.2-experimental"
                  ? "HU 2.2.2为固定本地候选，整体强度未证明。"
                  : "基础对手使用轻量启发式，未作GTO声明。"}{" "}
                更改设置将在下一手建立新会话。
              </p>
            </fieldset>
          </details>
        )}
      </div>
      {reviewMode && (
        <div className={s.reviewFilters}>
          <label>
            筛选位置
            <select
              aria-label="筛选位置"
              value={filterPosition}
              onChange={(e) =>
                setFilter(() => setFilterPosition(e.target.value))
              }
            >
              <option value="">全部位置</option>
              {["BB", "BTN/SB", "SB", "UTG", "HJ", "CO", "BTN"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            筛选街道
            <select
              aria-label="筛选街道"
              value={filterStreet}
              onChange={(e) => setFilter(() => setFilterStreet(e.target.value))}
            >
              <option value="">全部街道</option>
              {streetNames.slice(0, 4).map((p, i) => (
                <option key={p} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={markedOnly}
              onChange={(e) => setFilter(() => setMarkedOnly(e.target.checked))}
            />
            只看有疑问的手牌
          </label>
          <small>最近1000手中筛选，最多显示100手。</small>
        </div>
      )}
      {error && (
        <div className={s.error} role="alert">
          {error}
          <button onClick={() => void run(load)} disabled={busy}>
            重新连接
          </button>
        </div>
      )}
      {!view && (
        <div className={s.empty}>
          {reviewMode
            ? "完成第一手后，在这里回看你的决定。"
            : "每手 100 bb · 无抽水"}
        </div>
      )}
      {view && (
        <div className={reviewMode ? s.reviewLayout : s.layout}>
          {reviewMode && (
            <aside className={s.handList} aria-label="手牌列表">
              {hands.map((h) => (
                <button
                  key={h.id}
                  aria-pressed={h.id === hand?.id}
                  onClick={() => navigate(`/hands?hand=${h.id}`)}
                >
                  第 {h.number} 手
                  <span>
                    {h.complete
                      ? `${h.position ?? ""} · ${h.decisions} 次决策 · ${h.marked} 个疑问`
                      : "未完成"}
                  </span>
                  <small>
                    {h.net === null
                      ? "继续练习后复盘"
                      : `${h.net >= 0 ? "+" : ""}${amount(h.net)}`}
                  </small>
                </button>
              ))}
            </aside>
          )}
          <section className={s.main}>
            {feedbackMode && (
              <div className={s.result} aria-label="本手结果">
                <strong>
                  本手结束 · Hero {hand!.payoffs[hand!.hero] >= 0 ? "+" : ""}
                  {amount(hand!.payoffs[hand!.hero])}
                </strong>
                <button onClick={() => navigate(`/hands?hand=${hand!.id}`)}>
                  复盘这手牌
                </button>
                <button
                  className={s.primary}
                  disabled={busy}
                  onClick={() => void run(create)}
                >
                  下一手
                </button>
                <button
                  aria-expanded={showCompletedTable}
                  onClick={() => setShowCompletedTable(!showCompletedTable)}
                >
                  {showCompletedTable ? "收起牌桌" : "查看本手牌桌"}
                </button>
              </div>
            )}
            {(reviewMode || feedbackMode) && hand?.complete && (
              <AutoReviewPanel
                key={hand.id}
                hand={hand}
                decision={decision}
                selectionBusy={busy || reviewLoading}
                onSelect={(n) => void run(() => selectDecision(n))}
                onOpen={navigate}
                preview={feedbackMode}
              />
            )}
            {reviewMode && hand?.complete && (
              <h2 className={s.replayHeading}>行动前牌桌回放</h2>
            )}
            <div className={s.context}>
              <span>
                第 {view.number} 手 · {streetNames[view.street]}
              </span>
              <span>
                Hero ·{" "}
                {
                  (view.session?.positions ?? positions(view.players))[
                    view.hero
                  ]
                }
              </span>
              {!reviewMode && playback.playing && (
                <strong role="status" aria-live="polite">
                  {playback.thinking !== undefined
                    ? `对手 ${playback.thinking + 1} 正在行动…`
                    : frameText(playback.frame)}
                </strong>
              )}
              {snapshot && (
                <button
                  onClick={() => {
                    setSnapshot(undefined);
                    setDecision(undefined);
                  }}
                >
                  返回整手结果
                </button>
              )}
            </div>
            {view.session && (
              <p className={s.opponent}>
                对手：
                {view.session.botId === "hu-v2.2.2-experimental"
                  ? "HU Bot 2.2.2 · 实验候选"
                  : "基础对手"}{" "}
                · 本会话第 {view.session.handIndex} 手
                {view.session.mode !== "rotate"
                  ? ` · ${view.session.mode === "fixed" ? "指定位置练习" : "随机位置练习"}`
                  : ""}
              </p>
            )}
            <div
              className={s.table}
              hidden={feedbackMode && !showCompletedTable}
              aria-label="当前牌桌"
              data-players={view.players}
            >
              <div className={s.board}>
                <span>
                  底池 <strong>{amount(view.pot)}</strong>
                </span>
                <Board cards={view.board} />
                {!view.board.length && <span className={s.muted}>翻前</span>}
              </div>
              <div className={s.seats}>
                {view.stacks.map((stack, i) => (
                  <div
                    key={i}
                    data-seat={i}
                    data-position={
                      (view.session?.positions ?? positions(view.players))[i]
                    }
                    data-hero={i === view.hero}
                    data-dealer={
                      i === (view.session?.dealerSeat ?? view.players - 1)
                    }
                    data-player-id={view.session?.playerIds[i] ?? `legacy-${i}`}
                    style={{
                      gridArea:
                        view.players === 2
                          ? i === view.hero
                            ? "f"
                            : "a"
                          : ["f", "d", "a", "b", "c", "e"][
                              (i - view.hero + view.players) % view.players
                            ],
                    }}
                    className={`${s.seat} ${i === (playback.thinking ?? view.actor) ? s.acting : ""} ${!view.active[i] && !view.complete ? s.folded : ""}`}
                  >
                    <div>
                      <strong>
                        {i === view.hero ? "Hero" : `对手 ${i + 1}`}
                      </strong>
                      <span>
                        {i ===
                          (view.session?.dealerSeat ?? view.players - 1) && (
                          <b className={s.dealer} title="按钮">
                            D
                          </b>
                        )}{" "}
                        {
                          (view.session?.positions ?? positions(view.players))[
                            i
                          ]
                        }
                      </span>
                    </div>
                    <span>
                      {amount(stack)}
                      {view.bets[i] > 0
                        ? ` · 已投入 ${amount(view.bets[i])}`
                        : ""}
                    </span>
                    {i === view.hero ? (
                      <Board cards={view.heroCards} />
                    ) : view.revealed[i]?.length ? (
                      <Board cards={view.revealed[i]} small />
                    ) : (
                      <span className={s.cardBack}>▧ ▧</span>
                    )}

                    {playback.frame?.actor === i &&
                      playback.frame.kind === "player-acted" &&
                      !!playback.frame.amount && (
                        <i
                          key={playback.frame.id}
                          className={s.chipMove}
                          aria-hidden="true"
                        >
                          ● ●
                        </i>
                      )}
                    <strong className={s.actionCue}>
                      {playback.thinking === i
                        ? "正在行动…"
                        : playback.frame?.actor === i
                          ? frameText(playback.frame)
                          : !view.active[i] && !view.complete
                            ? "已弃牌"
                            : " "}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
            {!reviewMode && (!hand!.complete || playback.playing) && (
              <section className={s.actionArea} aria-label="行动区">
                <div className={s.actionHeading}>
                  <strong
                    role={busy && !playback.playing ? "status" : undefined}
                    aria-live="polite"
                  >
                    {playback.playing
                      ? "对手动作播放中"
                      : busy
                        ? "正在处理行动…"
                        : "轮到你"}
                    {!playback.playing && callAction
                      ? ` · 待跟注 ${amount(callAction.amount!)}`
                      : ""}
                  </strong>
                  <button
                    disabled={
                      busy ||
                      playback.playing ||
                      hand!.marks.includes(hand!.events.length)
                    }
                    onClick={() =>
                      void run(async () =>
                        setHand(
                          await gameCall<HandView>("game_mark", {
                            handId: hand!.id,
                            decision: hand!.events.length,
                          }),
                        ),
                      )
                    }
                  >
                    {hand!.marks.includes(hand!.events.length)
                      ? "已标记疑问"
                      : "标记疑问"}
                  </button>
                </div>
                <div
                  className={s.actions}
                  inert={playback.playing}
                  style={{
                    visibility: playback.playing ? "hidden" : undefined,
                  }}
                >
                  {hand!.legal
                    .filter((a) => a.kind !== "raise")
                    .map((a) => (
                      <button
                        key={a.kind}
                        disabled={busy}
                        onClick={() => void run(() => act(a))}
                      >
                        {actionName(a.kind)}
                        {a.kind === "call" ? ` ${amount(a.amount!)}` : ""}
                      </button>
                    ))}
                  {raiseAction && (
                    <>
                      <label>
                        下注/加注至 bb
                        <input
                          aria-label="下注/加注至 bb"
                          type="number"
                          step="0.01"
                          min={raiseAction.min! / 100}
                          max={raiseAction.max! / 100}
                          value={raise}
                          placeholder={String(raiseAction.min! / 100)}
                          onChange={(e) => setRaise(e.target.value)}
                        />
                      </label>
                      <button
                        className={s.primary}
                        disabled={busy}
                        onClick={() => void run(() => act(raiseAction))}
                      >
                        下注/加注
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRaise(String(raiseAction.max! / 100));
                        }}
                      >
                        填入全下额
                      </button>
                    </>
                  )}
                </div>
              </section>
            )}
            {view.complete &&
              !snapshot &&
              !playback.playing &&
              !feedbackMode && (
                <div
                  className={`${s.result} ${s.settlement}`}
                  aria-label="本手结果"
                >
                  <strong>
                    本手结束 · Hero {hand!.payoffs[hand!.hero] >= 0 ? "+" : ""}
                    {amount(hand!.payoffs[hand!.hero])}
                  </strong>
                  <span>已保存 {hand!.decisions.length} 次原始决策</span>
                  {!reviewMode && (
                    <>
                      <button
                        disabled={playback.playing || busy}
                        onClick={() => navigate(`/hands?hand=${hand!.id}`)}
                      >
                        复盘这手牌
                      </button>
                      <button
                        className={s.primary}
                        disabled={playback.playing || busy}
                        onClick={() => void run(create)}
                      >
                        下一手
                      </button>
                    </>
                  )}
                </div>
              )}
            {!!view.botDecisions?.some((d) => d.fallback) && (
              <p role="status" className={s.opponent}>
                本手有对手回退：
                {view.botDecisions.filter((d) => d.fallback).at(-1)?.fallback}
                。已记录实际执行版本。
              </p>
            )}
            {!!view.botDecisions?.length && (
              <details>
                <summary>对手与运行记录</summary>
                <p>所选对手固定版本只决定其行动，不是当前手牌的评分答案。</p>
                {view.botDecisions.map((d) => (
                  <p key={d.sequence}>
                    {d.sequence + 1}号行动 ·{" "}
                    {
                      (view.session?.positions ?? positions(view.players))[
                        d.actor
                      ]
                    }{" "}
                    · {d.executed} · {d.elapsedMs.toFixed(1)}ms
                    {d.fallback ? ` · ${d.fallback}` : ""}
                  </p>
                ))}
              </details>
            )}
            {reviewMode && !hand!.complete && (
              <div className={s.result}>
                <span>本手尚未完成</span>
                <button
                  className={s.primary}
                  onClick={() => navigate(`/play?hand=${hand!.id}`)}
                >
                  继续这手牌
                </button>
              </div>
            )}
          </section>
          <aside className={s.rail}>
            {reviewMode && hand!.complete ? (
              <>
                <h2>你的决定</h2>
                <div className={s.decisions}>
                  {hand!.decisions.map((d) => (
                    <button
                      key={d.sequence}
                      aria-pressed={decision === d.sequence}
                      disabled={busy || reviewLoading}
                      onClick={() => void run(() => selectDecision(d.sequence))}
                    >
                      {streetNames[d.street]} · {actionName(d.kind)}
                      {d.amount ? ` ${amount(d.amount)}` : ""}
                      {d.marked ? " · 有疑问" : ""}
                    </button>
                  ))}
                </div>
                {snapshot && (
                  <button
                    className={s.primary}
                    onClick={() => void run(study)}
                    disabled={busy || reviewLoading}
                  >
                    研究此决策
                  </button>
                )}
                <p className={s.muted}>
                  输赢是本手结果。策略评价需要匹配的范围与分析模型。
                </p>
              </>
            ) : (
              <>
                <h2>行动记录</h2>
                <ol className={s.log}>
                  {view.events.map((e, i) => (
                    <li key={i}>
                      <span>
                        {streetNames[e.street]} ·{" "}
                        {
                          (view.session?.positions ?? positions(view.players))[
                            e.actor
                          ]
                        }
                      </span>
                      <strong>
                        {actionName(e.kind)}
                        {e.amount ? ` ${amount(e.amount)}` : ""}
                      </strong>
                      {view.marks.includes(i) && <small>疑问</small>}
                    </li>
                  ))}
                </ol>
                <details>
                  <summary>练习设置</summary>
                  <p>
                    每手重置到 100
                    bb；位置轮换。对手使用有版本的启发式策略，未宣称
                    GTO。手后反馈保留你的原始选择。
                  </p>
                </details>
              </>
            )}
          </aside>
        </div>
      )}
      {(!hand || hand.complete) && !playback.playing && (
        <details className={s.backup}>
          <summary>练习备份</summary>
          <p>备份包含重放所需的完整发牌数据，不用于未见题。</p>
          <button disabled={busy} onClick={() => void run(exportHands)}>
            导出练习
          </button>
          <label>
            导入练习备份
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void run(async () => {
                  if (file.size > 1000000) throw Error("备份超过1MB");
                  await gameCall("game_import", {
                    backup: JSON.parse(await file.text()),
                  });
                  await load();
                });
                e.target.value = "";
              }}
            />
          </label>
        </details>
      )}
    </main>
  );
}
function frameText(frame?: import("./domain").PublicFrame) {
  if (!frame) return "正在准备动作…";
  if (frame.kind === "player-acted") {
    const action = frame.view.events.at(-1);
    return action
      ? `${actionName(action.kind)}${frame.amount ? ` ${amount(frame.amount)}` : ""}`
      : "行动已提交";
  }
  return (
    (
      {
        "bets-collected": "筹码收进底池",
        "board-dealt": `${streetNames[frame.view.street]}发牌`,
        "cards-tabled": "亮牌",
        "uncalled-returned": "退还未跟注筹码",
        "pot-awarded": "派发底池",
        "hand-closed": "本手结算",
        "hand-started": "开始本手",
        ready: "轮到你",
      } as Record<string, string>
    )[frame.kind] ?? "行动中"
  );
}
function parseAmount(text: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw Error("金额最多两位小数");
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
