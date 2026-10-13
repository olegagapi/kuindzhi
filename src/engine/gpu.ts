// Thin helpers over the imperative Skia API: offscreen surfaces, shader passes,
// blurs and uniform packing. Everything here runs on the JS thread; on device the
// surfaces are GPU-backed, in Jest they fall back to CanvasKit raster surfaces.
import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
  type SkRuntimeEffect,
  type SkShader,
  type SkSurface,
} from '@shopify/react-native-skia';

const effects = new Map<string, SkRuntimeEffect>();

export function getEffect(source: string): SkRuntimeEffect {
  let effect = effects.get(source);
  if (!effect) {
    const made = Skia.RuntimeEffect.Make(source);
    if (!made) throw new Error('SkSL failed to compile');
    effect = made;
    effects.set(source, effect);
  }
  return effect;
}

export function makeSurface(width: number, height: number, cpu = false): SkSurface {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const surface = (cpu ? null : Skia.Surface.MakeOffscreen(w, h)) ?? Skia.Surface.Make(w, h);
  if (!surface) throw new Error(`Could not allocate a ${w}x${h} surface`);
  return surface;
}

/** Pack named uniform values into the flat float array Skia expects. */
export function packUniforms(effect: SkRuntimeEffect, values: Record<string, number | readonly number[]>): number[] {
  const out = new Array<number>(effect.getUniformFloatCount()).fill(0);
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const u = effect.getUniform(i);
    const v = values[name];
    if (v === undefined) throw new Error(`Missing uniform "${name}"`);
    const arr = typeof v === 'number' ? [v] : v;
    for (let j = 0; j < u.columns * u.rows; j++) out[u.slot + j] = arr[j] ?? 0;
  }
  return out;
}

/** Shader sampling `image` stretched over a width x height output. */
export function stretchShader(image: SkImage, width: number, height: number, filter = FilterMode.Linear): SkShader {
  const sx = width / image.width();
  const sy = height / image.height();
  const matrix = Skia.Matrix().scale(sx, sy);
  return image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, filter, MipmapMode.None, matrix);
}

export function solidShader(value = 1): SkShader {
  const v = Math.round(value * 255);
  return Skia.Shader.MakeColor(Skia.Color(`rgb(${v},${v},${v})`));
}

/** Draw a full-surface shader pass and return the result. */
export function shaderPass(
  source: string,
  uniforms: Record<string, number | readonly number[]>,
  children: SkShader[],
  width: number,
  height: number,
  cpu = false,
): SkImage {
  const effect = getEffect(source);
  const shader = effect.makeShaderWithChildren(packUniforms(effect, uniforms), children);
  const surface = makeSurface(width, height, cpu);
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  const image = surface.makeImageSnapshot();
  disposeAll(surface);
  return image;
}

/** Resample an image to a new size (high-quality cubic for downscaling). */
export function resample(image: SkImage, width: number, height: number, cpu = false): SkImage {
  const surface = makeSurface(width, height, cpu);
  if (surface.width() === image.width() && surface.height() === image.height()) {
    // Mitchell isn't interpolating; a 1:1 copy must stay exact.
    surface.getCanvas().drawImage(image, 0, 0);
  } else {
    const src = Skia.XYWHRect(0, 0, image.width(), image.height());
    const dst = Skia.XYWHRect(0, 0, surface.width(), surface.height());
    surface.getCanvas().drawImageRectCubic(image, src, dst, 1 / 3, 1 / 3);
  }
  surface.flush();
  const out = surface.makeImageSnapshot();
  disposeAll(surface);
  return out;
}

/** Gaussian blur, edges clamped. */
export function blurImage(image: SkImage, sigma: number, cpu = false): SkImage {
  const surface = makeSurface(image.width(), image.height(), cpu);
  const paint = Skia.Paint();
  paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null));
  surface.getCanvas().drawImage(image, 0, 0, paint);
  surface.flush();
  const out = surface.makeImageSnapshot();
  disposeAll(surface);
  return out;
}

/** Build an RGBA image from a 0..1 grayscale plane. */
export function imageFromPlane(plane: Float32Array, width: number, height: number): SkImage {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = Math.max(0, Math.min(255, Math.round(plane[i] * 255)));
    bytes[i * 4] = v;
    bytes[i * 4 + 1] = v;
    bytes[i * 4 + 2] = v;
    bytes[i * 4 + 3] = 255;
  }
  const image = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(bytes),
    width * 4,
  );
  if (!image) throw new Error('Could not create mask image');
  return image;
}

/** Read RGBA8 pixels of an image (downscaled first on the CPU when large). */
export function readRGBA(image: SkImage): Uint8Array {
  const pixels = image.readPixels(0, 0, {
    width: image.width(),
    height: image.height(),
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!pixels) throw new Error('readPixels failed');
  return pixels instanceof Uint8Array ? pixels : Uint8Array.from(pixels, (v) => Math.round(v * 255));
}

/** Copy to CPU memory so the image can be drawn by the UI-thread canvas. */
export function toRaster(image: SkImage): SkImage {
  return image.makeNonTextureImage() ?? image;
}

type Disposable = { dispose?: () => void } | null | undefined;

export function disposeAll(...items: Disposable[]) {
  for (const item of items) {
    try {
      item?.dispose?.();
    } catch {
      // already released
    }
  }
}
