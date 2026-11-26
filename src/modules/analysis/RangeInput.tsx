import { useState, useRef, useEffect } from "react";
import { handClasses } from "../study/domain";
import { ComboCards } from "../../shared/ui";
import s from "./RangeInput.module.css";
export function RangeInput({
  label,
  weights,
  board,
  onChange,
  error,
  maxCombos = 200,
}: {
  label: string;
  weights: Record<string, number>;
  board: string[];
  onChange: (weights: Record<string, number>) => void;
  error?: string;
  maxCombos?: number;
}) {
  const [selected, setSelected] = useState("AA"),
    [percent, setPercent] = useState(100),
    [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const focus = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      focus?.focus();
    };
  }, [expanded]);
  const hand = handClasses.find((h) => h.label === selected)!,
    dead = new Set(board);
  const legal = (c: string) =>
    !dead.has(c.slice(0, 2)) && !dead.has(c.slice(2));
  const count = Object.values(weights).filter((v) => v > 0).length;
  const apply = (combos: string[], weight: number) => {
    const next = { ...weights };
    for (const c of combos) if (legal(c)) next[c] = weight;
    onChange(next);
  };
  return (
    <section className={s.editor} aria-label={`${label}图形范围`}>
      <header>
        <strong>{label}</strong>
        <span>
          {count} 个组合
          {count > maxCombos ? ` · 超过${maxCombos}上限，提交前请缩小范围` : ""}
        </span>
        <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起范围编辑" : "编辑范围"}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {expanded && (
        <dialog
          ref={dialog}
          className={s.dialog}
          aria-label={`${label}范围编辑器`}
          onCancel={(e) => {
            e.preventDefault();
            setExpanded(false);
          }}
        >
          <header>
            <h2>{label} 输入范围</h2>
            <button onClick={() => setExpanded(false)}>完成范围编辑</button>
          </header>
          <div className={s.matrix} aria-label={`${label}牌类`}>
            {handClasses.map((h) => {
              const supported = h.combos.filter(legal),
                w = supported.reduce((n, c) => n + (weights[c] ?? 0), 0);
              return (
                <button
                  key={h.label}
                  disabled={!supported.length}
                  aria-label={`${label} ${h.label}`}
                  aria-pressed={selected === h.label}
                  style={
                    w > 0
                      ? {
                          background: `rgba(36,151,123,${0.12 + (0.6 * w) / (supported.length * 10000)})`,
                        }
                      : undefined
                  }
                  onClick={() => setSelected(h.label)}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
          <div className={s.controls}>
            <b>{selected}</b>
            <label>
              输入权重 %{" "}
              <input
                aria-label={`${label}输入权重`}
                type="number"
                min={0}
                max={100}
                step={1}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
              />
            </label>
            <button
              disabled={
                !Number.isFinite(percent) || percent < 0 || percent > 100
              }
              onClick={() => apply(hand.combos, Math.round(percent * 100))}
            >
              应用到本牌类
            </button>
            <button onClick={() => apply(hand.combos, 0)}>清除本牌类</button>
          </div>
          <div className={s.combos}>
            {hand.combos.map((c) => (
              <button
                key={c}
                disabled={
                  !legal(c) ||
                  !Number.isFinite(percent) ||
                  percent < 0 ||
                  percent > 100
                }
                aria-label={`${label}组合 ${c}`}
                aria-pressed={(weights[c] ?? 0) > 0}
                onClick={() =>
                  apply(
                    [c],
                    (weights[c] ?? 0) > 0 ? 0 : Math.round(percent * 100),
                  )
                }
              >
                <ComboCards combo={c} />
                <span>{((weights[c] ?? 0) / 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        </dialog>
      )}
    </section>
  );
}
