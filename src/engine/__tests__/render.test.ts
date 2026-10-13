/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
import '@shopify/react-native-skia/jestSetup.js';
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

import { ADJUSTMENTS, ADJUSTMENT_INFO, type Adjustment, type Region } from '../../edits/catalog';
import { SEG_CLASSES, type Segmentation } from '../../ml/segmentationMath';
import { autoEnhance, measurePhoto } from '../analyze';
import { readRGBA } from '../gpu';
import { MaskStore } from '../masks';
import { fitSize, renderPhoto, renderSelectionOverlay, type RenderableStep } from '../render';

const W = 48;
const H = 32;

/** Horizontal grey ramp with a coloured band, so every op has something to act on. */
function testImage(): SkImage {
  const bytes = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ramp = Math.round(20 + (215 * x) / (W - 1));
      const [r, g, b] = y >= H - 8 ? [200, 120, 60] : [ramp, ramp, ramp];
      bytes.set([r, g, b, 255], i);
    }
  }
  return Skia.Image.MakeImage(
    { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(bytes),
    W * 4,
  )!;
}

const step = (adjustment: Adjustment, amount: number, region: Region = 'all', invert = false): RenderableStep => ({
  adjustment,
  amount,
  region,
  invert,
  enabled: true,
});

function render(steps: RenderableStep[], masks = new MaskStore({ base: source, meanLuma: 0.5, cpu: true })) {
  return readRGBA(renderPhoto(source, steps, masks, { width: W, height: H, cpu: true }));
}

function meanOf(px: Uint8Array, channel: number, x0 = 0, x1 = W, y0 = 0, y1 = H) {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      s += px[(y * W + x) * 4 + channel];
      n++;
    }
  }
  return s / n;
}
const lumaOf = (px: Uint8Array, x0?: number, x1?: number, y0?: number, y1?: number) =>
  0.2126 * meanOf(px, 0, x0, x1, y0, y1) + 0.7152 * meanOf(px, 1, x0, x1, y0, y1) + 0.0722 * meanOf(px, 2, x0, x1, y0, y1);

let source: SkImage;
let original: Uint8Array;

beforeAll(() => {
  source = testImage();
  original = readRGBA(source);
});

describe('renderPhoto', () => {
  it('is the identity with no steps', () => {
    const out = render([]);
    for (let i = 0; i < out.length; i++) expect(Math.abs(out[i] - original[i])).toBeLessThanOrEqual(1);
  });

  it('ignores disabled and zero steps', () => {
    const out = render([{ ...step('exposure', 0.8), enabled: false }, step('contrast', 0)]);
    expect(lumaOf(out)).toBeCloseTo(lumaOf(original), 0);
  });

  it.each(ADJUSTMENTS)('%s renders finite, changed pixels', (adjustment) => {
    const info = ADJUSTMENT_INFO[adjustment];
    const out = render([step(adjustment, info.max)]);
    let diff = 0;
    for (let i = 0; i < out.length; i++) diff += Math.abs(out[i] - original[i]);
    expect(diff).toBeGreaterThan(0);
  });

  it('exposure brightens and darkens', () => {
    expect(lumaOf(render([step('exposure', 0.5)]))).toBeGreaterThan(lumaOf(original) + 10);
    expect(lumaOf(render([step('exposure', -0.5)]))).toBeLessThan(lumaOf(original) - 10);
  });

  it('exposure rolls highlights off instead of clipping', () => {
    const out = render([step('exposure', 0.3)]);
    // the brightest columns stay below white and keep their order
    const brightest = meanOf(out, 1, W - 1, W, 0, 10);
    const nextBright = meanOf(out, 1, W - 8, W - 7, 0, 10);
    expect(brightest).toBeLessThan(255);
    expect(brightest).toBeGreaterThan(nextBright);
  });

  it('temperature warms and cools', () => {
    const warm = render([step('temperature', 0.6)]);
    const cool = render([step('temperature', -0.6)]);
    expect(meanOf(warm, 0) - meanOf(warm, 2)).toBeGreaterThan(meanOf(original, 0) - meanOf(original, 2) + 5);
    expect(meanOf(cool, 0) - meanOf(cool, 2)).toBeLessThan(meanOf(original, 0) - meanOf(original, 2) - 5);
  });

  it('monochrome removes colour', () => {
    const out = render([step('monochrome', 1)]);
    expect(Math.abs(meanOf(out, 0, 0, W, H - 8, H) - meanOf(out, 2, 0, W, H - 8, H))).toBeLessThan(2);
  });

  it('contrast changes the spread of tones', () => {
    const spread = (px: Uint8Array) => meanOf(px, 1, W - 6, W, 0, 10) - meanOf(px, 1, 0, 6, 0, 10);
    expect(spread(render([step('contrast', 0.8)]))).toBeGreaterThan(spread(original));
    expect(spread(render([step('contrast', -0.8)]))).toBeLessThan(spread(original));
  });

  it('a geometric region only changes its side of the frame', () => {
    const out = render([step('exposure', -0.8, 'left')]);
    expect(lumaOf(out, 0, 6, 0, 10)).toBeLessThan(lumaOf(original, 0, 6, 0, 10) - 2);
    expect(Math.abs(lumaOf(out, W - 6, W, 0, 10) - lumaOf(original, W - 6, W, 0, 10))).toBeLessThan(1);
  });

  it('invert flips the selection', () => {
    const out = render([step('exposure', -0.8, 'left', true)]);
    expect(Math.abs(lumaOf(out, 0, 4, 0, 10) - lumaOf(original, 0, 4, 0, 10))).toBeLessThan(2);
    expect(lumaOf(out, W - 6, W, 0, 10)).toBeLessThan(lumaOf(original, W - 6, W, 0, 10) - 10);
  });

  it('skips regions the photo does not have', () => {
    const out = render([step('blur', 1, 'background'), step('exposure', 1, 'eyes')]);
    expect(lumaOf(out)).toBeCloseTo(lumaOf(original), 0);
  });

  it('semantic regions follow the segmentation planes', () => {
    // Fake segmentation: top half face-skin, bottom half background.
    const sw = 12;
    const sh = 8;
    const planes = Object.fromEntries(SEG_CLASSES.map((c) => [c, new Float32Array(sw * sh)])) as Segmentation['planes'];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        (y < sh / 2 ? planes.faceSkin : planes.background)[y * sw + x] = 1;
      }
    }
    const masks = new MaskStore({ base: source, meanLuma: 0.5, segmentation: { width: sw, height: sh, planes }, cpu: true });
    expect(masks.isAvailable('face')).toBe(true);
    expect(masks.isAvailable('hair')).toBe(false);
    const out = render([step('exposure', 0.6, 'face')], masks);
    expect(lumaOf(out, 0, W, 0, 10)).toBeGreaterThan(lumaOf(original, 0, W, 0, 10) + 10);
    expect(Math.abs(lumaOf(out, 0, W, 22, 24) - lumaOf(original, 0, W, 22, 24))).toBeLessThan(3);
  });

  it('every region builds a mask', () => {
    const masks = new MaskStore({ base: source, meanLuma: 0.5, cpu: true });
    for (const region of masks.availableRegions()) {
      const m = masks.get(region);
      if (region === 'all') expect(m).toBeNull();
      else expect(m).toBeTruthy();
    }
  });

  it('renders the selection overlay', () => {
    const masks = new MaskStore({ base: source, meanLuma: 0.5, cpu: true });
    const overlay = readRGBA(renderSelectionOverlay(masks.get('left')!, W, H, true));
    expect(overlay[3]).toBeGreaterThan(overlay[(W - 1) * 4 + 3]);
  });
});

describe('analysis', () => {
  it('measures and auto-enhances a dark photo upward', () => {
    const stats = measurePhoto(source);
    expect(stats.brightness).toBeGreaterThan(0.2);
    expect(stats.brightness).toBeLessThan(0.8);
    const steps = autoEnhance({ ...stats, brightness: 0.15 }, 0);
    expect(steps.find((s) => s.adjustment === 'exposure')!.amount).toBeGreaterThan(0);
  });

  it('brightens a dark face relative to a bright background', () => {
    const steps = autoEnhance(
      { brightness: 0.6, contrast: 0.2, saturation: 0.3, warmth: 0, p05: 0.1, p95: 0.9, faceBrightness: 0.3, backgroundBrightness: 0.8 },
      1,
    );
    expect(steps).toContainEqual(expect.objectContaining({ adjustment: 'exposure', region: 'face' }));
  });

  it('fits sizes inside a long edge', () => {
    expect(fitSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
