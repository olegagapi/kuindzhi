// Photo I/O: decode with orientation baked in, export at full resolution.
import { ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';

/** Largest edge we keep in memory and export (12–16 MP phones fit; 48 MP gets downscaled). */
export const MAX_EDGE = 4096;

export interface LoadedPhoto {
  image: SkImage;
  /** The normalized JPEG on disk (orientation applied, ≤ MAX_EDGE). */
  fileUri: string;
}

/**
 * Decode a picked photo. ImageManipulator re-encodes it, which applies the EXIF
 * orientation (Skia's decoder doesn't) and caps the resolution.
 */
export async function loadPhoto(uri: string): Promise<LoadedPhoto> {
  let ref = await ImageManipulator.manipulate(uri).renderAsync();
  const longEdge = Math.max(ref.width, ref.height);
  if (longEdge > MAX_EDGE) {
    const scale = MAX_EDGE / longEdge;
    ref = await ImageManipulator.manipulate(ref)
      .resize({ width: Math.round(ref.width * scale), height: Math.round(ref.height * scale) })
      .renderAsync();
  }
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.97 });
  return { image: await decodeFile(saved.uri), fileUri: saved.uri };
}

/** Decode a JPEG that is already normalized (e.g. a saved session's original). */
export async function decodeFile(uri: string): Promise<SkImage> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('Could not decode this photo');
  return image;
}

/** Small JPEG for the "Continue editing" list. */
export async function makeThumbnail(uri: string): Promise<string> {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: 320 }).renderAsync();
  return (await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })).uri;
}

function writeJpeg(image: SkImage): string {
  const bytes = image.encodeToBytes(ImageFormat.JPEG, 95);
  const file = new File(Paths.cache, `kuindzhi-${Date.now()}.jpg`);
  file.write(bytes);
  return file.uri;
}

export async function saveToLibrary(image: SkImage): Promise<void> {
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('Allow photo library access to save your edit.');
  await Asset.create(writeJpeg(image));
}

export async function shareImage(image: SkImage): Promise<void> {
  const uri = writeJpeg(image);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg' });
}
