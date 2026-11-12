import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { actions, activeCombos, allCombos, canonicalPolicy, frequencyDifference, handByCombo, normalizeCombo, policyStats, validAllocation, validateHeroPlan, validateSpot, validateSubmission } from '../modules/study/domain';
import type { Allocation, AssessmentReport, Choices, EditableSnapshot, HeroPlanInput, PolicyRevision, RangeInputs, SolveInput, Spot, StudyCase, WorkspaceSnapshot } from '../modules/study/domain';
import { btnRange, bbRange, catalogue, fixtureVersion, referenceChoices, s01Spot } from '../fixtures/s01';
import type { SolverPort, WorkspaceRepository } from '../ports';
import { indexedDbRepository } from '../persistence/indexed-db';
import { createMockSolver } from '../mocks/solver';

type Result<T = undefined> = { ok: true; value: T } | { ok: false; message: string };
type State = {
  data: WorkspaceSnapshot;
  hydrated: boolean;
  saveStatus: 'loading' | 'saving' | 'saved' | 'error' | 'memory';
  savedAt: string | null;
  storageError: string | null;
  notice: { text: string; kind: 'success' | 'error' | 'info' } | null;
  pendingInput: boolean;
};
const uid = (prefix: string) => prefix + '-' + crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const copy = <T,>(value: T): T => structuredClone(value);
const emptyData = (): WorkspaceSnapshot => ({ schemaVersion: 1, fixtureVersion, cases: {} });
const rangesFor = (c?: { ranges?: RangeInputs }): RangeInputs => c?.ranges ?? { BTN: btnRange, BB: bbRange };
const weightsFor = (c?: { ranges?: RangeInputs }) => rangesFor(c).BTN;
const locked = (c: StudyCase) => new Set(c.draft.lockedCombos ?? []);
function editable(c: StudyCase): EditableSnapshot {
  return copy({ name: c.name, spot: c.spot, spotRevisionId: c.spotRevisionId, ranges: c.ranges,
    choices: c.draft.choices, lockedCombos: c.draft.lockedCombos ?? [], assistance: c.draft.assistance, restoredFrom: c.draft.restoredFrom });
}

export function createWorkspace(repository: WorkspaceRepository, solver: SolverPort) {
  const store = createStore<State>()(() => ({ data: emptyData(), hydrated: false, saveStatus: 'loading', savedAt: null, storageError: null, notice: null, pendingInput: false }));
  let initializePromise: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let mutation = 0;
  let persistenceEnabled = true;
  const controllers = new Map<string, AbortController>();
  function fail<T = undefined>(message: string): Result<T> {
    store.setState({ notice: { text: message, kind: 'error' } });
    return { ok: false, message };
  }
  function notice(text: string, kind: 'success' | 'info' = 'success') {
    store.setState({ notice: { text, kind } });
  }
  function persist() {
    if (!persistenceEnabled) return;
    const seq = ++mutation;
    const snapshot = copy(store.getState().data);
    store.setState({ saveStatus: 'saving' });
    queue = queue.then(async () => {
      try {
        await repository.save(snapshot);
        if (seq === mutation) store.setState({ saveStatus: 'saved', savedAt: now(), storageError: null });
      } catch {
        if (seq === mutation) store.setState({ saveStatus: 'error', storageError: '本地保存失败。内容仍在内存中，请重试或导出备份。' });
      }
    });
  }
  function replaceCase(c: StudyCase) {
    const current = store.getState().data;
    store.setState({ data: { ...current, cases: { ...current.cases, [c.id]: { ...c, updatedAt: now() } } } });
    persist();
  }
  function getCase(caseId: string) { return store.getState().data.cases[caseId]; }
  function editCase(c: StudyCase, next: StudyCase, label: string) {
    replaceCase({ ...next, draft: { ...next.draft, editRevision: c.draft.editRevision + 1 },
      editHistory: { past: [...(c.editHistory?.past ?? []), { label, snapshot: editable(c) }].slice(-30), future: [] } });
  }
  function applySnapshot(c: StudyCase, snapshot: EditableSnapshot): StudyCase {
    return { ...c, name: snapshot.name ?? c.name, spot: copy(snapshot.spot), spotRevisionId: snapshot.spotRevisionId, ranges: copy(snapshot.ranges),
      draft: { choices: copy(snapshot.choices), lockedCombos: [...snapshot.lockedCombos], assistance: snapshot.assistance, restoredFrom: snapshot.restoredFrom, editRevision: c.draft.editRevision + 1 } };
  }
  function updateJob(caseId: string, jobId: string, status: StudyCase['jobs'][number]['status'], stage: string) {
    const c = getCase(caseId);
    if (!c) return;
    const job = c.jobs.find(j => j.id === jobId);
    if (!job || ['cancelled', 'completed', 'failed', 'interrupted'].includes(job.status)) return;
    replaceCase({ ...c, jobs: c.jobs.map(j => j.id === jobId ? { ...j, status, stage } : j) });
  }

  async function runSolve(caseId: string, versionId: string | null): Promise<Result<string>> {
    const c = getCase(caseId);
    const version = c?.versions.find(v => v.id === versionId);
    if (!c || (versionId !== null && !version)) return fail('请先提交一个完整的策略版本。');
    const input: SolveInput = version
      ? { spot: copy(version.spot), spotRevisionId: version.spotRevisionId, choices: copy(version.choices), ranges: copy(rangesFor(version)) }
      : { spot: copy(c.spot), spotRevisionId: c.spotRevisionId, ranges: copy(rangesFor(c)) };
    if (c.jobs.some(j => j.policyRevisionId === versionId && j.spotRevisionId === input.spotRevisionId && ['queued', 'running'].includes(j.status))) return fail('相同输入已有模拟正在运行。');
    const jobId = uid('job');
    const controller = new AbortController();
    controllers.set(jobId, controller);
    replaceCase({ ...c, jobs: [...c.jobs, { id: jobId, policyRevisionId: versionId, spotRevisionId: input.spotRevisionId, status: 'queued', stage: '输入已固定，等待模拟', createdAt: now() }] });
    try {
      updateJob(caseId, jobId, 'running', '正在准备模拟分析');
      const result = await solver.solve(input, stage => updateJob(caseId, jobId, 'running', stage), controller.signal);
      const latest = getCase(caseId);
      if (!latest || controller.signal.aborted || latest.jobs.find(j => j.id === jobId)?.status !== 'running') return { ok: false, message: '模拟已取消。' };
      replaceCase({ ...latest, jobs: latest.jobs.map(j => j.id === jobId ? { ...j, status: 'completed', stage: '模拟完成', result } : j) });
      if (versionId !== null) return commands.requestAssessment(caseId, jobId);
      notice(result.reference ? '全范围示例参考已生成；你的推演与范围草稿保持独立。' : result.reason, 'info');
      return { ok: true, value: jobId };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, message: '模拟已取消。' };
      updateJob(caseId, jobId, 'failed', error instanceof Error ? error.message : '模拟执行失败');
      return fail('模拟执行失败，已有内容已保留，可以重新运行。');
    } finally { controllers.delete(jobId); }
  }

  const commands = {
    initialize() {
      if (initializePromise) return initializePromise;
      initializePromise = (async () => {
        try {
          const loaded = await repository.load();
          let interrupted = false;
          const data = loaded ?? emptyData();
          for (const c of Object.values(data.cases)) c.jobs = c.jobs.map(job => {
            if (job.status !== 'queued' && job.status !== 'running') return job;
            interrupted = true;
            return { ...job, status: 'interrupted', stage: '刷新前的模拟已中断，可重新运行' };
          });
          store.setState({ data, hydrated: true, saveStatus: 'saved' });
          if (interrupted) persist();
        } catch {
          persistenceEnabled = false;
          store.setState({ hydrated: true, saveStatus: 'memory', storageError: '无法读取本地存储；原记录未覆盖。本次内容仅保留在内存，请导出备份。' });
        }
      })();
      return initializePromise;
    },
    dismissNotice() { store.setState({ notice: null }); },
    showInfo(text: string) { notice(text, 'info'); },
    setPendingInput(value: boolean) { store.setState({ pendingInput: value }); },
    retrySave() { if (persistenceEnabled) persist(); },
    createCase(name = 'BTN vs BB · 翻牌研究'): Result<string> {
      if (!store.getState().hydrated) return fail('工作区尚未载入。');
      const id = uid('case');
      replaceCase({ id, name: name.trim() || '未命名研究', scenarioId: 'S01', createdAt: now(), updatedAt: now(),
        spotRevisionId: uid('spot'), spot: copy(s01Spot), draft: { editRevision: 0, choices: {} }, versions: [], jobs: [], reports: [], heroPlans: [], note: '' });
      notice('研究案例已建立。可以先从 Hero 手牌开始推演。');
      return { ok: true, value: id };
    },
    async createComparisonExample(): Promise<Result<string>> {
      const created = commands.createCase('S01 · 双版本对照示例');
      if (!created.ok) return created;
      const id = created.value;
      commands.loadExample(id);
      const v1 = commands.submitPolicy(id);
      if (!v1.ok) return v1;
      const c = getCase(id)!;
      commands.editPolicy(id, activeCombos(c.spot, weightsFor(c)), { check: 10000, bet33: 0, bet75: 0 }, c.draft.editRevision);
      const v2 = commands.submitPolicy(id);
      if (!v2.ok) return v2;
      await commands.requestSolve(id, v1.value);
      await commands.requestSolve(id, v2.value);
      notice('双版本示例已建立：V1 作者分配、V2 全过牌，报告均为合成数据。', 'info');
      return { ok: true, value: id };
    },
    editPolicy(caseId: string, comboIds: string[], allocation: Allocation, expectedRevision: number): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      if (c.draft.editRevision !== expectedRevision) return fail('草稿已更新，请重新检查后应用。');
      if (!actions.every(a => Number.isInteger(allocation[a.id]) && allocation[a.id] >= 0 && allocation[a.id] <= 10000)) return fail('每个频率应在 0–100% 之间。');
      const available = new Set(activeCombos(c.spot, weightsFor(c)));
      if (!comboIds.length || comboIds.some(combo => !available.has(combo))) return fail('所选组合不在当前可用范围中。');
      const choices = { ...c.draft.choices };
      const targets = [...new Set(comboIds)].filter(combo => !locked(c).has(combo));
      if (!targets.length) return fail('所选组合均已锁定，请先解锁。');
      targets.forEach(combo => { choices[combo] = { ...allocation }; });
      editCase(c, { ...c, draft: { ...c.draft, choices } }, `分配 ${targets.length} 个组合`);
      notice(`已更新 ${targets.length} 个组合，跳过 ${new Set(comboIds).size - targets.length} 个锁定组合。`);
      return { ok: true, value: undefined };
    },
    fillRemaining(caseId: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const remaining = activeCombos(c.spot, weightsFor(c)).filter(combo => !c.draft.choices[combo] && !locked(c).has(combo));
      if (!remaining.length) { notice('没有可补全的未锁定组合；锁定的未填写组合需要先解锁。', 'info'); return { ok: true, value: undefined }; }
      return commands.editPolicy(caseId, remaining, { check: 10000, bet33: 0, bet75: 0 }, c.draft.editRevision);
    },
    loadExample(caseId: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      if (!allCombos.every(combo => (weightsFor(c)[combo] ?? 0) === (btnRange[combo] ?? 0)) || JSON.stringify(c.spot) !== JSON.stringify(s01Spot) || !allCombos.every(combo => (rangesFor(c).BB[combo] ?? 0) === (bbRange[combo] ?? 0))) return fail('当前条件或范围没有匹配示例，请保留自己的输入；不能载入其他输入的分配。');
      const choices = { ...c.draft.choices };
      for (const [combo, value] of Object.entries(referenceChoices(c.spot))) if (!locked(c).has(combo)) choices[combo] = value;
      editCase(c, { ...c, draft: { ...c.draft, choices, assistance: 'example' } }, '载入示例分配');
      notice('已载入作者编写的示例分配；这不是 Solver 建议。', 'info');
      return { ok: true, value: undefined };
    },
    clearDraft(caseId: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const choices = Object.fromEntries(Object.entries(c.draft.choices).filter(([combo]) => locked(c).has(combo)));
      editCase(c, { ...c, draft: { ...c.draft, choices, assistance: Object.keys(choices).length ? c.draft.assistance : undefined } }, '清空未锁定分配');
      notice('未锁定的分配已清空，锁定部分与提交版本保留。', 'info');
      return { ok: true, value: undefined };
    },
    submitPolicy(caseId: string): Result<string> {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      if (store.getState().pendingInput) return fail('还有尚未应用的频率或权重输入，请先应用或放弃输入再提交。');
      const error = validateSubmission(c.spot, weightsFor(c), c.draft.choices);
      if (error) return fail(error);
      const last = c.versions.at(-1);
      if (last && !c.draft.restoredFrom && last.assistance === c.draft.assistance && JSON.stringify(last.spot) === JSON.stringify(c.spot) && JSON.stringify(rangesFor(last)) === JSON.stringify(rangesFor(c)) && canonicalPolicy(last.choices, activeCombos(last.spot, weightsFor(last))) === canonicalPolicy(c.draft.choices, activeCombos(c.spot, weightsFor(c)))) {
        notice(`与 V${last.number} 相同，已打开原提交。`, 'info');
        return { ok: true, value: last.id };
      }
      const id = uid('policy');
      const version: PolicyRevision = { id, number: c.versions.length + 1, spotRevisionId: c.spotRevisionId, spot: copy(c.spot), ranges: copy(rangesFor(c)), choices: copy(c.draft.choices), assistance: c.draft.assistance, createdAt: now() };
      replaceCase({ ...c, draft: { ...c.draft, restoredFrom: undefined }, versions: [...c.versions, version] });
      notice(`V${version.number} 已提交并固定，可以运行模拟分析。`);
      return { ok: true, value: id };
    },
    restoreAsDraft(caseId: string, versionId: string): Result {
      const c = getCase(caseId);
      const v = c?.versions.find(v => v.id === versionId);
      if (!c || !v) return fail('版本不存在。');
      editCase(c, { ...c, spot: copy(v.spot), spotRevisionId: v.spotRevisionId, ranges: copy(rangesFor(v)),
        draft: { editRevision: c.draft.editRevision, choices: copy(v.choices), assistance: v.assistance, lockedCombos: [], restoredFrom: v.id } }, `从 V${v.number} 恢复`);
      notice(`已从 V${v.number} 建立可编辑草稿，原版本保持不变。`);
      return { ok: true, value: undefined };
    },
    reviseSpot(caseId: string, spot: Spot, name: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const error = validateSpot(spot);
      if (error) return fail(error);
      editCase(c, { ...c, name: name.trim() || c.name, spot: copy(spot), spotRevisionId: uid('spot'), draft: { choices: {}, editRevision: c.draft.editRevision } }, '修订局面条件');
      notice('局面修订已建立，当前草稿已清空；历史版本仍保留。', 'info');
      return { ok: true, value: undefined };
    },
    setLocks(caseId: string, comboIds: string[], value: boolean, expectedRevision: number): Result {
      const c = getCase(caseId);
      if (!c || c.draft.editRevision !== expectedRevision) return fail('草稿已更新，请重新选择。');
      const available = new Set(activeCombos(c.spot, weightsFor(c)));
      if (!comboIds.length || comboIds.some(combo => !available.has(combo))) return fail('请选择当前可用组合。');
      const ids = locked(c);
      comboIds.forEach(combo => { if (value) ids.add(combo); else ids.delete(combo); });
      editCase(c, { ...c, draft: { ...c.draft, lockedCombos: [...ids] } }, `${value ? '锁定' : '解锁'} ${comboIds.length} 个组合`);
      notice(value ? '组合已锁定，批量分配、补全和清空会跳过它们。' : '所选组合已解锁。');
      return { ok: true, value: undefined };
    },
    reviseRange(caseId: string, player: 'BTN' | 'BB', comboIds: string[], weight: number, expectedRevision: number): Result {
      const c = getCase(caseId);
      if (!c || c.draft.editRevision !== expectedRevision) return fail('草稿已更新，请重新检查范围。');
      if (!Number.isInteger(weight) || weight < 0 || weight > 10000) return fail('输入权重应在 0–100% 之间，精确至 0.01%。');
      if (!comboIds.length || comboIds.some(combo => !allCombos.includes(combo) || c.spot.board.some(card => combo.slice(0, 2) === card || combo.slice(2) === card))) return fail('不能修改死牌或无效组合。');
      const ranges = copy(rangesFor(c));
      comboIds.forEach(combo => { ranges[player][combo] = weight; });
      if (allCombos.every(combo => (ranges[player][combo] ?? 0) === (rangesFor(c)[player][combo] ?? 0))) { notice('输入权重没有变化。', 'info'); return { ok: true, value: undefined }; }
      const baseline = allCombos.every(combo => (ranges.BTN[combo] ?? 0) === (btnRange[combo] ?? 0) && (ranges.BB[combo] ?? 0) === (bbRange[combo] ?? 0));
      const spot = { ...c.spot, rangeVersion: baseline ? s01Spot.rangeVersion : uid('range') };
      const available = new Set(activeCombos(spot, ranges.BTN));
      const choices = Object.fromEntries(Object.entries(c.draft.choices).filter(([combo]) => available.has(combo)));
      editCase(c, { ...c, spot, spotRevisionId: uid('spot'), ranges, draft: { ...c.draft, choices, lockedCombos: [...locked(c)].filter(combo => available.has(combo)) } }, `修订 ${player} 输入范围`);
      notice('范围修订已建立；保留仍可用的分配，新加入的组合需要填写。旧版本与报告保持不变。', 'info');
      return { ok: true, value: undefined };
    },
    undo(caseId: string): Result {
      const c = getCase(caseId);
      const entry = c?.editHistory?.past.at(-1);
      if (!c || !entry) return fail('没有可撤销的编辑。');
      replaceCase({ ...applySnapshot(c, entry.snapshot), editHistory: { past: c.editHistory!.past.slice(0, -1), future: [...c.editHistory!.future, { label: entry.label, snapshot: editable(c) }] } });
      notice(`已撤销：${entry.label}`);
      return { ok: true, value: undefined };
    },
    redo(caseId: string): Result {
      const c = getCase(caseId);
      const entry = c?.editHistory?.future.at(-1);
      if (!c || !entry) return fail('没有可重做的编辑。');
      replaceCase({ ...applySnapshot(c, entry.snapshot), editHistory: { past: [...c.editHistory!.past, { label: entry.label, snapshot: editable(c) }], future: c.editHistory!.future.slice(0, -1) } });
      notice(`已重做：${entry.label}`);
      return { ok: true, value: undefined };
    },
    forkVersion(caseId: string, versionId: string, name: string): Result<string> {
      const c = getCase(caseId);
      const v = c?.versions.find(v => v.id === versionId);
      if (!c || !v || !name.trim()) return fail('请选择固定版本并填写分支名称。');
      const id = uid('case');
      replaceCase({ id, name: name.trim().slice(0, 80), scenarioId: 'S01', createdAt: now(), updatedAt: now(),
        spot: copy(v.spot), spotRevisionId: v.spotRevisionId, ranges: copy(rangesFor(v)),
        draft: { editRevision: 0, choices: copy(v.choices), assistance: v.assistance, lockedCombos: [] },
        branchSource: { caseId, versionId, versionNumber: v.number }, versions: [], jobs: [], reports: [], heroPlans: [], note: '' });
      notice(`已从 V${v.number} 建立独立研究分支。`);
      return { ok: true, value: id };
    },
    saveNote(caseId: string, note: string) {
      const c = getCase(caseId);
      if (c) replaceCase({ ...c, note: note.slice(0, 4000) });
    },
    saveHeroPlan(caseId: string, input: HeroPlanInput, expectedSpotRevision: string): Result<string> {
      const c = getCase(caseId);
      if (!c || c.spotRevisionId !== expectedSpotRevision) return fail('局面已更新，请重新检查 Hero 推演。');
      const error = validateHeroPlan(input, c.spot, weightsFor(c));
      if (error) return fail(error);
      const id = uid('hero');
      replaceCase({ ...c, heroPlans: [...c.heroPlans, { ...input, combo: normalizeCombo(input.combo)!, reason: input.reason.slice(0, 2000), turnPlan: input.turnPlan.slice(0, 2000), id, spotRevisionId: c.spotRevisionId, createdAt: now() }] });
      notice('Hero 推演已保存。它不是完整范围作答，也未自动修改范围草稿。');
      return { ok: true, value: id };
    },
    applyHeroAction(caseId: string, planId: string, scope: 'hero' | 'class', expectedRevision: number): Result {
      const c = getCase(caseId);
      const plan = c?.heroPlans.find(p => p.id === planId);
      if (!c || !plan || plan.spotRevisionId !== c.spotRevisionId) return fail('该推演不属于当前局面，不能套用。');
      const error = validateHeroPlan(plan, c.spot, weightsFor(c));
      if (error) return fail(error);
      const target = scope === 'hero' ? [plan.combo] : activeCombos(c.spot, weightsFor(c)).filter(combo => handByCombo[combo] === handByCombo[plan.combo]);
      return commands.editPolicy(caseId, target, { check: plan.action === 'check' ? 10000 : 0, bet33: plan.action === 'bet33' ? 10000 : 0, bet75: plan.action === 'bet75' ? 10000 : 0 }, expectedRevision);
    },
    fillFromReference(caseId: string, jobId: string, expectedRevision: number): Result {
      const c = getCase(caseId);
      const job = c?.jobs.find(j => j.id === jobId);
      if (!c || c.draft.editRevision !== expectedRevision) return fail('草稿已更新，请重新检查补全范围。');
      if (!job || job.status !== 'completed' || job.spotRevisionId !== c.spotRevisionId || !job.result?.reference || job.result.availability !== 'available') return fail('没有适用于当前局面的完整参考，不能补全。');
      const reference = job.result.reference;
      const combos = activeCombos(c.spot, weightsFor(c));
      if (combos.some(combo => !reference[combo] || !validAllocation(reference[combo]))) return fail('参考未完整覆盖当前范围，不能自动补全。');
      const choices = { ...c.draft.choices };
      let count = 0;
      for (const combo of combos) if (!choices[combo] && !locked(c).has(combo)) { choices[combo] = copy(reference[combo]); count++; }
      if (count) editCase(c, { ...c, draft: { ...c.draft, choices, assistance: 'reference' } }, `参考补全 ${count} 个组合`);
      notice(`已用示例参考补全 ${count} 个未填写组合；已有分配未改动。这是一份辅助草稿。`, 'info');
      return { ok: true, value: undefined };
    },
    requestSolve(caseId: string, versionId: string): Promise<Result<string>> {
      return runSolve(caseId, versionId);
    },
    requestReference(caseId: string): Promise<Result<string>> {
      return runSolve(caseId, null);
    },
    cancelJob(caseId: string, jobId: string) {
      controllers.get(jobId)?.abort();
      updateJob(caseId, jobId, 'cancelled', '已取消，未生成新报告');
      notice('模拟已取消，策略版本保持不变。', 'info');
    },
    requestAssessment(caseId: string, jobId: string): Result<string> {
      const c = getCase(caseId);
      const job = c?.jobs.find(j => j.id === jobId);
      const version = c?.versions.find(v => v.id === job?.policyRevisionId);
      if (!c || !job?.result || job.status !== 'completed' || !version) return fail('没有已完成且匹配的模拟结果。');
      const existing = c.reports.find(r => r.jobId === jobId);
      if (existing) return { ok: true, value: existing.id };
      const reference = job.result.reference;
      const weights = weightsFor(version);
      const combos = activeCombos(version.spot, weights);
      const check: Choices = Object.fromEntries(combos.map(combo => [combo, { check: 10000, bet33: 0, bet75: 0 }]));
      const userKey = canonicalPolicy(version.choices, combos);
      const template = reference && userKey === canonicalPolicy(reference, combos) ? 'reference' : reference && userKey === canonicalPolicy(check, combos) ? 'check' : null;
      const differences: Record<string, { sum: number; mass: number }> = {};
      if (reference) for (const combo of combos) {
        const label = handByCombo[combo];
        differences[label] ??= { sum: 0, mass: 0 };
        differences[label].sum += weights[combo] * actions.reduce((s, a) => s + Math.abs(version.choices[combo][a.id] - reference[combo][a.id]) / 20000, 0);
        differences[label].mass += weights[combo];
      }
      const report: AssessmentReport = {
        id: uid('report'), jobId, policyRevisionId: version.id, spotRevisionId: version.spotRevisionId,
        inputFingerprint: job.result.inputFingerprint, dataKind: 'synthetic', createdAt: now(),
        difference: reference ? frequencyDifference(version.spot, weights, version.choices, reference) : null,
        largestDifferences: Object.entries(differences).map(([label, d]) => ({ label, difference: d.sum / d.mass })).sort((a, b) => b.difference - a.difference).slice(0, 5),
        sampleEv: template ? { template, value: template === 'check' ? 1.86 : 2.04, loss: template === 'check' ? 0.18 : 0 } : null,
      };
      replaceCase({ ...c, reports: [...c.reports, report] });
      notice(reference ? '模拟反馈已生成。参考差异不等于实际 EV 损失。' : job.result.reason, 'info');
      return { ok: true, value: report.id };
    },
    flushSaves() { return queue; },
  };
  return { store, commands };
}

const workspace = createWorkspace(indexedDbRepository, createMockSolver());
export const commands = workspace.commands;
export const useWorkspace = <T,>(selector: (state: State) => T): T => useStore(workspace.store, selector);
export const queries = {
  catalogue: () => catalogue,
  weights: (player: 'BTN' | 'BB' = 'BTN', context?: { ranges?: RangeInputs }) => rangesFor(context)[player],
  stats: (c: StudyCase) => policyStats(c.spot, weightsFor(c), c.draft.choices),
  snapshot: () => copy(workspace.store.getState().data),
  latestReference: (c: StudyCase) => c.jobs.filter(j => j.status === 'completed' && j.spotRevisionId === c.spotRevisionId && j.result?.availability === 'available' && j.result.reference).at(-1),
  latestHeroPlan: (c: StudyCase) => c.heroPlans.filter(p => p.spotRevisionId === c.spotRevisionId).at(-1),
};
