// Claude provider (PROVIDER=anthropic): structured outputs on Claude Haiku 4.5.
import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { buildSystemPrompt, buildUserMessage } from '../../src/edits/prompt';
import { EditPlanSchema } from '../../src/edits/schema';
import { UpstreamError, type PlanInput, type ProviderResult } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';

/** The slice of the SDK client the provider uses, so tests can inject a fake. */
export type ClaudeClient = Pick<Anthropic, 'messages'>;

// Built once per isolate; both are pure functions of the catalog.
const SYSTEM_PROMPT = buildSystemPrompt();
const PLAN_FORMAT = zodOutputFormat(EditPlanSchema);

export function createClaudeClient(apiKey: string): ClaudeClient {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
}

export async function planWithClaude(client: ClaudeClient, model: string, { command, context }: PlanInput): Promise<ProviderResult> {
  let message;
  try {
    message = await client.messages.parse({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(command, context) }],
      output_config: { format: PLAN_FORMAT },
    });
  } catch (err) {
    throw toUpstreamError(err);
  }

  const usage = {
    provider: 'anthropic' as const,
    model,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    // No `thinking` parameter is sent, so Haiku 4.5 doesn't think.
    thinking_tokens: 0,
  };
  if (message.stop_reason === 'refusal') return { kind: 'refused', usage };
  if (message.stop_reason === 'max_tokens' || message.parsed_output == null) return { kind: 'invalid', usage };
  return { kind: 'plan', plan: message.parsed_output, usage };
}

function toUpstreamError(err: unknown): UpstreamError {
  // Most specific first: in the TS SDK the connection errors subclass APIError.
  if (err instanceof RateLimitError) return new UpstreamError(429, 'upstream_rate_limited');
  // A rejected key won't fix itself: the app turns the cloud tier off for the session.
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new UpstreamError(502, 'upstream_auth');
  }
  if (err instanceof APIConnectionTimeoutError) return new UpstreamError(504, 'upstream_timeout');
  if (err instanceof APIConnectionError) return new UpstreamError(502, 'upstream_unreachable');
  if (err instanceof APIError) {
    console.error('Claude API error', err.status, err.message);
    return new UpstreamError(502, 'upstream_error');
  }
  // Non-HTTP SDK error: structured output failed JSON/schema validation.
  if (err instanceof AnthropicError) return new UpstreamError(502, 'model_output_invalid');
  throw err;
}
