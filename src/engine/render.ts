// The edit stack → pixels. Non-destructive: every render starts from the
// original, so preview (screen size) and export (full size) run the same code.
import type { SkImage, SkShader } from '@shopify/react-native-skia';

import { ADJUSTMENTS, ADJUSTMENT_INFO, type Adjustment, type Region } from '../edits/catalog';
import { hexToRgb01, palette } from '../ui/palette';
import { blurImage, disposeAll, resample, shaderPass, solidShader, stretchShader } from './gpu';
import type { MaskStore } from './masks';
import { ADJUST_SKSL, MASK_MULTIPLY_SKSL, OVERLAY_SKSL } from './shaders';

export interface RenderableStep {
  adjustment: Adjustment;
  region: Region;
  amount: number;
  invert: boolean;
  enabled: boolean;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** Grain seed, fixed per photo so re-renders don't shimmer. */
  seed?: number;
  /** Force CPU raster surfaces (tests). */
  cpu?: boolean;
}

/** Blur radius per adjustment, relative to the image diagonal so preview ≈ export. */
export function blurSigma(adjustment: Adjustment, amount: number, width: number, height: number): number {
  const d = Math.hypot(width, height);
  switch (adjustment) {
    case 'clarity':
      return d * 0.012;
    case 'dehaze':
      return d * 0.02;
    case 'sharpen':
      return Math.max(0.6, d * 0.0009);
    case 'blur':
      return Math.max(0.5, Math.abs(amount) * d * 0.012);
    case 'smooth':
      return Math.max(1, d * 0.0045);
    default:
      return 0;
  }
}

export function renderPhoto(
  source: SkImage,
  steps: readonly RenderableStep[],
  masks: MaskStore,
  { width, height, seed = 0, cpu = false }: RenderOptions,
): SkImage {
  let current = resample(source, width, height, cpu);

  for (const step of steps) {
    if (!step.enabled || step.amount === 0) continue;
    const mask = masks.get(step.region, step.invert);
    if (mask === undefined) continue; // region not present in this photo

    const maskShader: SkShader = mask ? stretchShader(mask, width, height) : solidShader(1);
    let blurred: SkImage | null = null;
    if (ADJUSTMENT_INFO[step.adjustment].needsBlur) {
      const sigma = blurSigma(step.adjustment, step.amount, width, height);
      const maskAware = mask && (step.adjustment === 'blur' || step.adjustment === 'smooth');
      if (maskAware) {
        // Normalized convolution: blur (image × mask) and divide by blurred mask
        // (the shader unpremultiplies), so a blurred background never smears the
        // subject's colours into it, and smoothing skin never pulls in hair.
        const weighted = shaderPass(
          MASK_MULTIPLY_SKSL,
          {},
          [stretchShader(current, width, height), maskShader],
          width,
          height,
          cpu,
        );
        blurred = blurImage(weighted, sigma, cpu);
        disposeAll(weighted);
      } else {
        blurred = blurImage(current, sigma, cpu);
      }
    }

    const imageShader = stretchShader(current, width, height);
    const next = shaderPass(
      ADJUST_SKSL,
      {
        op: ADJUSTMENTS.indexOf(step.adjustment),
        amount: step.amount,
        size: [width, height],
        seed,
      },
      [imageShader, maskShader, blurred ? stretchShader(blurred, width, height) : imageShader],
      width,
      height,
      cpu,
    );
    disposeAll(current, blurred);
    current = next;
  }
  return current;
}

const SELECTION_TINT = hexToRgb01(palette.accent);

/** Translucent overlay in the palette accent showing a region's selection. */
export function renderSelectionOverlay(
  mask: SkImage | null,
  width: number,
  height: number,
  cpu = false,
  tint: readonly number[] = SELECTION_TINT,
): SkImage {
  return shaderPass(OVERLAY_SKSL, { tint }, [mask ? stretchShader(mask, width, height) : solidShader(1)], width, height, cpu);
}

/** Fit an image's aspect ratio inside a long-edge budget. */
export function fitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
