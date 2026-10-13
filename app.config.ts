import type { ExpoConfig } from 'expo/config';

import palette from './src/ui/palette.json';

// Colours come from src/ui/palette.json, the single source for the whole app.
// Native colours (background, Android icon) apply after `npx expo prebuild`.
const config: ExpoConfig = {
  name: 'Kuindzhi',
  slug: 'kuindzhi',
  scheme: 'kuindzhi',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: palette.bg,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.kuindzhi',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.kuindzhi',
    adaptiveIcon: {
      backgroundColor: palette.bg,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'react-native-fast-tflite',
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Kuindzhi listens when you hold the mic so you can describe edits by voice.',
        speechRecognitionPermission: 'Kuindzhi turns your spoken edit into text, on this device when possible.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as'],
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Kuindzhi opens the photo you want to edit.',
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: 'Kuindzhi saves edited photos to your library.',
        savePhotosPermission: 'Kuindzhi saves edited photos to your library.',
        granularPermissions: ['photo'],
      },
    ],
    'expo-sharing',
    'expo-asset',
    'expo-font',
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
