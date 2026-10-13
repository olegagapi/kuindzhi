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

export const SOURCE_LABEL: Record<PlanSource, string> = {
  local: 'on this phone',
  'on-device-ai': 'on-device AI',
  cloud: 'cloud AI',
  manual: 'manual',
  auto: 'auto',
};
