// Aspect-preserving resize into a square model input. Verified offline: the
// selfie segmenter finds back-lit/full-body people far better letterboxed than
// stretched, and both MediaPipe models expect RGB scaled to [-1, 1].

export interface LetterboxRect {
  /** Model input side (e.g. 256). */
  size: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function letterboxRect(imageWidth: number, imageHeight: number, size: number): LetterboxRect {
  const scale = size / Math.max(imageWidth, imageHeight);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  return { size, x: Math.floor((size - width) / 2), y: Math.floor((size - height) / 2), width, height };
}

/** RGBA8 pixels of the full size x size letterboxed canvas → float32 RGB in [-1, 1]. */
export function rgbaToSignedTensor(rgba: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size * size * 3);
  for (let i = 0, j = 0; i < size * size; i++, j += 3) {
    out[j] = rgba[i * 4] / 127.5 - 1;
    out[j + 1] = rgba[i * 4 + 1] / 127.5 - 1;
    out[j + 2] = rgba[i * 4 + 2] / 127.5 - 1;
  }
  return out;
}
