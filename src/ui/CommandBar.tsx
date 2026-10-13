import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius } from './theme';

interface Props {
  busy: boolean;
  listening: boolean;
  transcript: string;
  suggestions: string[];
  onSubmit: (text: string) => void;
  onMicStart: () => void;
  onMicStop: () => void;
}

/** Type or hold-to-talk. */
export function CommandBar({ busy, listening, transcript, suggestions, onSubmit, onMicStart, onMicStop }: Props) {
  const [text, setText] = useState('');

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <View>
      {suggestions.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
          contentContainerStyle={styles.suggestions}
        >
          {suggestions.map((s) => (
            <Pressable key={s} onPress={() => submit(s)} style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.6 }]}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.bar}>
        <View style={[styles.inputWrap, listening && styles.inputListening]}>
          {listening ? (
            <Text style={[styles.input, styles.transcript]} numberOfLines={2}>
              {transcript || 'Listening…'}
            </Text>
          ) : (
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Describe an edit… “make my face brighter”"
              placeholderTextColor={colors.textMuted}
              returnKeyType="send"
              onSubmitEditing={() => submit(text)}
              editable={!busy}
              autoCorrect
              accessibilityLabel="Edit command"
            />
          )}
          {busy ? (
            <ActivityIndicator color={colors.accent} style={styles.trailing} />
          ) : text.trim() && !listening ? (
            <Pressable onPress={() => submit(text)} style={styles.trailing} accessibilityLabel="Apply edit">
              <Ionicons name="arrow-up-circle" size={30} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPressIn={onMicStart}
          onPressOut={onMicStop}
          disabled={busy}
          style={[styles.mic, listening && styles.micActive]}
          accessibilityRole="button"
          accessibilityLabel="Hold to speak an edit"
        >
          <Ionicons name={listening ? 'mic' : 'mic-outline'} size={24} color={listening ? colors.accentInk : colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  suggestions: { paddingHorizontal: 16, gap: 8, paddingBottom: 10, alignItems: 'center' },
  suggestion: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  suggestionText: { color: colors.moon, fontSize: 13 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  inputWrap: {
    flex: 1,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 16,
    paddingRight: 8,
  },
  inputListening: { borderColor: colors.accent },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 },
  transcript: { color: colors.moon },
  trailing: { marginLeft: 6 },
  mic: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  micActive: { backgroundColor: colors.accent, transform: [{ scale: 1.08 }] },
});
