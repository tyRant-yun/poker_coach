import { useEffect, useRef, useState } from "react";
import { Card } from "./ui";
import s from "./Cards.module.css";
const ranks = [..."AKQJT98765432"];
const suits = [
  { code: "s", name: "黑桃", symbol: "♠" },
  { code: "h", name: "红桃", symbol: "♥" },
  { code: "d", name: "方块", symbol: "♦" },
  { code: "c", name: "梅花", symbol: "♣" },
];
export function CardSlots({
  label,
  cards,
  count,
  dead = [],
  onChange,
}: {
  label: string;
  cards: string[];
  count: number;
  dead?: string[];
  onChange: (cards: string[]) => void;
}) {
  const [index, setIndex] = useState<number>(),
    [draft, setDraft] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (index === undefined) return;
    const el = dialog.current;
    el?.showModal();
    return () => {
      el?.close();
      returnFocus.current?.focus();
    };
  }, [index !== undefined]);
  const open = (i: number) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setDraft(Array.from({ length: count }, (_, n) => cards[n] ?? ""));
    setIndex(i);
  };
  const used = new Set([...dead, ...draft.filter((_, n) => n !== index)]);
  return (
    <fieldset className={s.slots}>
      <legend>{label}</legend>
      <div>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${label} 第${i + 1}张${cards[i] ? ` ${cards[i]}` : " 选牌"}`}
            onClick={() => open(i)}
          >
            {cards[i] && /^[2-9TJQKA][cdhs]$/.test(cards[i]) ? (
              <Card card={cards[i]} />
            ) : (
              <span className={s.empty}>＋</span>
            )}
          </button>
        ))}
      </div>
      {index !== undefined && (
        <dialog
          ref={dialog}
          className={s.dialog}
          aria-label={`${label}选牌器`}
          onCancel={(e) => {
            e.preventDefault();
            setIndex(undefined);
          }}
        >
          <header>
            <h2>
              {label} · 第{index + 1}张
            </h2>
            <button onClick={() => setIndex(undefined)} aria-label="关闭选牌器">
              关闭
            </button>
          </header>
          <div className={s.draft}>
            {draft.map((c, i) => (
              <button
                key={i}
                aria-pressed={index === i}
                aria-label={`编辑第${i + 1}张`}
                onClick={() => setIndex(i)}
              >
                {c ? <Card card={c} /> : "＋"}
              </button>
            ))}
          </div>
          <div className={s.deck}>
            {suits.map((suit) => (
              <div key={suit.code}>
                <b>{suit.symbol}</b>
                {ranks.map((rank) => {
                  const card = rank + suit.code;
                  return (
                    <button
                      key={card}
                      type="button"
                      disabled={used.has(card)}
                      title={used.has(card) ? "这张牌已被使用" : undefined}
                      aria-label={`选择${suit.name}${rank === "T" ? "10" : rank}`}
                      aria-pressed={draft[index] === card}
                      onClick={() => {
                        const next = [...draft];
                        next[index] = card;
                        setDraft(next);
                        const empty = next.findIndex((c) => !c);
                        if (empty >= 0) setIndex(empty);
                      }}
                    >
                      <Card card={card} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <footer>
            <button
              onClick={() =>
                setDraft(draft.map((c, i) => (i === index ? "" : c)))
              }
            >
              清除此槽位
            </button>
            <button onClick={() => setIndex(undefined)}>取消</button>
            <button
              disabled={draft.every((c, i) => c === (cards[i] ?? ""))}
              onClick={() => {
                onChange(draft);
                setIndex(undefined);
              }}
            >
              应用选牌
            </button>
          </footer>
        </dialog>
      )}
    </fieldset>
  );
}
