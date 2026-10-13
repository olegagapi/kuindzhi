import { describe, expect, it } from 'vitest';

import { costPerThousand, matchWorkerUrl, parseEnv, upsertEnv } from '../scripts/setup-lib.mjs';

describe('setup helpers', () => {
  it('finds the workers.dev URL in wrangler deploy output', () => {
    const out = 'Uploaded kuindzhi-planner (2.1 sec)\nDeployed kuindzhi-planner triggers (0.4 sec)\n  https://kuindzhi-planner.oleg-a1.workers.dev\nCurrent Version ID: 123';
    expect(matchWorkerUrl(out)).toBe('https://kuindzhi-planner.oleg-a1.workers.dev');
    expect(matchWorkerUrl('no url here')).toBeNull();
  });

  it('reads .env values, ignoring comments and quotes', () => {
    expect(parseEnv('# comment\nEXPO_PUBLIC_PLANNER_KEY="abc"\n\nOTHER=1\n')).toEqual({
      EXPO_PUBLIC_PLANNER_KEY: 'abc',
      OTHER: '1',
    });
  });

  it('updates existing keys in place and appends new ones, keeping other lines', () => {
    const before = '# Cloud planner\nEXPO_PUBLIC_PLANNER_URL=\nSOMETHING_ELSE=keep\n';
    const after = upsertEnv(before, {
      EXPO_PUBLIC_PLANNER_URL: 'https://x.workers.dev',
      EXPO_PUBLIC_PLANNER_KEY: 'k',
    });
    expect(after).toBe(
      '# Cloud planner\nEXPO_PUBLIC_PLANNER_URL=https://x.workers.dev\nSOMETHING_ELSE=keep\nEXPO_PUBLIC_PLANNER_KEY=k\n',
    );
    expect(upsertEnv('', { A: '1' })).toBe('A=1\n');
  });

  it('is idempotent', () => {
    const once = upsertEnv('A=1\n', { A: '2', B: '3' });
    expect(upsertEnv(once, { A: '2', B: '3' })).toBe(once);
  });

  it('prices thinking tokens as output', () => {
    const usage = { model: 'gemini-3.5-flash-lite', input_tokens: 1000, output_tokens: 100, thinking_tokens: 100 };
    // 1000 * 0.30 + 200 * 2.50 = 800 micro-dollars per request → $0.80 per 1,000
    expect(costPerThousand(usage)).toBeCloseTo(0.8, 5);
    expect(costPerThousand({ model: 'unknown' })).toBeNull();
  });
});
