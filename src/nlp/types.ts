import type { EditPlan, ImageContext, PlanSource } from '../edits/schema';

/** Why a tier is being skipped or just failed (see resilience.ts). */
export type TierIssue = 'offline' | 'rate-limited' | 'misconfigured' | 'unavailable' | 'transient';

/** A tier in the planning cascade: local parser → on-device LLM → cloud LLM. */
export interface Planner {
  source: PlanSource;
  isAvailable(): Promise<boolean>;
  /** Throws on failure; the cascade moves to the next tier. */
  plan(command: string, context: ImageContext): Promise<EditPlan>;
  /** Optional health report, provided by the circuit breaker. */
  issue?(): TierIssue | null;
}

export interface PlannerResult {
  plan: EditPlan;
  source: PlanSource;
}
