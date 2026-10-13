// Kuindzhi planner: the last, paid tier of the planning cascade. Turns a text
// command plus a few image statistics into an EditPlan. Photos never reach this
// worker. The model provider is a deploy-time choice (PROVIDER var): Gemini by
// default, Claude as the alternative; the app↔worker contract doesn't change.
import { normalizePlan, PlannerRequestSchema, type EditPlan } from '../../src/edits/schema';
import { createClaudeClient, DEFAULT_CLAUDE_MODEL, planWithClaude, type ClaudeClient } from './anthropic';
import { createGeminiClient, DEFAULT_GEMINI_MODEL, planWithGemini, type GeminiClient } from './gemini';
import { UpstreamError, type ProviderResult } from './types';

export interface Env {
  /** Shared secret the app sends in `x-kuindzhi-key`. */
  APP_KEY: string;
  /** "gemini" (default) or "anthropic". */
  PROVIDER?: string;
  /** Overrides the provider's default model. */
  MODEL?: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  PLAN_LIMITER?: RateLimit;
}

export interface Deps {
  gemini(env: Env): GeminiClient;
  anthropic(env: Env): ClaudeClient;
}

const MAX_BODY_BYTES = 16 * 1024;

const REFUSED_PLAN: EditPlan = { intent: 'unsupported', steps: [], reply: "I can't help with that edit." };

const defaultDeps: Deps = {
  gemini: (env) => createGeminiClient(env.GEMINI_API_KEY!),
  anthropic: (env) => createClaudeClient(env.ANTHROPIC_API_KEY!),
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

export async function handleRequest(request: Request, env: Env, deps: Deps = defaultDeps): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, provider: providerOf(env) });
  }
  if (url.pathname !== '/plan') return error(404, 'not_found');
  if (request.method !== 'POST') return error(405, 'method_not_allowed');

  if (!env.APP_KEY || !timingSafeEqual(request.headers.get('x-kuindzhi-key') ?? '', env.APP_KEY)) {
    return error(401, 'unauthorized');
  }

  if (env.PLAN_LIMITER) {
    const key =
      request.headers.get('x-kuindzhi-device') ?? request.headers.get('cf-connecting-ip') ?? 'anonymous';
    const { success } = await env.PLAN_LIMITER.limit({ key });
    if (!success) return error(429, 'rate_limited');
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return error(413, 'body_too_large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, 'invalid_json');
  }
  const parsedRequest = PlannerRequestSchema.safeParse(body);
  if (!parsedRequest.success) return error(400, 'invalid_request');
  const input = parsedRequest.data;

  let result: ProviderResult;
  try {
    switch (providerOf(env)) {
      case 'gemini':
        if (!env.GEMINI_API_KEY) return error(500, 'not_configured');
        result = await planWithGemini(deps.gemini(env), env.MODEL || DEFAULT_GEMINI_MODEL, input);
        break;
      case 'anthropic':
        if (!env.ANTHROPIC_API_KEY) return error(500, 'not_configured');
        result = await planWithClaude(deps.anthropic(env), env.MODEL || DEFAULT_CLAUDE_MODEL, input);
        break;
      default:
        return error(500, 'unknown_provider');
    }
  } catch (err) {
    if (err instanceof UpstreamError) return error(err.status, err.code);
    throw err;
  }

  switch (result.kind) {
    case 'refused':
      return json({ plan: REFUSED_PLAN, usage: result.usage });
    case 'invalid':
      return error(502, 'model_output_invalid');
    case 'plan':
      return json({ plan: normalizePlan(result.plan, input.context.regions), usage: result.usage });
  }
}

function providerOf(env: Env): string {
  return (env.PROVIDER || 'gemini').trim().toLowerCase();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function error(status: number, code: string): Response {
  return json({ error: code }, status);
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}
