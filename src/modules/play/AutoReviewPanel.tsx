import { useEffect, useState } from "react";
import type { HandView } from "./domain";
import { streetNames } from "./domain";
import { gameCall } from "./client";
import { profileNames, rangeNotice, referenceRanges } from "./review";
import type { ReviewReport, RangeProfile } from "./review";
import s from "./AutoReviewPanel.module.css";
import { handClasses } from "../study/domain";

const actionName = (name: string) =>
  name === "raise"
    ? "下注/加注至"
    : name
        .replace(/check/i, "过牌")
        .replace(/fold/i, "弃牌")
        .replace(/call/i, "跟注")
        .replace(
          /(?:all-in|allin)\((\d+)\)/i,
          (_, n) => `全下至 ${Number(n) / 100} bb`,
        )
        .replace(
          /(?:bet|raise)\((\d+)\)/i,
          (_, n) => `下注/加注至 ${Number(n) / 100} bb`,
        );
export function AutoReviewPanel({
  hand,
  decision,
  onSelect,
  onOpen,
}: {
  hand: HandView;
  decision?: number;
  onSelect: (n: number) => void;
  onOpen: (url: string) => void;
}) {
  const [report, setReport] = useState<ReviewReport>(),
    [error, setError] = useState(""),
    [street, setStreet] = useState(0),
    [profile, setProfile] = useState<RangeProfile>("standard"),
    [busy, setBusy] = useState(false),
    [rangePlayer, setRangePlayer] = useState<0 | 1>(0);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    setReport(undefined);
    setError("");
    const read = async () => {
      try {
        const r = await gameCall<ReviewReport>("game_review_report", {
          handId: hand.id,
        });
        if (!alive) return;
        setReport(r);
        setProfile(r.profile);
        setError("");
        if (["queued", "running"].includes(r.status))
          timer = setTimeout(read, 700);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [hand.id]);
  useEffect(() => {
    const n = hand.decisions.find((n) => n.sequence === decision);
    if (n) setStreet(n.street);
  }, [decision, hand]);
  async function mutate(tool: "game_review_retry" | "game_review_cancel") {
    setBusy(true);
    setError("");
    try {
      const r = await gameCall<ReviewReport>(tool, {
        handId: hand.id,
        ...(tool === "game_review_retry" ? { profile } : {}),
      });
      setReport(r);
      if (tool === "game_review_retry") {
        // A bounded poll generation is tied to the existing hand through a page reload.
        onOpen(`/hands?hand=${hand.id}&report=${Date.now()}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nodes = report?.nodes.filter((n) => n.street === street) ?? [],
    node = report?.nodes.find((n) => n.sequence === decision),
    completed =
      report?.nodes.filter((n) => n.status === "completed").length ?? 0;
  const busyReport = report && ["queued", "running"].includes(report.status);
  return (
    <section className={s.panel} aria-label="自动复盘报告">
      <div className={s.heading}>
        <div>
          <h2>手后分析</h2>
          <span>
            真实局部分析 {completed} / {hand.decisions.length} 个决定 ·
            未覆盖节点保留事实
          </span>
        </div>
        {busyReport ? (
          <button
            disabled={busy}
            onClick={() => void mutate("game_review_cancel")}
          >
            取消自动分析
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => void mutate("game_review_retry")}
          >
            重新分析
          </button>
        )}
      </div>
      {busyReport && (
        <p role="status">
          {report.status === "queued"
            ? "等待后台分析"
            : "后台分析中，可以先回看原始决定"}
        </p>
      )}
      {report?.status === "interrupted" && (
        <p>上次分析已中断，可按相同参考重新分析。</p>
      )}
      {report?.status === "cancelled" && (
        <p>自动分析已取消；已完成结果保留。</p>
      )}
      {(error || report?.error) && <p role="alert">{error || report?.error}</p>}
      <nav className={s.streets} aria-label="复盘街道">
        {streetNames.slice(0, 4).map((label, i) => (
          <button
            key={i}
            aria-pressed={street === i}
            onClick={() => {
              setStreet(i);
              const n = hand.decisions.find((n) => n.street === i);
              if (n) onSelect(n.sequence);
            }}
          >
            {label}
            <span>
              {hand.decisions.filter((n) => n.street === i).length} 次决定
            </span>
          </button>
        ))}
      </nav>
      <div className={s.nodes}>
        {hand.decisions
          .filter((n) => n.street === street)
          .map((n) => (
            <button
              key={n.sequence}
              aria-pressed={decision === n.sequence}
              onClick={() => onSelect(n.sequence)}
            >
              决策 {n.sequence + 1} · {actionName(n.kind)}
              {n.amount ? ` ${n.amount / 100} bb` : ""}
              {n.marked ? " · 疑问" : ""}
            </button>
          ))}
      </div>
      {!hand.decisions.some((n) => n.street === street) && (
        <p>该街没有 Hero 决策（未到达该街、已弃牌或已全下）。</p>
      )}
      {!node && hand.decisions.some((n) => n.street === street) && (
        <p>
          {nodes.length
            ? "选择一个决定，查看当时价格与分析依据。"
            : "正在准备原始决策事实…"}
        </p>
      )}
      {node && (
        <div className={s.detail}>
          <div className={s.facts}>
            <span>
              行动前底池 <b>{node.potBb.toFixed(2)} bb</b>
            </span>
            <span>
              待跟注 <b>{node.callBb.toFixed(2)} bb</b>
            </span>
            {node.requiredEquity !== null && (
              <span>
                直接底池赔率 <b>{(node.requiredEquity * 100).toFixed(1)}%</b>
              </span>
            )}
            {node.betPotFraction !== null && (
              <span>
                本次增投 / 原底池{" "}
                <b>{(node.betPotFraction * 100).toFixed(0)}%</b>
              </span>
            )}
            {node.equity !== undefined && (
              <span>
                参考范围下权益 <b>{(node.equity * 100).toFixed(1)}%</b>
              </span>
            )}
            {node.nodeEvBb !== undefined && (
              <span>
                节点参考 EV <b>{node.nodeEvBb.toFixed(3)} bb</b>
              </span>
            )}
          </div>
          {node.requiredEquity !== null && (
            <small>
              赔率未计后续下注、权益实现、抽水与多人边池，不能单独判断该跟注是否盈利。
            </small>
          )}
          <p>{node.reason}</p>
          {node.actions && (
            <div className={s.chart} aria-label="真实行动EV比较">
              {node.actions.map((a, i) => {
                const max = Math.max(
                  ...node.actions!.map((a) => Math.abs(a.evBb)),
                  0.01,
                );
                return (
                  <div className={s.action} key={a.action}>
                    <span>
                      {actionName(a.action)}
                      {i === node.chosenIndex ? <b>你的选择</b> : null}
                    </span>
                    <div className={s.track}>
                      <i
                        style={{ width: `${(Math.abs(a.evBb) / max) * 100}%` }}
                        data-negative={a.evBb < 0}
                      />
                    </div>
                    <strong>{a.evBb.toFixed(3)} bb</strong>
                    <span>{(a.frequency * 100).toFixed(1)}%</span>
                  </div>
                );
              })}
              <small>
                每行：行动 EV · 同解参考频率；条长为 EV 绝对值，负值另行标记。
              </small>
            </div>
          )}
          {node.gapBb !== undefined && (
            <p className={s.gap}>
              假设内 EV 差 <strong>{node.gapBb.toFixed(3)} bb</strong> ·{" "}
              {node.gapBb < 0.01
                ? "数值差异很小，不据低频判错。"
                : `该假设下可优先比较「${actionName(node.actions!.reduce((a, b) => (a.evBb > b.evBb ? a : b)).action)}」，再检查范围变化是否影响结论。`}
            </p>
          )}
          {node.actions && (
            <small>
              {node.quality === "target-met"
                ? "求解达到规格质量目标。"
                : "求解尚未达到规格质量目标。"}
              采用参考策略延续的节点行动价值，不是你实际后续操作的整手收益；局部
              EV 差不累加为整手总损失。
            </small>
          )}
          {node.solutionId && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void gameCall<{ sourceId: string; caseId: string }>(
                  "game_review_open",
                  { handId: hand.id, decision: node.sequence },
                )
                  .then((r) =>
                    onOpen(
                      `/solver/real?case=${encodeURIComponent(r.caseId)}&source=${encodeURIComponent(r.sourceId)}`,
                    ),
                  )
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              图形深入研究
            </button>
          )}
        </div>
      )}
      <details>
        <summary>自动范围与计算条件</summary>
        <p>{rangeNotice}</p>
        <label>
          参考范围{" "}
          <select
            aria-label="自动分析参考范围"
            value={profile}
            onChange={(e) => setProfile(e.target.value as RangeProfile)}
          >
            {Object.entries(profileNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span>改变选择后点击“重新分析”生成新报告。</span>
        <div className={s.rangeClasses}>
          {
            Object.keys(
              referenceRanges(node?.board ?? [], hand.heroCards, 0, profile)[0],
            ).length
          }{" "}
          个 Hero 参考组合（按当前公共牌排除死牌）
        </div>
        {node?.rangeClasses && (
          <>
            <label>
              查看范围
              <select
                aria-label="查看自动范围"
                value={rangePlayer}
                onChange={(e) =>
                  setRangePlayer(Number(e.target.value) as 0 | 1)
                }
              >
                <option value={0}>
                  OOP{node.player === 0 ? " · Hero" : ""}
                </option>
                <option value={1}>
                  IP{node.player === 1 ? " · Hero" : ""}
                </option>
              </select>
            </label>
            <p>该固定分析：{node.rangeCounts?.[rangePlayer]} 个具体组合</p>
            <div className={s.matrix} aria-label="自动参考范围矩阵">
              {handClasses.map((h) => (
                <span
                  key={h.label}
                  data-in-range={node.rangeClasses![rangePlayer].includes(
                    h.label,
                  )}
                >
                  {h.label}
                </span>
              ))}
            </div>
          </>
        )}
        <p>
          转牌：每方单尺寸，无再加注；河牌后续过牌摊牌。河牌：有限尺寸与精确原行动路径。翻前/翻牌/多人尚无均衡评价。
        </p>
        <p>
          完整练习备份保留原手；自动报告可在导入后重建，真实案例与原生解随研究备份另存。
        </p>
      </details>
    </section>
  );
}
