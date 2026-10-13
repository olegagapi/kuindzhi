import type { EditPlan, ImageContext, PlanSource } from '../edits/schema';

/** A tier in the planning cascade: local parser → on-device LLM → cloud LLM. */
export interface Planner {
  source: PlanSource;
  isAvailable(): Promise<boolean>;
  /** Throws on failure; the cascade moves to the next tier. */
  plan(command: string, context: ImageContext): Promise<EditPlan>;
}

export interface PlannerResult {
  plan: EditPlan;
  source: PlanSource;
}
