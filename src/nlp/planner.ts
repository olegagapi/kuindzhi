// The planning cascade, cheapest first:
//   1. local rule-based parser  — free, offline, instant
//   2. on-device LLM            — free, private (Apple Foundation Models / Gemini Nano)
//   3. cloud LLM                — Gemini Flash-Lite via our Worker (free tier; see docs/AI-PROVIDERS.md)
// Paid tiers only see commands the free tiers couldn't handle. Every failure
// degrades to the next tier and finally to what the parser understood.
import { normalizePlan, type EditPlan, type ImageContext, type PlanSource } from '../edits/schema';
import { parseLocally } from './localParser';
import type { Planner, TierIssue } from './types';

export interface CascadeResult {
  plan: EditPlan;
  source: PlanSource;
  /** Which tiers were tried, in order (for the UI badge and debugging). */
  tried: PlanSource[];
  /** Problems with tiers that were skipped or failed on the way. */
  issues: TierIssue[];
}

export const FALLBACK_REPLY =
  "I couldn't turn that into an edit. Try something like “brighten my face”, “blur the background” or “warmer and more contrast”.";

const PAID: ReadonlySet<PlanSource> = new Set(['cloud']);

/** Short explanation appended when the reply came from the fallback because a tier couldn't help. */
export function issueNote(issues: readonly TierIssue[]): string {
  if (issues.includes('offline')) return 'Offline, so this was handled on the phone.';
  if (issues.includes('misconfigured')) return "The cloud planner isn't set up correctly, so this was handled on the phone.";
  if (issues.includes('rate-limited')) return 'The cloud planner is busy; try again in a few minutes.';
  return '';
}

export async function planCommand(
  command: string,
  context: ImageContext,
  llmTiers: Planner[],
): Promise<CascadeResult> {
  const tried: PlanSource[] = ['local'];
  const issues: TierIssue[] = [];
  const local = parseLocally(command, context.regions);
  const localPlan = normalizePlan(local.plan, context.regions);

  // Fully understood with nothing left over: done, for free.
  if (local.confidence === 'full' && !local.unknownWords.length) {
    return { plan: localPlan, source: 'local', tried, issues };
  }
  // Understood, but some words were ignored ("cold *winter morning*"): a free
  // on-device model may do better; not worth paying for. A full parse with no
  // steps (e.g. "give it the mood of…" read as generative) may use every tier.
  const allowPaid = local.confidence !== 'full' || localPlan.steps.length === 0;

  for (const tier of llmTiers) {
    if (PAID.has(tier.source) && !allowPaid) continue;
    try {
      if (!(await tier.isAvailable())) {
        noteIssue(tier, issues);
        continue;
      }
      tried.push(tier.source);
      const plan = normalizePlan(await tier.plan(command, context), context.regions);
      if (plan.intent === 'edit' && !plan.steps.length) throw new Error('LLM plan had no usable steps');
      return { plan, source: tier.source, tried, issues };
    } catch (error) {
      noteIssue(tier, issues);
      if (__DEV__) console.warn(`[planner] ${tier.source} failed`, error);
    }
  }

  const note = issueNote(issues);
  const withNote = (plan: EditPlan, extra = ''): EditPlan => ({
    ...plan,
    reply: [plan.reply + extra, note].filter(Boolean).join(' ').trim(),
  });

  if (local.confidence === 'full') {
    // "Unsupported" guessed from a generic verb ("give it the mood of…") while
    // ignoring words is a guess; admit we didn't understand instead.
    if (localPlan.intent === 'unsupported' && local.unknownWords.length) {
      return { plan: withNote({ ...localPlan, reply: FALLBACK_REPLY }), source: 'local', tried, issues };
    }
    return { plan: localPlan, source: 'local', tried, issues };
  }
  if (local.confidence === 'partial' && (localPlan.steps.length || localPlan.intent !== 'edit')) {
    const skipped = local.unparsed.length ? ` (skipped: ${local.unparsed.join('; ')})` : '';
    return { plan: withNote(localPlan, skipped), source: 'local', tried, issues };
  }
  return { plan: withNote({ intent: 'unsupported', steps: [], reply: FALLBACK_REPLY }), source: 'local', tried, issues };
}

function noteIssue(tier: Planner, issues: TierIssue[]) {
  const issue = tier.issue?.();
  if (issue && !issues.includes(issue)) issues.push(issue);
}
