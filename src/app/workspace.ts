import { createTeachingCoach } from '../modules/teaching/coach';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { actionsFor, activeCombos, allCombos, canonicalPolicy, frequencyDifference, handByCombo, normalizeCombo, policyStats, validAllocation, validateHeroPlan, validateSpot, validateSubmission } from '../modules/study/domain';
import type { Allocation, AssessmentReport, Choices, EditableSnapshot, HeroPlanInput, PolicyRevision, RangeInputs, ScenarioId, SolveInput, Spot, StudyCase, WorkspaceSnapshot } from '../modules/study/domain';
import { btnRange, bbRange, fixtureVersion, s01Spot } from '../fixtures/s01';
import type { SolverPort, WorkspaceRepository } from '../ports';
import { indexedDbRepository } from '../persistence/indexed-db';
import { createMockSolver } from '../mocks/solver';
import { descendants, evaluationTemplate, matchingReference, scenarios, scenarioFor } from '../fixtures/scenarios';
import { emptyProduct, runningStatuses } from '../modules/product/domain';
import { createLearningCommands, learningQueries } from '../modules/product/learning';
import { createTransferCommands } from '../modules/product/transfer';
import { createReviewCommands, reviewQueries } from '../modules/product/review';
import { createAgentCommands } from '../modules/product/agent';
import { createResearchCommands, researchQueries } from '../modules/product/research';
import { emptyTeaching, upgradeTeachingSnapshot } from '../modules/teaching/content';
import { createTeachingCommands } from '../modules/teaching/commands';
import { createKnowledgeCommands } from '../modules/teaching/knowledge';
import { teachingQueries } from '../modules/teaching/queries';

type Result<T = undefined> = { ok: true; value: T } | { ok: false; message: string };
type State = {
  data: WorkspaceSnapshot;
  hydrated: boolean;
  saveStatus: 'loading' | 'saving' | 'saved' | 'error' | 'memory';
  savedAt: string | null;
  storageError: string | null;
  notice: { text: string; kind: 'success' | 'error' | 'info' } | null;
  pendingInput: boolean;
  pendingInputCaseId: string | null;
};
const uid = (prefix: string) => prefix + '-' + crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const copy = <T,>(value: T): T => structuredClone(value);
const emptyData = (): WorkspaceSnapshot => ({ schemaVersion: 2, fixtureVersion, cases: {},teaching:emptyTeaching() });
const rangesFor = (c?: { ranges?: RangeInputs }): RangeInputs => c?.ranges ?? { BTN: btnRange, BB: bbRange };
const weightsFor = (c?: { ranges?: RangeInputs; spot?: Spot }) => rangesFor(c)[c?.spot?.actor ?? 'BTN'] ?? rangesFor(c).BTN;
const locked = (c: StudyCase) => new Set(c.draft.lockedCombos ?? []);
function editable(c: StudyCase): EditableSnapshot {
  return copy({ name: c.name, spot: c.spot, spotRevisionId: c.spotRevisionId, ranges: c.ranges,
    choices: c.draft.choices, lockedCombos: c.draft.lockedCombos ?? [], assistance: c.draft.assistance, restoredFrom: c.draft.restoredFrom, staleNodes:c.staleNodes });
}

export function createWorkspace(repository: WorkspaceRepository, solver: SolverPort) {
  const store = createStore<State>()(() => ({ data: emptyData(), hydrated: false, saveStatus: 'loading', savedAt: null, storageError: null, notice: null, pendingInput: false, pendingInputCaseId: null }));
  let initializePromise: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let mutation = 0;
  let persistenceEnabled = true;
  const controllers = new Map<string, AbortController>();
  const skipControllers = new Map<string, AbortController>();
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
      if(!persistenceEnabled)return;
      try {
        await repository.save(snapshot);
        if (seq === mutation) store.setState({ saveStatus: 'saved', savedAt: now(), storageError: null });
      } catch {
        if (seq === mutation) store.setState({ saveStatus: 'error', storageError: '本地保存失败。内容仍在内存中，请重试或导出备份。' });
      }
    });
  }
  function replaceData(data: WorkspaceSnapshot) { store.setState({ data }); persist(); }
  function replaceCase(c: StudyCase) {
    const current = store.getState().data;
    store.setState({ data: { ...current, cases: { ...current.cases, [c.id]: { ...c, updatedAt: now() } } } });
    persist();
  }
  function getCase(caseId: string) { return store.getState().data.cases[caseId]; }
  function editCase(c: StudyCase, next: StudyCase, label: string) {
    const affected = JSON.stringify(c.draft.choices) !== JSON.stringify(next.draft.choices) || JSON.stringify(c.spot) !== JSON.stringify(next.spot) ? descendants(c.scenarioId,c.spot.nodeId ?? `${c.scenarioId}-root`) : [];
    const reference = matchingReference(next.spot,rangesFor(next));
    const isReference = reference && canonicalPolicy(next.draft.choices,activeCombos(next.spot,weightsFor(next)),actionsFor(next.spot)) === canonicalPolicy(reference,activeCombos(next.spot,weightsFor(next)),actionsFor(next.spot));
    const staleNodes = isReference ? (c.staleNodes ?? []).filter(id=>!affected.includes(id)) : [...new Set([...(c.staleNodes ?? []),...affected])];
    replaceCase({ ...next, staleNodes, draft: { ...next.draft, editRevision: c.draft.editRevision + 1 },
      editHistory: { past: [...(c.editHistory?.past ?? []), { label, snapshot: editable(c) }].slice(-30), future: [] } });
  }
  function applySnapshot(c: StudyCase, snapshot: EditableSnapshot): StudyCase {
    return { ...c, name: snapshot.name ?? c.name, staleNodes:copy(snapshot.staleNodes??[]), spot: copy(snapshot.spot), spotRevisionId: snapshot.spotRevisionId, ranges: copy(snapshot.ranges),
      draft: { choices: copy(snapshot.choices), lockedCombos: [...snapshot.lockedCombos], assistance: snapshot.assistance, restoredFrom: snapshot.restoredFrom, editRevision: c.draft.editRevision + 1 } };
  }
  function updateJob(caseId: string, jobId: string, status: StudyCase['jobs'][number]['status'], stage: string) {
    const c = getCase(caseId);
    if (!c) return;
    const job = c.jobs.find(j => j.id === jobId);
    if (!job || ['cancelled', 'completed', 'failed', 'interrupted'].includes(job.status)) return;
    replaceCase({ ...c, jobs: c.jobs.map(j => j.id === jobId ? { ...j, status, stage, events:[...(j.events ?? []),{status,stage,at:now()}] } : j) });
  }

  async function runSolve(caseId: string, versionId: string | null, fixedInput?:SolveInput): Promise<Result<string>> {
    if(teachingQueries.activeIndependent(store.getState().data))return fail('独立题期间不读取研究参考；请先明确使用辅助。');
    const c = getCase(caseId);
    const version = c?.versions.find(v => v.id === versionId);
    if (!c || (versionId !== null && !version)) return fail('请先提交一个完整的策略版本。');
    const input: SolveInput = fixedInput?copy(fixedInput):version
      ? { spot: copy(version.spot), spotRevisionId: version.spotRevisionId, choices: copy(version.choices), ranges: copy(rangesFor(version)) }
      : { spot: copy(c.spot), spotRevisionId: c.spotRevisionId, ranges: copy(rangesFor(c)) };
    input.settings = copy(fixedInput?.settings ?? store.getState().data.product?.settings ?? emptyProduct().settings);
    input.executionAttempt = c.jobs.filter(j => j.policyRevisionId === versionId && j.spotRevisionId === input.spotRevisionId && j.settings?.outcome === input.settings?.outcome).length + 1;
    if (c.jobs.some(j => j.policyRevisionId === versionId && j.spotRevisionId === input.spotRevisionId && runningStatuses.includes(j.status))) return fail('相同输入已有模拟正在运行。');
    const jobId = uid('job');
    const controller = new AbortController();
    controllers.set(jobId, controller);
    const skip = new AbortController(); skipControllers.set(jobId,skip);
    replaceCase({ ...c, jobs: [...c.jobs, { id: jobId, policyRevisionId: versionId, spotRevisionId: input.spotRevisionId, status: 'queued', stage: '输入已固定，等待模拟', input:copy(input), settings:input.settings, events:[{status:'queued',stage:'输入已固定，等待模拟',at:now()}], createdAt: now() }] });
    try {
      updateJob(caseId, jobId, 'queued', '等待输入预检');
      const result = await solver.solve(input, (stage,status) => updateJob(caseId,jobId,status ?? 'running',stage),controller.signal,skip.signal);
      const latest = getCase(caseId);
      if (!latest || controller.signal.aborted || !runningStatuses.includes(latest.jobs.find(j => j.id === jobId)?.status ?? 'failed')) return { ok: false, message: '模拟已取消。' };
      replaceCase({ ...latest, jobs: latest.jobs.map(j => j.id === jobId ? { ...j, status: 'completed', stage: '模拟完成', result, events:[...(j.events ?? []),{status:'completed',stage:'模拟完成',at:now()}] } : j) });
      if (versionId !== null) return commands.requestAssessment(caseId, jobId);
      notice(result.reference ? '全范围示例参考已生成；你的推演与范围草稿保持独立。' : result.reason, 'info');
      return { ok: true, value: jobId };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, message: '模拟已取消。' };
      updateJob(caseId, jobId, 'failed', error instanceof Error ? error.message : '模拟执行失败');
      return fail('模拟执行失败，已有内容已保留，可以重新运行。');
    } finally { controllers.delete(jobId); skipControllers.delete(jobId); }
  }

  const commands = {
    initialize() {
      if (initializePromise) return initializePromise;
      initializePromise = (async () => {
        try {
          const loaded = await repository.load();
          let interrupted = false;
          const data = upgradeTeachingSnapshot(loaded ?? emptyData());
          data.product ??= emptyProduct();
          for (const mission of Object.values(data.product.missions)) if (['planned','running','paused'].includes(mission.status)) { mission.status = 'interrupted'; mission.trace=mission.trace.map(t=>t.status==='running'?{...t,status:'interrupted',observation:'刷新前工具中断，恢复时检查已登记成果。'}:t); mission.message = '刷新前的脚本中断，可从已记录步骤继续。'; interrupted = true; }
          for (const c of Object.values(data.cases)) c.jobs = c.jobs.map(job => {
            if (!runningStatuses.includes(job.status)) return job;
            interrupted = true;
            return { ...job, status: 'interrupted', stage: '刷新前的模拟已中断，可重新运行' };
          });
          store.setState({ data, hydrated: true, saveStatus: 'saved' });
          if (interrupted || loaded?.schemaVersion===1 || loaded&&JSON.stringify(loaded.teaching)!==JSON.stringify(data.teaching)) persist();
        } catch {
          persistenceEnabled = false;
          store.setState({ hydrated: true, saveStatus: 'memory', storageError: '无法读取本地存储；原记录未覆盖。本次内容仅保留在内存，请导出备份。' });
        }
      })();
      return initializePromise;
    },
    dismissNotice() { store.setState({ notice: null }); },
    showInfo(text: string) { notice(text, 'info'); },
    setPendingInput(value: boolean,caseId?:string) { store.setState({ pendingInput: value,pendingInputCaseId:value?caseId??null:null }); },
    retrySave() { if (persistenceEnabled) persist(); },
    createCase(name = 'BTN vs BB · 翻牌研究', scenarioId: ScenarioId = 'S01'): Result<string> {
      if (!store.getState().hydrated) return fail('工作区尚未载入。');
      if(teachingQueries.activeIndependent(store.getState().data))return fail('独立题不能创建含答案的研究；请先明确请求辅助。');
      const template = scenarioFor(scenarioId)?.nodes[0];
      if (!template) return fail('没有找到演示局面。');
      const id = uid('case');
      replaceCase({ id, name: name.trim() || '未命名研究', scenarioId, createdAt: now(), updatedAt: now(),
        spotRevisionId: uid('spot'), spot: copy(template.spot), ranges: copy(template.ranges), draft: { editRevision: 0, choices: {} }, versions: [], jobs: [], reports: [], heroPlans: [], note: '' });
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
      if (!actionsFor(c.spot).every(a => Number.isInteger(allocation[a.id]) && allocation[a.id] >= 0 && allocation[a.id] <= 10000)) return fail('每个频率应在 0–100% 之间。');
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
      return commands.editPolicy(caseId, remaining, Object.fromEntries(actionsFor(c.spot).map((a,i) => [a.id,i === 0 ? 10000 : 0])), c.draft.editRevision);
    },
    loadExample(caseId: string): Result {
      if(teachingQueries.activeIndependent(store.getState().data))return fail('独立题期间不读取示例答案。');
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const example = matchingReference(c.spot,rangesFor(c));
      if (!example) return fail('当前条件或范围没有匹配示例，请保留自己的输入；不能载入其他输入的分配。');
      const choices = { ...c.draft.choices };
      for (const [combo, value] of Object.entries(example)) if (!locked(c).has(combo)) choices[combo] = value;
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
      if (store.getState().pendingInput && (!store.getState().pendingInputCaseId || store.getState().pendingInputCaseId === caseId)) return fail('还有尚未应用的频率或权重输入，请先应用或放弃输入再提交。');
      const error = validateSubmission(c.spot, weightsFor(c), c.draft.choices);
      if (error) return fail(error);
      const last = c.versions.at(-1);
      if (last && !c.draft.restoredFrom && last.assistance === c.draft.assistance && JSON.stringify(last.spot) === JSON.stringify(c.spot) && JSON.stringify(rangesFor(last)) === JSON.stringify(rangesFor(c)) && canonicalPolicy(last.choices, activeCombos(last.spot, weightsFor(last)),actionsFor(last.spot)) === canonicalPolicy(c.draft.choices, activeCombos(c.spot, weightsFor(c)),actionsFor(c.spot))) {
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
      if(!rangesFor(c)[spot.actor])return fail('当前玩家没有输入范围，局面修订未应用。');
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
    reviseRange(caseId: string, player: string, comboIds: string[], weight: number, expectedRevision: number): Result {
      const c = getCase(caseId);
      if (!c || c.draft.editRevision !== expectedRevision) return fail('草稿已更新，请重新检查范围。');
      if (!Number.isInteger(weight) || weight < 0 || weight > 10000) return fail('输入权重应在 0–100% 之间，精确至 0.01%。');
      if (!comboIds.length || comboIds.some(combo => !allCombos.includes(combo) || c.spot.board.some(card => combo.slice(0, 2) === card || combo.slice(2) === card))) return fail('不能修改死牌或无效组合。');
      const ranges = copy(rangesFor(c));
      if (!ranges[player]) return fail('该玩家不在当前输入中。');
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
      replaceCase({ id, name: name.trim().slice(0, 80), scenarioId: c.scenarioId, createdAt: now(), updatedAt: now(),
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
      if (combos.some(combo => !reference[combo] || !validAllocation(reference[combo],actionsFor(c.spot)))) return fail('参考未完整覆盖当前范围，不能自动补全。');
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
    retryJob(caseId:string,jobId:string):Promise<Result<string>> {
      const c=getCase(caseId),job=c?.jobs.find(j=>j.id===jobId);
      if(!c||!job||!['failed','interrupted','cancelled'].includes(job.status))return Promise.resolve(fail('只有未完成的作业可以重试。'));
      if(!job.input&&job.spotRevisionId!==c.spotRevisionId&&!job.policyRevisionId)return Promise.resolve(fail('旧作业没有输入快照，请从对应固定版本重新运行。'));
      return runSolve(caseId,job.policyRevisionId,job.input);
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
      const available = actionsFor(version.spot);
      const check: Choices = Object.fromEntries(combos.map(combo => [combo,Object.fromEntries(available.map((a,i) => [a.id,i === 0 ? 10000 : 0]))]));
      const userKey = canonicalPolicy(version.choices, combos,available);
      const template = reference && userKey === canonicalPolicy(reference, combos,available) ? 'reference' : reference && userKey === canonicalPolicy(check, combos,available) ? 'check' : null;
      const differences: Record<string, { sum: number; mass: number }> = {};
      if (reference) for (const combo of combos) {
        const label = handByCombo[combo];
        differences[label] ??= { sum: 0, mass: 0 };
        differences[label].sum += weights[combo] * available.reduce((s, a) => s + Math.abs(version.choices[combo][a.id] - reference[combo][a.id]) / 20000, 0);
        differences[label].mass += weights[combo];
      }
      const evaluated=template?evaluationTemplate(version.spot,template):null;
      const report: AssessmentReport = {
        id: uid('report'), jobId, policyRevisionId: version.id, spotRevisionId: version.spotRevisionId,
        inputFingerprint: job.result.inputFingerprint, dataKind: 'synthetic', createdAt: now(),
        difference: reference ? frequencyDifference(version.spot, weights, version.choices, reference) : null,
        largestDifferences: Object.entries(differences).map(([label, d]) => ({ label, difference: d.sum / d.mass })).sort((a, b) => b.difference - a.difference).slice(0, 5),
        sampleEv: template&&evaluated?{template,value:evaluated.value,loss:evaluated.loss}:null,
        sampleAdversarial:evaluated?.adversarial??null,
      };
      replaceCase({ ...c, reports: [...c.reports, report] });
      notice(reference ? '模拟反馈已生成。参考差异不等于实际 EV 损失。' : job.result.reason, 'info');
      return { ok: true, value: report.id };
    },
    async readStoredBackup():Promise<Result<unknown>> {try{if(!repository.readRaw)return fail('此存储适配器不提供原始记录读取。');return {ok:true,value:await repository.readRaw()};}catch{return fail('原始本地存储无法读取；没有覆盖它。');}},
    skipWait(jobId: string) { skipControllers.get(jobId)?.abort(); },
    flushSaves() { return queue; },
  };
  const context = { getData:() => store.getState().data, replaceData, getCase, replaceCase, editCase, fail, notice, base:commands,
    saved:async()=>{await queue;return store.getState().saveStatus==='saved';},memory:()=>!persistenceEnabled,
    enterMemory:()=>{persistenceEnabled=false;store.setState({saveStatus:'memory',storageError:'辅助内存模式：没有持久化，不能作为未见或延迟保持证据。'});},
    onReset:()=>{persistenceEnabled=true;store.setState({pendingInput:false,pendingInputCaseId:null,storageError:null});if(repository.reset)queue=queue.then(async()=>{try{await repository.reset!();}catch{persistenceEnabled=false;store.setState({saveStatus:'error',storageError:'重置未完成，原存储保留；请先导出原件。'});}});}, stopAll:() => { controllers.forEach(c => c.abort()); skipControllers.forEach(c => c.abort()); } };
  const research = createResearchCommands(context);
  const learning = createLearningCommands(context);
  const agent = createAgentCommands(context,research,learning);
  const review=createReviewCommands(context,learning);
  const transfer=createTransferCommands(context);
  const teaching=createTeachingCommands(context),theory=createKnowledgeCommands(context);
  const coach=createTeachingCoach(context,teaching,theory);
  return { store, commands:{...commands,...research,...learning,...agent,...review,...transfer,...teaching,...theory,...coach,
    async prepareMarkdownExport():Promise<Result<string>>{const result=teaching.teachingExportExposure();if(!result.ok)return result;if(!context.memory()&&!await context.saved())return fail('暴露记录保存失败，未生成学习记录导出。');const current=store.getState().data;replaceData({...current,teaching:{...current.teaching!,pendingDisclosure:false}});return {ok:true,value:transfer.exportMarkdown()};},
    async prepareWorkspaceExport():Promise<Result<WorkspaceSnapshot>>{const result=teaching.teachingExportExposure();if(!result.ok)return result;if(!context.memory()&&!await context.saved())return fail('暴露记录保存失败，暂未生成含答案备份。');const current=store.getState().data;replaceData({...current,teaching:{...current.teaching!,pendingDisclosure:false}});return {ok:true,value:copy(store.getState().data)};},
  } };
}

const workspace = createWorkspace(indexedDbRepository, createMockSolver());
export const commands = workspace.commands;
export const useWorkspace = <T,>(selector: (state: State) => T): T => useStore(workspace.store, selector);
export const queries = {
  teaching:teachingQueries,
  catalogue: () => scenarios.map(({nodes,...item}) => ({...item,board:nodes[0].spot.board})),
  ...researchQueries,
  learning: learningQueries,
  ...reviewQueries,
  weights: (player: string = 'BTN', context?: { ranges?: RangeInputs }) => rangesFor(context)[player],
  stats: (c: StudyCase) => policyStats(c.spot, weightsFor(c), c.draft.choices),
  snapshot: () => copy(workspace.store.getState().data),
  latestReference: (c: StudyCase) => c.jobs.filter(j => j.status === 'completed' && j.spotRevisionId === c.spotRevisionId && j.result?.availability === 'available' && j.result.reference).at(-1),
  latestHeroPlan: (c: StudyCase) => c.heroPlans.filter(p => p.spotRevisionId === c.spotRevisionId).at(-1),
};
