// The planner contract: free text in, EditPlan out. Shared by the app and the
// Cloudflare Worker (imported there by relative path).
import { z } from 'zod';

import { ADJUSTMENTS, REGIONS, clampAmount, type Adjustment, type Region } from './catalog';

export const INTENTS = ['edit', 'auto-enhance', 'undo', 'redo', 'reset', 'unsupported'] as const;
export type Intent = (typeof INTENTS)[number];

// No numeric bounds in the schema: structured-output JSON schema does not support
// them. Amounts are clamped in normalizePlan() instead.
export const PlanStepSchema = z.object({
  adjustment: z.enum(ADJUSTMENTS),
  region: z.enum(REGIONS),
  amount: z.number(),
  invert: z.boolean(),
});

export const EditPlanSchema = z.object({
  intent: z.enum(INTENTS),
  steps: z.array(PlanStepSchema),
  reply: z.string(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type EditPlan = z.infer<typeof EditPlanSchema>;

export type PlanSource = 'local' | 'on-device-ai' | 'cloud' | 'manual' | 'auto';

/** What planners are told about the photo. Never pixels — only a few numbers. */
export interface ImageContext {
  /** Regions that can be selected in this photo. */
  regions: Region[];
  faces: number;
  /** 0..1 averages measured on device. */
  stats: {
    brightness: number;
    contrast: number;
    saturation: number;
    /** + warm, - cool */
    warmth: number;
    faceBrightness?: number;
    backgroundBrightness?: number;
  };
  /** Already applied steps, e.g. "exposure +0.30 on face". */
  history: string[];
}

export const PlannerRequestSchema = z.object({
  command: z.string().min(1).max(500),
  context: z.object({
    regions: z.array(z.enum(REGIONS)),
    faces: z.number(),
    stats: z.object({
      brightness: z.number(),
      contrast: z.number(),
      saturation: z.number(),
      warmth: z.number(),
      faceBrightness: z.number().optional(),
      backgroundBrightness: z.number().optional(),
    }),
    history: z.array(z.string().max(120)).max(30),
  }),
});
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;

/** Clamp amounts, drop no-op steps and steps on regions the photo doesn't have. */
export function normalizePlan(plan: EditPlan, available?: readonly Region[]): EditPlan {
  if (plan.intent !== 'edit') return { ...plan, steps: [] };
  const steps = plan.steps
    .map((s) => ({ ...s, amount: round2(clampAmount(s.adjustment, s.amount)) }))
    .filter((s) => s.amount !== 0)
    .filter((s) => !available || available.includes(s.region));
  return { ...plan, steps };
}

export function describeStep(step: Pick<PlanStep, 'adjustment' | 'region' | 'amount' | 'invert'>): string {
  const sign = step.amount > 0 ? '+' : '';
  const where = step.invert ? `everything except ${step.region}` : step.region;
  return `${step.adjustment} ${sign}${step.amount.toFixed(2)} on ${where}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isAdjustment(v: string): v is Adjustment {
  return (ADJUSTMENTS as readonly string[]).includes(v);
}

export function isRegion(v: string): v is Region {
  return (REGIONS as readonly string[]).includes(v);
}
