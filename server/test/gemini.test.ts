import { ApiError, FinishReason, ThinkingLevel } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import type { PlannerRequest } from '../../src/edits/schema';
import type { GeminiClient } from '../src/gemini';
import { handleRequest, type Deps, type Env } from '../src/index';

const APP_KEY = 'test-app-key';

const context: PlannerRequest['context'] = {
  regions: ['all', 'face', 'person', 'background'],
  faces: 1,
  stats: { brightness: 0.42, contrast: 0.5, saturation: 0.3, warmth: 0.05 },
  history: [],
};

function env(overrides: Partial<Env> = {}): Env {
  return { GEMINI_API_KEY: 'AIza-test', APP_KEY, ...overrides };
}

function planRequest(command = 'make it moodier'): Request {
  return new Request('https://planner.test/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kuindzhi-key': APP_KEY },
    body: JSON.stringify({ command, context }),
  });
}

function fakeResponse(text: string | undefined, finishReason: FinishReason = FinishReason.STOP, blockReason?: string) {
  return {
    text,
    candidates: [{ finishReason }],
    promptFeedback: blockReason ? { blockReason } : undefined,
    usageMetadata: { promptTokenCount: 1400, candidatesTokenCount: 70, thoughtsTokenCount: 12 },
  };
}

function depsWith(generateContent: ReturnType<typeof vi.fn>): Deps {
  const client = { models: { generateContent } } as unknown as GeminiClient;
  return {
    gemini: () => client,
    anthropic: () => {
      throw new Error('claude client should not be used');
    },
  };
}

const PLAN = {
  intent: 'edit',
  steps: [
    { adjustment: 'contrast', region: 'all', amount: 0.3, invert: false },
    // Dropped: this photo has no sky region.
    { adjustment: 'exposure', region: 'sky', amount: -0.3, invert: false },
  ],
  reply: 'Added contrast.',
};

describe('planner worker (PROVIDER=gemini, the default)', () => {
  it('reports the provider on health checks', async () => {
    const res = await handleRequest(new Request('https://planner.test/health'), env());
    expect(await res.json()).toEqual({ ok: true, provider: 'gemini' });
  });

  it('returns a normalized plan with input, output and thinking tokens', async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(PLAN)));
    const res = await handleRequest(planRequest(), env(), depsWith(generateContent));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: unknown; usage: unknown };
    expect(body.plan).toEqual({
      intent: 'edit',
      steps: [{ adjustment: 'contrast', region: 'all', amount: 0.3, invert: false }],
      reply: 'Added contrast.',
    });
    expect(body.usage).toEqual({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      input_tokens: 1400,
      output_tokens: 70,
      thinking_tokens: 12,
    });
  });

  it('asks for JSON matching the plan schema with minimal thinking', async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(PLAN)));
    await handleRequest(planRequest('warmer please'), env(), depsWith(generateContent));
    const params = generateContent.mock.calls[0][0];
    expect(params.model).toBe('gemini-3.5-flash-lite');
    expect(params.contents).toContain('Request: warmer please');
    expect(params.config.systemInstruction).toContain('Adjustments');
    expect(params.config.responseMimeType).toBe('application/json');
    expect(params.config.responseJsonSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['intent', 'steps', 'reply']),
    });
    expect(params.config.responseJsonSchema).not.toHaveProperty('$schema');
    expect(params.config.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
  });

  it('uses a zero thinking budget for 2.5 models and honours MODEL', async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(PLAN)));
    await handleRequest(planRequest(), env({ MODEL: 'gemini-2.5-flash' }), depsWith(generateContent));
    const params = generateContent.mock.calls[0][0];
    expect(params.model).toBe('gemini-2.5-flash');
    expect(params.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('turns safety blocks into an unsupported plan', async () => {
    for (const response of [
      fakeResponse(undefined, FinishReason.SAFETY),
      fakeResponse(undefined, FinishReason.STOP, 'PROHIBITED_CONTENT'),
    ]) {
      const res = await handleRequest(planRequest(), env(), depsWith(vi.fn().mockResolvedValue(response)));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { plan: { intent: string } }).plan.intent).toBe('unsupported');
    }
  });

  it('returns 502 for truncated, non-JSON or off-schema output', async () => {
    for (const response of [
      fakeResponse('{"intent":"edit","steps":[', FinishReason.MAX_TOKENS),
      fakeResponse('not json'),
      fakeResponse(JSON.stringify({ intent: 'paint', steps: [], reply: '' })),
    ]) {
      const res = await handleRequest(planRequest(), env(), depsWith(vi.fn().mockResolvedValue(response)));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'model_output_invalid' });
    }
  });

  it('maps API errors to HTTP statuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timeout = new Error('timed out');
    timeout.name = 'AbortError';
    const cases: Array<[unknown, number, string]> = [
      [new ApiError({ message: 'quota', status: 429 }), 429, 'upstream_rate_limited'],
      [new ApiError({ message: 'boom', status: 500 }), 502, 'upstream_error'],
      [timeout, 504, 'upstream_timeout'],
      [new TypeError('fetch failed'), 502, 'upstream_unreachable'],
    ];
    for (const [err, status, code] of cases) {
      const res = await handleRequest(planRequest(), env(), depsWith(vi.fn().mockRejectedValue(err)));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
    }
  });

  it('reports a missing key or unknown provider as a configuration error', async () => {
    const generateContent = vi.fn();
    const noKey = await handleRequest(planRequest(), env({ GEMINI_API_KEY: undefined }), depsWith(generateContent));
    const unknown = await handleRequest(planRequest(), env({ PROVIDER: 'nope' }), depsWith(generateContent));
    expect(await noKey.json()).toEqual({ error: 'not_configured' });
    expect(await unknown.json()).toEqual({ error: 'unknown_provider' });
    expect(generateContent).not.toHaveBeenCalled();
  });
});
