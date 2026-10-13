import { Canvas, Image, type SkImage } from '@shopify/react-native-skia';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { colors, radius } from './theme';

interface Props {
  image: SkImage | null;
  original: SkImage | null;
  overlay: SkImage | null;
  loading?: boolean;
}

/** The photo. Press and hold to compare with the original. */
export function PhotoView({ image, original, overlay, loading }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [comparing, setComparing] = useState(false);
  const shown = comparing && original ? original : image;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <Pressable
      style={styles.container}
      onLayout={onLayout}
      onPressIn={() => setComparing(true)}
      onPressOut={() => setComparing(false)}
      accessibilityLabel="Photo. Press and hold to see the original."
    >
      {shown && size.width > 0 ? (
        <Canvas style={{ width: size.width, height: size.height }}>
          <Image image={shown} x={0} y={0} width={size.width} height={size.height} fit="contain" />
          {overlay && !comparing ? (
            <Image image={overlay} x={0} y={0} width={size.width} height={size.height} fit="contain" />
          ) : null}
        </Canvas>
      ) : null}
      {loading ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      {comparing && original ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>Original</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: colors.scrim,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
