import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchDevScript } from '../dev/devScript';
import type { SessionMeta } from '../state/sessionStore';
import { sessions } from '../state/sessions';
import { timeAgo } from '../ui/format';
import { colors, radius, serif } from '../ui/theme';

export default function Home() {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);

  const [recent, setRecent] = useState<SessionMeta[]>([]);

  // Refresh "Continue editing" whenever the home screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      sessions
        .list()
        .then(setRecent)
        .catch(() => setRecent([]));
    }, []),
  );

  const removeSession = (meta: SessionMeta) => {
    Alert.alert('Remove this edit?', 'The edited version and its history will be deleted from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          sessions.remove(meta.id);
          setRecent((list) => list.filter((m) => m.id !== meta.id));
        },
      },
    ]);
  };

  useEffect(() => {
    void fetchDevScript().then(async (script) => {
      if (!script) return;
      const params: Record<string, string> = { command: (script.commands ?? []).join('\n') };
      if (script.resume) {
        const [latest] = await sessions.list();
        if (latest) params.session = latest.id;
      }
      if (script.capture) params.capture = script.capture;
      if (script.save) params.save = '1';
      if (params.session) {
        // resuming: no photo source needed
      } else if (script.uri) params.uri = script.uri;
      else params.sample = script.sample ?? 'portrait';
      router.push({ pathname: '/editor', params });
    });
  }, []);

  const pick = async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (!result.canceled && result.assets[0]) {
        router.push({ pathname: '/editor', params: { uri: result.assets[0].uri } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.hero}>
        <View style={styles.moon} />
        <Text style={styles.wordmark}>Kuindzhi</Text>
        <Text style={styles.tagline}>Say how the light should fall.</Text>
        <Text style={styles.body}>
          Describe an edit by voice or text — “make my face brighter”, “blur the background”, “warmer sky”. Kuindzhi
          turns it into real photo adjustments with precise masks. Nothing is redrawn or invented.
        </Text>
      </View>

      <View style={styles.actions}>
        {recent.length ? (
          <View style={styles.recent}>
            <Text style={styles.recentTitle}>Continue editing</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
              {recent.map((meta) => (
                <Pressable
                  key={meta.id}
                  style={({ pressed }) => [styles.recentItem, pressed && styles.pressed]}
                  onPress={() => router.push({ pathname: '/editor', params: { session: meta.id } })}
                  onLongPress={() => removeSession(meta)}
                  accessibilityLabel={`Continue editing, ${meta.stepCount} edits, ${timeAgo(meta.updatedAt)}. Long press to remove.`}
                >
                  <Image source={{ uri: sessions.thumbUri(meta.id) }} style={styles.recentThumb} />
                  <Text style={styles.recentMeta} numberOfLines={1}>
                    {meta.stepCount ? `${meta.stepCount} edit${meta.stepCount > 1 ? 's' : ''}` : 'Original'} · {timeAgo(meta.updatedAt)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={pick}>
          <Ionicons name="images-outline" size={20} color={colors.accentInk} />
          <Text style={styles.primaryText}>Choose a photo</Text>
        </Pressable>
        <View style={styles.samples}>
          <SampleButton label="Try a portrait" sample="portrait" />
          <SampleButton label="Try a sunset" sample="sunset" />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.footnote}>
          Named after Arkhyp Kuindzhi (1842–1910), the Mariupol-born painter of light, whose “Moonlit Night on the
          Dnieper” made people look behind the canvas for a lamp.
        </Text>
      </View>
    </View>
  );
}

function SampleButton({ label, sample }: { label: string; sample: string }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/editor', params: { sample } })}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24, justifyContent: 'space-between' },
  hero: { gap: 14 },
  moon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.moon,
    shadowColor: colors.moon,
    shadowOpacity: 0.7,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    marginBottom: 12,
  },
  wordmark: { fontFamily: serif, fontSize: 48, color: colors.text, letterSpacing: 0.5 },
  tagline: { fontFamily: serif, fontSize: 22, color: colors.accent },
  body: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 6 },
  actions: { gap: 12 },
  recent: { gap: 10, marginBottom: 8 },
  recentTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  recentRow: { gap: 12 },
  recentItem: { width: 112, gap: 6 },
  recentThumb: { width: 112, height: 112, borderRadius: radius.sm, backgroundColor: colors.surface },
  recentMeta: { color: colors.textMuted, fontSize: 12 },
  primary: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 17,
  },
  primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
  samples: { flexDirection: 'row', gap: 12 },
  secondary: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 14,
  },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  error: { color: colors.danger, textAlign: 'center' },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 12 },
});
