// Tier 2 of the planning cascade: a free, private on-device LLM.
// iOS 26+: Apple Foundation Models (schema-guided). Android: Gemini Nano via ML Kit GenAI.
import { getOnDeviceLlm, type OnDeviceLlmNative } from '../../modules/on-device-llm';
import { ADJUSTMENTS, REGIONS } from '../edits/catalog';
import { buildUserMessage } from '../edits/prompt';
import { EditPlanSchema, INTENTS, normalizePlan, type EditPlan, type ImageContext } from '../edits/schema';
import { buildCompactSystemPrompt } from './compactPrompt';
import type { Planner } from './types';

const TIMEOUT_MS = 10_000;

export function createOnDevicePlanner(
  resolveNative: () => OnDeviceLlmNative | null = getOnDeviceLlm,
  timeoutMs = TIMEOUT_MS,
): Planner {
  let preparing = false;
  let instructions: string | undefined;

  return {
    source: 'on-device-ai',

    async isAvailable() {
      const native = resolveNative();
      if (!native) return false;
      try {
        const { status } = await native.getStatus();
        if (status === 'downloadable' && !preparing) {
          // Android: fetch Gemini Nano in the background for next time.
          preparing = true;
          native.prepare().catch(() => {
            preparing = false;
          });
        }
        return status === 'available';
      } catch {
        return false;
      }
    },

    async plan(command: string, context: ImageContext): Promise<EditPlan> {
      const native = resolveNative();
      if (!native) throw new Error('On-device LLM is not available in this build');
      instructions ??= buildCompactSystemPrompt();
      const raw = await withTimeout(native.generatePlan(instructions, buildUserMessage(command, context)), timeoutMs);
      return parseOnDevicePlan(raw, context);
    },
  };
}

export const onDevicePlanner = createOnDevicePlanner();

/** Parse the model's JSON, tolerating small-model sloppiness; throws so the cascade moves on. */
export function parseOnDevicePlan(raw: string, context: ImageContext): EditPlan {
  const parsed = EditPlanSchema.safeParse(coerceLoosePlan(extractJson(raw)));
  if (!parsed.success) throw new Error(`On-device plan failed validation: ${parsed.error.message}`);
  const plan = normalizePlan(parsed.data, context.regions);
  if (plan.intent === 'edit' && plan.steps.length === 0) {
    throw new Error('On-device plan has no usable steps');
  }
  return plan;
}

export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('On-device model returned no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

// Fill defaults small models often omit and drop steps with unknown names, so a
// single bad step doesn't sink an otherwise good plan.
function coerceLoosePlan(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = rawSteps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      adjustment: s.adjustment,
      region: s.region ?? 'all',
      amount: typeof s.amount === 'string' ? Number(s.amount) : s.amount,
      invert: s.invert === true,
    }))
    .filter(
      (s) =>
        (ADJUSTMENTS as readonly unknown[]).includes(s.adjustment) &&
        (REGIONS as readonly unknown[]).includes(s.region) &&
        typeof s.amount === 'number' &&
        Number.isFinite(s.amount),
    );
  const intent = (INTENTS as readonly unknown[]).includes(obj.intent) ? obj.intent : steps.length ? 'edit' : obj.intent;
  return { intent, steps, reply: typeof obj.reply === 'string' ? obj.reply : '' };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`On-device model timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
