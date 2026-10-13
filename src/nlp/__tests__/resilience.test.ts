import { REGIONS } from '../../edits/catalog';
import type { EditPlan, ImageContext } from '../../edits/schema';
import { CloudPlannerError } from '../cloudPlanner';
import { planCommand } from '../planner';
import { classifyCloudFailure, classifyOnDeviceFailure, withCircuitBreaker } from '../resilience';
import type { Planner } from '../types';

const context: ImageContext = {
  regions: [...REGIONS],
  faces: 1,
  stats: { brightness: 0.5, contrast: 0.2, saturation: 0.3, warmth: 0 },
  history: [],
};

const PLAN: EditPlan = { intent: 'edit', steps: [{ adjustment: 'fade', region: 'all', amount: 0.3, invert: false }], reply: 'ok' };
const UNPARSEABLE = 'give it the mood of a rainy day in London';

function cloud(error?: unknown) {
  const plan = jest.fn(async () => {
    if (error) throw error;
    return PLAN;
  });
  const isAvailable = jest.fn(async () => true);
  const planner: Planner = { source: 'cloud', isAvailable, plan };
  return { planner, plan };
}

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('circuit breaker', () => {
  it('skips an offline cloud for a minute, then tries again', async () => {
    const c = cloud(new CloudPlannerError('unreachable', undefined, 'network'));
    const time = clock();
    const tier = withCircuitBreaker(c.planner, classifyCloudFailure, time.now);

    const first = await planCommand(UNPARSEABLE, context, [tier]);
    expect(c.plan).toHaveBeenCalledTimes(1);
    expect(first.issues).toEqual(['offline']);
    expect(first.plan.reply).toMatch(/Offline/);

    const second = await planCommand(UNPARSEABLE, context, [tier]);
    expect(c.plan).toHaveBeenCalledTimes(1); // skipped, no network wait
    expect(second.issues).toEqual(['offline']);

    time.advance(61_000);
    await planCommand(UNPARSEABLE, context, [tier]);
    expect(c.plan).toHaveBeenCalledTimes(2);
  });

  it('turns the cloud off for the session when the key is rejected', async () => {
    const c = cloud(new CloudPlannerError('bad key', 502, 'upstream_auth'));
    const time = clock();
    const tier = withCircuitBreaker(c.planner, classifyCloudFailure, time.now);
    const first = await planCommand(UNPARSEABLE, context, [tier]);
    expect(first.plan.reply).toMatch(/isn't set up correctly/);
    time.advance(24 * 3600_000);
    await planCommand(UNPARSEABLE, context, [tier]);
    expect(c.plan).toHaveBeenCalledTimes(1);
  });

  it('treats a wrong app key and a missing worker secret as misconfiguration', () => {
    expect(classifyCloudFailure(new CloudPlannerError('x', 401, 'unauthorized')).skipMs).toBe(Infinity);
    expect(classifyCloudFailure(new CloudPlannerError('x', 500, 'not_configured')).skipMs).toBe(Infinity);
    expect(classifyCloudFailure(new CloudPlannerError('x', 429, 'rate_limited')).issue).toBe('rate-limited');
    expect(classifyCloudFailure(new CloudPlannerError('x', 502, 'model_output_invalid')).skipMs).toBe(0);
    expect(classifyCloudFailure(new Error('boom')).skipMs).toBe(0);
  });

  it('keeps trying after a transient failure and recovers', async () => {
    let fail = true;
    const plan = jest.fn(async () => {
      if (fail) throw new CloudPlannerError('bad output', 502, 'model_output_invalid');
      return PLAN;
    });
    const tier = withCircuitBreaker({ source: 'cloud', isAvailable: async () => true, plan }, classifyCloudFailure);
    await planCommand(UNPARSEABLE, context, [tier]);
    fail = false;
    const ok = await planCommand(UNPARSEABLE, context, [tier]);
    expect(ok.source).toBe('cloud');
    expect(tier.issue?.()).toBeNull();
  });

  it('gives up on an on-device model after two failures in a row', async () => {
    const plan = jest.fn(async (): Promise<EditPlan> => {
      throw new Error('assets missing');
    });
    const tier = withCircuitBreaker({ source: 'on-device-ai', isAvailable: async () => true, plan }, classifyOnDeviceFailure);
    for (let i = 0; i < 4; i++) await planCommand(UNPARSEABLE, context, [tier]);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it('treats a throwing isAvailable as unavailable', async () => {
    const tier = withCircuitBreaker(
      {
        source: 'cloud',
        isAvailable: async () => {
          throw new Error('native crash');
        },
        plan: jest.fn(),
      },
      classifyCloudFailure,
    );
    const r = await planCommand(UNPARSEABLE, context, [tier]);
    expect(r.source).toBe('local');
  });
});
