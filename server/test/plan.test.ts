import {
  AnthropicError,
  APIConnectionTimeoutError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { PlannerRequest } from '../../src/edits/schema';
import type { ClaudeClient } from '../src/anthropic';
import { handleRequest, type Deps, type Env } from '../src/index';

const APP_KEY = 'test-app-key';

const context: PlannerRequest['context'] = {
  regions: ['all', 'face', 'person', 'background', 'top'],
  faces: 1,
  stats: { brightness: 0.42, contrast: 0.5, saturation: 0.3, warmth: 0.05, faceBrightness: 0.3 },
  history: [],
};

function env(overrides: Partial<Env> = {}): Env {
  return { PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', APP_KEY, ...overrides };
}

function planRequest(body: unknown, headers: Record<string, string> = { 'x-kuindzhi-key': APP_KEY }): Request {
  return new Request('https://planner.test/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function fakeMessage(parsed_output: unknown, stop_reason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: JSON.stringify(parsed_output) }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1500, output_tokens: 90 },
    parsed_output,
  };
}

function depsWith(parse: ReturnType<typeof vi.fn>): Deps {
  const client = { messages: { parse } } as unknown as ClaudeClient;
  return {
    anthropic: () => client,
    gemini: () => {
      throw new Error('gemini client should not be used');
    },
  };
}

describe('planner worker (PROVIDER=anthropic)', () => {
  it('answers health checks', async () => {
    const res = await handleRequest(new Request('https://planner.test/health'), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: 'anthropic' });
  });

  it('rejects a missing or wrong app key with 401', async () => {
    const parse = vi.fn();
    const missing = await handleRequest(planRequest({ command: 'x', context }, {}), env(), depsWith(parse));
    const wrong = await handleRequest(
      planRequest({ command: 'x', context }, { 'x-kuindzhi-key': 'nope' }),
      env(),
      depsWith(parse),
    );
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies with 400', async () => {
    const parse = vi.fn();
    const notJson = await handleRequest(planRequest('{nope'), env(), depsWith(parse));
    const badShape = await handleRequest(planRequest({ command: '', context }), env(), depsWith(parse));
    const badRegion = await handleRequest(
      planRequest({ command: 'brighter', context: { ...context, regions: ['moon'] } }),
      env(),
      depsWith(parse),
    );
    expect(notJson.status).toBe(400);
    expect(badShape.status).toBe(400);
    expect(badRegion.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });

  it('returns a normalized plan and usage on the happy path', async () => {
    const parse = vi.fn().mockResolvedValue(
      fakeMessage({
        intent: 'edit',
        steps: [
          { adjustment: 'exposure', region: 'face', amount: 0.3, invert: false },
          // Clamped to the catalog range.
          { adjustment: 'saturation', region: 'all', amount: 5, invert: false },
          // Dropped: the photo has no sky region.
          { adjustment: 'saturation', region: 'sky', amount: 0.3, invert: false },
          // Dropped: no-op.
          { adjustment: 'contrast', region: 'all', amount: 0, invert: false },
        ],
        reply: 'Brightened your face.',
      }),
    );
    const res = await handleRequest(
      planRequest({ command: 'make my face lighter and colors crazy', context }),
      env(),
      depsWith(parse),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { steps: unknown[] }; usage: unknown };
    expect(body.plan).toEqual({
      intent: 'edit',
      steps: [
        { adjustment: 'exposure', region: 'face', amount: 0.3, invert: false },
        { adjustment: 'saturation', region: 'all', amount: 1, invert: false },
      ],
      reply: 'Brightened your face.',
    });
    expect(body.usage).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input_tokens: 1500,
      output_tokens: 90,
      thinking_tokens: 0,
    });

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.system).toContain('Adjustments');
    expect(params.messages[0].content).toContain('Request: make my face lighter and colors crazy');
    expect(params).not.toHaveProperty('thinking');
  });

  it('honours the MODEL override', async () => {
    const parse = vi.fn().mockResolvedValue(fakeMessage({ intent: 'undo', steps: [], reply: 'Undone.' }));
    await handleRequest(planRequest({ command: 'undo', context }), env({ MODEL: 'claude-sonnet-5-5' }), depsWith(parse));
    expect(parse.mock.calls[0][0].model).toBe('claude-sonnet-5-5');
  });

  it('turns a refusal into an unsupported plan', async () => {
    const parse = vi.fn().mockResolvedValue(fakeMessage({ intent: 'edit', steps: [], reply: '' }, 'refusal'));
    const res = await handleRequest(planRequest({ command: 'something', context }), env(), depsWith(parse));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { intent: string; steps: unknown[] } };
    expect(body.plan.intent).toBe('unsupported');
    expect(body.plan.steps).toEqual([]);
  });

  it('returns 502 when output is truncated or unparsed', async () => {
    const truncated = vi.fn().mockResolvedValue(fakeMessage(null, 'max_tokens'));
    const unparsed = vi.fn().mockResolvedValue(fakeMessage(null));
    const invalid = vi.fn().mockRejectedValue(new AnthropicError('Failed to parse structured output'));
    for (const parse of [truncated, unparsed, invalid]) {
      const res = await handleRequest(planRequest({ command: 'brighter', context }), env(), depsWith(parse));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'model_output_invalid' });
    }
  });

  it('maps SDK errors to HTTP statuses', async () => {
    const cases: Array<[Error, number, string]> = [
      [new RateLimitError(429, {}, 'slow down', new Headers()), 429, 'upstream_rate_limited'],
      [new APIConnectionTimeoutError(), 504, 'upstream_timeout'],
      [new AuthenticationError(401, {}, 'invalid x-api-key', new Headers()), 502, 'upstream_auth'],
      [new InternalServerError(500, {}, 'boom', new Headers()), 502, 'upstream_error'],
    ];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [err, status, code] of cases) {
      const parse = vi.fn().mockRejectedValue(err);
      const res = await handleRequest(planRequest({ command: 'brighter', context }), env(), depsWith(parse));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
    }
  });

  it('rate limits per device', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const parse = vi.fn();
    const res = await handleRequest(
      planRequest({ command: 'brighter', context }, { 'x-kuindzhi-key': APP_KEY, 'x-kuindzhi-device': 'device-1' }),
      env({ PLAN_LIMITER: { limit } as unknown as RateLimit }),
      depsWith(parse),
    );
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'device-1' });
    expect(parse).not.toHaveBeenCalled();
  });
});
