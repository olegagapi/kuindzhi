# Kuindzhi planner worker

The last tier of Kuindzhi's planning cascade:

1. local rule-based parser (free, offline)
2. on-device LLM (Apple Foundation Models or Gemini Nano, free)
3. **this worker**, which asks a small cloud model to turn the command into an `EditPlan`:
   Gemini 3.5 Flash-Lite by default (free tier, no card), or Claude Haiku 4.5.

Why this model, what it costs, and how to measure token use: [`docs/AI-PROVIDERS.md`](../docs/AI-PROVIDERS.md).

The app sends only the command text, the list of selectable regions, and a few
0–1 image statistics. **No photo, thumbnail, or pixel data ever leaves the device.**

The schema, adjustment/region catalog, and prompt are imported from the app by
relative path (`../src/edits/*`), so the worker and app can't drift apart.

## API

`POST /plan`

- Headers: `x-kuindzhi-key: <APP_KEY>`, and optionally `x-kuindzhi-device: <install id>` (rate-limit key; falls back to the client IP).
- Body: `PlannerRequest` (`{ command, context: { regions, faces, stats, history } }`).
- Response `200`: `{ plan: EditPlan, usage: { provider, model, input_tokens, output_tokens, thinking_tokens } }`.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_json` / `invalid_request` | body failed `PlannerRequestSchema` |
| 401 | `unauthorized` | missing or wrong `x-kuindzhi-key` |
| 413 | `body_too_large` | body over 16 KB |
| 429 | `rate_limited` | more than 30 requests/minute for this device |
| 429 | `upstream_rate_limited` | model API rate limit (e.g. free-tier quota) |
| 502 | `model_output_invalid` | the model's output was truncated or failed schema validation |
| 502 | `upstream_error` / `upstream_unreachable` | model API error or network failure |
| 504 | `upstream_timeout` | model API timed out |
| 500 | `not_configured` / `unknown_provider` | the provider's key secret is missing, or `PROVIDER` is not `gemini`/`anthropic` |

The app treats every non-200 as "this tier failed" and falls back to what the
local parser understood. A safety refusal is returned as `200` with
`intent: "unsupported"`.

`GET /health` returns `{ "ok": true, "provider": "gemini" }`.

## Setup (one command)

```bash
cd server
npm run setup                          # Gemini 3.5 Flash-Lite
npm run setup -- --provider=anthropic  # or Claude Haiku 4.5
npm run setup -- --dry-run             # print every step, change nothing
```

You need a model API key (Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey), free, no
card) and a free Cloudflare account; the script opens the Cloudflare login in your browser when needed. It deploys
the worker, stores both secrets, writes `EXPO_PUBLIC_PLANNER_URL` and `EXPO_PUBLIC_PLANNER_KEY` into the repo-root
`.env`, and sends a test request that prints the token counts. Re-running it is safe and is how you switch provider.

`EXPO_PUBLIC_*` values are inlined at build time, so restart Metro (`npm start` in the repo root) afterwards.
If `EXPO_PUBLIC_PLANNER_URL` is empty, the cloud tier is disabled and the app stays fully on-device.

## Develop

```bash
npm install
npm test            # vitest, both provider clients mocked, no keys needed
npm run typecheck
npm run build       # wrangler deploy --dry-run --outdir dist
```

Local dev: put the secrets in `server/.dev.vars` (git-ignored), then `npm run dev`:

```
GEMINI_API_KEY=AIza...        # or ANTHROPIC_API_KEY=sk-ant-... with PROVIDER=anthropic
APP_KEY=some-long-random-string
```

## Configuration

| Name | Kind | Meaning |
|---|---|---|
| `PROVIDER` | var | `gemini` (default) or `anthropic` |
| `MODEL` | var, optional | Overrides the provider default (`gemini-3.5-flash-lite` / `claude-haiku-4-5`) |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | secret | Key for the selected provider |
| `APP_KEY` | secret | Shared key the app sends in `x-kuindzhi-key` |

Gemini runs with minimal thinking and a JSON-schema response generated from the shared zod schema; Claude uses
structured outputs. Both report `usage` as `{ provider, model, input_tokens, output_tokens, thinking_tokens }`.

## Cost

| | Tokens per request |
|---|---|
| System prompt (generated from the catalog) | ~1,000 |
| User message (stats, regions, history, command) | ~120 |
| Schema overhead | a few hundred (estimate) |
| Output (JSON plan, 1–3 steps) | ~60–100 |

About 1.5k input and 0.1k output tokens per request:

- Gemini 3.5 Flash-Lite: **$0 on the free tier**; about $0.0007 per request on the paid tier ($0.30 / $2.50 per 1M).
- Claude Haiku 4.5: about $0.002 per request ($1 / $5 per 1M). Prompt caching doesn't apply: the prompt is below
  Haiku 4.5's 4,096-token cache minimum.

Most commands never get here because the local parser and the on-device LLM handle them first.
Cloudflare Workers' free plan covers 100k requests/day, so hosting costs nothing at this scale.

## Abuse protection

`APP_KEY` ships inside the app binary, so it only deters casual abuse. The
per-device rate limit (Workers Rate Limiting binding, 30/min) caps the damage.
For production, replace the shared key with platform attestation: **App Attest**
(iOS) and **Play Integrity** (Android) tokens, verified here before calling the model.

## Switching providers

The app↔worker contract (`PlannerRequest` → `EditPlan`) is provider-neutral, so
switching model or provider only changes this worker: re-run `npm run setup` with
another `--provider`, or set `MODEL`. The app doesn't need an update. Adding a
provider means one file like `src/gemini.ts` and a case in `src/index.ts`.
