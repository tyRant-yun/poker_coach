import { handClasses } from '../modules/study/domain';
import type { Allocation, Choices, RangeWeights, Spot } from '../modules/study/domain';

// Authored synthetic demonstration data, not a solver output or recommended poker strategy.
export const fixtureVersion = 's01-demo-1';
export const s01Spot: Spot = {
  board: ['As', '7d', '2c'], potMinor: 550, stackMinor: 9750, unitsPerBb: 100,
  actor: 'BTN', rangeVersion: 's01-ranges-v1', treeVersion: 's01-x-b33-b75-v1',
};
export const btnRange: RangeWeights = {};
export const bbRange: RangeWeights = {};
for (const h of handClasses) {
  const hi = Math.min(h.row, h.col);
  const lo = Math.max(h.row, h.col);
  const pair = h.row === h.col;
  const suited = h.row < h.col;
  const inBtn = pair || (suited && (hi <= 3 || lo - hi <= 3)) || (!suited && hi <= 3 && lo <= 8);
  const inBb = pair || (suited && (hi <= 5 || lo - hi <= 4)) || (!suited && hi <= 4 && lo <= 9);
  for (const combo of h.combos) {
    btnRange[combo] = inBtn ? (lo > 8 && !pair ? 5000 : 10000) : 0;
    bbRange[combo] = inBb ? (hi > 3 ? 6500 : 10000) : 0;
  }
}
export function referenceChoices(spot = s01Spot): Choices {
  const result: Choices = {};
  for (const h of handClasses) {
    for (const combo of h.combos) {
      const seed = (h.row * 7 + h.col * 11 + combo.charCodeAt(1)) % 5;
      const presets: Allocation[] = [
        { check: 6500, bet33: 2500, bet75: 1000 }, { check: 3000, bet33: 6000, bet75: 1000 },
        { check: 4500, bet33: 3500, bet75: 2000 }, { check: 2000, bet33: 5500, bet75: 2500 },
        { check: 7500, bet33: 1500, bet75: 1000 },
      ];
      if (btnRange[combo] > 0 && !spot.board.some(card => combo.slice(0, 2) === card || combo.slice(2) === card)) result[combo] = { ...presets[seed] };
    }
  }
  return result;
}
export const catalogue = [{
  id: 'S01', title: 'BTN vs BB', subtitle: '单加注底池 · 翻牌范围构建', board: s01Spot.board,
  tags: ['现金局', '6-max', '100 bb', 'SRP'],
  description: '先选择 Hero 并规划行动，再对照全范围参考；可以只改关心的组合，按需辅助补全。',
}];
