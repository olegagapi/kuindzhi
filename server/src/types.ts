import type { EditPlan, PlannerRequest } from '../../src/edits/schema';

export type ProviderName = 'gemini' | 'anthropic';

/** Token accounting for one request. `thinking_tokens` are billed as output but never seen. */
export interface Usage {
  provider: ProviderName;
  model: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
}

export type ProviderResult =
  | { kind: 'plan'; plan: EditPlan; usage: Usage }
  | { kind: 'refused'; usage: Usage }
  | { kind: 'invalid'; usage?: Usage };

export type PlanInput = Pick<PlannerRequest, 'command' | 'context'>;

/** A provider failure already mapped to the worker's HTTP status and error code. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
