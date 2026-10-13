// Circuit breaker for planner tiers. A tier that is offline, rate-limited or
// misconfigured is skipped for a while (or for the rest of the session) instead
// of making every command wait for the same failure again.
import type { EditPlan, ImageContext } from '../edits/schema';
import { CloudPlannerError } from './cloudPlanner';
import type { Planner, TierIssue } from './types';

export interface FailureVerdict {
  /** How long to skip the tier: 0 = try again next time, Infinity = rest of the session. */
  skipMs: number;
  issue: TierIssue;
}

export type FailureClassifier = (error: unknown, consecutiveFailures: number) => FailureVerdict;

export function withCircuitBreaker(inner: Planner, classify: FailureClassifier, now: () => number = Date.now): Planner {
  let skipUntil = 0;
  let skipIssue: TierIssue | null = null;
  let lastIssue: TierIssue | null = null;
  let consecutive = 0;

  return {
    source: inner.source,

    issue() {
      return now() < skipUntil ? skipIssue : lastIssue;
    },

    async isAvailable() {
      if (now() < skipUntil) return false;
      try {
        return await inner.isAvailable();
      } catch {
        return false;
      }
    },

    async plan(command: string, context: ImageContext): Promise<EditPlan> {
      try {
        const plan = await inner.plan(command, context);
        consecutive = 0;
        lastIssue = null;
        return plan;
      } catch (error) {
        consecutive += 1;
        const verdict = classify(error, consecutive);
        lastIssue = verdict.issue;
        if (verdict.skipMs > 0) {
          skipUntil = now() + verdict.skipMs;
          skipIssue = verdict.issue;
          if (__DEV__) console.warn(`[planner] ${inner.source} skipped (${verdict.issue}) for ${verdict.skipMs} ms`);
        }
        throw error;
      }
    },
  };
}

const MINUTE = 60_000;

/** Offline/timeouts: retry in a minute. Quota: in five. A rejected key or broken config: not this session. */
export function classifyCloudFailure(error: unknown): FailureVerdict {
  if (error instanceof CloudPlannerError) {
    if (error.code === 'network' || error.code === 'timeout') return { skipMs: MINUTE, issue: 'offline' };
    if (error.status === 429) return { skipMs: 5 * MINUTE, issue: 'rate-limited' };
    if (
      error.status === 401 ||
      error.code === 'upstream_auth' ||
      error.code === 'not_configured' ||
      error.code === 'unknown_provider'
    ) {
      return { skipMs: Infinity, issue: 'misconfigured' };
    }
  }
  return { skipMs: 0, issue: 'transient' };
}

/** An on-device model that fails twice in a row (e.g. assets missing) is off for the session. */
export function classifyOnDeviceFailure(_error: unknown, consecutiveFailures: number): FailureVerdict {
  return consecutiveFailures >= 2 ? { skipMs: Infinity, issue: 'unavailable' } : { skipMs: 0, issue: 'transient' };
}
