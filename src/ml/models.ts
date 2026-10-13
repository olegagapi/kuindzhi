// Runs the bundled MediaPipe models with react-native-fast-tflite (TFLite C API,
// same .tflite on iOS and Android). Pre-processing uses Skia: letterbox the photo
// onto a small raster surface and read the pixels back.
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

import { disposeAll, makeSurface, readRGBA } from '../engine/gpu';
import { decodeFaces, type Face } from './blazeface';
import { letterboxRect, rgbaToSignedTensor, type LetterboxRect } from './letterbox';
import { decodeSegmentation, type Segmentation } from './segmentationMath';

let segmenter: Promise<TfliteModel> | null = null;
let faceDetector: Promise<TfliteModel> | null = null;

function getSegmenter() {
  // CPU first: every op in these models runs on the default delegate; CoreML /
  // GPU delegates can be enabled per platform later.
  segmenter ??= loadTensorflowModel(require('../../assets/models/selfie_multiclass_256x256.tflite'), []);
  return segmenter;
}

function getFaceDetector() {
  faceDetector ??= loadTensorflowModel(require('../../assets/models/blaze_face_short_range.tflite'), []);
  return faceDetector;
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
