import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import s from '../styles/App.module.css';

const iconPaths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10H3V10Zm6 10v-7h6v7',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  report: 'M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8m-8 4h6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  info: 'M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  close: 'm6 6 12 12M6 18 18 6',
  sliders: 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4 4v6',
  search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  layers: 'm12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 17l9 5 9-5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  refresh: 'M20 8a9 9 0 1 0 1 7M20 3v5h-5',
  play: 'm8 4 12 8-12 8V4Z',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name] ?? iconPaths.grid} /></svg>;
}
export function Card({ card, small = false }: { card: string; small?: boolean }) {
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[card[1]];
  const color = card[1] === 'h' || card[1] === 'd' ? s.redCard : '';
  return <span className={`${s.playingCard} ${small ? s.smallCard : ''} ${color}`} data-suit={card[1]} aria-label={card}><b>{card[0]}</b><span>{suit}</span></span>;
}
export function ComboCards({ combo }: { combo: string }) {
  return <span className={s.comboCards}><Card card={combo.slice(0,2)} small /><Card card={combo.slice(2)} small /></span>;
}
export function Board({ cards, small = false }: { cards: string[]; small?: boolean }) {
  return <span className={s.board}>{cards.map(card => <Card key={card} card={card} small={small} />)}</span>;
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const headingId = 'dialog-' + title.replace(/\s/g, '-');
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => returnFocus.current?.focus());
    };
  }, []);
  return <dialog ref={ref} className={s.dialog} aria-labelledby={headingId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className={s.dialogHeader}><h2 id={headingId}>{title}</h2><button className={s.iconButton} onClick={onClose} aria-label="关闭弹窗"><Icon name="close" /></button></div>
    {children}
  </dialog>;
}
export function percent(n: number) { return (n * 100).toFixed(1) + '%'; }
export function dateTime(iso: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); }
