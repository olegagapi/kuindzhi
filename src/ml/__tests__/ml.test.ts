import { readFileSync } from 'fs';
import { join } from 'path';

import { blazeFaceAnchors, decodeFaces, iou, nonMaxSuppression, type Face } from '../blazeface';
import { letterboxRect, rgbaToSignedTensor } from '../letterbox';
import { decodeSegmentation, SEG_CLASSES } from '../segmentationMath';

const fixtures = join(__dirname, '..', '__fixtures__');

function readF32(name: string): Float32Array {
  const buf = readFileSync(join(fixtures, name));
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe('letterbox', () => {
  it('fits landscape images centred vertically', () => {
    expect(letterboxRect(1920, 1285, 128)).toEqual({ size: 128, x: 0, y: 21, width: 128, height: 86 });
  });

  it('fits portrait images centred horizontally', () => {
    expect(letterboxRect(1000, 2000, 256)).toEqual({ size: 256, x: 64, y: 0, width: 128, height: 256 });
  });

  it('maps bytes to [-1, 1] and drops alpha', () => {
    const t = rgbaToSignedTensor(Uint8Array.from([0, 255, 127.5, 255]), 1);
    expect(Array.from(t)).toEqual([-1, 1, expect.closeTo(0, 1)]);
  });
});

describe('BlazeFace decoding (real model output for girl.jpg)', () => {
  const meta = JSON.parse(readFileSync(join(fixtures, 'girl_blazeface.json'), 'utf8'));
  const faces = decodeFaces(
    readF32('girl_blazeface_regressors.f32'),
    readF32('girl_blazeface_classificators.f32'),
    meta.rect,
  );
  const [imgW, imgH] = meta.image;

  it('has 896 anchors', () => {
    expect(blazeFaceAnchors().length).toBe(896 * 2);
  });

  it('finds exactly one face after NMS', () => {
    expect(faces).toHaveLength(1);
    expect(faces[0].score).toBeGreaterThan(0.8);
  });

  it('matches the box decoded offline with the reference implementation', () => {
    const f = faces[0];
    const cx = (f.box.x + f.box.w / 2) * imgW;
    const cy = (f.box.y + f.box.h / 2) * imgH;
    expect(Math.abs(cx - meta.expected.centerPx[0])).toBeLessThan(20);
    expect(Math.abs(cy - meta.expected.centerPx[1])).toBeLessThan(20);
    expect(Math.abs(f.box.w * imgW - meta.expected.sizePx)).toBeLessThan(30);
  });

  it('places the eyes above the mouth and inside the box', () => {
    const [rightEye, leftEye, , mouth] = faces[0].keypoints;
    expect(rightEye.y).toBeLessThan(mouth.y);
    expect(leftEye.y).toBeLessThan(mouth.y);
    expect(rightEye.x).toBeLessThan(leftEye.x); // subject's right eye is on image left
    for (const p of faces[0].keypoints.slice(0, 4)) {
      expect(p.x).toBeGreaterThan(faces[0].box.x);
      expect(p.x).toBeLessThan(faces[0].box.x + faces[0].box.w);
    }
  });
});

describe('NMS', () => {
  const face = (x: number, score: number): Face => ({
    score,
    box: { x, y: 0, w: 0.2, h: 0.2 },
    keypoints: Array.from({ length: 6 }, () => ({ x, y: 0 })),
  });

  it('merges overlapping boxes and keeps separate ones', () => {
    const kept = nonMaxSuppression([face(0.1, 0.9), face(0.11, 0.8), face(0.6, 0.7)], 0.3);
    expect(kept).toHaveLength(2);
    expect(kept[0].box.x).toBeGreaterThan(0.1);
    expect(kept[0].box.x).toBeLessThan(0.11);
  });

  it('computes IoU', () => {
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBe(0);
  });
});

describe('segmentation decoding', () => {
  it('applies softmax per pixel and crops the letterbox padding', () => {
    const size = 4;
    const rect = { size, x: 0, y: 1, width: 4, height: 2 };
    const logits = new Float32Array(size * size * SEG_CLASSES.length);
    // Row 1 is all face-skin, row 2 all background; padding rows hair.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cls = y === 1 ? 3 : y === 2 ? 0 : 1;
        logits[(y * size + x) * 6 + cls] = 10;
      }
    }
    const seg = decodeSegmentation(logits, rect);
    expect(seg.width).toBe(4);
    expect(seg.height).toBe(2);
    expect(seg.planes.faceSkin[0]).toBeGreaterThan(0.99);
    expect(seg.planes.background[4]).toBeGreaterThan(0.99);
    expect(Math.max(...seg.planes.hair)).toBeLessThan(0.01);
    const sum = SEG_CLASSES.reduce((s, c) => s + seg.planes[c][5], 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
