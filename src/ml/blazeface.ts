// Decoder for MediaPipe's BlazeFace short-range model (128x128 input).
// Outputs: regressors [1, 896, 16] (box cx, cy, w, h + 6 keypoints, in input
// pixels relative to the anchor) and classificators [1, 896, 1] (logits).
// Anchor layout and keypoint order were verified against the real model offline.
import type { LetterboxRect } from './letterbox';

export interface Point {
  x: number;
  y: number;
}

export interface Face {
  score: number;
  /** Normalized to the original image (0..1). */
  box: { x: number; y: number; w: number; h: number };
  /** right eye, left eye, nose tip, mouth centre, right ear, left ear (subject's left/right). */
  keypoints: Point[];
}

const INPUT = 128;
const STRIDES = [8, 16, 16, 16];

let anchorCache: Float32Array | null = null;

/** SSD anchors: (x, y) centres in 0..1, 2 per cell per stride layer → 896. */
export function blazeFaceAnchors(): Float32Array {
  if (anchorCache) return anchorCache;
  const out: number[] = [];
  let i = 0;
  while (i < STRIDES.length) {
    const stride = STRIDES[i];
    let perCell = 0;
    while (i < STRIDES.length && STRIDES[i] === stride) {
      perCell += 2;
      i++;
    }
    const cells = Math.ceil(INPUT / stride);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        for (let k = 0; k < perCell; k++) out.push((x + 0.5) / cells, (y + 0.5) / cells);
      }
    }
  }
  anchorCache = Float32Array.from(out);
  return anchorCache;
}

export interface DecodeOptions {
  minScore?: number;
  iouThreshold?: number;
}

export function decodeFaces(
  regressors: Float32Array,
  classificators: Float32Array,
  rect: LetterboxRect,
  { minScore = 0.6, iouThreshold = 0.3 }: DecodeOptions = {},
): Face[] {
  const anchors = blazeFaceAnchors();
  const count = anchors.length / 2;
  const candidates: Face[] = [];
  // Letterbox space (0..1 of the model input) → original image space (0..1).
  const toImageX = (v: number) => (v * INPUT - rect.x) / rect.width;
  const toImageY = (v: number) => (v * INPUT - rect.y) / rect.height;

  for (let i = 0; i < count; i++) {
    const logit = Math.max(-100, Math.min(100, classificators[i]));
    const score = 1 / (1 + Math.exp(-logit));
    if (score < minScore) continue;
    const r = i * 16;
    const ax = anchors[i * 2];
    const ay = anchors[i * 2 + 1];
    const cx = regressors[r] / INPUT + ax;
    const cy = regressors[r + 1] / INPUT + ay;
    const w = regressors[r + 2] / INPUT;
    const h = regressors[r + 3] / INPUT;
    const keypoints: Point[] = [];
    for (let k = 0; k < 6; k++) {
      keypoints.push({
        x: toImageX(regressors[r + 4 + k * 2] / INPUT + ax),
        y: toImageY(regressors[r + 5 + k * 2] / INPUT + ay),
      });
    }
    const x0 = toImageX(cx - w / 2);
    const y0 = toImageY(cy - h / 2);
    candidates.push({
      score,
      box: { x: x0, y: y0, w: toImageX(cx + w / 2) - x0, h: toImageY(cy + h / 2) - y0 },
      keypoints,
    });
  }
  return nonMaxSuppression(candidates, iouThreshold);
}

/** Weighted NMS (as MediaPipe does): overlapping detections are averaged by score. */
export function nonMaxSuppression(faces: Face[], iouThreshold: number): Face[] {
  const remaining = [...faces].sort((a, b) => b.score - a.score);
  const kept: Face[] = [];
  while (remaining.length) {
    const best = remaining[0];
    const cluster = remaining.filter((f) => iou(f.box, best.box) > iouThreshold);
    for (const f of cluster) remaining.splice(remaining.indexOf(f), 1);
    const total = cluster.reduce((s, f) => s + f.score, 0);
    const avg = (pick: (f: Face) => number) => cluster.reduce((s, f) => s + pick(f) * f.score, 0) / total;
    kept.push({
      score: best.score,
      box: { x: avg((f) => f.box.x), y: avg((f) => f.box.y), w: avg((f) => f.box.w), h: avg((f) => f.box.h) },
      keypoints: best.keypoints.map((_, k) => ({ x: avg((f) => f.keypoints[k].x), y: avg((f) => f.keypoints[k].y) })),
    });
  }
  return kept;
}

export function iou(a: Face['box'], b: Face['box']): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
