/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
// Prints the response curve of one adjustment, rendered through the real ADJUST_SKSL
// in CanvasKit. Not part of `npm test` (the name doesn't match *.test.ts); run it with
// .claude/skills/engine-change/scripts/curve.sh <adjustment> [amount ...]
import '@shopify/react-native-skia/jestSetup.js';
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

import { ADJUSTMENT_INFO, ADJUSTMENTS, type Adjustment } from '../../../../src/edits/catalog';
import { readRGBA } from '../../../../src/engine/gpu';
import { MaskStore } from '../../../../src/engine/masks';
import { renderPhoto } from '../../../../src/engine/render';

const out = (line = '') => process.stdout.write(`${line}\n`);

function strip(pixels: number[][]): SkImage {
  const bytes = new Uint8Array(pixels.length * 4);
  pixels.forEach((p, i) => bytes.set([p[0], p[1], p[2], 255], i * 4));
  return Skia.Image.MakeImage(
    { width: pixels.length, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(bytes),
    pixels.length * 4,
  )!;
}

function render(src: SkImage, adjustment: Adjustment, amount: number): number[][] {
  const masks = new MaskStore({ base: src, meanLuma: 0.5, cpu: true });
  const step = { adjustment, amount, region: 'all' as const, invert: false, enabled: true };
  const rgba = readRGBA(renderPhoto(src, [step], masks, { width: src.width(), height: 1, cpu: true }));
  return Array.from({ length: src.width() }, (_, x) => [rgba[x * 4], rgba[x * 4 + 1], rgba[x * 4 + 2]]);
}

function hsvToRgb(h: number, s: number, v: number): number[] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const fmt = (c: number[]) => c.map((v) => String(v).padStart(3)).join(' ');

it('prints the curve', () => {
  const adjustment = process.env.CURVE_ADJ as Adjustment;
  if (!ADJUSTMENTS.includes(adjustment)) throw new Error(`CURVE_ADJ must be one of: ${ADJUSTMENTS.join(', ')}`);
  const info = ADJUSTMENT_INFO[adjustment];
  const amounts = process.env.CURVE_AMOUNTS
    ? process.env.CURVE_AMOUNTS.split(',').map(Number)
    : [...new Set([info.min, info.min / 2, info.step * (info.min < 0 ? -1 : 0), info.step, info.max / 2, info.max])].filter(
        (a) => a !== 0,
      );
  if (info.needsBlur) out(`note: ${adjustment} depends on neighbouring pixels; a 1-px strip only shows its tonal part.`);

  const grey = strip(Array.from({ length: 256 }, (_, x) => [x, x, x]));
  const hues = strip(Array.from({ length: 12 }, (_, i) => hsvToRgb(i * 30, 0.6, 0.75)));
  const probes = [0, 32, 64, 96, 128, 160, 192, 224, 255];

  for (const amount of amounts) {
    const g = render(grey, adjustment, amount);
    const l = g.map(luma);
    const down = l.flatMap((v, x) => (x > 0 && v < l[x - 1] - 0.5 ? [x] : []));
    const cast = Math.max(...g.map((c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])));
    out(`\n${adjustment} ${amount >= 0 ? '+' : ''}${amount}`);
    out(`  grey in : ${probes.map((p) => String(p).padStart(4)).join('')}`);
    out(`  grey out: ${probes.map((p) => String(Math.round(l[p])).padStart(4)).join('')}`);
    out(
      down.length
        ? `  TONE ORDER BROKEN: output falls at ${down.length} inputs (first at ${down[0]}); peak ${Math.round(Math.max(...l))} at input ${l.indexOf(Math.max(...l))}`
        : '  tone order kept (monotonic)',
    );
    out(`  max colour cast on greys: ${cast} levels`);
    const h = render(hues, adjustment, amount);
    out('  hue   in (S .6 V .75)   out         luma change');
    h.forEach((c, i) => {
      const src = hsvToRgb(i * 30, 0.6, 0.75);
      out(`  ${String(i * 30).padStart(3)}°  ${fmt(src)}  ->  ${fmt(c)}   ${(luma(c) - luma(src)).toFixed(1).padStart(6)}`);
    });
  }
});
