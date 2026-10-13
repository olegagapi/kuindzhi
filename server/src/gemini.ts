// Gemini provider (PROVIDER=gemini, the default): Gemini 3.5 Flash-Lite with a
// JSON-schema response and minimal thinking. Works on the free tier (no billing).
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';

import { buildSystemPrompt, buildUserMessage } from '../../src/edits/prompt';
import { EditPlanSchema } from '../../src/edits/schema';
import { UpstreamError, type PlanInput, type ProviderResult } from './types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

/** The slice of the SDK client the provider uses, so tests can inject a fake. */
export type GeminiClient = Pick<GoogleGenAI, 'models'>;

const SYSTEM_PROMPT = buildSystemPrompt();
// `responseJsonSchema` takes standard JSON Schema, generated from the shared contract.
const PLAN_JSON_SCHEMA: Record<string, unknown> = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(EditPlanSchema) as Record<string, unknown>;
  return schema;
})();

const REFUSALS = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
]);

export function createGeminiClient(apiKey: string): GeminiClient {
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 15_000 } });
}

export async function planWithGemini(client: GeminiClient, model: string, { command, context }: PlanInput): Promise<ProviderResult> {
  let response: GenerateContentResponse;
  try {
    response = await client.models.generateContent({
      model,
      contents: buildUserMessage(command, context),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: PLAN_JSON_SCHEMA,
        // Mapping a sentence onto the menu needs no reasoning, and thought tokens
        // bill as output. Gemini 3 models take a level; 2.5 models a budget.
        thinkingConfig: model.startsWith('gemini-2') ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.MINIMAL },
        maxOutputTokens: 1024,
      },
    });
  } catch (err) {
    throw toUpstreamError(err);
  }

  const meta = response.usageMetadata;
  const usage = {
    provider: 'gemini' as const,
    model,
    input_tokens: meta?.promptTokenCount ?? 0,
    output_tokens: meta?.candidatesTokenCount ?? 0,
    thinking_tokens: meta?.thoughtsTokenCount ?? 0,
  };
  const finish = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason || REFUSALS.has(finish)) return { kind: 'refused', usage };
  if (finish === FinishReason.MAX_TOKENS) return { kind: 'invalid', usage };

  let raw: unknown;
  try {
    raw = JSON.parse(response.text ?? '');
  } catch {
    return { kind: 'invalid', usage };
  }
  const parsed = EditPlanSchema.safeParse(raw);
  return parsed.success ? { kind: 'plan', plan: parsed.data, usage } : { kind: 'invalid', usage };
}

function toUpstreamError(err: unknown): UpstreamError {
  if (err instanceof ApiError) {
    if (err.status === 429) return new UpstreamError(429, 'upstream_rate_limited');
    // Gemini answers an invalid key with 400 "API key not valid" (per its error docs; not
    // verified against a live key here), and a revoked or restricted one with 401/403.
    if (err.status === 401 || err.status === 403 || (err.status === 400 && /api[ _-]?key/i.test(err.message))) {
      return new UpstreamError(502, 'upstream_auth');
    }
    if (err.status === 408 || err.status === 504) return new UpstreamError(504, 'upstream_timeout');
    console.error('Gemini API error', err.status, err.message);
    return new UpstreamError(502, 'upstream_error');
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new UpstreamError(504, 'upstream_timeout');
  }
  // fetch() rejects with a TypeError when the network is unreachable.
  if (err instanceof TypeError) return new UpstreamError(502, 'upstream_unreachable');
  throw err;
}
