import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../src/app/workspace';
import { activeCombos, allCombos, frequencyDifference, handClasses, policyStats } from '../../src/modules/study/domain';
import type { SolveResult, WorkspaceSnapshot } from '../../src/modules/study/domain';
import { btnRange, fixtureVersion, referenceChoices, s01Spot } from '../../src/fixtures/s01';
import { createMockSolver } from '../../src/mocks/solver';
import type { SolverPort, WorkspaceRepository } from '../../src/ports';

function memoryRepository(initial: WorkspaceSnapshot | null = null) {
  let saved = initial;
  const repository: WorkspaceRepository = {
    async load() { return saved ? structuredClone(saved) : null; },
    async save(data) { saved = structuredClone(data); },
  };
  return { repository, read: () => saved };
}
async function setup(solver: SolverPort = createMockSolver(0)) {
  const memory = memoryRepository();
  const app = createWorkspace(memory.repository, solver);
  await app.commands.initialize();
  const result = app.commands.createCase();
  if (!result.ok) throw new Error(result.message);
  return { ...app, ...memory, id: result.value, current: () => app.store.getState().data.cases[result.value] };
}
function submitted(app: Awaited<ReturnType<typeof setup>>) {
  app.commands.fillRemaining(app.id);
  const result = app.commands.submitPolicy(app.id);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('range representation', () => {
  it('expands 169 classes without duplicate combinations and excludes public cards', () => {
    expect(handClasses).toHaveLength(169);
    expect(allCombos).toHaveLength(1326);
    expect(new Set(allCombos).size).toBe(1326);
    const fullRange = Object.fromEntries(allCombos.map(c => [c, 10000]));
    expect(activeCombos(s01Spot, fullRange)).toHaveLength(1176);
    expect(activeCombos(s01Spot, btnRange).every(c => !c.includes('As') && !c.includes('7d') && !c.includes('2c'))).toBe(true);
  });
  it('separates unassigned combinations, invalid frequencies, and zero-weight combinations', () => {
    const first = activeCombos(s01Spot, btnRange)[0];
    const stats = policyStats(s01Spot, btnRange, { [first]: { check: 9000, bet33: 9000, bet75: 0 } });
    expect(stats.invalid).toBe(1);
    expect(stats.filled).toBe(0);
    expect(stats.missing).toBe(stats.combos.length - 1);
  });
  it('computes zero reference difference for identical synthetic allocations', () => {
    const reference = referenceChoices();
    expect(frequencyDifference(s01Spot, btnRange, reference, structuredClone(reference))).toBe(0);
  });
});

describe('application commands and immutable submissions', () => {
  it('blocks incomplete submissions and stale edits', async () => {
    const app = await setup();
    expect(app.commands.submitPolicy(app.id).ok).toBe(false);
    const first = activeCombos(app.current().spot, btnRange)[0];
    expect(app.commands.editPolicy(app.id, [first], { check: 10000, bet33: 0, bet75: 0 }, 0).ok).toBe(true);
    expect(app.commands.editPolicy(app.id, [first], { check: 0, bet33: 10000, bet75: 0 }, 0).ok).toBe(false);
    expect(app.current().draft.choices[first].check).toBe(10000);
  });
  it('keeps the original snapshot after edits and restore, and deduplicates identical submissions', async () => {
    const app = await setup();
    const versionId = submitted(app);
    const original = structuredClone(app.current().versions[0]);
    const first = activeCombos(app.current().spot, btnRange)[0];
    app.commands.editPolicy(app.id, [first], { check: 0, bet33: 10000, bet75: 0 }, app.current().draft.editRevision);
    const second = app.commands.submitPolicy(app.id);
    expect(second.ok).toBe(true);
    expect(app.current().versions).toHaveLength(2);
    expect(app.current().versions[0]).toEqual(original);
    app.commands.submitPolicy(app.id);
    expect(app.current().versions).toHaveLength(2);
    app.commands.restoreAsDraft(app.id, versionId);
    expect(app.current().draft.choices).toEqual(original.choices);
    expect(app.current().versions[0]).toEqual(original);
  });
  it('saves the latest explicit data snapshot and excludes transient UI state', async () => {
    const app = await setup();
    submitted(app);
    app.commands.saveNote(app.id, 'newest note');
    await app.commands.flushSaves();
    expect(app.read()?.cases[app.id].note).toBe('newest note');
    expect(app.store.getState().saveStatus).toBe('saved');
    expect(app.read()).not.toHaveProperty('notice');
    expect(app.read()).not.toHaveProperty('saveStatus');
  });
});

describe('mock results and provenance', () => {
  it('binds reports to fixed input and refuses to fabricate EV for arbitrary edited strategies', async () => {
    const app = await setup();
    submitted(app);
    const first = activeCombos(app.current().spot, btnRange)[0];
    app.commands.editPolicy(app.id, [first], { check: 5000, bet33: 5000, bet75: 0 }, app.current().draft.editRevision);
    const second = app.commands.submitPolicy(app.id);
    if (!second.ok) throw new Error(second.message);
    await app.commands.requestSolve(app.id, second.value);
    const report = app.current().reports[0];
    expect(report.policyRevisionId).toBe(second.value);
    expect(report.spotRevisionId).toBe(app.current().versions[1].spotRevisionId);
    expect(report.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.difference).toBeGreaterThan(0);
    expect(report.sampleEv).toBeNull();
    expect(report.dataKind).toBe('synthetic');
  });
  it('does not reuse reference or numeric results for a different spot', async () => {
    const app = await setup();
    app.commands.reviseSpot(app.id, { ...s01Spot, potMinor: 650 }, 'custom');
    const versionId = submitted(app);
    await app.commands.requestSolve(app.id, versionId);
    expect(app.current().jobs[0].result?.availability).toBe('uncovered');
    expect(app.current().jobs[0].result?.reference).toBeNull();
    expect(app.current().reports[0].difference).toBeNull();
    expect(app.current().reports[0].sampleEv).toBeNull();
  });
  it('ignores a late result even if the solver adapter fails to honor cancellation', async () => {
    let deliver!: (result: SolveResult) => void;
    const solver: SolverPort = { solve: () => new Promise(resolve => { deliver = resolve; }) };
    const app = await setup(solver);
    const pending = app.commands.requestSolve(app.id, submitted(app));
    const jobId = app.current().jobs[0].id;
    app.commands.cancelJob(app.id, jobId);
    deliver({ dataKind: 'synthetic', fixtureVersion, availability: 'available', reference: referenceChoices(), reason: 'late', inputFingerprint: 'late' });
    await pending;
    expect(app.current().jobs[0].status).toBe('cancelled');
    expect(app.current().reports).toHaveLength(0);
  });
  it('restores in-progress jobs as interrupted instead of pretending to run in the background', async () => {
    const solver: SolverPort = { solve: () => new Promise(() => {}) };
    const app = await setup(solver);
    void app.commands.requestSolve(app.id, submitted(app));
    await app.commands.flushSaves();
    const restored = createWorkspace(app.repository, createMockSolver(0));
    await restored.commands.initialize();
    expect(restored.store.getState().data.cases[app.id].jobs[0].status).toBe('interrupted');
  });
});

describe('storage failure behavior', () => {
  it('keeps edits in memory and does not report a failed save as saved', async () => {
    const app = createWorkspace({ async load() { return null; }, async save() { throw new Error('quota'); } }, createMockSolver(0));
    await app.commands.initialize();
    app.commands.createCase('unsaved case');
    await app.commands.flushSaves();
    expect(app.store.getState().saveStatus).toBe('error');
    expect(Object.values(app.store.getState().data.cases)[0].name).toBe('unsaved case');
  });
  it('does not overwrite the original record after an unreadable load', async () => {
    let writes = 0;
    const app = createWorkspace({ async load() { throw new Error('corrupt'); }, async save() { writes++; } }, createMockSolver(0));
    await app.commands.initialize();
    app.commands.createCase();
    await app.commands.flushSaves();
    expect(app.store.getState().saveStatus).toBe('memory');
    expect(writes).toBe(0);
  });
});
