import { actions } from '../study/domain';
import type { ActionDefinition, Allocation, Choices, RangeWeights } from '../study/domain';
import { percent } from '../../shared/ui';
import s from '../../styles/App.module.css';

export function average(combos: string[], choices: Choices, weights: RangeWeights, available = actions): Allocation {
  const mass = combos.reduce((sum, c) => sum + weights[c], 0);
  return Object.fromEntries(available.map(a => [a.id, mass ? combos.reduce((sum, c) => sum + weights[c] * (choices[c]?.[a.id] ?? 0), 0) / mass : 0])) as Allocation;
}
export function cellBackground(value: Allocation, available = actions) {
  let end = 0;
  const stops = available.map(a => { const start=end; end=Math.min(100,end+(value[a.id] ?? 0)/100); return `${a.color} ${start}%,${a.color} ${end}%`; });
  return `linear-gradient(90deg,${stops.join(',')},#26313d ${end}%,#26313d 100%)`;
}
export function FrequencyBar({ totals, label, available = actions }: { totals: Allocation; label?: string; available?: ActionDefinition[] }) {
  const assigned = available.reduce((sum, a) => sum + totals[a.id], 0);
  return <div className={s.frequencyGroup}>
    {label && <span className={s.smallMuted}>{label}</span>}
    <div className={s.frequencyBar}>
      {available.map(a => <span key={a.id} style={{ width: `${totals[a.id] * 100}%`, background: a.color }} title={`${a.name} ${percent(totals[a.id])}`} />)}
      {assigned < .9999 && <span style={{ width: `${(1 - assigned) * 100}%`, background: '#34404f' }} />}
    </div>
    <div className={s.frequencyLegend}>
      {available.map(a => <span key={a.id}><i style={{ background: a.color }} />{a.name}<b>{percent(totals[a.id])}</b></span>)}
      {assigned < .9999 && <span><i style={{ background: '#34404f' }} />未分配<b>{percent(1 - assigned)}</b></span>}
    </div>
  </div>;
}
