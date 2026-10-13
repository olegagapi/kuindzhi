import type { OnDeviceLlmNative, OnDeviceLlmStatus } from '../../../modules/on-device-llm';
import type { ImageContext } from '../../edits/schema';
import { createOnDevicePlanner, onDevicePlanner, parseOnDevicePlan } from '../onDevicePlanner';

const context: ImageContext = {
  regions: ['all', 'face', 'background', 'person', 'sky'],
  faces: 1,
  stats: { brightness: 0.4, contrast: 0.5, saturation: 0.3, warmth: 0.1, faceBrightness: 0.3 },
  history: [],
};

function fakeNative(
  output: string | Promise<string>,
  status: OnDeviceLlmStatus = 'available',
): jest.Mocked<OnDeviceLlmNative> {
  return {
    getStatus: jest.fn(async () => ({ status, reason: '' })),
    prepare: jest.fn(async () => ({ status: 'downloading' as const, reason: '' })),
    generatePlan: jest.fn(async (_instructions: string, _prompt: string) => output),
  };
}

const facePlan = JSON.stringify({
  intent: 'edit',
  steps: [{ adjustment: 'exposure', region: 'face', amount: 0.3, invert: false }],
  reply: 'Brightened your face.',
});

describe('onDevicePlanner', () => {
  it('is unavailable when the native module is not linked', async () => {
    const planner = createOnDevicePlanner(() => null);
    await expect(planner.isAvailable()).resolves.toBe(false);
    await expect(planner.plan('brighter', context)).rejects.toThrow(/not available/);
  });

  it('degrades gracefully with the default (unlinked) module in tests', async () => {
    await expect(onDevicePlanner.isAvailable()).resolves.toBe(false);
  });

  it('reports availability from the native status', async () => {
    await expect(createOnDevicePlanner(() => fakeNative(facePlan)).isAvailable()).resolves.toBe(true);
    await expect(createOnDevicePlanner(() => fakeNative(facePlan, 'unavailable')).isAvailable()).resolves.toBe(false);
    await expect(createOnDevicePlanner(() => fakeNative(facePlan, 'downloading')).isAvailable()).resolves.toBe(false);
  });

  it('starts the model download once when it is downloadable', async () => {
    const native = fakeNative(facePlan, 'downloadable');
    const planner = createOnDevicePlanner(() => native);
    await expect(planner.isAvailable()).resolves.toBe(false);
    await planner.isAvailable();
    expect(native.prepare).toHaveBeenCalledTimes(1);
  });

  it('treats a throwing status call as unavailable', async () => {
    const native = fakeNative(facePlan);
    native.getStatus.mockRejectedValue(new Error('boom'));
    await expect(createOnDevicePlanner(() => native).isAvailable()).resolves.toBe(false);
  });

  it('returns a validated plan and sends compact instructions plus the user message', async () => {
    const native = fakeNative(facePlan);
    const plan = await createOnDevicePlanner(() => native).plan('make my face lighter', context);

    expect(plan).toEqual({
      intent: 'edit',
      steps: [{ adjustment: 'exposure', region: 'face', amount: 0.3, invert: false }],
      reply: 'Brightened your face.',
    });
    const [instructions, prompt] = native.generatePlan.mock.calls[0];
    expect(instructions).toContain('Regions:');
    expect(instructions.length).toBeLessThan(2500);
    expect(prompt).toContain('Request: make my face lighter');
    expect(prompt).toContain('Available regions: all, face, background, person, sky');
  });

  it('parses JSON wrapped in code fences', async () => {
    const native = fakeNative('```json\n' + facePlan + '\n```');
    const plan = await createOnDevicePlanner(() => native).plan('brighter face', context);
    expect(plan.steps).toHaveLength(1);
  });

  it('rejects invalid JSON so the cascade can move on', async () => {
    await expect(createOnDevicePlanner(() => fakeNative('Sure! I made it brighter.')).plan('x', context)).rejects.toThrow(
      /no JSON/,
    );
    await expect(createOnDevicePlanner(() => fakeNative('{"intent": "edit", "steps": [')).plan('x', context)).rejects.toThrow();
  });

  it('times out slow generations', async () => {
    const native = fakeNative(new Promise<string>(() => {}));
    await expect(createOnDevicePlanner(() => native, 20).plan('x', context)).rejects.toThrow(/timed out/);
  });
});

describe('parseOnDevicePlan', () => {
  it('fills omitted defaults and clamps amounts', () => {
    const plan = parseOnDevicePlan(
      JSON.stringify({ steps: [{ adjustment: 'contrast', amount: '2.5' }, { adjustment: 'blur', region: 'background', amount: 0.7 }] }),
      context,
    );
    expect(plan).toEqual({
      intent: 'edit',
      steps: [
        { adjustment: 'contrast', region: 'all', amount: 1, invert: false },
        { adjustment: 'blur', region: 'background', amount: 0.7, invert: false },
      ],
      reply: '',
    });
  });

  it('drops steps with unknown names or unavailable regions', () => {
    const plan = parseOnDevicePlan(
      JSON.stringify({
        intent: 'edit',
        steps: [
          { adjustment: 'teleport', region: 'face', amount: 0.5, invert: false },
          { adjustment: 'saturation', region: 'hair', amount: 0.5, invert: false },
          { adjustment: 'saturation', region: 'sky', amount: 0.4, invert: true },
        ],
        reply: 'ok',
      }),
      context,
    );
    expect(plan.steps).toEqual([{ adjustment: 'saturation', region: 'sky', amount: 0.4, invert: true }]);
  });

  it('throws when an edit ends up with no usable steps', () => {
    const raw = JSON.stringify({ intent: 'edit', steps: [{ adjustment: 'exposure', region: 'hair', amount: 0.3, invert: false }], reply: '' });
    expect(() => parseOnDevicePlan(raw, context)).toThrow(/no usable steps/);
  });

  it('passes through non-edit intents without steps', () => {
    const plan = parseOnDevicePlan(JSON.stringify({ intent: 'unsupported', steps: [], reply: "I can't add a unicorn." }), context);
    expect(plan).toEqual({ intent: 'unsupported', steps: [], reply: "I can't add a unicorn." });
  });

  it('rejects an unknown intent with no steps', () => {
    expect(() => parseOnDevicePlan(JSON.stringify({ intent: 'paint', steps: [], reply: '' }), context)).toThrow(/validation/);
  });
});
