import type { PolicyRevision, SolveResult, WorkspaceSnapshot } from '../modules/study/domain';

export interface WorkspaceRepository {
  load(): Promise<WorkspaceSnapshot | null>;
  save(snapshot: WorkspaceSnapshot): Promise<void>;
}
export interface SolverPort {
  solve(version: PolicyRevision, onStage: (stage: string) => void, signal: AbortSignal): Promise<SolveResult>;
}
