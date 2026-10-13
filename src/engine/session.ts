// One opened photo: the decoded original, its analysis (people, faces, stats) and
// the masks derived from it. Rendering always starts from `source`.
import type { SkImage } from '@shopify/react-native-skia';

import type { Region } from '../edits/catalog';
import { describeStep, type ImageContext } from '../edits/schema';
import type { Face } from '../ml/blazeface';
import { detectFaces, segmentPeople } from '../ml/models';
import type { Segmentation } from '../ml/segmentationMath';
import type { EditStep } from '../state/editStack';
import { measurePhoto, type PhotoStats } from './analyze';
import { disposeAll, resample, toRaster } from './gpu';
import { MaskStore } from './masks';
import { fitSize, renderPhoto, renderSelectionOverlay } from './render';

/** Long edge of the on-screen preview render. */
export const PREVIEW_EDGE = 1280;
/** Long edge of the image the masks and models are computed from. */
const ANALYSIS_EDGE = 512;

export type AnalysisState = 'pending' | 'ready' | 'limited';

export class PhotoSession {
  readonly previewSize: { width: number; height: number };
  readonly seed = Math.floor(Math.random() * 1000);
  analysis: AnalysisState = 'pending';
  stats: PhotoStats;
  faces: Face[] = [];
  segmentation: Segmentation | null = null;
  masks: MaskStore;
  private readonly base: SkImage;

  constructor(readonly source: SkImage) {
    this.previewSize = fitSize(source.width(), source.height(), PREVIEW_EDGE);
    const small = fitSize(source.width(), source.height(), ANALYSIS_EDGE);
    // Raster (CPU) copy: it is drawn onto both GPU surfaces (masks) and CPU
    // surfaces (model input, stats), and a GPU texture can't be read by the latter.
    const gpuBase = resample(source, small.width, small.height);
    this.base = toRaster(gpuBase);
    if (this.base !== gpuBase) disposeAll(gpuBase);
    this.stats = measurePhoto(this.base);
    this.masks = new MaskStore({ base: this.base, meanLuma: this.stats.brightness });
  }

  /**
   * Run the person segmenter and face detector, then rebuild masks. Each model
   * is independent: if one fails, the other's regions are still offered.
   */
  async analyze(): Promise<void> {
    const [segmentation, faces] = await Promise.allSettled([segmentPeople(this.base), detectFaces(this.base)]);
    if (segmentation.status === 'fulfilled') {
      this.segmentation = segmentation.value;
      this.stats = measurePhoto(this.base, segmentation.value);
    } else if (__DEV__) {
      console.warn('[analysis] person segmenter failed', segmentation.reason);
    }
    if (faces.status === 'fulfilled') this.faces = faces.value;
    else if (__DEV__) console.warn('[analysis] face detector failed', faces.reason);
    this.analysis = segmentation.status === 'fulfilled' && faces.status === 'fulfilled' ? 'ready' : 'limited';
    this.masks.dispose();
    this.masks = new MaskStore({
      base: this.base,
      meanLuma: this.stats.brightness,
      segmentation: this.segmentation,
      faces: this.faces,
    });
  }

  availableRegions(): Region[] {
    return this.masks.availableRegions();
  }

  context(steps: readonly EditStep[]): ImageContext {
    return {
      regions: this.availableRegions(),
      faces: this.faces.length,
      stats: {
        brightness: round(this.stats.brightness),
        contrast: round(this.stats.contrast),
        saturation: round(this.stats.saturation),
        warmth: round(this.stats.warmth),
        faceBrightness: optRound(this.stats.faceBrightness),
        backgroundBrightness: optRound(this.stats.backgroundBrightness),
      },
      history: steps.filter((s) => s.enabled).map(describeStep).slice(-30),
    };
  }

  /** Screen-sized render, copied to CPU memory for the UI-thread canvas. */
  renderPreview(steps: readonly EditStep[]): SkImage {
    const gpu = renderPhoto(this.source, steps, this.masks, { ...this.previewSize, seed: this.seed });
    const raster = toRaster(gpu);
    if (raster !== gpu) disposeAll(gpu);
    return raster;
  }

  /** Full-resolution render for saving/sharing. */
  renderFull(steps: readonly EditStep[]): SkImage {
    return renderPhoto(this.source, steps, this.masks, {
      width: this.source.width(),
      height: this.source.height(),
      seed: this.seed,
    });
  }

  selectionOverlay(region: Region, invert: boolean): SkImage | null {
    const mask = this.masks.get(region, invert);
    if (mask === undefined) return null;
    const gpu = renderSelectionOverlay(mask, this.previewSize.width, this.previewSize.height);
    const raster = toRaster(gpu);
    if (raster !== gpu) disposeAll(gpu);
    return raster;
  }

  dispose() {
    this.masks.dispose();
    disposeAll(this.base);
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
const optRound = (v: number | undefined) => (v === undefined ? undefined : round(v));
