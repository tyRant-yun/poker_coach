import { useEffect, useMemo, useState } from 'react';
import { actions, activeCombos, handByCombo, handClasses, policyStats } from '../study/domain';
import type { Action, Choices, RangeWeights, Spot } from '../study/domain';
import { Board, Icon, percent } from '../../shared/ui';
import { average, cellBackground, FrequencyBar } from './RangeVisuals';
import s from '../../styles/App.module.css';

type Props = {
  spot: Spot;
  reference: Choices;
  weights: RangeWeights;
  heroCombo?: string;
  userChoices?: Choices;
  userLabel?: string;
};

export function ReferenceRange({ spot, reference, weights, heroCombo, userChoices, userLabel = '你的分配' }: Props) {
  const available = useMemo(() => new Set(activeCombos(spot, weights)), [spot, weights]);
  const [label, setLabel] = useState(heroCombo ? handByCombo[heroCombo] : 'AKs');
  const [combo, setCombo] = useState(heroCombo ?? 'AhKh');
  const [view, setView] = useState<Action | 'all'>('all');
  useEffect(() => {
    if (heroCombo) { setLabel(handByCombo[heroCombo]); setCombo(heroCombo); }
  }, [heroCombo]);
  const hand = handClasses.find(h => h.label === label)!;
  const candidates = hand.combos.filter(c => available.has(c) && reference[c]);
  const selected = candidates.includes(combo) ? combo : candidates[0];
  const allocation = selected ? reference[selected] : null;
  const user = selected ? userChoices?.[selected] : null;
  const stats = policyStats(spot, weights, reference);
  const mass = candidates.reduce((sum, c) => sum + weights[c], 0);
  return <section className={s.referenceCard} data-testid="reference-range">
    <div className={s.referenceHeading}>
      <div><span className={s.eyebrow}>RANGE STRATEGY</span><h2>全范围推荐策略 <span className={s.pill}>合成参考</span></h2>
        <p>点击任一牌类查看具体组合；这份预置演示策略未经真实 Solver 验证。</p></div>
      <span className={s.outlineBadge}>{available.size} 个组合</span>
    </div>
    <FrequencyBar totals={stats.totals} label="整个范围的参考行动分布" />
    <div className={s.referenceLayout}>
      <div>
        <div className={s.referenceFilters} aria-label="参考矩阵显示方式">
          <button aria-pressed={view === 'all'} className={view === 'all' ? s.refFilterActive : ''} onClick={() => setView('all')}>混合策略</button>
          {actions.map(a => <button key={a.id} aria-pressed={view === a.id} className={view === a.id ? s.refFilterActive : ''} onClick={() => setView(a.id)}>{a.name}视图</button>)}
        </div>
        <div className={`${s.matrix} ${s.referenceMatrix}`} role="group" aria-label="全范围推荐策略矩阵">
          {handClasses.map(h => {
            const combos = h.combos.filter(c => available.has(c) && reference[c]);
            const value = average(combos, reference, weights);
            const selectedClass = h.label === label;
            const isHero = heroCombo && h.label === handByCombo[heroCombo];
            const color = view === 'all' ? cellBackground(value) : actions.find(a => a.id === view)!.color;
            return <button key={h.label} disabled={!combos.length} aria-pressed={selectedClass}
              aria-label={`参考 ${h.label}，${combos.length} 个组合${isHero ? '，Hero 所在牌类' : ''}`}
              data-testid={`reference-cell-${h.label}`}
              className={`${s.matrixCell} ${selectedClass ? s.cellSelected : ''} ${isHero ? s.heroCell : ''}`}
              style={combos.length ? { background: color, ...(view === 'all' ? {} : { opacity: .2 + value[view] / 12500 }) } : undefined}
              onClick={() => { setLabel(h.label); setCombo(combos[0]); }}>
              <b>{h.label}</b><span>{view === 'all' ? (isHero ? 'H' : '●') : `${(value[view] / 100).toFixed(0)}%`}</span>
            </button>;
          })}
        </div>
        <div className={s.matrixFoot}><span>蓝：过牌 · 橙：小注 · 紫：大注</span><span>H：Hero 所在牌类</span></div>
      </div>
      <div className={s.referenceDetail}>
        <div className={s.fieldHeading}><b>{label} · 组合明细</b><span>{candidates.length} 个可用组合</span></div>
        <div className={s.comboList}>{candidates.map(c => <button key={c} aria-label={`参考组合 ${c}`} aria-pressed={selected === c}
          className={selected === c ? s.comboSelected : ''} onClick={() => setCombo(c)}>{c.slice(0, 2)} / {c.slice(2)}{c === heroCombo ? ' · Hero' : ''}</button>)}</div>
        {selected && allocation ? <>
          <div className={s.referenceHand}><Board cards={[selected.slice(0, 2), selected.slice(2)]} small />{selected === heroCombo && <span className={s.pill}>当前 Hero</span>}</div>
          <table className={s.referenceTable} aria-label="组合行动频率比较"><thead><tr><th>行动</th><th>模拟参考</th>{userChoices && <th>{userLabel}</th>}</tr></thead>
            <tbody>{actions.map(a => <tr key={a.id}><td><i style={{ background: a.color }} />{a.name}</td><td>{percent(allocation[a.id] / 10000)}</td>{userChoices && <td>{user ? percent(user[a.id] / 10000) : '未填写'}</td>}</tr>)}</tbody>
          </table>
          <div className={s.referenceConnection}><Icon name="layers" size={16} /><p>{label} 的 {candidates.length} 个组合占当前范围权重的 <b>{percent(stats.mass ? mass / stats.mass : 0)}</b>。不同花色组合可能有不同分配，请逐组合对照，不把一手牌的行动直接等同于整个范围。</p></div>
        </> : <p className={s.muted}>当前牌类没有可用参考。</p>}
      </div>
    </div>
  </section>;
}
