// Region → mask image. Masks are grayscale images at "analysis" resolution
// (≤ 512 px, or the model's grid for semantic regions); the render pass stretches
// them to the output size with bilinear filtering, so one mask serves both the
// on-screen preview and the full-resolution export.
import { Skia, type SkImage } from '@shopify/react-native-skia';

import { REGION_INFO, type Region } from '../edits/catalog';
import type { Face } from '../ml/blazeface';
import type { Segmentation } from '../ml/segmentationMath';
import {
  blurImage,
  disposeAll,
  imageFromPlane,
  makeSurface,
  shaderPass,
  solidShader,
  stretchShader,
} from './gpu';
import { INVERT_SKSL, MASK_KIND, MASK_SKSL, SKY_SKSL } from './shaders';

const HUE_BANDS: Partial<Record<Region, { center: number; width: number }>> = {
  reds: { center: 0, width: 0.083 },
  oranges: { center: 0.083, width: 0.075 },
  yellows: { center: 0.16, width: 0.08 },
  greens: { center: 0.333, width: 0.13 },
  aquas: { center: 0.5, width: 0.1 },
  blues: { center: 0.62, width: 0.1 },
  purples: { center: 0.75, width: 0.09 },
  magentas: { center: 0.87, width: 0.09 },
};

const GEOMETRIC_KIND: Partial<Record<Region, number>> = {
  top: MASK_KIND.top,
  bottom: MASK_KIND.bottom,
  left: MASK_KIND.left,
  right: MASK_KIND.right,
  center: MASK_KIND.center,
  edges: MASK_KIND.edges,
  'shadow-areas': MASK_KIND.shadowAreas,
  'midtone-areas': MASK_KIND.midtoneAreas,
  'highlight-areas': MASK_KIND.highlightAreas,
};

/** Minimum mean coverage for a semantic region to count as present. */
const MIN_COVERAGE = 0.003;

export interface MaskStoreInput {
  /** The original photo downscaled to ≤ 512 px (mask base resolution). */
  base: SkImage;
  /** Mean luma of the photo, 0..1 (used by the sky detector). */
  meanLuma: number;
  segmentation?: Segmentation | null;
  faces?: Face[];
  cpu?: boolean;
}

export class MaskStore {
  private cache = new Map<string, SkImage>();
  private readonly coverage = new Map<Region, number>();

  constructor(private readonly input: MaskStoreInput) {
    const seg = input.segmentation;
    if (seg) {
      for (const region of ['person', 'background', 'face', 'skin', 'hair', 'clothes'] as const) {
        this.coverage.set(region, mean(semanticPlane(seg, region)));
      }
    }
  }

  get faces(): Face[] {
    return this.input.faces ?? [];
  }

  availableRegions(): Region[] {
    return (Object.keys(REGION_INFO) as Region[]).filter((r) => this.isAvailable(r));
  }

  isAvailable(region: Region): boolean {
    const kind = REGION_INFO[region].kind;
    if (kind === 'semantic') {
      if (region === 'face' && this.faces.length > 0) return true;
      return (this.coverage.get(region) ?? 0) > MIN_COVERAGE;
    }
    if (kind === 'face') return this.faces.length > 0;
    return true;
  }

  /**
   * The mask for a region: `null` means "whole photo" (no mask needed),
   * `undefined` means the region isn't present in this photo.
   */
  get(region: Region, invert = false): SkImage | null | undefined {
    if (region === 'all') return invert ? undefined : null;
    if (!this.isAvailable(region)) return undefined;
    const key = `${region}|${invert ? 1 : 0}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let mask: SkImage;
    if (invert) {
      const plain = this.get(region, false);
      if (!plain) return undefined;
      mask = shaderPass(INVERT_SKSL, {}, [stretchShader(plain, plain.width(), plain.height())], plain.width(), plain.height(), this.input.cpu);
    } else {
      mask = this.build(region);
    }
    this.cache.set(key, mask);
    return mask;
  }

  dispose() {
    disposeAll(...this.cache.values());
    this.cache.clear();
  }

  private build(region: Region): SkImage {
    const { base, cpu } = this.input;
    const w = base.width();
    const h = base.height();
    const kind = REGION_INFO[region].kind;

    if (kind === 'semantic') {
      if (region === 'face' && (this.coverage.get('face') ?? 0) <= MIN_COVERAGE) {
        return this.faceEllipses(region);
      }
      const seg = this.input.segmentation!;
      const raw = imageFromPlane(semanticPlane(seg, region), seg.width, seg.height);
      // Feather the low-res model output slightly so edges don't look blocky.
      const soft = blurImage(raw, 0.8, cpu);
      disposeAll(raw);
      return soft;
    }
    if (kind === 'face') return this.faceEllipses(region);
    if (region === 'sky') return this.sky();

    const band = HUE_BANDS[region];
    const maskKind = band ? MASK_KIND.colorBand : GEOMETRIC_KIND[region];
    if (maskKind === undefined) throw new Error(`No mask builder for ${region}`);
    return shaderPass(
      MASK_SKSL,
      { kind: maskKind, hueCenter: band?.center ?? 0, hueWidth: band?.width ?? 0.1, size: [w, h] },
      [stretchShader(base, w, h)],
      w,
      h,
      cpu,
    );
  }

  private sky(): SkImage {
    const { base, cpu, meanLuma } = this.input;
    const w = base.width();
    const h = base.height();
    const blurred = blurImage(base, Math.max(1.5, Math.hypot(w, h) * 0.004), cpu);
    const person = this.isAvailable('person') ? this.get('person') : null;
    const personShader = person ? stretchShader(person, w, h) : solidShader(0);
    const raw = shaderPass(
      SKY_SKSL,
      { meanLuma, size: [w, h] },
      [stretchShader(base, w, h), stretchShader(blurred, w, h), personShader],
      w,
      h,
      cpu,
    );
    const soft = blurImage(raw, Math.max(1, Math.hypot(w, h) * 0.004), cpu);
    disposeAll(blurred, raw);
    return soft;
  }

  /** Eyes / mouth (and the face fallback) as feathered ellipses from face keypoints. */
  private faceEllipses(region: Region): SkImage {
    const { base, cpu } = this.input;
    const w = base.width();
    const h = base.height();
    const surface = makeSurface(w, h, cpu);
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('black'));
    const paint = Skia.Paint();
    paint.setColor(Skia.Color('white'));
    let feather = 2;
    for (const face of this.faces) {
      const bw = face.box.w * w;
      const bh = face.box.h * h;
      const k = face.keypoints;
      const oval = (cx: number, cy: number, rx: number, ry: number) =>
        canvas.drawOval(Skia.XYWHRect(cx * w - rx, cy * h - ry, rx * 2, ry * 2), paint);
      if (region === 'eyes') {
        oval(k[0].x, k[0].y, 0.13 * bw, 0.08 * bw);
        oval(k[1].x, k[1].y, 0.13 * bw, 0.08 * bw);
        feather = Math.max(feather, 0.03 * bw);
      } else if (region === 'mouth') {
        oval(k[3].x, k[3].y, 0.2 * bw, 0.1 * bw);
        feather = Math.max(feather, 0.03 * bw);
      } else {
        oval(face.box.x + face.box.w / 2, face.box.y + face.box.h * 0.55, 0.42 * bw, 0.58 * bh);
        feather = Math.max(feather, 0.06 * bw);
      }
    }
    surface.flush();
    const raw = surface.makeImageSnapshot();
    const soft = blurImage(raw, feather, cpu);
    disposeAll(raw, surface);
    return soft;
  }
}

export function semanticPlane(seg: Segmentation, region: Region): Float32Array {
  const p = seg.planes;
  const n = seg.width * seg.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    switch (region) {
      case 'person':
        out[i] = 1 - p.background[i];
        break;
      case 'background':
        out[i] = p.background[i];
        break;
      case 'face':
        out[i] = p.faceSkin[i];
        break;
      case 'skin':
        out[i] = p.faceSkin[i] + p.bodySkin[i];
        break;
      case 'hair':
        out[i] = p.hair[i];
        break;
      case 'clothes':
        out[i] = p.clothes[i] + p.others[i];
        break;
      default:
        out[i] = 0;
    }
  }
  return out;
}

function mean(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}
