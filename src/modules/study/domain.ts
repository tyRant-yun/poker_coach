export type Action = 'check' | 'bet33' | 'bet75';
export type Allocation = Record<Action, number>;
export type Choices = Record<string, Allocation>;
export type RangeWeights = Record<string, number>;
export const actions: { id: Action; name: string; short: string; color: string }[] = [
  { id: 'check', name: '过牌', short: 'X', color: '#79aee8' },
  { id: 'bet33', name: '下注 33%', short: 'B33', color: '#e6ad6b' },
  { id: 'bet75', name: '下注 75%', short: 'B75', color: '#b697e4' },
];
export const ranks = 'AKQJT98765432'.split('');
export const suits = ['s', 'h', 'd', 'c'];

export type HandClass = { label: string; combos: string[]; row: number; col: number };
export const handClasses: HandClass[] = ranks.flatMap((a, row) => ranks.map((b, col) => {
  const label = row === col ? a + b : row < col ? a + b + 's' : b + a + 'o';
  const hi = row <= col ? a : b;
  const lo = row <= col ? b : a;
  const combos = suits.flatMap((s, i) => suits.flatMap((t, j) => {
    if (row === col) return i < j ? [hi + s + lo + t] : [];
    return (row < col ? s === t : s !== t) ? [hi + s + lo + t] : [];
  }));
  return { label, combos, row, col };
}));
export const allCombos = handClasses.flatMap(h => h.combos);
export const handByCombo = Object.fromEntries(handClasses.flatMap(h => h.combos.map(c => [c, h.label])));

export type Spot = {
  board: string[];
  potMinor: number;
  stackMinor: number;
  unitsPerBb: number;
  actor: 'BTN';
  rangeVersion: string;
  treeVersion: string;
};
export type PolicyDraft = { editRevision: number; choices: Choices };
export type PolicyRevision = {
  id: string;
  number: number;
  spotRevisionId: string;
  spot: Spot;
  choices: Choices;
  createdAt: string;
};
export type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export type SolveResult = {
  dataKind: 'synthetic';
  fixtureVersion: string;
  inputFingerprint: string;
  availability: 'available' | 'uncovered';
  reference: Choices | null;
  reason: string;
};
export type SolveJob = {
  id: string;
  policyRevisionId: string;
  spotRevisionId: string;
  status: JobStatus;
  stage: string;
  createdAt: string;
  result?: SolveResult;
};
export type AssessmentReport = {
  id: string;
  jobId: string;
  policyRevisionId: string;
  spotRevisionId: string;
  inputFingerprint: string;
  dataKind: 'synthetic';
  createdAt: string;
  difference: number | null;
  largestDifferences: { label: string; difference: number }[];
  sampleEv: { value: number; loss: number; template: 'check' | 'reference' } | null;
};
export type StudyCase = {
  id: string;
  name: string;
  scenarioId: 'S01';
  createdAt: string;
  updatedAt: string;
  spotRevisionId: string;
  spot: Spot;
  draft: PolicyDraft;
  versions: PolicyRevision[];
  jobs: SolveJob[];
  reports: AssessmentReport[];
  note: string;
};
export type WorkspaceSnapshot = { schemaVersion: 1; fixtureVersion: string; cases: Record<string, StudyCase> };

export function activeCombos(spot: Spot, weights: RangeWeights): string[] {
  return allCombos.filter(c => weights[c] > 0 && !spot.board.some(card => c.slice(0, 2) === card || c.slice(2) === card));
}
export function validAllocation(value: Allocation): boolean {
  return actions.every(a => Number.isInteger(value[a.id]) && value[a.id] >= 0 && value[a.id] <= 10000)
    && actions.reduce((sum, a) => sum + value[a.id], 0) === 10000;
}
export function policyStats(spot: Spot, weights: RangeWeights, choices: Choices) {
  const combos = activeCombos(spot, weights);
  const mass = combos.reduce((s, c) => s + weights[c], 0);
  const totals: Allocation = { check: 0, bet33: 0, bet75: 0 };
  let filled = 0;
  let invalid = 0;
  for (const c of combos) {
    const value = choices[c];
    if (!value) continue;
    if (!validAllocation(value)) { invalid++; continue; }
    filled++;
    for (const a of actions) totals[a.id] += value[a.id] / 10000 * weights[c];
  }
  return { combos, mass, filled, invalid, missing: combos.length - filled - invalid,
    coverage: combos.length ? filled / combos.length : 0,
    totals: Object.fromEntries(actions.map(a => [a.id, mass ? totals[a.id] / mass : 0])) as Allocation };
}
export function validateSubmission(spot: Spot, weights: RangeWeights, choices: Choices): string | null {
  const s = policyStats(spot, weights, choices);
  if (!s.combos.length) return '当前范围没有可用组合。';
  if (s.invalid) return `${s.invalid} 个组合频率无效，每个组合的行动频率应合计 100%。`;
  if (s.missing) return `还有 ${s.missing} 个组合尚未分配，请完成后再提交。`;
  return null;
}
export function spotSignature(spot: Spot): string {
  return JSON.stringify({ ...spot, board: [...spot.board].sort() });
}
export function canonicalPolicy(choices: Choices, combos: string[]): string {
  return JSON.stringify([...combos].sort().map(c => [c, ...actions.map(a => choices[c]?.[a.id] ?? null)]));
}
export function frequencyDifference(spot: Spot, weights: RangeWeights, user: Choices, reference: Choices): number {
  const combos = activeCombos(spot, weights);
  const mass = combos.reduce((s, c) => s + weights[c], 0);
  if (!mass) return 0;
  return combos.reduce((sum, c) => sum + weights[c] * actions.reduce((d, a) =>
    d + Math.abs(user[c][a.id] - reference[c][a.id]) / 20000, 0), 0) / mass;
}
export function validateSpot(spot: Spot): string | null {
  if (spot.board.length !== 3 || spot.board.some(c => !/^[AKQJT2-9][shdc]$/.test(c)) || new Set(spot.board).size !== 3)
    return '请输入三张不同的翻牌，例如 As 7d 2c。';
  if (![spot.potMinor, spot.stackMinor].every(v => Number.isInteger(v) && v > 0)) return '底池与剩余筹码必须为正数。';
  return null;
}
