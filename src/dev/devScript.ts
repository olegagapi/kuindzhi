// Dev-only automation: when EXPO_PUBLIC_DEV_SCRIPT_URL is set at bundle time, the
// home screen fetches a JSON script and opens the editor with it — used for
// scripted simulator runs and screenshots without tapping.
//   { "sample": "portrait", "commands": ["make my face brighter", "warmer"] }

import { ImageFormat, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

export interface DevScript {
  sample?: string;
  /** Write the full-res result to <app cache>/<capture>.jpg after the commands run. */
  capture?: string;
  /** Also run the real "Save to Photos" export. */
  save?: boolean;
  uri?: string;
  commands?: string[];
}

export async function fetchDevScript(): Promise<DevScript | null> {
  const url = process.env.EXPO_PUBLIC_DEV_SCRIPT_URL;
  if (!__DEV__ || !url) return null;
  try {
    const res = await fetch(`${url}?t=${Date.now()}`);
    return res.ok ? ((await res.json()) as DevScript) : null;
  } catch {
    return null;
  }
}

/** Write a rendered image to the app cache as `<name>.jpg` (dev scripts' "capture" field). */
export function writeDevCapture(image: SkImage, name: string) {
  const file = new File(Paths.cache, `${name}.jpg`);
  file.write(image.encodeToBytes(ImageFormat.JPEG, 92));
  console.log(`[dev] capture written: ${file.uri}`);
}
