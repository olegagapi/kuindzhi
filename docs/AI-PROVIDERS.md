# Cloud planner: provider, cost and token budget

The cloud planner is the last tier of the planning cascade (`src/nlp/planner.ts`). It only sees commands that the
local parser and the on-device model couldn't handle, and it only ever receives text and a few numbers, never the
photo. This page records which model it uses and why, what that costs, how to set it up, and how to measure how
"hungry" a model is before switching.

Prices and model availability below were checked on **2026-10-13**. They change often; re-check the linked pages
before relying on a number.

## Decision

**Default: Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) on the Google AI Studio free tier.**

| Criterion | Why it wins |
|---|---|
| Fewest admin steps | One API key from AI Studio with an existing Google account. **No credit card.** The worker runs on Cloudflare's free plan, also without a card. |
| Cheapest | Free tier: $0. Paid tier: $0.30 / $2.50 per 1M tokens, about **$0.0007 per request** (≈ $0.70 per 1,000), about 3× cheaper than Claude Haiku 4.5. |
| Not token-hungry | Its default thinking level is "minimal", and the worker pins it there. Hidden thinking tokens are still reported (`thinking_tokens`) so this can be checked. |
| Current generation | Stable, and the model Google recommends for new projects. No retirement announced. |

Claude Haiku 4.5 stays available as a one-flag alternative (`npm run setup -- --provider=anthropic`). The app doesn't
change either way: the app↔worker contract (`PlannerRequest` → `EditPlan`) is provider-neutral.

Gemini wasn't on the original shortlist ("ChatGPT or Claude"); it was chosen on the two stated criteria, cheapest and
least administration.

## Privacy on the free tier

Google's pricing page lists "Used to improve our products" as **Yes** on the free tier and **No** on the paid tier.
What the worker sends per request:

- the command text, e.g. "give it the mood of a rainy day";
- the list of regions found in the photo (e.g. `face`, `sky`);
- about six rounded numbers (brightness, contrast, saturation, warmth, face and background brightness);
- short descriptions of the steps already applied (e.g. `exposure +0.30 on face`).

Never pixels, thumbnails or file names. To move to the paid tier, enable billing for the key's project in AI Studio
(check Google's current instructions; this step wasn't verified when this page was written). Nothing in the code changes.

## Options considered

Per-request figures assume our current prompt: about 1,500 input tokens and a 100-token JSON plan.

| Model | Price per 1M tokens (in / out) | Thinks by default? | Per request | Admin | Status (2026-10-13) |
|---|---|---|---|---|---|
| **Gemini 3.5 Flash-Lite** | $0.30 / $2.50, free tier | Minimal | ≈ $0.0007 (free tier $0) | Google account, no card | Current; recommended for new projects |
| Gemini 3.1 Flash-Lite | $0.25 / $1.50, free tier | Minimal | ≈ $0.0005 | Google account, no card | Current, previous generation |
| Claude Haiku 4.5 | $1.00 / $5.00 | No (only if enabled) | ≈ $0.002 | Anthropic account + card | Current |
| GPT-5 nano | $0.05 / $0.40 | **Yes**: reasoning tokens bill as output | ≈ $0.0001–0.0005, depends on reasoning | OpenAI account + card | Current (price from third-party trackers) |
| Gemini 2.5 Flash-Lite | $0.10 / $0.40 | No | — | — | **Closed to new projects** (404 for new users) |
| GPT-4.1 nano | $0.10 / $0.40 | No | — | — | **Shuts down 2026-10-23** |

An earlier answer in the project discussion recommended Gemini 2.5 Flash-Lite and GPT-4.1 nano before their
availability was checked. Both are out: one is closed to new projects, the other shuts down in ten days.

GPT-5 nano has the lowest list price, but it reasons by default, so the hidden tokens can outnumber the 100 tokens of
JSON we need and the cost per request becomes unpredictable. It is worth measuring with reasoning set to minimal (see
below). Using it would mean adding an OpenAI provider to the worker, about the size of `server/src/gemini.ts`.

## Admin steps per provider

| | Gemini (default) | Claude |
|---|---|---|
| Model key | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key | [console.anthropic.com](https://console.anthropic.com/settings/keys) → add billing → create key |
| Card | Not needed (free tier) | Needed |
| Worker hosting | Cloudflare account (free plan, no card); the setup script opens the browser login | Same |
| Command | `cd server && npm run setup` | `cd server && npm run setup -- --provider=anthropic` |
| Afterwards | Restart the bundler (`npm start` in the repo root) | Same |

## Setup

```bash
cd server
npm run setup              # Gemini; add -- --provider=anthropic for Claude, -- --dry-run to preview
```

What the script does (`server/scripts/setup.mjs`):

1. Installs the worker's dependencies if they're missing.
2. Checks the Cloudflare login and runs `wrangler login` (browser) if needed.
3. Asks for the model API key with hidden input, or reads `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` from the environment.
4. Reuses the app key already in `.env`, or generates one.
5. Deploys the worker with the chosen provider. On a brand-new Cloudflare account, wrangler asks once to register a
   free `workers.dev` subdomain; the script hands the terminal to wrangler for that.
6. Stores the model key and app key as worker secrets (passed on stdin, never on the command line).
7. Writes `EXPO_PUBLIC_PLANNER_URL` and `EXPO_PUBLIC_PLANNER_KEY` into the repo-root `.env` (git-ignored), keeping
   everything else in that file.
8. Sends one test request and prints the plan, the input/output/thinking tokens and the cost per 1,000 requests.

It is safe to re-run; that is also how to switch providers.

Troubleshooting:

- **401 right after setup:** new secrets take a few seconds to propagate. The script retries; if it still fails, run it again.
- **429 `upstream_rate_limited`:** the free tier's daily or per-minute quota was hit. Wait, or enable billing.
- **404 or "model not found":** the model was renamed or retired. Override it with `"MODEL"` in `server/wrangler.jsonc`
  vars (or `npx wrangler deploy --var MODEL:<id>`).

## Measuring how hungry a model is (planned, not built)

The worker already reports what's needed. Every `/plan` response includes:

```json
"usage": { "provider": "gemini", "model": "gemini-3.5-flash-lite",
           "input_tokens": 1412, "output_tokens": 74, "thinking_tokens": 0 }
```

Run the same fixed set of commands through each candidate model and compare.

### What to measure

| Metric | How |
|---|---|
| Input tokens | `usage.input_tokens`; differs per model because tokenizers differ |
| Output tokens | `usage.output_tokens`: the JSON plan itself |
| Thinking tokens | `usage.thinking_tokens`: hidden, billed as output |
| Hunger ratio | (output + thinking) ÷ output; 1.0 means no hidden spend |
| Latency | `curl -w '%{time_total}'`, report median and 95th percentile |
| Accuracy | Does the plan match the expected intent, adjustments, regions and direction (sign)? Amounts within a tolerance |
| Cost | Per 1,000 requests and, more usefully, per 1,000 **correct** plans |

### The command set (about 50, kept in a versioned file)

- 15 everyday commands that the local parser also handles, as a sanity baseline ("make my face brighter",
  "blur the background a lot", "warmer and more contrast").
- 15 free-form or mood requests, which are what actually reach the cloud ("make it feel like a cold winter morning",
  "give it the mood of a rainy day", "make it look like a 70s film photo", "more cinematic but keep skin natural").
- 10 compound, negated or inverted requests ("darken everything except me", "brighter but not the sky").
- 5 generative requests that must come back `unsupported` ("remove the person", "add a sunset").
- 5 history or vague requests ("undo that", "start over", "fix it").

Each line gets an expected answer: intent, plus the adjustment, region and sign of each step.

### Procedure (manual, with curl and jq)

```bash
URL=https://kuindzhi-planner.<subdomain>.workers.dev   # from .env
KEY=<EXPO_PUBLIC_PLANNER_KEY from .env>
CONTEXT='{"regions":["all","person","background","face","skin","hair","eyes","mouth","sky"],"faces":1,
          "stats":{"brightness":0.5,"contrast":0.2,"saturation":0.3,"warmth":0},"history":[]}'

# 1. Point the worker at the model under test (repeat per model).
(cd server && npx wrangler deploy --var PROVIDER:gemini --var MODEL:gemini-3.5-flash-lite)

# 2. Run every command, one JSON line per result.
while IFS= read -r cmd; do
  resp=$(curl -s -w '\n%{time_total}' "$URL/plan" \
    -H 'content-type: application/json' -H "x-kuindzhi-key: $KEY" -H 'x-kuindzhi-device: token-test' \
    -d "$(jq -nc --arg c "$cmd" --argjson ctx "$CONTEXT" '{command: $c, context: $ctx}')")
  echo "$resp" | sed '$d' | jq -c --arg cmd "$cmd" --arg t "$(echo "$resp" | tail -1)" \
    '{cmd: $cmd, seconds: ($t | tonumber), usage, plan}' >> results-gemini-3.5-flash-lite.jsonl
  sleep 2   # the worker allows 30 requests/minute per device; free tiers have their own limits
done < commands.txt

# 3. Averages for this model.
jq -s '{n: length,
        input: (map(.usage.input_tokens) | add / length),
        output: (map(.usage.output_tokens) | add / length),
        thinking: (map(.usage.thinking_tokens) | add / length),
        seconds: (map(.seconds) | add / length)}' results-gemini-3.5-flash-lite.jsonl
```

Accuracy is checked against the expected answers, by hand at first. Turning this into an automated script is the
natural next step when the comparison becomes routine.

Running 50 commands through four models costs a few cents (nothing on the Gemini free tier).

### Bigger levers than the choice of model

These cut tokens whatever the provider, and would show up directly in the measurements above:

- **Shorter prompt.** About 1,000 of the ~1,500 input tokens are the system prompt describing every adjustment and
  region. The compact prompt already written for the on-device model (`src/nlp/compactPrompt.ts`) would cut input
  by roughly 60%.
- **No reply from the model.** Output costs 5–8× more per token than input. Writing the user-facing sentence on the
  phone from the steps, instead of asking the model for it, removes about 40% of the output tokens.
- **Keep the free tiers busy.** Every command the local parser understands never reaches the cloud.

None of these is implemented yet.

## Sources

- Gemini models and lifecycle: [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
- Gemini pricing, free tier and data use: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Gemini thinking levels: [ai.google.dev/gemini-api/docs/thinking](https://ai.google.dev/gemini-api/docs/thinking)
- Gemini deprecations: [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- OpenAI deprecations (GPT-4.1 nano): [developers.openai.com/api/docs/deprecations](https://developers.openai.com/api/docs/deprecations)
- GPT-5 nano model and reasoning tokens: [developers.openai.com/api/docs/models/gpt-5-nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [CloudZero OpenAI pricing](https://www.cloudzero.com/blog/openai-pricing/)
- Claude Haiku 4.5 pricing: Anthropic's model table (`claude-haiku-4-5`, $1 / $5 per 1M tokens)
- Cloudflare Workers rate limiting: [developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
