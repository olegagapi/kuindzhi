// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// On-device ML models ship as bundled assets.
config.resolver.assetExts.push('tflite');

module.exports = config;
