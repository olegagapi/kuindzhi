// Post-processing for MediaPipe's selfie_multiclass_256x256 model.
// Output: [1, 256, 256, 6] logits for background, hair, body-skin, face-skin,
// clothes, others (labels.txt inside the .tflite).
import type { LetterboxRect } from './letterbox';

export const SEG_CLASSES = ['background', 'hair', 'bodySkin', 'faceSkin', 'clothes', 'others'] as const;
export type SegClass = (typeof SEG_CLASSES)[number];

export interface Segmentation {
  /** Plane size = the letterbox content rect (image aspect ratio). */
  width: number;
  height: number;
  /** Per-class probabilities, row-major, width * height each. */
  planes: Record<SegClass, Float32Array>;
}

/** Softmax per pixel and crop away the letterbox padding. */
export function decodeSegmentation(logits: Float32Array, rect: LetterboxRect): Segmentation {
  const { size, x: ox, y: oy, width, height } = rect;
  const classes = SEG_CLASSES.length;
  if (logits.length !== size * size * classes) {
    throw new Error(`Unexpected segmentation output length ${logits.length}`);
  }
  const planes = Object.fromEntries(SEG_CLASSES.map((c) => [c, new Float32Array(width * height)])) as Record<
    SegClass,
    Float32Array
  >;
  const arrays = SEG_CLASSES.map((c) => planes[c]);
  const exps = new Float64Array(classes);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = ((y + oy) * size + (x + ox)) * classes;
      let max = -Infinity;
      for (let k = 0; k < classes; k++) max = Math.max(max, logits[base + k]);
      let sum = 0;
      for (let k = 0; k < classes; k++) {
        exps[k] = Math.exp(logits[base + k] - max);
        sum += exps[k];
      }
      const o = y * width + x;
      for (let k = 0; k < classes; k++) arrays[k][o] = exps[k] / sum;
    }
  }
  return { width, height, planes };
}

/** Mean of `values` (an RGB-derived plane) weighted by a class plane. */
export function weightedMean(values: Float32Array, weights: Float32Array): number | undefined {
  let s = 0;
  let w = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i] * weights[i];
    w += weights[i];
  }
  return w > values.length * 0.003 ? s / w : undefined;
}
