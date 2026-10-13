import { ADJUSTMENT_INFO, REGION_INFO } from '../edits/catalog';
import type { PlanSource } from '../edits/schema';
import type { EditStep } from '../state/editStack';

export function formatAmount(amount: number): string {
  const v = Math.round(amount * 100);
  return v > 0 ? `+${v}` : `${v}`;
}

export function stepTitle(step: Pick<EditStep, 'adjustment' | 'region' | 'invert'>): string {
  const region = REGION_INFO[step.region].label;
  const where = step.region === 'all' ? '' : step.invert ? `All but ${region.toLowerCase()} · ` : `${region} · `;
  return `${where}${ADJUSTMENT_INFO[step.adjustment].label}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(then: number, now = Date.now()): string {
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export const SOURCE_LABEL: Record<PlanSource, string> = {
  local: 'on this phone',
  'on-device-ai': 'on-device AI',
  cloud: 'cloud AI',
  manual: 'manual',
  auto: 'auto',
};
