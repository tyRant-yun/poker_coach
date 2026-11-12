import type { Allocation, EditableSnapshot, PolicyRevision, ScenarioId, StudyCase, WorkspaceSnapshot } from '../study/domain';
export type Result<T = undefined> = { ok: true; value: T } | { ok: false; message: string };
export type ProductContext = {
  getData(): WorkspaceSnapshot; replaceData(data: WorkspaceSnapshot): void;
  getCase(id: string): StudyCase | undefined; replaceCase(c: StudyCase): void;
  editCase(c: StudyCase,next: StudyCase,label: string): void;
  fail<T = undefined>(message: string): Result<T>; notice(text: string,kind?: 'success'|'info'): void; stopAll(): void;
  base: { createCase(name?: string,scenarioId?: ScenarioId): Result<string>; submitPolicy(id: string): Result<string>; loadExample(id: string): Result; editPolicy(id: string,combos: string[],allocation: Allocation,revision: number): Result; forkVersion(id: string,version: string,name: string): Result<string>; requestSolve(id: string,version: string): Promise<Result<string>>; requestReference(id: string): Promise<Result<string>>; flushSaves(): Promise<void> };
};
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0,12)}`;
export const now = () => new Date().toISOString();
export const copy = <T,>(x: T): T => structuredClone(x);
export function capture(c: StudyCase): EditableSnapshot { return copy({name:c.name,spot:c.spot,spotRevisionId:c.spotRevisionId,ranges:c.ranges,choices:c.draft.choices,lockedCombos:c.draft.lockedCombos ?? [],assistance:c.draft.assistance,restoredFrom:c.draft.restoredFrom}); }
export const versionInput = (v: PolicyRevision) => ({spot:v.spot,ranges:v.ranges,choices:v.choices});
