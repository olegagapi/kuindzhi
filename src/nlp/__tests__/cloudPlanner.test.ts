import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { ImageContext } from '../../edits/schema';
import { CloudPlannerError, createCloudPlanner, type FetchLike } from '../cloudPlanner';

const context: ImageContext = {
  regions: ['all', 'face', 'person', 'background'],
  faces: 1,
  stats: { brightness: 0.4, contrast: 0.5, saturation: 0.3, warmth: 0 },
  history: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const originalFetch = global.fetch;
const originalUrl = process.env.EXPO_PUBLIC_PLANNER_URL;
const originalKey = process.env.EXPO_PUBLIC_PLANNER_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.EXPO_PUBLIC_PLANNER_URL = originalUrl;
  process.env.EXPO_PUBLIC_PLANNER_KEY = originalKey;
});

describe('cloud planner', () => {
  it('is unavailable without a URL', async () => {
    delete process.env.EXPO_PUBLIC_PLANNER_URL;
    const planner = createCloudPlanner();
    expect(planner.source).toBe('cloud');
    expect(await planner.isAvailable()).toBe(false);
    await expect(planner.plan('brighter', context)).rejects.toBeInstanceOf(CloudPlannerError);
  });

  it('posts the command with auth headers and returns a validated, normalized plan', async () => {
    process.env.EXPO_PUBLIC_PLANNER_URL = 'https://planner.test/';
    process.env.EXPO_PUBLIC_PLANNER_KEY = 'secret';
    const fetchMock = jest.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        plan: {
          intent: 'edit',
          steps: [
            { adjustment: 'exposure', region: 'face', amount: 0.3, invert: false },
            { adjustment: 'blur', region: 'sky', amount: 0.5, invert: false },
            { adjustment: 'saturation', region: 'all', amount: 3, invert: false },
          ],
          reply: 'Done.',
        },
        usage: { input_tokens: 1500, output_tokens: 80 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const planner = createCloudPlanner({ deviceId: 'device-1' });
    expect(await planner.isAvailable()).toBe(true);
    const plan = await planner.plan('  make my face lighter  ', {
      ...context,
      history: Array.from({ length: 40 }, (_, i) => `step ${i} ${'x'.repeat(200)}`),
    });

    expect(plan).toEqual({
      intent: 'edit',
      steps: [
        { adjustment: 'exposure', region: 'face', amount: 0.3, invert: false },
        { adjustment: 'saturation', region: 'all', amount: 1, invert: false },
      ],
      reply: 'Done.',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://planner.test/plan');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'x-kuindzhi-key': 'secret', 'x-kuindzhi-device': 'device-1' });
    const sent = JSON.parse(String(init?.body));
    expect(sent.command).toBe('make my face lighter');
    expect(sent.context.history).toHaveLength(30);
    expect(sent.context.history[0]).toHaveLength(120);
  });

  it('surfaces worker errors with status and code', async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429));
    const planner = createCloudPlanner({ url: 'https://planner.test', appKey: 'k', fetchImpl });
    await expect(planner.plan('brighter', context)).rejects.toMatchObject({
      name: 'CloudPlannerError',
      status: 429,
      code: 'rate_limited',
    });
  });

  it('rejects responses that are not a valid plan', async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        plan: { intent: 'edit', steps: [{ adjustment: 'teleport', region: 'all', amount: 1, invert: false }], reply: '' },
      }),
    );
    const planner = createCloudPlanner({ url: 'https://planner.test', fetchImpl });
    await expect(planner.plan('brighter', context)).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('times out slow requests', async () => {
    const fetchImpl = jest.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const planner = createCloudPlanner({ url: 'https://planner.test', fetchImpl, timeoutMs: 10 });
    await expect(planner.plan('brighter', context)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports network failures', async () => {
    const fetchImpl = jest.fn<FetchLike>().mockRejectedValue(new TypeError('Network request failed'));
    const planner = createCloudPlanner({ url: 'https://planner.test', fetchImpl });
    await expect(planner.plan('brighter', context)).rejects.toMatchObject({ code: 'network' });
  });
});
