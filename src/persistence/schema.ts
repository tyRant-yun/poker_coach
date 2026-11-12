import { z } from 'zod';

const allocation = z.object({ check: z.number().int().min(0).max(10000), bet33: z.number().int().min(0).max(10000), bet75: z.number().int().min(0).max(10000) });
const choices = z.record(z.string(), allocation);
const spot = z.object({ board: z.array(z.string()), potMinor: z.number().int().positive(), stackMinor: z.number().int().positive(), unitsPerBb: z.number().int().positive(), actor: z.literal('BTN'), rangeVersion: z.string(), treeVersion: z.string() });
const assistance = z.enum(['reference', 'example']).optional();
const revision = z.object({ id: z.string(), number: z.number().int(), spotRevisionId: z.string(), spot, choices, createdAt: z.string(), assistance });
export const solveResultSchema = z.object({ dataKind: z.literal('synthetic'), fixtureVersion: z.string(), inputFingerprint: z.string(), availability: z.enum(['available', 'uncovered']), reference: choices.nullable(), reason: z.string() });
const job = z.object({ id: z.string(), policyRevisionId: z.string().nullable(), spotRevisionId: z.string(), status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted']), stage: z.string(), createdAt: z.string(), result: solveResultSchema.optional() });
const report = z.object({ id: z.string(), jobId: z.string(), policyRevisionId: z.string(), spotRevisionId: z.string(), inputFingerprint: z.string(), dataKind: z.literal('synthetic'), createdAt: z.string(), difference: z.number().nullable(), largestDifferences: z.array(z.object({ label: z.string(), difference: z.number() })), sampleEv: z.object({ value: z.number(), loss: z.number(), template: z.enum(['check', 'reference']) }).nullable() });
const heroPlan = z.object({ id: z.string(), spotRevisionId: z.string(), createdAt: z.string(), combo: z.string(), action: z.enum(['check', 'bet33', 'bet75']), opponentBranch: z.enum(['call', 'raise', 'fold', 'turn-bet', 'turn-check']), response: z.enum(['call', 'raise', 'fold', 'reassess']), turnPlan: z.string(), reason: z.string() });
const studyCase = z.object({ id: z.string(), name: z.string(), scenarioId: z.literal('S01'), createdAt: z.string(), updatedAt: z.string(), spotRevisionId: z.string(), spot, draft: z.object({ editRevision: z.number().int(), choices, assistance }), versions: z.array(revision), jobs: z.array(job), reports: z.array(report), heroPlans: z.array(heroPlan).default([]), note: z.string() });
export const snapshotSchema = z.object({ schemaVersion: z.literal(1), fixtureVersion: z.string(), cases: z.record(z.string(), studyCase) });
