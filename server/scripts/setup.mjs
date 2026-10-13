#!/usr/bin/env node
// One-command setup for the cloud planner:
//   cd server && npm run setup              (Gemini, free tier)
//   npm run setup -- --provider=anthropic   (Claude Haiku 4.5)
//   npm run setup -- --dry-run              (print every step, change nothing)
//
// It installs the worker's dependencies, logs in to Cloudflare (browser) if
// needed, deploys the worker, stores the model key and an app key as worker
// secrets, writes the app's .env, and sends one test request. Safe to re-run:
// the app key already in .env is reused, so the app and worker stay in sync.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { costPerThousand, matchWorkerUrl, parseEnv, upsertEnv } from './setup-lib.mjs';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(serverDir, '..', '.env');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const provider = args.find((a) => a.startsWith('--provider='))?.split('=')[1] ?? 'gemini';

const PROVIDERS = {
  gemini: {
    secret: 'GEMINI_API_KEY',
    name: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier: no card needed. On the free tier Google may use requests to improve its products; the worker only ever sends command text and a few numbers, never photos.',
  },
  anthropic: {
    secret: 'ANTHROPIC_API_KEY',
    name: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Needs a billing method on the Anthropic account.',
  },
};

const chosen = PROVIDERS[provider];
if (!chosen) fail(`Unknown provider "${provider}". Use --provider=gemini or --provider=anthropic.`);

const DRY_OUTPUT = {
  whoami: 'You are logged in with an OAuth Token (dry run).',
  deploy: 'Deployed kuindzhi-planner triggers\n  https://kuindzhi-planner.your-subdomain.workers.dev',
};

await main();

async function main() {
  step(`Kuindzhi planner setup · provider: ${chosen.name}${dryRun ? ' · DRY RUN, nothing will change' : ''}`);

  if (!existsSync(join(serverDir, 'node_modules', 'wrangler'))) {
    step('Installing the worker dependencies');
    await mustRun('npm', ['install']);
  }

  step('Checking your Cloudflare login');
  const whoami = await run('npx', ['--no-install', 'wrangler', 'whoami'], 'whoami');
  if (whoami.code !== 0 || /not authenticated/i.test(whoami.out)) {
    console.log('A browser window will open. Log in to Cloudflare (or create a free account), then come back here.');
    await mustRun('npx', ['--no-install', 'wrangler', 'login'], undefined, { interactive: true });
  }

  step(`Your ${chosen.name} API key`);
  console.log(`Create one at ${chosen.keyUrl}`);
  console.log(chosen.note);
  const modelKey =
    process.env[chosen.secret] || (dryRun ? 'dry-run-key' : await askSecret(`Paste the ${chosen.name} API key: `));
  if (!modelKey) fail('No API key entered.');

  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const appKey = parseEnv(existing).EXPO_PUBLIC_PLANNER_KEY || randomBytes(24).toString('hex');

  step('Deploying the worker');
  const deployArgs = ['--no-install', 'wrangler', 'deploy', '--var', `PROVIDER:${provider}`];
  let deploy = await run('npx', deployArgs, 'deploy');
  let url = matchWorkerUrl(deploy.out);
  if (!url) {
    // First deploy on a new account asks to register a workers.dev subdomain, which needs a terminal.
    console.log('\nWrangler needs a couple of answers. Follow its prompts below.');
    await mustRun('npx', deployArgs, undefined, { interactive: true });
    deploy = await run('npx', deployArgs, 'deploy');
    url = matchWorkerUrl(deploy.out) || (await ask('Paste the worker URL shown above (https://…workers.dev): '));
  }
  if (!url) fail('Could not determine the worker URL.');

  step('Storing secrets on the worker');
  await mustRun('npx', ['--no-install', 'wrangler', 'secret', 'put', chosen.secret], modelKey);
  await mustRun('npx', ['--no-install', 'wrangler', 'secret', 'put', 'APP_KEY'], appKey);

  step('Pointing the app at the worker (.env in the repo root)');
  const updated = upsertEnv(existing, { EXPO_PUBLIC_PLANNER_URL: url, EXPO_PUBLIC_PLANNER_KEY: appKey });
  if (dryRun) console.log(`Would write ${envPath}:\n${updated.replace(appKey, '<app key>')}`);
  else writeFileSync(envPath, updated);

  step('Sending a test request');
  if (dryRun) {
    console.log(`Would POST ${url}/plan with "give it the mood of a rainy day".`);
  } else {
    await smokeTest(url, appKey);
  }

  step('Done');
  console.log('Restart the app bundler so it picks up .env: from the repo root, run `npm start` (or rebuild).');
  console.log('To switch providers later, re-run this with --provider=anthropic or --provider=gemini.');
}

async function smokeTest(url, appKey) {
  const body = {
    command: 'give it the mood of a rainy day',
    context: {
      regions: ['all', 'person', 'background', 'face', 'sky'],
      faces: 1,
      stats: { brightness: 0.5, contrast: 0.2, saturation: 0.3, warmth: 0 },
      history: [],
    },
  };
  // New secrets take a few seconds to reach every Cloudflare location.
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(`${url}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kuindzhi-key': appKey, 'x-kuindzhi-device': 'setup' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        const { plan, usage } = payload;
        console.log(`Plan: ${plan.steps.map((s) => `${s.adjustment} ${s.amount} on ${s.region}`).join(', ') || plan.intent}`);
        console.log(`Reply: ${plan.reply}`);
        console.log(
          `Tokens: ${usage.input_tokens} in, ${usage.output_tokens} out, ${usage.thinking_tokens} thinking (${usage.model}).`,
        );
        const cost = costPerThousand(usage);
        if (cost !== null) console.log(`At paid-tier prices that is about $${cost.toFixed(2)} per 1,000 requests.`);
        return;
      }
      if (payload.error === 'upstream_auth') {
        console.log(`${chosen.name} rejected the API key. Run setup again and paste a valid key.`);
        return;
      }
      if (![401, 500].includes(res.status)) {
        console.log(`The worker answered ${res.status} ${JSON.stringify(payload)}. Check the key and run setup again.`);
        return;
      }
    } catch (error) {
      if (attempt === 6) console.log(`Could not reach the worker: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('The worker did not accept the test request yet. Wait a minute and run setup again; it is safe to repeat.');
}

function run(cmd, cmdArgs, dryKey, { input, interactive = false } = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun) return Promise.resolve({ code: 0, out: DRY_OUTPUT[dryKey] ?? '' });
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: serverDir, stdio: interactive ? 'inherit' : 'pipe', env: process.env });
    let out = '';
    if (!interactive) {
      child.stdout.on('data', (d) => {
        out += d;
        process.stdout.write(d);
      });
      child.stderr.on('data', (d) => {
        out += d;
        process.stderr.write(d);
      });
      child.stdin.end(input === undefined ? undefined : `${input}\n`);
    }
    child.on('error', (err) => resolve({ code: 1, out: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

async function mustRun(cmd, cmdArgs, input, options = {}) {
  const result = await run(cmd, cmdArgs, undefined, { ...options, input });
  if (result.code !== 0) fail(`"${cmd} ${cmdArgs.join(' ')}" failed. Fix the error above and run setup again.`);
  return result;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Like ask(), but doesn't echo what is typed or pasted. */
function askSecret(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

function step(text) {
  console.log(`\n== ${text}`);
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}
