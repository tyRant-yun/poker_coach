import { useEffect, useState } from "react";
import type { HandView } from "./domain";
import { streetNames } from "./domain";
import { gameCall } from "./client";
import { profileNames, rangeNotice, referenceRanges } from "./review";
import type { ReviewReport, RangeProfile } from "./review";
import s from "./AutoReviewPanel.module.css";
import { handClasses } from "../study/domain";
import { decisionAdvice, reportSummary } from "./feedback";
import { StrategyLibrary } from "./StrategyLibrary";

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
  preview = false,
  selectionBusy = false,
}: {
  hand: HandView;
  decision?: number;
  onSelect: (n: number) => void;
  onOpen: (url: string) => void;
  preview?: boolean;
  selectionBusy?: boolean;
}) {
  const [report, setReport] = useState<ReviewReport>(),
    [error, setError] = useState(""),
    [street, setStreet] = useState(0),
    [profile, setProfile] = useState<RangeProfile>("standard"),
    [busy, setBusy] = useState(false),
    [rangePlayer, setRangePlayer] = useState<0 | 1>(0);
  const [generation, setGeneration] = useState(0);
  const previewPriority = preview
    ? [...(report?.nodes ?? [])].sort(
        (a, b) =>
          Number(b.gapBb !== undefined) - Number(a.gapBb !== undefined) ||
          Number(b.marked) - Number(a.marked) ||
          (b.gapBb ?? 0) - (a.gapBb ?? 0),
      )[0]?.sequence
    : undefined;
  const activeDecision = decision ?? previewPriority;
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
  }, [hand.id, generation]);
  useEffect(() => {
    const n = hand.decisions.find((n) => n.sequence === activeDecision);
    if (n) setStreet(n.street);
  }, [activeDecision, hand]);
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
        setGeneration((n) => n + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nodes = report?.nodes.filter((n) => n.street === street) ?? [],
    node = report?.nodes.find((n) => n.sequence === activeDecision),
    completed =
      report?.nodes.filter((n) => n.status === "completed").length ?? 0;
  const busyReport = report && ["queued", "running"].includes(report.status);
  const summary = report?.nodes.length ? reportSummary(report) : undefined;
  const advice = node ? decisionAdvice(node) : undefined;
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
      <div className={s.summary} aria-label="报告覆盖与本手结果">
        <span>
          本手结算
          <strong>
            {hand.payoffs[hand.hero] >= 0 ? "+" : ""}
            {(hand.payoffs[hand.hero] / 100).toFixed(2)} bb
          </strong>
        </span>
        <span>
          有参考 EV 差
          <strong>
            {summary?.evaluated ?? 0} / {hand.decisions.length} 个决定
          </strong>
        </span>
        <span>
          待分析<strong>{summary?.pending ?? "准备中"}</strong>
        </span>
        <span>
          未评价<strong>{summary?.unknown ?? "准备中"}</strong>
        </span>
      </div>
      <p className={s.boundary}>
        EV差基于每个决定的参考模型；未知不记为零，各节点差值不累加为整手损失。
      </p>
      {report && (
        <div className={s.timeline} aria-label="四街决定EV差时间线">
          {report.nodes.map((n) => (
            <button
              key={n.sequence}
              aria-pressed={activeDecision === n.sequence}
              disabled={selectionBusy}
              onClick={() => onSelect(n.sequence)}
            >
              <small>
                {streetNames[n.street]} · {n.sequence + 1}
                {n.marked ? " · 疑问" : ""}
              </small>
              {n.gapBb === undefined ? (
                <span>
                  {["queued", "running"].includes(n.status)
                    ? "待分析"
                    : "未评价"}
                </span>
              ) : (
                <>
                  <svg
                    viewBox="0 0 100 18"
                    role="img"
                    aria-label={`参考EV差 ${n.gapBb.toFixed(3)} bb`}
                  >
                    <rect
                      x="0"
                      y="5"
                      width="100"
                      height="8"
                      rx="4"
                      fill="#e9eef1"
                    />
                    <rect
                      x="0"
                      y="5"
                      width={Math.min(
                        100,
                        (n.gapBb /
                          Math.max(
                            ...report.nodes.map((x) => x.gapBb ?? 0),
                            0.01,
                          )) *
                          100,
                      )}
                      height="8"
                      rx="4"
                      fill="#b66b44"
                    />
                  </svg>
                  <strong>{n.gapBb.toFixed(3)} bb</strong>
                </>
              )}
            </button>
          ))}
        </div>
      )}
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
            disabled={selectionBusy}
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
              aria-pressed={activeDecision === n.sequence}
              disabled={selectionBusy}
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
          {node.referenceStrategy && (
            <div aria-label="来源策略频率（无EV评价）">
              {node.referenceStrategy.map((a) => (
                <p key={a.action}>
                  {actionName(a.action)} · {(a.frequency * 100).toFixed(1)}%
                </p>
              ))}
              <small>来源未包含行动EV，这些频率不用于计算损失或判错。</small>
            </div>
          )}
          {node.actions && (
            <div className={s.scope} aria-label="评价适用范围">
              <strong>
                {node.reference
                  ? `来源：${node.reference.name}`
                  : "范围来源：有限牌类假设，未按历史更新"}
              </strong>
              <span>
                行动覆盖：
                {node.coverage?.actions === "complete"
                  ? "参考树内完整"
                  : "有限候选，未覆盖全部合法尺度"}
              </span>
              {node.coverage?.missingActions.length ? (
                <span>
                  缺失：
                  {node.coverage.missingActions.map(actionName).join("、")}
                </span>
              ) : null}
              <span>
                后续：
                {node.coverage?.continuation === "checkdown"
                  ? "河牌过牌摊牌"
                  : "按所示参考树延续"}
              </span>
            </div>
          )}
          {node.actions && (
            <div className={s.chart} aria-label="真实行动EV比较">
              <div className={s.action}>
                <span>候选行动</span>
                <span>相对零点</span>
                <span>行动EV</span>
                <span>频率</span>
              </div>
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
                        style={{
                          width: `${(Math.abs(a.evBb) / max) * 50}%`,
                          marginLeft: `${a.evBb < 0 ? 50 - (Math.abs(a.evBb) / max) * 50 : 50}%`,
                        }}
                        data-negative={a.evBb < 0}
                      />
                    </div>
                    <strong>{a.evBb.toFixed(3)} bb</strong>
                    <span>{(a.frequency * 100).toFixed(1)}%</span>
                  </div>
                );
              })}
              <small>
                每行：行动 EV ·
                同解参考频率；条形中央为零点，左侧负值、右侧正值。
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
          {advice && (
            <div className={s.advice} aria-label="本决定建议">
              <strong>{advice.title}</strong>
              <p>{advice.detail}</p>
            </div>
          )}
          {node.actions && (
            <small>
              {node.quality === "source-declared"
                ? "外部来源质量按原声明与人工核验记录显示。"
                : node.quality === "target-met"
                  ? "求解达到规格质量目标。"
                  : "求解尚未达到规格质量目标。"}
              采用参考策略延续的节点行动价值，不是你实际后续操作的整手收益；局部
              EV 差不累加为整手总损失。
            </small>
          )}
          {node.solutionId && (
            <button
              disabled={busy || selectionBusy}
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
          新转牌报告包含后续河牌单尺寸下注，无再加注；旧报告按原说明解读。河牌保留有限尺寸与精确原行动路径。翻前需匹配已接纳数据；自动翻牌与多人评价仍待可靠来源/模型覆盖。
        </p>
        <p>
          完整练习备份保留原手；自动报告可在导入后重建，真实案例与原生解随研究备份另存。
        </p>
      </details>
      <StrategyLibrary />
    </section>
  );
}
