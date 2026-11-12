import { useEffect, useRef, useState } from 'react';
import { commands, queries } from '../../app/workspace';
import { actionsFor, activeCombos, allCombos, handClasses, handByCombo, validAllocation } from '../study/domain';
import type { Allocation, StudyCase } from '../study/domain';
import { ComboCards, Icon } from '../../shared/ui';
import { average, cellBackground, FrequencyBar } from './RangeVisuals';
import s from '../../styles/App.module.css';

export function StrategyEditor({ c, initialHand, onSelectHand }: { c: StudyCase; initialHand: string; onSelectHand: (label: string) => void }) {
  const [mode, setMode] = useState<'policy' | 'range'>('policy');
  const [player, setPlayer] = useState(c.spot.actor);
  const [view, setView] = useState<'matrix' | 'combos'>('matrix');
  const [category, setCategory] = useState('all');
  const [suit, setSuit] = useState('all');
  const [status, setStatus] = useState('all');
  const [focus, setFocus] = useState(false);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(handClasses.find(h => h.label === initialHand)!.combos);
  const [dirty, setDirty] = useState(false);
  const dragging = useRef(false);
  const actions = actionsFor(c.spot);
  const weights = queries.weights(player, c);
  const live = new Set(activeCombos(c.spot, weights));
  const dead = (combo: string) => c.spot.board.some(card => combo.slice(0, 2) === card || combo.slice(2) === card);
  const locks = new Set(c.draft.lockedCombos ?? []);
  const matches = (combo: string) => {
    const label = handByCombo[combo];
    if (category === 'pair' && label.length !== 2) return false;
    if (category === 'suited' && !label.endsWith('s')) return false;
    if (category === 'offsuit' && !label.endsWith('o')) return false;
    if (suit !== 'all' && combo[1] !== suit && combo[3] !== suit) return false;
    if (status === 'missing' && (!live.has(combo) || !!c.draft.choices[combo])) return false;
    if (status === 'invalid' && (!live.has(combo) || !c.draft.choices[combo] || validAllocation(c.draft.choices[combo],actions))) return false;
    if (status === 'locked' && !locks.has(combo)) return false;
    if (status === 'excluded' && (dead(combo) || live.has(combo))) return false;
    if (status === 'dead' && !dead(combo)) return false;
    return true;
  };
  const visible = allCombos.filter(matches);
  const selectable = visible.filter(combo => !dead(combo) && (mode === 'range' || live.has(combo)));
  const target = [...new Set(selection)].filter(combo => selectable.includes(combo));
  const labelSet = new Set(target.map(combo => handByCombo[combo]));
  const heading = labelSet.size === 1 ? [...labelSet][0] : '批量选择';
  useEffect(() => { if (heading !== '批量选择') onSelectHand(heading); }, [heading, onSelectHand]);
  const stats = queries.stats(c);
  function change(action: () => void) {
    if (dirty) { commands.showInfo('有尚未应用的输入。请先应用，或点击“放弃输入”后再更换选择。'); return; }
    action();
  }
  function choose(ids: string[], append = false) {
    change(() => setSelection(old => append ? [...new Set([...old, ...ids])] : ids));
  }
  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(false);
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !dirty) { e.preventDefault(); if (e.shiftKey) commands.redo(c.id); else commands.undo(c.id); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [c.id, dirty]);
  useEffect(() => { commands.setPendingInput(dirty,c.id); return () => commands.setPendingInput(false); }, [dirty]);
  useEffect(() => { setPage(0); }, [category, suit, status, mode, player]);
  const stateLabel = (combo: string) => dead(combo) ? '死牌' : !live.has(combo) ? '权重 0 · 排除' : mode === 'range' ? `权重 ${(weights[combo] ?? 0) / 100}%` : !c.draft.choices[combo] ? '未填写' : !validAllocation(c.draft.choices[combo],actions) ? '待修正' : locks.has(combo) ? '已锁定' : '已分配';
  return <div className={`${s.editorLayout} ${focus ? s.editorFocus : ''}`}>
    <div className={s.editorMain}>
      <section className={s.matrixPanel}>
        <div className={s.panelHeader}><div><h2>{mode === 'policy' ? '你的策略范围' : `${player} 输入范围`}</h2><p>{mode === 'policy' ? '拖选牌类，或按住 Ctrl / ⌘ 多选；批量应用形成一次编辑' : '权重决定组合在输入范围中的占比，0 表示排除'}</p></div><button className={s.textButton} aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? '退出焦点模式' : '焦点模式'}</button></div>
        <div className={s.editorToolbar}>
          <div className={s.segmented}><button className={mode === 'policy' ? s.segmentActive : ''} onClick={() => change(() => { setMode('policy'); setPlayer(c.spot.actor); })}>行动频率</button><button className={mode === 'range' ? s.segmentActive : ''} onClick={() => change(() => setMode('range'))}>输入权重</button></div>
          {mode === 'range' && <div className={s.segmented} aria-label="编辑玩家范围">{(['BTN', 'BB'] as const).map(p => <button key={p} className={player === p ? s.segmentActive : ''} onClick={() => change(() => setPlayer(p))}>{p}</button>)}</div>}
          <div className={s.segmented}><button className={view === 'matrix' ? s.segmentActive : ''} onClick={() => setView('matrix')}>矩阵</button><button className={view === 'combos' ? s.segmentActive : ''} onClick={() => setView('combos')}>具体组合</button></div>
        </div>
        <div className={s.editorFilters}>
          <label>类别<select aria-label="类别过滤" value={category} onChange={e => change(() => setCategory(e.target.value))}><option value="all">全部牌类</option><option value="pair">口袋对子</option><option value="suited">同花非对子</option><option value="offsuit">杂色非对子</option></select></label>
          <label>花色<select aria-label="花色过滤" value={suit} onChange={e => change(() => setSuit(e.target.value))}><option value="all">全部花色</option><option value="s">含 ♠</option><option value="h">含 ♥</option><option value="d">含 ♦</option><option value="c">含 ♣</option></select></label>
          <label>状态<select aria-label="组合状态过滤" value={status} onChange={e => change(() => setStatus(e.target.value))}><option value="all">全部状态</option><option value="missing">未填写</option><option value="invalid">频率待修正</option><option value="locked">已锁定</option><option value="excluded">权重 0 · 排除</option><option value="dead">死牌</option></select></label>
        </div>
        <div className={s.matrixMeta}><span>{live.size} 个可用组合 · 加权组合量 {(activeCombos(c.spot, weights).reduce((sum, combo) => sum + weights[combo], 0) / 10000).toFixed(2)}</span><span>{mode === 'policy' ? 'X / B33 / B75' : '输入权重 %'}</span></div>
        {view === 'matrix' ? <div className={s.matrix} role="group" aria-label={mode === 'policy' ? 'BTN 策略矩阵' : `${player} 输入范围矩阵`}>
          {handClasses.map(h => {
            const ids = h.combos.filter(combo => selectable.includes(combo));
            const liveIds = ids.filter(combo => live.has(combo));
            const selected = ids.length > 0 && ids.every(combo => target.includes(combo));
            const nLocked = liveIds.filter(combo => locks.has(combo)).length;
            const filled = liveIds.filter(combo => c.draft.choices[combo]).length;
            const background = mode === 'policy' ? cellBackground(average(liveIds, c.draft.choices, weights,actions),actions) : `rgba(91,154,139,${ids.length ? .12 + ids.reduce((sum, combo) => sum + (weights[combo] ?? 0), 0) / ids.length / 16000 : 0})`;
            return <button key={h.label} data-testid={`cell-${h.label}`} aria-label={`${h.label}，${ids.length} 个可选组合${nLocked ? `，${nLocked} 个锁定` : ''}`} aria-pressed={selected} disabled={!ids.length} className={`${s.matrixCell} ${selected ? s.cellSelected : ''}`} style={ids.length ? { background } : undefined}
              onPointerDown={e => { if (e.button !== 0) return; dragging.current = true; choose(ids, e.ctrlKey || e.metaKey || e.shiftKey); }}
              onPointerEnter={e => { if (dragging.current && e.buttons === 1) choose(ids, true); }}
              onClick={e => { if (e.detail === 0) choose(ids, e.ctrlKey || e.metaKey || e.shiftKey); }}><b>{h.label}</b><span>{mode === 'range' ? ids.length ? `${Math.round(ids.reduce((sum, combo) => sum + (weights[combo] ?? 0), 0) / ids.length / 100)}%` : '' : nLocked ? `L${nLocked}` : filled === liveIds.length && filled ? '●' : filled ? '◐' : '·'}</span></button>;
          })}
        </div> : <><div className={s.comboGrid} role="group" aria-label={`${player} 具体组合列表`}>{visible.slice(Math.min(page, Math.max(0, Math.ceil(visible.length / 96) - 1)) * 96, (Math.min(page, Math.max(0, Math.ceil(visible.length / 96) - 1)) + 1) * 96).map(combo => <button key={combo} aria-label={`选择组合 ${combo}，${stateLabel(combo)}`} aria-pressed={target.includes(combo)} className={target.includes(combo) ? s.comboSelected : ''} disabled={!selectable.includes(combo)} onClick={e => choose([combo], e.ctrlKey || e.metaKey || e.shiftKey)}><ComboCards combo={combo} /><small>{stateLabel(combo)}</small></button>)}</div><div className={s.pagination}><button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{Math.min(page + 1, Math.max(1, Math.ceil(visible.length / 96)))} / {Math.max(1, Math.ceil(visible.length / 96))}</span><button disabled={(page + 1) * 96 >= visible.length} onClick={() => setPage(page + 1)}>下一页</button></div></>}
        <div className={s.selectionTools}><button onClick={() => choose(selectable)}>选择筛选结果（{selectable.length}）</button><button onClick={() => choose([])}>取消选择</button><span>已选 {target.length} · 锁定 {target.filter(combo => locks.has(combo)).length}</span></div>
        <p className={s.fieldHelp}>死牌不可选。权重 0 = 排除；行动 0% = 保留该组合但不采取该行动。未填写独立统计。后续节点尚未建模，未覆盖不视为不可达。</p>
        {mode === 'policy' && (stats.mass ? <FrequencyBar totals={stats.totals} available={actions} label="整体行动频率 · 按当前范围权重汇总，未完成组合单独保留" /> : <p className={s.rangeNote}>无可用组合，整体行动频率无数据。请在输入权重中加入组合。</p>)}
      </section>
      <div className={s.editHistoryBar}><button disabled={dirty || !c.editHistory?.past.length} onClick={() => commands.undo(c.id)}>撤销{c.editHistory?.past.length ? `（${c.editHistory.past.length}）` : ''}</button><button disabled={dirty || !c.editHistory?.future.length} onClick={() => commands.redo(c.id)}>重做</button><span>编辑历史 · 最近 30 步 · Ctrl/⌘ Z</span></div>
      {c.editHistory?.past.length ? <details className={s.editHistoryDetails}><summary>最近编辑：{c.editHistory.past.at(-1)?.label}</summary><ol>{[...c.editHistory.past].reverse().map((entry, i) => <li key={i}>{entry.label}</li>)}</ol><p>这是草稿编辑历史；固定提交在“版本记录”中。</p></details> : null}
    </div>
    <AllocationInspector key={`${mode}-${player}`} c={c} target={target} heading={heading} mode={mode} player={player} dirty={dirty} setDirty={setDirty} choose={choose} />
  </div>;
}

function AllocationInspector({ c, target, heading, mode, player, dirty, setDirty, choose }: { c: StudyCase; target: string[]; heading: string; mode: 'policy' | 'range'; player: string; dirty: boolean; setDirty: (value: boolean) => void; choose: (ids: string[]) => void }) {
  const actions = actionsFor(c.spot);
  const weights = queries.weights(player, c);
  const [values, setValues] = useState(['100', '0', '0']);
  const [weight, setWeight] = useState('100');
  const [revision, setRevision] = useState(c.draft.editRevision);
  const key = target.join(',');
  function load() {
    const current = average(target, c.draft.choices, weights,actions);
    setValues(target.some(combo => c.draft.choices[combo]) ? actions.map(a => (Math.round(current[a.id]) / 100).toString()) : actions.map((_,i) => i===0 ? '100' : '0'));
    setWeight(target.length ? (target.reduce((sum, combo) => sum + (weights[combo] ?? 0), 0) / target.length / 100).toFixed(2) : '100');
    setRevision(c.draft.editRevision);
  }
  useEffect(() => { if (!dirty) load(); }, [key, c.draft.editRevision, dirty]);
  const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const label = heading === '批量选择' && target.length === 0 ? '未选择' : heading;
  const unlocked = target.filter(combo => !(c.draft.lockedCombos ?? []).includes(combo));
  function apply() {
    if ((mode === 'policy' ? values : [weight]).some(value => value.trim() === '' || !Number.isFinite(Number(value)))) { commands.showInfo('请输入有效数值；不会自动补足剩余概率。'); return; }
    const result = mode === 'policy'
      ? commands.editPolicy(c.id, target, Object.fromEntries(actions.map((a, i) => [a.id, Math.round(Number(values[i]) * 100)])) as Allocation, revision)
      : commands.reviseRange(c.id, player, target, Math.round(Number(weight) * 100), revision);
    if (result.ok) setDirty(false);
  }
  return <aside className={s.inspector}><section className={s.inspectorCard}>
    <div className={s.inspectorTitle}><span className={s.eyebrow}>{mode === 'policy' ? 'COMBO EDITOR' : 'RANGE INPUT'}</span><span className={s.outlineBadge}>{player}</span></div><div className={s.handHeading}><h2>{label}</h2><span>已选 {target.length} 个组合</span></div>
    {heading !== '批量选择' && <div className={s.comboList}>{handClasses.find(h => h.label === heading)?.combos.map(combo => <button key={combo} disabled={!target.includes(combo) && (c.spot.board.some(card => combo.includes(card)) || (mode === 'policy' && !(weights[combo] > 0)))} aria-label={`选择组合 ${combo}`} onClick={() => choose([combo])}><ComboCards combo={combo} /></button>)}</div>}
    {target.length === 1 && <button className={s.textButton} onClick={() => choose(handClasses.find(h => h.label === heading)!.combos)}>编辑整个 {heading}</button>}
    <div className={s.inspectorDivider} />
    {mode === 'policy' ? <><div className={s.fieldHeading}><b>行动分配</b><span>频率 %</span></div>{actions.map((a, i) => <label className={s.allocationField} key={a.id}><span><i style={{ background: a.color }} />{a.name}</span><div><input type="number" min="0" max="100" step="0.01" value={values[i]} onChange={e => { setDirty(true); setValues(old => old.map((value, j) => i === j ? e.target.value : value)); }} aria-label={`${a.name}频率`} /><span>%</span></div></label>)}<div className={`${s.allocationTotal} ${Math.abs(total - 100) > .001 ? s.invalidTotal : ''}`}><span>合计</span><b>{Number(total.toFixed(2))}%</b></div><p className={s.fieldHelp}>可应用合计未满 100% 的中间草稿；提交时必须合计 100%，不会自动分配剩余概率。混合选择显示加权均值，应用后统一分配给未锁定组合。</p></> : <><label className={s.formField}>输入权重 %<input aria-label="输入权重" type="number" min="0" max="100" step="0.01" value={weight} onChange={e => { setDirty(true); setWeight(e.target.value); }} /></label><p className={s.fieldHelp}>批量选择显示平均权重，应用后统一设置。0 排除、100 完整加入。范围变化会建立输入修订；这不是行动频率。</p></>}
    {dirty && <p className={s.assistanceNote}>输入尚未应用</p>}
    {dirty && c.draft.editRevision !== revision && <p role="alert" className={s.assistanceNote}>草稿已发生变化，输入已保留。请放弃输入重新载入，或核对后点击“确认当前修订”。</p>}
    {dirty && c.draft.editRevision !== revision && <button className={s.secondaryButton} onClick={() => setRevision(c.draft.editRevision)}>确认当前修订</button>}
    <button className={s.primaryButton} disabled={!target.length || (mode === 'policy' && !unlocked.length)} onClick={apply}>应用到 {target.length} 个组合 <Icon name="check" size={15} /></button>
    {dirty && <button className={s.textButton} onClick={() => setDirty(false)}>放弃输入</button>}
    {mode === 'policy' && <div className={s.lockTools}><button disabled={dirty || !target.length} onClick={() => commands.setLocks(c.id, target, true, c.draft.editRevision)}>锁定所选</button><button disabled={dirty || !target.length} onClick={() => commands.setLocks(c.id, target, false, c.draft.editRevision)}>解锁所选</button><span>批量编辑跳过 {target.length - unlocked.length} 个锁定组合</span></div>}
  </section><section className={s.notesCard}><label htmlFor="study-note"><Icon name="bookmark" size={15} />研究笔记</label><textarea id="study-note" value={c.note} maxLength={4000} onChange={e => commands.saveNote(c.id, e.target.value)} placeholder="记下你这样分配的理由…" /><span>自动保存到本地</span></section></aside>;
}
