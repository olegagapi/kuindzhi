// Pure helpers for scripts/setup.mjs (unit-tested in test/setup.test.ts).

/** First workers.dev URL in wrangler's output, without a trailing slash. */
export function matchWorkerUrl(text) {
  const m = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i.exec(text ?? '');
  return m ? m[0] : null;
}

/** KEY=value pairs of a .env file (comments and blank lines ignored). */
export function parseEnv(text) {
  const out = {};
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Set keys in a .env file's text, keeping every other line (and comment) as it was. */
export function upsertEnv(text, updates) {
  const lines = (text ?? '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const pending = new Map(Object.entries(updates));
  const result = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && pending.has(m[1])) {
      const value = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}=${value}`;
    }
    return line;
  });
  for (const [key, value] of pending) result.push(`${key}=${value}`);
  return `${result.join('\n')}\n`;
}

/** Paid-tier list prices per 1M tokens (checked 2026-10-13). The Gemini free tier costs $0. */
export const PRICES = {
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Dollars per 1,000 requests like this one, or null for an unknown model. Thinking tokens bill as output. */
export function costPerThousand(usage) {
  const price = PRICES[usage?.model];
  if (!price) return null;
  const output = (usage.output_tokens ?? 0) + (usage.thinking_tokens ?? 0);
  return ((usage.input_tokens ?? 0) * price.input + output * price.output) / 1000;
}
