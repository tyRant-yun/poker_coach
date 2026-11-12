import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { commands, queries } from '../../app/workspace';
import { actionsFor, activeCombos, allCombos, handClasses, handByCombo, policyStats, spotSignature } from '../study/domain';
import type { PolicyRevision, StudyCase } from '../study/domain';
import { Board, ComboCards, Dialog, dateTime } from '../../shared/ui';
import { FrequencyBar } from './RangeVisuals';
import s from '../../styles/App.module.css';

export function VersionHistory({ c, onOpen, onRestore }: { c: StudyCase; onOpen: (id: string) => void; onRestore: (id: string) => void }) {
  const [restore, setRestore] = useState<PolicyRevision | null>(null);
  const [branch, setBranch] = useState<PolicyRevision | null>(null);
  const [name, setName] = useState('');
  const navigate = useNavigate();
  return <div>
    <section className={s.historyCard}>
      <div className={s.panelHeader}><div><h2>每次提交，都是一份独立快照</h2><p>固定范围、条件和策略。当前可编辑的是 V{c.versions.length + 1} 草稿，编辑历史单独保留。</p></div><span className={s.outlineBadge}>{c.versions.length} 个版本</span></div>
      {c.versions.length ? <div className={s.versionList}>{[...c.versions].reverse().map(v => <div className={s.versionRow} key={v.id}><span className={s.versionNumber}>V{v.number}</span><div><h3>范围策略提交</h3><p>{dateTime(v.createdAt)} · {activeCombos(v.spot, queries.weights('BTN', v)).length} 个组合 · {c.reports.filter(r => r.policyRevisionId === v.id).length} 份报告</p><code>{v.id}</code></div><Board cards={v.spot.board} small /><div className={s.versionRowActions}><button className={s.secondaryButton} onClick={() => onOpen(v.id)}>查看反馈</button><button className={s.textButton} onClick={() => setRestore(v)}>恢复为草稿</button><button className={s.textButton} onClick={() => { setBranch(v); setName(`${c.name} · V${v.number} 分支`); }}>新建研究分支</button></div></div>)}</div> : <div className={s.empty}><h3>还没有提交版本</h3><p>完整分配范围并提交后，版本会保存在这里。</p></div>}
    </section>
    {c.versions.length >= 2 && <VersionComparison key={c.versions.map(v => v.id).join()} versions={c.versions} />}
    {restore && <Dialog title={`从 V${restore.number} 恢复草稿`} onClose={() => setRestore(null)}><div className={s.dialogBody}><p>将替换当前草稿，建立 V{c.versions.length + 1} 草稿。原有版本与报告保持不变，此操作可撤销。</p><div className={s.dialogActions}><button className={s.secondaryButton} onClick={() => setRestore(null)}>取消</button><button className={s.primaryButton} onClick={() => { onRestore(restore.id); setRestore(null); }}>建立新草稿</button></div></div></Dialog>}
    {branch && <Dialog title={`从 V${branch.number} 建立研究分支`} onClose={() => setBranch(null)}><form className={s.dialogBody} onSubmit={e => { e.preventDefault(); const result = commands.forkVersion(c.id, branch.id, name); if (result.ok) { setBranch(null); navigate(`/study/${result.value}?view=strategy`); } }}><label className={s.formField}>分支名称<input aria-label="分支名称" required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><p>创建独立研究案例，复制这一版的固定条件、范围和分配，并记录来源。原案例与报告保留在原处。</p><div className={s.dialogActions}><button type="button" className={s.secondaryButton} onClick={() => setBranch(null)}>取消</button><button className={s.primaryButton} type="submit">创建并打开分支</button></div></form></Dialog>}
  </div>;
}

function VersionComparison({ versions }: { versions: PolicyRevision[] }) {
  const [leftId, setLeft] = useState(versions[0].id);
  const [rightId, setRight] = useState(versions.at(-1)!.id);
  const [hand, setHand] = useState('all');
  const [changedOnly, setChangedOnly] = useState(true);
  const [page, setPage] = useState(0);
  const left = versions.find(v => v.id === leftId)!;
  const right = versions.find(v => v.id === rightId)!;
  const lw = queries.weights('BTN', left), rw = queries.weights('BTN', right);
  const la = new Set(activeCombos(left.spot, lw)), ra = new Set(activeCombos(right.spot, rw));
  const changed = (combo: string) => la.has(combo) !== ra.has(combo) || (la.has(combo) && ra.has(combo) && (lw[combo] !== rw[combo] || [...actionsFor(left.spot),...actionsFor(right.spot)].some(a => left.choices[combo]?.[a.id] !== right.choices[combo]?.[a.id])));
  const union = allCombos.filter(combo => la.has(combo) || ra.has(combo));
  const changedCombos = union.filter(changed);
  const bbChanged = allCombos.some(combo => (queries.weights('BB', left)[combo] ?? 0) !== (queries.weights('BB', right)[combo] ?? 0));
  const sameConditions = spotSignature(left.spot) === spotSignature(right.spot) && !bbChanged && allCombos.every(combo => (lw[combo] ?? 0) === (rw[combo] ?? 0));
  const rows = union.filter(combo => (hand === 'all' || handByCombo[combo] === hand) && (!changedOnly || changed(combo)));
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(rows.length / 24) - 1));
  const detail = (v: PolicyRevision, combo: string, active: Set<string>) => {
    if (!active.has(combo)) return <span className={s.smallMuted}>{v.spot.board.some(card => combo.includes(card)) ? '死牌' : '范围外 · 权重 0'}</span>;
    return <span className={s.compareComboValues}><b>权重 {queries.weights('BTN', v)[combo] / 100}%</b><span>{actionsFor(v.spot).map(a => `${a.short} ${(v.choices[combo][a.id] / 100).toFixed(2)}%`).join(' / ')}</span></span>;
  };
  return <section className={s.versionComparison}>
    <div className={s.panelHeader}><div><h2>版本差异比较</h2><p>各版按自己的输入范围汇总；组合明细保留权重与三个行动的概率。</p></div></div>
    <div className={s.comparisonSelects}>{[[leftId, setLeft, '基准版本'], [rightId, setRight, '比较版本']].map(([id, set, label]) => <label key={label as string}>{label as string}<select aria-label={label as string} value={id as string} onChange={e => { (set as (id: string) => void)(e.target.value); setPage(0); }}>{versions.map(v => <option key={v.id} value={v.id}>V{v.number}</option>)}</select></label>)}</div>
    <div className={s.versionTotals}>{[left, right].map((v, i) => { const stats = policyStats(v.spot, queries.weights('BTN', v), v.choices); return <div key={i}><h3>V{v.number}</h3><Board cards={v.spot.board} small /><p>{stats.combos.length} 个组合 · 加权组合量 {(stats.mass / 10000).toFixed(2)}</p><p className={s.smallMuted}>底池 {v.spot.potMinor / v.spot.unitsPerBb} bb · 剩余 {v.spot.stackMinor / v.spot.unitsPerBb} bb</p><code>{v.spot.rangeVersion}</code><FrequencyBar totals={stats.totals} available={actionsFor(v.spot)} label="按该版本的输入范围加权" /></div>; })}</div>
    <p className={s.assistanceNote}>{sameConditions ? '两版输入条件相同，可以比较行动分配。' : `输入条件或范围不同${bbChanged ? '（含 BB 输入范围）' : ''}，此处仅作描述性并排比较，不推断收益优劣。`}</p>
    <div className={s.comparisonCounts}><span>变化 {changedCombos.length}</span><span>新增 {union.filter(combo => !la.has(combo) && ra.has(combo)).length}</span><span>移除 {union.filter(combo => la.has(combo) && !ra.has(combo)).length}</span><span>共同 {union.filter(combo => la.has(combo) && ra.has(combo)).length}</span></div>
    <div className={s.matrix} role="group" aria-label="版本差异矩阵">{handClasses.map(h => { const count = h.combos.filter(combo => changedCombos.includes(combo)).length; return <button key={h.label} disabled={!h.combos.some(combo => union.includes(combo))} className={`${s.matrixCell} ${hand === h.label ? s.cellSelected : ''} ${count ? s.diffCell : ''}`} aria-label={`${h.label}，${count} 个组合变化`} onClick={() => { setHand(hand === h.label ? 'all' : h.label); setPage(0); }}><b>{h.label}</b><span>{count || '·'}</span></button>; })}</div>
    <div className={s.selectionTools}><button onClick={() => { setHand('all'); setPage(0); }}>查看全部牌类</button><label><input type="checkbox" checked={changedOnly} onChange={e => { setChangedOnly(e.target.checked); setPage(0); }} />只看变化</label><span>{hand === 'all' ? '全部牌类' : hand} · {rows.length} 个组合</span></div>
    <div className={s.comparisonTableWrap}><table className={s.comparisonTable}><thead><tr><th>具体组合</th><th>基准 V{left.number}</th><th>比较 V{right.number}</th></tr></thead><tbody>{rows.slice(pageIndex * 24, (pageIndex + 1) * 24).map(combo => <tr key={combo}><th><ComboCards combo={combo} /></th><td>{detail(left, combo, la)}</td><td>{detail(right, combo, ra)}</td></tr>)}</tbody></table>{!rows.length && <p className={s.empty}>当前筛选没有组合差异。</p>}</div>
    <div className={s.pagination}><button disabled={!pageIndex} onClick={() => setPage(pageIndex - 1)}>上一页</button><span>{pageIndex + 1} / {Math.max(1, Math.ceil(rows.length / 24))}</span><button disabled={(pageIndex + 1) * 24 >= rows.length} onClick={() => setPage(pageIndex + 1)}>下一页</button></div>
  </section>;
}
