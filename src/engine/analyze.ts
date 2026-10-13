// Cheap global statistics measured on device. They drive "auto enhance" and are
// the only description of the photo an LLM planner ever sees (a few numbers,
// never pixels).
import type { SkImage } from '@shopify/react-native-skia';

import type { PlanStep } from '../edits/schema';
import type { Segmentation } from '../ml/segmentationMath';
import { disposeAll, readRGBA, resample } from './gpu';
import { semanticPlane } from './masks';

export interface PhotoStats {
  /** Mean luma 0..1 */
  brightness: number;
  /** Std-dev of luma, ~0..0.5 */
  contrast: number;
  /** Mean (max-min) chroma 0..1 */
  saturation: number;
  /** Mean (r - b), + warm / - cool */
  warmth: number;
  p05: number;
  p95: number;
  faceBrightness?: number;
  backgroundBrightness?: number;
}

const GRID = 64;

export function measurePhoto(image: SkImage, segmentation?: Segmentation | null, cpu = false): PhotoStats {
  const small = resample(image, GRID, GRID, true);
  const rgba = readRGBA(small);
  disposeAll(small);
  void cpu;

  const n = GRID * GRID;
  const lum = new Float32Array(n);
  let sumL = 0;
  let sumSat = 0;
  let sumWarm = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l;
    sumL += l;
    sumSat += Math.max(r, g, b) - Math.min(r, g, b);
    sumWarm += r - b;
  }
  const brightness = sumL / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (lum[i] - brightness) ** 2;
  const sorted = Float32Array.from(lum).sort();

  const stats: PhotoStats = {
    brightness,
    contrast: Math.sqrt(variance / n),
    saturation: sumSat / n,
    warmth: sumWarm / n,
    p05: sorted[Math.floor(n * 0.05)],
    p95: sorted[Math.floor(n * 0.95)],
  };

  if (segmentation) {
    stats.faceBrightness = regionMean(lum, semanticPlane(segmentation, 'face'), segmentation);
    stats.backgroundBrightness = regionMean(lum, semanticPlane(segmentation, 'background'), segmentation);
  }
  return stats;
}

/** Mean of the 64x64 luma grid weighted by a segmentation plane (nearest sampling). */
function regionMean(lum: Float32Array, plane: Float32Array, seg: Segmentation): number | undefined {
  let s = 0;
  let w = 0;
  for (let y = 0; y < GRID; y++) {
    const py = Math.min(seg.height - 1, Math.floor(((y + 0.5) / GRID) * seg.height));
    for (let x = 0; x < GRID; x++) {
      const px = Math.min(seg.width - 1, Math.floor(((x + 0.5) / GRID) * seg.width));
      const weight = plane[py * seg.width + px];
      s += lum[y * GRID + x] * weight;
      w += weight;
    }
  }
  return w > GRID * GRID * 0.005 ? s / w : undefined;
}

/** Deterministic "auto enhance", in the spirit of Lightroom's Auto. */
export function autoEnhance(stats: PhotoStats, faces: number): PlanStep[] {
  const steps: PlanStep[] = [];
  const add = (adjustment: PlanStep['adjustment'], amount: number, region: PlanStep['region'] = 'all') => {
    const rounded = Math.round(amount * 100) / 100;
    if (Math.abs(rounded) >= 0.05) steps.push({ adjustment, region, amount: rounded, invert: false });
  };

  const ev = Math.log2(0.46 / Math.max(stats.brightness, 0.04));
  add('exposure', clamp(ev * 0.35, -0.4, 0.45));
  if (stats.p95 > 0.96) add('highlights', -0.3);
  if (stats.p05 < 0.04) add('shadows', 0.25);
  if (stats.contrast < 0.16) add('contrast', 0.2);
  else if (stats.contrast > 0.3) add('contrast', -0.1);
  if (Math.abs(stats.warmth) > 0.04) add('temperature', clamp(-stats.warmth * 2.5, -0.3, 0.3));
  if (stats.saturation < 0.25) add('vibrance', 0.3);
  else if (stats.saturation < 0.4) add('vibrance', 0.15);
  add('clarity', 0.15);

  if (faces > 0 && stats.faceBrightness !== undefined && stats.faceBrightness < 0.42) {
    const darker = stats.backgroundBrightness !== undefined && stats.faceBrightness < stats.backgroundBrightness;
    add('exposure', clamp((0.5 - stats.faceBrightness) * (darker ? 1.4 : 1), 0.1, 0.45), 'face');
  }
  return steps;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
