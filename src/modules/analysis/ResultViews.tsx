import { handClasses } from "../study/domain";
import s from "./ResultViews.module.css";
export type ResultRow = {
  combo: string;
  hand: string;
  conditionalProbability: number | null;
  allocation: number[] | null;
  equity: number | null;
  evBb: number | null;
  actionEvBb: number[] | null;
  availability: string;
};
export function actionLabel(action: string) {
  if (action === "Check") return "过牌";
  if (action === "Fold") return "弃牌";
  if (action === "Call") return "跟注";
  const n = /\((\d+)\)/.exec(action);
  return `${action.startsWith("AllIn") ? "全下至" : action.startsWith("Raise") ? "加注至" : "下注至"} ${n ? Number(n[1]) / 100 : ""} bb`;
}
export function actionColor(action: string) {
  if (action === "Fold") return "#718195";
  if (action === "Check") return "#267f69";
  if (action === "Call") return "#286fad";
  const n = Number(/\((\d+)\)/.exec(action)?.[1] ?? 0);
  const variation = Math.round(Math.log2(1 + n) * 23);
  const hue = action.startsWith("AllIn")
    ? 265 + (variation % 25)
    : action.startsWith("Raise")
      ? 330 + (variation % 25)
      : 20 + (variation % 43);
  return `hsl(${hue} 57% ${34 + (variation % 15)}%)`;
}
const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
export function ActionDistribution({
  values,
  emptyMessage = "切换到当前行动方查看策略分布。",
}: {
  values: { action: string; frequency: number | null }[];
  emptyMessage?: string;
}) {
  return (
    <figure className={s.distribution} aria-label="当前范围行动分布">
      <figcaption>当前范围的行动</figcaption>
      {values.some((v) => v.frequency !== null) ? (
        <>
          <div className={s.stack}>
            {values.map((v) => (
              <span
                key={v.action}
                title={`${actionLabel(v.action)} ${pct(v.frequency)}`}
                style={{
                  width: `${(v.frequency ?? 0) * 100}%`,
                  background: actionColor(v.action),
                }}
              />
            ))}
          </div>
          <div className={s.legend}>
            {values.map((v) => (
              <span key={v.action}>
                <i style={{ background: actionColor(v.action) }} />
                {actionLabel(v.action)} <b>{pct(v.frequency)}</b>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </figure>
  );
}
export function ResultMatrix({
  rows,
  classes,
  actions,
  metric,
  selected,
  onSelect,
}: {
  rows: ResultRow[];
  classes: { hand: string; probability: number | null }[];
  actions: string[];
  metric: "strategy" | "weight" | "equity" | "ev";
  selected: string;
  onSelect: (hand: string) => void;
}) {
  const maxEv = Math.max(0.001, ...rows.map((r) => Math.abs(r.evBb ?? 0)));
  return (
    <>
      <div className={s.matrix} aria-label="真实结果矩阵">
        {handClasses.map((h) => {
          const probability =
              classes.find((c) => c.hand === h.label)?.probability ?? null,
            mass = probability ?? 0,
            group = rows.filter(
              (r) => r.hand === h.label && (r.conditionalProbability ?? 0) > 0,
            ),
            weight = group.reduce((n, r) => n + r.conditionalProbability!, 0);
          const mean = (field: "equity" | "evBb") =>
            weight > 0 && group.every((r) => r[field] !== null)
              ? group.reduce(
                  (n, r) => n + r.conditionalProbability! * r[field]!,
                  0,
                ) / weight
              : null;
          const equity = mean("equity"),
            ev = mean("evBb");
          let background: string | undefined;
          if (
            metric === "strategy" &&
            weight > 0 &&
            group.every((r) => r.allocation)
          ) {
            let end = 0;
            const stops = actions.map((a, i) => {
              const from = end;
              end +=
                (group.reduce(
                  (n, r) => n + r.conditionalProbability! * r.allocation![i],
                  0,
                ) /
                  weight) *
                100;
              return `${actionColor(a)} ${from}% ${end}%`;
            });
            if (stops.length)
              background = `linear-gradient(to right,${stops.join(",")})`;
          }
          if (metric === "weight" && mass > 0)
            background = `rgba(36,151,123,${0.12 + 0.83 * Math.min(1, mass * 10)})`;
          if (metric === "equity" && equity !== null)
            background = `rgba(32,146,116,${0.06 + equity * 0.75})`;
          if (metric === "ev" && ev !== null)
            background = `rgba(${ev < 0 ? "191,65,65" : "32,146,116"},${0.06 + (Math.abs(ev) / maxEv) * 0.75})`;
          return (
            <button
              key={h.label}
              aria-pressed={selected === h.label}
              title={`${h.label} 条件占比 ${pct(probability)} · 权益 ${pct(equity)} · EV ${ev === null ? "—" : ev.toFixed(4)} bb`}
              style={{
                background,
                color:
                  metric === "strategy" && background ? "white" : undefined,
              }}
              onClick={() => onSelect(selected === h.label ? "" : h.label)}
            >
              {h.label}
              {metric === "equity" && mass > 0 && <small>{pct(equity)}</small>}
              {metric === "ev" && mass > 0 && (
                <small>{ev?.toFixed(2) ?? "—"}</small>
              )}
            </button>
          );
        })}
      </div>
      <div className={s.scale} aria-label="矩阵色标">
        {metric === "strategy"
          ? "分段为各行动频率；选牌类查看真实花色组合。"
          : metric === "weight"
            ? "浅 → 深：当前条件分布中的牌类占比。"
            : metric === "equity"
              ? "权益：0%（浅）→ 100%（深）；灰色为无数据。"
              : `EV：红色负值 ← 0 → 绿色正值；本节点色标 ±${maxEv.toFixed(2)} bb。`}
      </div>
    </>
  );
}
export function HeroEvChart({
  row,
  actions,
}: {
  row: ResultRow;
  actions: string[];
}) {
  const max = Math.max(0.001, ...(row.actionEvBb ?? []).map(Math.abs));
  return (
    <figure className={s.ev} aria-label="Hero行动EV图">
      <figcaption>
        各行动 EV <small>当前节点 · bb · 中线为0</small>
      </figcaption>
      {actions.map((a, i) => {
        const value = row.actionEvBb?.[i] ?? null,
          width = value === null ? 0 : (Math.abs(value) / max) * 48;
        return (
          <div key={a} className={s.evRow}>
            <span>
              {actionLabel(a)} <small>{pct(row.allocation?.[i] ?? null)}</small>
            </span>
            <div className={s.plot}>
              <i className={s.axis} />
              {value !== null && (
                <i
                  style={{
                    left: `${value < 0 ? 50 - width : 50}%`,
                    width: `${width}%`,
                    background: actionColor(a),
                  }}
                />
              )}
            </div>
            <b>{value === null ? "—" : value.toFixed(3)}</b>
          </div>
        );
      })}
    </figure>
  );
}
export function NodePath({
  labels,
  onSelect,
}: {
  labels: string[];
  onSelect: (depth: number) => void;
}) {
  return (
    <nav className={s.path} aria-label="研究行动路径">
      <button onClick={() => onSelect(0)}>根节点</button>
      {labels.map((label, i) => (
        <span key={i}>
          {" "}
          →{" "}
          <button
            onClick={() => onSelect(i + 1)}
            aria-current={i === labels.length - 1 ? "step" : undefined}
          >
            {label}
          </button>
        </span>
      ))}
    </nav>
  );
}
