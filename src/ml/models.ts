// Runs the bundled MediaPipe models with react-native-fast-tflite (TFLite C API,
// same .tflite on iOS and Android). Pre-processing uses Skia: letterbox the photo
// onto a small raster surface and read the pixels back.
import { Skia, type SkImage } from '@shopify/react-native-skia';
import type { TfliteModel } from 'react-native-fast-tflite';

import { disposeAll, makeSurface, readRGBA } from '../engine/gpu';
import { decodeFaces, type Face } from './blazeface';
import { letterboxRect, rgbaToSignedTensor, type LetterboxRect } from './letterbox';
import { decodeSegmentation, type Segmentation } from './segmentationMath';

let segmenter: Promise<TfliteModel> | null = null;
let faceDetector: Promise<TfliteModel> | null = null;

/**
 * Loads a bundled model. The TFLite native module is required lazily so a build
 * without it (or a failed load) only turns off person/face regions instead of
 * crashing the editor. A failed load is forgotten, so the next photo retries.
 */
function loadModel(asset: number, cache: () => Promise<TfliteModel> | null, set: (p: Promise<TfliteModel> | null) => void) {
  const cached = cache();
  if (cached) return cached;
  let promise: Promise<TfliteModel>;
  try {
    const { loadTensorflowModel } = require('react-native-fast-tflite') as typeof import('react-native-fast-tflite');
    // CPU first: every op in these models runs on the default delegate; CoreML /
    // GPU delegates can be enabled per platform later.
    promise = loadTensorflowModel(asset, []);
  } catch (error) {
    promise = Promise.reject(error);
  }
  promise = promise.catch((error) => {
    set(null);
    throw error;
  });
  set(promise);
  return promise;
}

function getSegmenter() {
  return loadModel(
    require('../../assets/models/selfie_multiclass_256x256.tflite'),
    () => segmenter,
    (p) => (segmenter = p),
  );
}

function getFaceDetector() {
  return loadModel(
    require('../../assets/models/blaze_face_short_range.tflite'),
    () => faceDetector,
    (p) => (faceDetector = p),
  );
}

/** Letterbox `image` into a size x size square and return the [-1, 1] RGB tensor. */
export function letterboxTensor(image: SkImage, size: number): { tensor: Float32Array; rect: LetterboxRect } {
  const rect = letterboxRect(image.width(), image.height(), size);
  const surface = makeSurface(size, size, true);
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('black'));
  canvas.drawImageRectCubic(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height),
    1 / 3,
    1 / 3,
  );
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const rgba = readRGBA(snapshot);
  disposeAll(snapshot, surface);
  return { tensor: rgbaToSignedTensor(rgba, size), rect };
}

export async function segmentPeople(image: SkImage): Promise<Segmentation> {
  const model = await getSegmenter();
  const { tensor, rect } = letterboxTensor(image, 256);
  const [out] = await model.run([tensor.buffer as ArrayBuffer]);
  return decodeSegmentation(new Float32Array(out), rect);
}

export async function detectFaces(image: SkImage): Promise<Face[]> {
  const model = await getFaceDetector();
  const { tensor, rect } = letterboxTensor(image, 128);
  const outputs = await model.run([tensor.buffer as ArrayBuffer]);
  // Output order follows the model: regressors [1,896,16], classificators [1,896,1].
  const byName = new Map(model.outputs.map((t, i) => [t.name, outputs[i]]));
  const regressors = new Float32Array(byName.get('regressors') ?? outputs[0]);
  const classificators = new Float32Array(byName.get('classificators') ?? outputs[1]);
  return decodeFaces(regressors, classificators, rect);
}
