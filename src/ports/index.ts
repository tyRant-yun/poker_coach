import type { JobStatus, SolveInput, SolveResult, WorkspaceSnapshot } from '../modules/study/domain';

export interface WorkspaceRepository {
  load(): Promise<WorkspaceSnapshot | null>;
  save(snapshot: WorkspaceSnapshot): Promise<void>;
}
export interface SolverPort {
  solve(input: SolveInput, onStage: (stage: string, status?: JobStatus) => void, signal: AbortSignal, skip?: AbortSignal): Promise<SolveResult>;
}
