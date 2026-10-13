// The vocabulary shared by every planner (local parser, on-device LLM, cloud LLM)
// and the render engine. Pure data: this file is also bundled into the
// Cloudflare Worker, so it must not import React Native code.

export const ADJUSTMENTS = [
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'saturation',
  'vibrance',
  'temperature',
  'tint',
  'hue',
  'clarity',
  'dehaze',
  'sharpen',
  'blur',
  'smooth',
  'vignette',
  'grain',
  'fade',
  'monochrome',
  'sepia',
] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];

export const REGIONS = [
  'all',
  // Semantic (person segmentation model)
  'person',
  'background',
  'face',
  'skin',
  'hair',
  'clothes',
  // Face keypoints (face detector)
  'eyes',
  'mouth',
  // Procedural
  'sky',
  // Tonal (luminosity masks)
  'shadow-areas',
  'midtone-areas',
  'highlight-areas',
  // Colour ranges
  'reds',
  'oranges',
  'yellows',
  'greens',
  'aquas',
  'blues',
  'purples',
  'magentas',
  // Geometric gradients
  'top',
  'bottom',
  'left',
  'right',
  'center',
  'edges',
] as const;
export type Region = (typeof REGIONS)[number];

export type RegionKind = 'global' | 'semantic' | 'face' | 'procedural' | 'tonal' | 'color' | 'geometric';

export interface AdjustmentInfo {
  label: string;
  /** What amount = +1 / -1 means. Shown to LLM planners. */
  describe: string;
  min: number;
  max: number;
  /** Amount for a plain request like "warmer" (no intensity words). */
  step: number;
  /** Rendering needs a blurred copy of the current image. */
  needsBlur?: boolean;
}

export const ADJUSTMENT_INFO: Record<Adjustment, AdjustmentInfo> = {
  exposure: { label: 'Exposure', describe: 'light level, +1 = +2 stops brighter, -1 = 2 stops darker (highlights roll off softly)', min: -1, max: 1, step: 0.3 },
  brightness: { label: 'Brightness', describe: 'midtone brightness that keeps pure blacks and whites', min: -1, max: 1, step: 0.3 },
  contrast: { label: 'Contrast', describe: '+ = punchier S-curve, - = flatter', min: -1, max: 1, step: 0.25 },
  highlights: { label: 'Highlights', describe: '- = recover/tone down bright areas, + = brighten them', min: -1, max: 1, step: 0.35 },
  shadows: { label: 'Shadows', describe: '+ = lift/open dark areas, - = deepen them', min: -1, max: 1, step: 0.35 },
  whites: { label: 'Whites', describe: 'white point, + = brighter whites', min: -1, max: 1, step: 0.25 },
  blacks: { label: 'Blacks', describe: 'black point, - = deeper blacks, + = lifted blacks', min: -1, max: 1, step: 0.25 },
  saturation: { label: 'Saturation', describe: 'colour intensity, -1 = grey, +1 = double', min: -1, max: 1, step: 0.25 },
  vibrance: { label: 'Vibrance', describe: 'smart saturation that boosts muted colours and protects skin', min: -1, max: 1, step: 0.35 },
  temperature: { label: 'Temperature', describe: '+ = warmer/yellow, - = cooler/blue', min: -1, max: 1, step: 0.25 },
  tint: { label: 'Tint', describe: '+ = magenta, - = green', min: -1, max: 1, step: 0.2 },
  hue: { label: 'Hue', describe: 'rotate hues, ±1 = ±180 degrees; ±0.1 is a noticeable shift', min: -1, max: 1, step: 0.08 },
  clarity: { label: 'Clarity', describe: 'local midtone contrast, + = crisp texture, - = soft/dreamy', min: -1, max: 1, step: 0.35, needsBlur: true },
  dehaze: { label: 'Dehaze', describe: '+ = remove haze/fog, - = add atmosphere', min: -1, max: 1, step: 0.35, needsBlur: true },
  sharpen: { label: 'Sharpen', describe: 'edge sharpening (unsharp mask), 0..1', min: 0, max: 1, step: 0.4, needsBlur: true },
  blur: { label: 'Blur', describe: 'lens-style blur, 0..1, 1 = very strong (good for background)', min: 0, max: 1, step: 0.5, needsBlur: true },
  smooth: { label: 'Smooth', describe: 'edge-preserving skin smoothing/retouch, 0..1', min: 0, max: 1, step: 0.5, needsBlur: true },
  vignette: { label: 'Vignette', describe: '+ = darken frame edges, - = lighten them', min: -1, max: 1, step: 0.4 },
  grain: { label: 'Grain', describe: 'film grain, 0..1', min: 0, max: 1, step: 0.35 },
  fade: { label: 'Fade', describe: 'matte/faded film look (lifted blacks), 0..1', min: 0, max: 1, step: 0.35 },
  monochrome: { label: 'Black & White', describe: 'black-and-white mix, 0..1 (1 = fully B&W)', min: 0, max: 1, step: 1 },
  sepia: { label: 'Sepia', describe: 'sepia toning, 0..1', min: 0, max: 1, step: 0.6 },
};

export interface RegionInfo {
  label: string;
  describe: string;
  kind: RegionKind;
}

export const REGION_INFO: Record<Region, RegionInfo> = {
  all: { label: 'Photo', describe: 'the whole photo', kind: 'global' },
  person: { label: 'People', describe: 'all people (subject) incl. hair and clothes', kind: 'semantic' },
  background: { label: 'Background', describe: 'everything that is not a person', kind: 'semantic' },
  face: { label: 'Face', describe: 'facial skin', kind: 'semantic' },
  skin: { label: 'Skin', describe: 'face and body skin', kind: 'semantic' },
  hair: { label: 'Hair', describe: 'hair', kind: 'semantic' },
  clothes: { label: 'Clothes', describe: 'clothing', kind: 'semantic' },
  eyes: { label: 'Eyes', describe: 'eye areas of detected faces', kind: 'face' },
  mouth: { label: 'Mouth', describe: 'mouth/teeth area of detected faces', kind: 'face' },
  sky: { label: 'Sky', describe: 'sky (detected from colour and position)', kind: 'procedural' },
  'shadow-areas': { label: 'Dark areas', describe: 'dark tones of the photo', kind: 'tonal' },
  'midtone-areas': { label: 'Midtones', describe: 'middle tones of the photo', kind: 'tonal' },
  'highlight-areas': { label: 'Bright areas', describe: 'bright tones of the photo', kind: 'tonal' },
  reds: { label: 'Reds', describe: 'red colours', kind: 'color' },
  oranges: { label: 'Oranges', describe: 'orange colours (incl. most skin tones)', kind: 'color' },
  yellows: { label: 'Yellows', describe: 'yellow colours', kind: 'color' },
  greens: { label: 'Greens', describe: 'green colours (foliage, grass)', kind: 'color' },
  aquas: { label: 'Aquas', describe: 'aqua/cyan colours (sea, pools)', kind: 'color' },
  blues: { label: 'Blues', describe: 'blue colours (sky, water)', kind: 'color' },
  purples: { label: 'Purples', describe: 'purple colours', kind: 'color' },
  magentas: { label: 'Magentas', describe: 'magenta/pink colours', kind: 'color' },
  top: { label: 'Top', describe: 'upper part, fading towards the middle (graduated filter)', kind: 'geometric' },
  bottom: { label: 'Bottom', describe: 'lower part, fading towards the middle', kind: 'geometric' },
  left: { label: 'Left', describe: 'left side, fading towards the middle', kind: 'geometric' },
  right: { label: 'Right', describe: 'right side, fading towards the middle', kind: 'geometric' },
  center: { label: 'Center', describe: 'the centre, fading towards the edges', kind: 'geometric' },
  edges: { label: 'Edges', describe: 'the frame edges, fading towards the centre', kind: 'geometric' },
};

/** Regions that always exist, regardless of what the photo contains. */
export const ALWAYS_AVAILABLE_REGIONS: Region[] = REGIONS.filter((r) => {
  const kind = REGION_INFO[r].kind;
  return kind === 'global' || kind === 'tonal' || kind === 'color' || kind === 'geometric';
});

export function clampAmount(adjustment: Adjustment, amount: number): number {
  const { min, max } = ADJUSTMENT_INFO[adjustment];
  if (!Number.isFinite(amount)) return 0;
  return Math.min(max, Math.max(min, amount));
}
