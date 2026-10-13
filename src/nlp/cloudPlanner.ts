// Cloud tier of the planning cascade: posts the command plus image statistics
// (never pixels) to the Kuindzhi planner worker (server/), which asks Claude.
import { EditPlanSchema, normalizePlan, type EditPlan, type ImageContext, type PlannerRequest } from '../edits/schema';
import type { Planner } from './types';

/** The one fetch signature the planner uses (lets tests pass a plain mock). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CloudPlannerOptions {
  /** Worker base URL. Defaults to EXPO_PUBLIC_PLANNER_URL. */
  url?: string;
  /** Shared app key. Defaults to EXPO_PUBLIC_PLANNER_KEY. */
  appKey?: string;
  /** Stable per-install id, used by the worker for rate limiting. */
  deviceId?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class CloudPlannerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CloudPlannerError';
  }
}

// Mirrors the limits in PlannerRequestSchema so the worker never 400s on size.
const MAX_COMMAND = 500;
const MAX_HISTORY = 30;
const MAX_HISTORY_ITEM = 120;

export function createCloudPlanner(opts: CloudPlannerOptions = {}): Planner {
  const url = (opts.url ?? process.env.EXPO_PUBLIC_PLANNER_URL ?? '').trim().replace(/\/+$/, '');
  const appKey = opts.appKey ?? process.env.EXPO_PUBLIC_PLANNER_KEY ?? '';
  const timeoutMs = opts.timeoutMs ?? 8000;

  return {
    source: 'cloud',

    async isAvailable() {
      return url.length > 0;
    },

    async plan(command: string, context: ImageContext): Promise<EditPlan> {
      if (!url) throw new CloudPlannerError('Cloud planner is not configured');
      const text = command.trim().slice(0, MAX_COMMAND);
      if (!text) throw new CloudPlannerError('Empty command');

      const body: PlannerRequest = {
        command: text,
        context: {
          regions: context.regions,
          faces: context.faces,
          stats: context.stats,
          history: context.history.slice(-MAX_HISTORY).map((h) => h.slice(0, MAX_HISTORY_ITEM)),
        },
      };
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-kuindzhi-key': appKey,
      };
      if (opts.deviceId) headers['x-kuindzhi-device'] = opts.deviceId;

      const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, init) => globalThis.fetch(u, init));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${url}/plan`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) throw new CloudPlannerError('Cloud planner timed out', undefined, 'timeout');
        throw new CloudPlannerError(`Cloud planner unreachable: ${String(err)}`, undefined, 'network');
      } finally {
        clearTimeout(timer);
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new CloudPlannerError(`Cloud planner returned ${res.status} without JSON`, res.status);
      }
      if (!res.ok) {
        const code = (payload as { error?: unknown } | null)?.error;
        throw new CloudPlannerError(
          `Cloud planner returned ${res.status}`,
          res.status,
          typeof code === 'string' ? code : undefined,
        );
      }

      const parsed = EditPlanSchema.safeParse((payload as { plan?: unknown } | null)?.plan);
      if (!parsed.success) throw new CloudPlannerError('Cloud planner returned an invalid plan', res.status, 'invalid_plan');
      return normalizePlan(parsed.data, context.regions);
    },
  };
}
