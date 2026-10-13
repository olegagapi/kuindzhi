import { REGIONS } from '../../edits/catalog';
import type { EditPlan, ImageContext, PlanSource } from '../../edits/schema';
import { FALLBACK_REPLY, planCommand } from '../planner';
import type { Planner } from '../types';

const context: ImageContext = {
  regions: [...REGIONS],
  faces: 1,
  stats: { brightness: 0.5, contrast: 0.2, saturation: 0.3, warmth: 0 },
  history: [],
};

const llmPlan: EditPlan = {
  intent: 'edit',
  steps: [{ adjustment: 'temperature', region: 'all', amount: -0.3, invert: false }],
  reply: 'Cooler.',
};

function tier(source: PlanSource, result: EditPlan | Error = llmPlan, available = true) {
  const plan = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const planner: Planner = { source, isAvailable: async () => available, plan };
  return { planner, plan };
}

describe('planCommand cascade', () => {
  it('answers fully understood commands locally without touching any LLM', async () => {
    const onDevice = tier('on-device-ai');
    const cloud = tier('cloud');
    const r = await planCommand('make my face brighter', context, [onDevice.planner, cloud.planner]);
    expect(r.source).toBe('local');
    expect(r.plan.steps[0]).toMatchObject({ adjustment: 'exposure', region: 'face' });
    expect(onDevice.plan).not.toHaveBeenCalled();
    expect(cloud.plan).not.toHaveBeenCalled();
  });

  it('asks the free on-device model when the parser ignored words, but never pays for it', async () => {
    const onDevice = tier('on-device-ai', new Error('model busy'));
    const cloud = tier('cloud');
    const r = await planCommand('make it feel like a cold winter morning', context, [onDevice.planner, cloud.planner]);
    expect(onDevice.plan).toHaveBeenCalled();
    expect(cloud.plan).not.toHaveBeenCalled();
    expect(r.source).toBe('local');
    expect(r.plan.steps[0]).toMatchObject({ adjustment: 'temperature' });
  });

  it('uses the on-device plan when it succeeds', async () => {
    const onDevice = tier('on-device-ai');
    const r = await planCommand('make it feel like a cold winter morning', context, [onDevice.planner]);
    expect(r.source).toBe('on-device-ai');
    expect(r.tried).toEqual(['local', 'on-device-ai']);
  });

  it('falls through to the cloud for commands the parser cannot handle', async () => {
    const onDevice = tier('on-device-ai', llmPlan, false);
    const cloud = tier('cloud');
    const r = await planCommand('give it the mood of a rainy day in London', context, [onDevice.planner, cloud.planner]);
    expect(onDevice.plan).not.toHaveBeenCalled();
    expect(r.source).toBe('cloud');
  });

  it('rejects empty LLM edit plans and moves on', async () => {
    const onDevice = tier('on-device-ai', { intent: 'edit', steps: [], reply: '' });
    const cloud = tier('cloud');
    const r = await planCommand('asdf qwerty zxcv', context, [onDevice.planner, cloud.planner]);
    expect(r.source).toBe('cloud');
  });

  it('drops LLM steps on regions the photo does not have', async () => {
    const cloud = tier('cloud', {
      intent: 'edit',
      steps: [
        { adjustment: 'exposure', region: 'sky', amount: 0.3, invert: false },
        { adjustment: 'contrast', region: 'all', amount: 0.2, invert: false },
      ],
      reply: 'ok',
    });
    const r = await planCommand('qwerty uiop', { ...context, regions: ['all'] }, [cloud.planner]);
    expect(r.plan.steps).toEqual([{ adjustment: 'contrast', region: 'all', amount: 0.2, invert: false }]);
  });

  it('does not claim a request is generative when it only guessed from unknown words', async () => {
    const r = await planCommand('give it the mood of a rainy day in London', context, []);
    expect(r.plan.reply).toBe(FALLBACK_REPLY);
    const sure = await planCommand('remove the person', context, []);
    expect(sure.plan.reply).toMatch(/can't add, remove/);
  });

  it('returns a helpful fallback when nothing understands the command', async () => {
    const r = await planCommand('asdf qwerty zxcv', context, []);
    expect(r.plan.intent).toBe('unsupported');
    expect(r.plan.reply).toBe(FALLBACK_REPLY);
  });

  it('keeps the understood part of a partial command when no LLM is available', async () => {
    const r = await planCommand('make the colors pop but keep skin natural', context, []);
    expect(r.plan.steps.length).toBeGreaterThan(0);
    expect(r.plan.reply).toMatch(/skipped/);
  });
});
