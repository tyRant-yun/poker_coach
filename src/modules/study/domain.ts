export type Action = string;
export type ActionDefinition = { id: string; name: string; short: string; color: string };
export type ScenarioId = 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'S08' | 'S09' | 'S10';
export type Allocation = Record<Action, number>;
export type Choices = Record<string, Allocation>;
export type RangeWeights = Record<string, number>;
export type RangeInputs = { BTN: RangeWeights; BB: RangeWeights } & Record<string, RangeWeights>;
export type EditableSnapshot = {
  name?: string;
  spot: Spot; spotRevisionId: string; ranges?: RangeInputs;
  choices: Choices; lockedCombos: string[]; assistance?: 'reference' | 'example';
  restoredFrom?: string;
};
export type EditEntry = { label: string; snapshot: EditableSnapshot };
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
  actor: string;
  nodeId?: string;
  actionSet?: ActionDefinition[];
  unit?: string;
  assumption?: string;
  upstream?: string;
  rangeVersion: string;
  treeVersion: string;
};
export type PolicyDraft = { editRevision: number; choices: Choices; assistance?: 'reference' | 'example'; lockedCombos?: string[]; restoredFrom?: string };
export type HeroPlanInput = {
  combo: string;
  action: Action;
  opponentBranch: 'call' | 'raise' | 'fold' | 'turn-bet' | 'turn-check';
  response: 'call' | 'raise' | 'fold' | 'reassess';
  turnPlan: string;
  reason: string;
};
export type HeroPlan = HeroPlanInput & { id: string; spotRevisionId: string; createdAt: string };
export type SolveInput = { spot: Spot; spotRevisionId: string; choices?: Choices; ranges?: RangeInputs; settings?: import('../product/domain').DemoSettings; executionAttempt?: number };
export type PolicyRevision = {
  id: string;
  number: number;
  spotRevisionId: string;
  spot: Spot;
  ranges?: RangeInputs;
  choices: Choices;
  createdAt: string;
  assistance?: 'reference' | 'example';
};
export type JobStatus = 'preflight' | 'postprocessing' | 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export type SolveResult = {
  dataKind: 'synthetic';
  fixtureVersion: string;
  inputFingerprint: string;
  availability: 'available' | 'uncovered' | 'unsupported';
  nodeId?: string;
  quality?: 'demo-target-met' | 'demo-incomplete' | 'not-evaluated';
  metrics?: Record<string, { equity: number; ev: Record<string, number>; category: string }>;
  unit?: string;
  reference: Choices | null;
  reason: string;
};
export type SolveJob = {
  id: string;
  policyRevisionId: string | null;
  spotRevisionId: string;
  status: JobStatus;
  stage: string;
  createdAt: string;
  input?: SolveInput;
  result?: SolveResult;
  settings?: import('../product/domain').DemoSettings;
  events?: { status: JobStatus; stage: string; at: string }[];
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
  scenarioId: ScenarioId;
  nodeDrafts?: Record<string, EditableSnapshot>;
  staleNodes?: string[];
  origin?: { handId: string; decisionId: string };
  experiment?: { baselineCaseId: string; baselineVersionId: string; variant: string; lock: import('../product/domain').NodeLock };
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
  spotRevisionId: string;
  spot: Spot;
  ranges?: RangeInputs;
  editHistory?: { past: EditEntry[]; future: EditEntry[] };
  branchSource?: { caseId: string; versionId: string; versionNumber: number };
  draft: PolicyDraft;
  versions: PolicyRevision[];
  jobs: SolveJob[];
  reports: AssessmentReport[];
  heroPlans: HeroPlan[];
  note: string;
};
export type WorkspaceSnapshot = { schemaVersion: 1; fixtureVersion: string; cases: Record<string, StudyCase>; product?: import('../product/domain').ProductState };

export function activeCombos(spot: Spot, weights: RangeWeights): string[] {
  return allCombos.filter(c => weights[c] > 0 && !spot.board.some(card => c.slice(0, 2) === card || c.slice(2) === card));
}
export const actionsFor = (spot: Spot): ActionDefinition[] => spot.actionSet ?? actions;
export function validAllocation(value: Allocation, available = actions): boolean {
  return available.every(a => Number.isInteger(value[a.id]) && value[a.id] >= 0 && value[a.id] <= 10000)
    && available.reduce((sum, a) => sum + value[a.id], 0) === 10000 && Object.keys(value).every(key => available.some(a => a.id === key) || value[key] === 0);
}
export function policyStats(spot: Spot, weights: RangeWeights, choices: Choices) {
  const combos = activeCombos(spot, weights);
  const mass = combos.reduce((s, c) => s + weights[c], 0);
  const available = actionsFor(spot);
  const totals: Allocation = Object.fromEntries(available.map(a => [a.id, 0]));
  let filled = 0;
  let invalid = 0;
  for (const c of combos) {
    const value = choices[c];
    if (!value) continue;
    if (!validAllocation(value, available)) { invalid++; continue; }
    filled++;
    for (const a of available) totals[a.id] += value[a.id] / 10000 * weights[c];
  }
  return { combos, mass, filled, invalid, missing: combos.length - filled - invalid,
    coverage: combos.length ? filled / combos.length : 0,
    totals: Object.fromEntries(available.map(a => [a.id, mass ? totals[a.id] / mass : 0])) as Allocation };
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
export function canonicalPolicy(choices: Choices, combos: string[], available = actions): string {
  return JSON.stringify([...combos].sort().map(c => [c, ...available.map(a => choices[c]?.[a.id] ?? null)]));
}
export function frequencyDifference(spot: Spot, weights: RangeWeights, user: Choices, reference: Choices): number {
  const combos = activeCombos(spot, weights);
  const mass = combos.reduce((s, c) => s + weights[c], 0);
  if (!mass) return 0;
  return combos.reduce((sum, c) => sum + weights[c] * actionsFor(spot).reduce((d, a) =>
    d + Math.abs(user[c][a.id] - reference[c][a.id]) / 20000, 0), 0) / mass;
}
export function validateSpot(spot: Spot): string | null {
  if (![0, 3, 4, 5].includes(spot.board.length) || spot.board.some(c => !/^[AKQJT2-9][shdc]$/.test(c)) || new Set(spot.board).size !== spot.board.length)
    return '公共牌应为 0、3、4 或 5 张不同的有效牌。';
  if (![spot.potMinor, spot.stackMinor].every(v => Number.isInteger(v) && v > 0)) return '底池与剩余筹码必须为正数。';
  return null;
}

export function normalizeCombo(input: string): string | null {
  const m = input.replace(/\s/g, '').match(/^([AKQJT2-9])([shdc])([AKQJT2-9])([shdc])$/i);
  if (!m) return null;
  const a = m[1].toUpperCase() + m[2].toLowerCase();
  const b = m[3].toUpperCase() + m[4].toLowerCase();
  return allCombos.find(c => c === a + b || c === b + a) ?? null;
}
export function validateHeroPlan(plan: HeroPlanInput, spot: Spot, weights: RangeWeights): string | null {
  const combo = normalizeCombo(plan.combo);
  if (!combo || !activeCombos(spot, weights).includes(combo)) return 'Hero 手牌与公共牌冲突，或不在当前输入范围中。';
  if (!actions.some(a => a.id === plan.action)) return '请先选择 Hero 的当前行动。';
  const branches = plan.action === 'check' ? ['turn-bet', 'turn-check'] : ['call', 'raise', 'fold'];
  if (!branches.includes(plan.opponentBranch)) return '这条后续分支与当前行动不一致：BTN 过牌后进入转牌。';
  if (!['call', 'raise', 'fold', 'reassess'].includes(plan.response)) return '请选择有效的后续计划。';
  if (!['raise', 'turn-bet'].includes(plan.opponentBranch) && plan.response !== 'reassess') return '该分支没有待回应的下注，请在下一决策点再评估。';
  return null;
}
