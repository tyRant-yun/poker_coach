import { actions } from '../study/domain';
import type { Allocation, Choices, RangeWeights } from '../study/domain';
import { percent } from '../../shared/ui';
import s from '../../styles/App.module.css';

export function average(combos: string[], choices: Choices, weights: RangeWeights): Allocation {
  const mass = combos.reduce((sum, c) => sum + weights[c], 0);
  return Object.fromEntries(actions.map(a => [a.id, mass ? combos.reduce((sum, c) => sum + weights[c] * (choices[c]?.[a.id] ?? 0), 0) / mass : 0])) as Allocation;
}
export function cellBackground(value: Allocation) {
  const x = Math.min(100, value.check / 100);
  const y = Math.min(100, x + value.bet33 / 100);
  const z = Math.min(100, y + value.bet75 / 100);
  return `linear-gradient(90deg,#315675 0%,#315675 ${x}%,#85613e ${x}%,#85613e ${y}%,#695280 ${y}%,#695280 ${z}%,#26313d ${z}%)`;
}
export function FrequencyBar({ totals, label }: { totals: Allocation; label?: string }) {
  const assigned = actions.reduce((sum, a) => sum + totals[a.id], 0);
  return <div className={s.frequencyGroup}>
    {label && <span className={s.smallMuted}>{label}</span>}
    <div className={s.frequencyBar}>
      {actions.map(a => <span key={a.id} style={{ width: `${totals[a.id] * 100}%`, background: a.color }} title={`${a.name} ${percent(totals[a.id])}`} />)}
      {assigned < .9999 && <span style={{ width: `${(1 - assigned) * 100}%`, background: '#34404f' }} />}
    </div>
    <div className={s.frequencyLegend}>
      {actions.map(a => <span key={a.id}><i style={{ background: a.color }} />{a.name}<b>{percent(totals[a.id])}</b></span>)}
      {assigned < .9999 && <span><i style={{ background: '#34404f' }} />未分配<b>{percent(1 - assigned)}</b></span>}
    </div>
  </div>;
}
