import { useEffect, useState } from "react";
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

const amount = (n: number) => `${(n / 100).toFixed(n % 100 ? 2 : 0)} bb`;
const actionName = (kind: string) =>
  ({ check: "过牌", fold: "弃牌", call: "跟注", raise: "下注/加注至" })[kind] ??
  kind;
export function PlayPage() {
  const location = useLocation(),
    navigate = useNavigate(),
    reviewMode = location.pathname === "/hands";
  const [hands, setHands] = useState<HandSummary[]>([]),
    [hand, setHand] = useState<HandView>(),
    [snapshot, setSnapshot] = useState<HandView>(),
    [decision, setDecision] = useState<number>(),
    [raise, setRaise] = useState(""),
    [players, setPlayers] = useState<2 | 6>(6),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = new URLSearchParams(location.search).get("hand");
  async function load() {
    const list = await gameCall<HandSummary[]>("game_list");
    setHands(list);
    const id = selected ?? list[0]?.id;
    if (id) {
      const current = await gameCall<HandView>("game_get", { handId: id });
      setHand(current);
    }
  }
  useEffect(() => {
    let alive = true;
    setSnapshot(undefined);
    setDecision(undefined);
    setHand(undefined);
    setError("");
    void gameCall<HandSummary[]>("game_list")
      .then(async (list) => {
        if (!alive) return;
        setHands(list);
        const id = selected ?? list[0]?.id;
        if (id) {
          const h = await gameCall<HandView>("game_get", { handId: id });
          if (alive) {
            setHand(h);
            setPlayers(h.players);
          }
        }
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      });
    return () => {
      alive = false;
    };
  }, [selected, reviewMode]);
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
    const next = hand?.complete && players === hand.players;
    const h = await gameCall<HandView>(
      next ? "game_next" : "game_create",
      next ? { handId: hand.id } : { players },
    );
    setHand(h);
    setSnapshot(undefined);
    setDecision(undefined);
    navigate(`/play?hand=${h.id}`);
    setHands(await gameCall<HandSummary[]>("game_list"));
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
    setHand(h);
    setRaise("");
    setHands(await gameCall<HandSummary[]>("game_list"));
  };
  const selectDecision = async (sequence: number) => {
    const view = await gameCall<HandView>("game_review", {
      handId: hand!.id,
      decision: sequence,
    });
    setSnapshot(view);
    setDecision(sequence);
  };
  const study = async () => {
    const source = await gameCall<ResearchSource>("game_research", {
      handId: hand!.id,
      decision,
    });
    navigate(`/solver/real?source=${encodeURIComponent(source.id)}`);
  };
  const view = snapshot ?? hand,
    raiseAction = hand?.legal.find((a) => a.kind === "raise"),
    callAction = hand?.legal.find((a) => a.kind === "call");
  return (
    <main className={s.page}>
      <ProductNav />
      <div className={s.heading}>
        <div>
          <h1>{reviewMode ? "手牌复盘" : "整手练习"}</h1>
          <p>
            {reviewMode
              ? "选一手牌，回到当时的决定。"
              : "从翻前打完一手，再看值得研究的决定。"}
          </p>
        </div>
        {!reviewMode && (
          <div className={s.start}>
            {(!hand || hand.complete) && (
              <>
                <label>
                  桌型
                  <select
                    aria-label="桌型"
                    value={players}
                    onChange={(e) =>
                      setPlayers(Number(e.target.value) as 2 | 6)
                    }
                  >
                    <option value={6}>6 人桌</option>
                    <option value={2}>单挑</option>
                  </select>
                </label>
                <button
                  className={s.primary}
                  onClick={() => void run(create)}
                  disabled={busy}
                >
                  {hand ? "下一手" : "开始练习"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {(!hand || hand.complete) && (
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
                      ? `${h.decisions} 次决策 · ${h.marked} 个疑问`
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
            <div className={s.context}>
              <span>
                第 {view.number} 手 · {streetNames[view.street]}
              </span>
              <span>Hero · {positions(view.players)[view.hero]}</span>
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
            <div className={s.table} aria-label="当前牌桌">
              <div className={s.board}>
                <span>
                  底池 <strong>{amount(view.pot)}</strong>
                </span>
                <Board cards={view.board} />
                {!view.board.length && <span className={s.muted}>翻前</span>}
              </div>
              <div
                className={s.seats}
                style={
                  view.players === 2
                    ? { gridTemplateColumns: "repeat(2,minmax(0,1fr))" }
                    : undefined
                }
              >
                {view.stacks.map((stack, i) => (
                  <div
                    key={i}
                    className={`${s.seat} ${i === view.actor ? s.acting : ""} ${!view.active[i] && !view.complete ? s.folded : ""}`}
                  >
                    <div>
                      <strong>
                        {i === view.hero ? "Hero" : `对手 ${i + 1}`}
                      </strong>
                      <span>{positions(view.players)[i]}</span>
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
                    {!view.active[i] && !view.complete && <small>已弃牌</small>}
                  </div>
                ))}
              </div>
            </div>
            {!reviewMode && !hand!.complete && (
              <section className={s.actionArea} aria-label="行动区">
                <div className={s.actionHeading}>
                  <strong>
                    轮到你
                    {callAction
                      ? ` · 待跟注 ${amount(callAction.amount!)}`
                      : ""}
                  </strong>
                  <button
                    disabled={busy || hand!.marks.includes(hand!.events.length)}
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
                <div className={s.actions}>
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
                {busy && <span role="status">正在处理行动…</span>}
              </section>
            )}
            {hand!.complete && !snapshot && (
              <div className={s.result}>
                <strong>
                  本手结束 · Hero {hand!.payoffs[hand!.hero] >= 0 ? "+" : ""}
                  {amount(hand!.payoffs[hand!.hero])}
                </strong>
                <span>已保存 {hand!.decisions.length} 次原始决策</span>
                {!reviewMode && (
                  <button
                    className={s.primary}
                    onClick={() => navigate(`/hands?hand=${hand!.id}`)}
                  >
                    复盘这手牌
                  </button>
                )}
              </div>
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
                    disabled={busy}
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
                        {positions(view.players)[e.actor]}
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
    </main>
  );
}
function parseAmount(text: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw Error("金额最多两位小数");
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
