export interface UsageLike {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
}

export function matchWorkerUrl(text: string | null | undefined): string | null;
export function parseEnv(text: string | null | undefined): Record<string, string>;
export function upsertEnv(text: string | null | undefined, updates: Record<string, string>): string;
export const PRICES: Record<string, { input: number; output: number }>;
export function costPerThousand(usage: UsageLike | null | undefined): number | null;
