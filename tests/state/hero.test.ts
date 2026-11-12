import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../src/app/workspace';
import { activeCombos, normalizeCombo, policyStats } from '../../src/modules/study/domain';
import type { HeroPlanInput, WorkspaceSnapshot } from '../../src/modules/study/domain';
import { btnRange, s01Spot } from '../../src/fixtures/s01';
import { createMockSolver } from '../../src/mocks/solver';
import { snapshotSchema } from '../../src/persistence/schema';

const plan: HeroPlanInput = { combo: 'AdKd', action: 'bet33', opponentBranch: 'call', response: 'reassess', reason: '先思考这手牌', turnPlan: '按转牌与对手尺寸调整' };
async function setup() {
  let saved: WorkspaceSnapshot | null = null;
  const repository = { async load() { return saved ? structuredClone(saved) : null; }, async save(data: WorkspaceSnapshot) { saved = structuredClone(data); } };
  const app = createWorkspace(repository, createMockSolver(0));
  await app.commands.initialize();
  const created = app.commands.createCase();
  if (!created.ok) throw new Error(created.message);
  const id = created.value;
  return { ...app, id, repository, current: () => app.store.getState().data.cases[id] };
}

describe('Hero focus and full-range reference', () => {
  it('returns the entire reference without inventing a full submitted policy or score', async () => {
    const app = await setup();
    expect((await app.commands.requestReference(app.id)).ok).toBe(true);
    const c = app.current();
    expect(c.versions).toHaveLength(0);
    expect(c.reports).toHaveLength(0);
    expect(Object.keys(c.draft.choices)).toHaveLength(0);
    expect(c.jobs[0].policyRevisionId).toBeNull();
    expect(Object.keys(c.jobs[0].result!.reference!)).toHaveLength(activeCombos(c.spot, btnRange).length);
  });
  it('persists Hero plans separately and normalizes reversed cards', async () => {
    const app = await setup();
    expect(normalizeCombo('Kd Ad')).toBe('AdKd');
    expect(app.commands.saveHeroPlan(app.id, { ...plan, combo: 'Kd Ad' }, app.current().spotRevisionId).ok).toBe(true);
    expect(app.current().heroPlans[0].combo).toBe('AdKd');
    expect(Object.keys(app.current().draft.choices)).toHaveLength(0);
    expect(app.current().versions).toHaveLength(0);
    await app.commands.flushSaves();
    const restored = createWorkspace(app.repository, createMockSolver(0));
    await restored.commands.initialize();
    expect(restored.store.getState().data.cases[app.id].heroPlans[0].turnPlan).toBe(plan.turnPlan);
  });
  it('rejects blocked Hero cards and an impossible same-street follow-up after BTN checks', async () => {
    const app = await setup();
    const spotId = app.current().spotRevisionId;
    expect(app.commands.saveHeroPlan(app.id, { ...plan, combo: 'AsKs' }, spotId).ok).toBe(false);
    expect(app.commands.saveHeroPlan(app.id, { ...plan, action: 'check', opponentBranch: 'call' }, spotId).ok).toBe(false);
    expect(app.current().heroPlans).toHaveLength(0);
    expect(app.commands.saveHeroPlan(app.id, { ...plan, action: 'check', opponentBranch: 'turn-bet', response: 'call' }, spotId).ok).toBe(true);
  });
  it('changes exactly one combo unless the user explicitly chooses the class scope', async () => {
    const app = await setup();
    const saved = app.commands.saveHeroPlan(app.id, plan, app.current().spotRevisionId);
    if (!saved.ok) throw new Error(saved.message);
    app.commands.applyHeroAction(app.id, saved.value, 'hero', app.current().draft.editRevision);
    expect(Object.keys(app.current().draft.choices)).toEqual(['AdKd']);
    expect(policyStats(app.current().spot, btnRange, app.current().draft.choices).filled).toBe(1);
    expect(app.commands.applyHeroAction(app.id, saved.value, 'class', 0).ok).toBe(false);
    app.commands.applyHeroAction(app.id, saved.value, 'class', app.current().draft.editRevision);
    expect(Object.keys(app.current().draft.choices)).toHaveLength(3);
    expect(app.current().versions).toHaveLength(0);
  });
  it('fills only missing combos, preserves Hero decisions and persists assistance metadata', async () => {
    const app = await setup();
    app.commands.editPolicy(app.id, ['AdKd'], { check: 0, bet33: 10000, bet75: 0 }, 0);
    const reference = await app.commands.requestReference(app.id);
    if (!reference.ok) throw new Error(reference.message);
    expect(app.commands.fillFromReference(app.id, reference.value, app.current().draft.editRevision).ok).toBe(true);
    expect(app.current().draft.choices.AdKd).toEqual({ check: 0, bet33: 10000, bet75: 0 });
    expect(policyStats(app.current().spot, btnRange, app.current().draft.choices).coverage).toBe(1);
    expect(app.current().draft.assistance).toBe('reference');
    const submitted = app.commands.submitPolicy(app.id);
    if (!submitted.ok) throw new Error(submitted.message);
    expect(app.current().versions[0].assistance).toBe('reference');
    app.commands.clearDraft(app.id);
    app.commands.restoreAsDraft(app.id, submitted.value);
    expect(app.current().draft.assistance).toBe('reference');
  });
  it('does not apply a historical Hero plan or reference after the spot changes', async () => {
    const app = await setup();
    const hero = app.commands.saveHeroPlan(app.id, plan, app.current().spotRevisionId);
    const reference = await app.commands.requestReference(app.id);
    if (!hero.ok || !reference.ok) throw new Error('setup failed');
    app.commands.reviseSpot(app.id, { ...s01Spot, potMinor: 650 }, 'changed spot');
    expect(app.commands.applyHeroAction(app.id, hero.value, 'hero', app.current().draft.editRevision).ok).toBe(false);
    expect(app.commands.fillFromReference(app.id, reference.value, app.current().draft.editRevision).ok).toBe(false);
    expect(app.current().heroPlans).toHaveLength(1);
    expect(Object.keys(app.current().draft.choices)).toHaveLength(0);
  });
  it('loads a pre-Hero snapshot without deleting its reports or versions', async () => {
    const app = await setup();
    app.commands.fillRemaining(app.id);
    const version = app.commands.submitPolicy(app.id);
    if (!version.ok) throw new Error(version.message);
    await app.commands.requestSolve(app.id, version.value);
    const raw = JSON.parse(JSON.stringify(app.store.getState().data));
    delete raw.cases[app.id].heroPlans;
    const loaded = snapshotSchema.parse(raw);
    expect(loaded.cases[app.id].heroPlans).toEqual([]);
    expect(loaded.cases[app.id].versions).toHaveLength(1);
    expect(loaded.cases[app.id].reports).toHaveLength(1);
  });
});
