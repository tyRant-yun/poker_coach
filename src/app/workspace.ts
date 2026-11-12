import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { actions, activeCombos, canonicalPolicy, frequencyDifference, handByCombo, policyStats, validateSpot, validateSubmission } from '../modules/study/domain';
import type { Allocation, AssessmentReport, Choices, PolicyRevision, Spot, StudyCase, WorkspaceSnapshot } from '../modules/study/domain';
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
};
const uid = (prefix: string) => prefix + '-' + crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const copy = <T,>(value: T): T => structuredClone(value);
const emptyData = (): WorkspaceSnapshot => ({ schemaVersion: 1, fixtureVersion, cases: {} });

export function createWorkspace(repository: WorkspaceRepository, solver: SolverPort) {
  const store = createStore<State>()(() => ({ data: emptyData(), hydrated: false, saveStatus: 'loading', savedAt: null, storageError: null, notice: null }));
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
  function updateJob(caseId: string, jobId: string, status: StudyCase['jobs'][number]['status'], stage: string) {
    const c = getCase(caseId);
    if (!c) return;
    const job = c.jobs.find(j => j.id === jobId);
    if (!job || ['cancelled', 'completed', 'failed', 'interrupted'].includes(job.status)) return;
    replaceCase({ ...c, jobs: c.jobs.map(j => j.id === jobId ? { ...j, status, stage } : j) });
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
    retrySave() { if (persistenceEnabled) persist(); },
    createCase(name = 'BTN vs BB · 翻牌研究'): Result<string> {
      if (!store.getState().hydrated) return fail('工作区尚未载入。');
      const id = uid('case');
      replaceCase({ id, name: name.trim() || '未命名研究', scenarioId: 'S01', createdAt: now(), updatedAt: now(),
        spotRevisionId: uid('spot'), spot: copy(s01Spot), draft: { editRevision: 0, choices: {} }, versions: [], jobs: [], reports: [], note: '' });
      notice('研究案例已建立。先为你的范围分配行动。');
      return { ok: true, value: id };
    },
    editPolicy(caseId: string, comboIds: string[], allocation: Allocation, expectedRevision: number): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      if (c.draft.editRevision !== expectedRevision) return fail('草稿已更新，请重新检查后应用。');
      if (!actions.every(a => Number.isInteger(allocation[a.id]) && allocation[a.id] >= 0 && allocation[a.id] <= 10000)) return fail('每个频率应在 0–100% 之间。');
      const available = new Set(activeCombos(c.spot, btnRange));
      if (!comboIds.length || comboIds.some(combo => !available.has(combo))) return fail('所选组合不在当前可用范围中。');
      const choices = { ...c.draft.choices };
      comboIds.forEach(combo => { choices[combo] = { ...allocation }; });
      replaceCase({ ...c, draft: { choices, editRevision: c.draft.editRevision + 1 } });
      notice(`已更新 ${comboIds.length} 个组合。`);
      return { ok: true, value: undefined };
    },
    fillRemaining(caseId: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const remaining = activeCombos(c.spot, btnRange).filter(combo => !c.draft.choices[combo]);
      if (!remaining.length) { notice('所有组合均已填写。', 'info'); return { ok: true, value: undefined }; }
      return commands.editPolicy(caseId, remaining, { check: 10000, bet33: 0, bet75: 0 }, c.draft.editRevision);
    },
    loadExample(caseId: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      replaceCase({ ...c, draft: { editRevision: c.draft.editRevision + 1, choices: referenceChoices(c.spot) } });
      notice('已载入作者编写的示例分配；这不是 Solver 建议。', 'info');
      return { ok: true, value: undefined };
    },
    clearDraft(caseId: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      replaceCase({ ...c, draft: { editRevision: c.draft.editRevision + 1, choices: {} } });
      notice('草稿已清空，提交版本不受影响。', 'info');
      return { ok: true, value: undefined };
    },
    submitPolicy(caseId: string): Result<string> {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const error = validateSubmission(c.spot, btnRange, c.draft.choices);
      if (error) return fail(error);
      const last = c.versions.at(-1);
      if (last && JSON.stringify(last.spot) === JSON.stringify(c.spot) && canonicalPolicy(last.choices, activeCombos(last.spot, btnRange)) === canonicalPolicy(c.draft.choices, activeCombos(c.spot, btnRange))) {
        notice(`与 V${last.number} 相同，已打开原提交。`, 'info');
        return { ok: true, value: last.id };
      }
      const id = uid('policy');
      const version: PolicyRevision = { id, number: c.versions.length + 1, spotRevisionId: c.spotRevisionId, spot: copy(c.spot), choices: copy(c.draft.choices), createdAt: now() };
      replaceCase({ ...c, versions: [...c.versions, version] });
      notice(`V${version.number} 已提交并固定，可以运行模拟分析。`);
      return { ok: true, value: id };
    },
    restoreAsDraft(caseId: string, versionId: string): Result {
      const c = getCase(caseId);
      const v = c?.versions.find(v => v.id === versionId);
      if (!c || !v) return fail('版本不存在。');
      replaceCase({ ...c, spot: copy(v.spot), spotRevisionId: v.spotRevisionId,
        draft: { editRevision: c.draft.editRevision + 1, choices: copy(v.choices) } });
      notice(`已从 V${v.number} 建立可编辑草稿，原版本保持不变。`);
      return { ok: true, value: undefined };
    },
    reviseSpot(caseId: string, spot: Spot, name: string): Result {
      const c = getCase(caseId);
      if (!c) return fail('案例不存在。');
      const error = validateSpot(spot);
      if (error) return fail(error);
      replaceCase({ ...c, name: name.trim() || c.name, spot: copy(spot), spotRevisionId: uid('spot'), draft: { choices: {}, editRevision: c.draft.editRevision + 1 } });
      notice('局面修订已建立，当前草稿已清空；历史版本仍保留。', 'info');
      return { ok: true, value: undefined };
    },
    saveNote(caseId: string, note: string) {
      const c = getCase(caseId);
      if (c) replaceCase({ ...c, note: note.slice(0, 4000) });
    },
    async requestSolve(caseId: string, versionId: string): Promise<Result<string>> {
      const c = getCase(caseId);
      const version = c?.versions.find(v => v.id === versionId);
      if (!c || !version) return fail('请先提交一个完整的策略版本。');
      if (c.jobs.some(j => j.policyRevisionId === versionId && ['queued', 'running'].includes(j.status))) return fail('该版本已有模拟正在运行。');
      const jobId = uid('job');
      const controller = new AbortController();
      controllers.set(jobId, controller);
      replaceCase({ ...c, jobs: [...c.jobs, { id: jobId, policyRevisionId: version.id, spotRevisionId: version.spotRevisionId, status: 'queued', stage: '输入已固定，等待模拟', createdAt: now() }] });
      try {
        updateJob(caseId, jobId, 'running', '正在准备模拟分析');
        const result = await solver.solve(copy(version), stage => updateJob(caseId, jobId, 'running', stage), controller.signal);
        const latest = getCase(caseId);
        if (!latest || controller.signal.aborted || latest.jobs.find(j => j.id === jobId)?.status !== 'running') return { ok: false, message: '模拟已取消。' };
        replaceCase({ ...latest, jobs: latest.jobs.map(j => j.id === jobId ? { ...j, status: 'completed', stage: '模拟完成', result } : j) });
        return commands.requestAssessment(caseId, jobId);
      } catch (error) {
        if (controller.signal.aborted) return { ok: false, message: '模拟已取消。' };
        updateJob(caseId, jobId, 'failed', error instanceof Error ? error.message : '模拟执行失败');
        return fail('模拟执行失败，策略已保留，可以重新运行。');
      } finally { controllers.delete(jobId); }
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
      const combos = activeCombos(version.spot, btnRange);
      const check: Choices = Object.fromEntries(combos.map(combo => [combo, { check: 10000, bet33: 0, bet75: 0 }]));
      const userKey = canonicalPolicy(version.choices, combos);
      const template = reference && userKey === canonicalPolicy(reference, combos) ? 'reference' : reference && userKey === canonicalPolicy(check, combos) ? 'check' : null;
      const differences: Record<string, { sum: number; mass: number }> = {};
      if (reference) for (const combo of combos) {
        const label = handByCombo[combo];
        differences[label] ??= { sum: 0, mass: 0 };
        differences[label].sum += btnRange[combo] * actions.reduce((s, a) => s + Math.abs(version.choices[combo][a.id] - reference[combo][a.id]) / 20000, 0);
        differences[label].mass += btnRange[combo];
      }
      const report: AssessmentReport = {
        id: uid('report'), jobId, policyRevisionId: version.id, spotRevisionId: version.spotRevisionId,
        inputFingerprint: job.result.inputFingerprint, dataKind: 'synthetic', createdAt: now(),
        difference: reference ? frequencyDifference(version.spot, btnRange, version.choices, reference) : null,
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
  weights: (player: 'BTN' | 'BB' = 'BTN') => player === 'BTN' ? btnRange : bbRange,
  stats: (c: StudyCase) => policyStats(c.spot, btnRange, c.draft.choices),
  snapshot: () => copy(workspace.store.getState().data),
};
