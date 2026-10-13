import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ADJUSTMENT_INFO } from '../edits/catalog';
import type { EditStep } from '../state/editStack';
import { formatAmount, SOURCE_LABEL, stepTitle } from './format';
import { colors, radius } from './theme';

interface Props {
  step: EditStep;
  onChange: (amount: number, commit: boolean) => void;
  onToggle: () => void;
  onInvert: () => void;
  onRemove: () => void;
  onShowArea: (show: boolean) => void;
}

/** Fine-tune a step the AI (or the parser) created — nothing is a black box. */
export function StepPanel({ step, onChange, onToggle, onInvert, onRemove, onShowArea }: Props) {
  const info = ADJUSTMENT_INFO[step.adjustment];
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{stepTitle(step)}</Text>
          {step.command ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              “{step.command}” · {SOURCE_LABEL[step.source]}
            </Text>
          ) : null}
        </View>
        <Text style={styles.value}>{formatAmount(step.amount)}</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={info.min}
        maximumValue={info.max}
        value={step.amount}
        step={0.01}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.text}
        onValueChange={(v) => onChange(v, false)}
        onSlidingComplete={(v) => onChange(v, true)}
        accessibilityLabel={`${info.label} amount`}
      />
      <View style={styles.actions}>
        <Action icon={step.enabled ? 'eye-outline' : 'eye-off-outline'} label={step.enabled ? 'On' : 'Off'} onPress={onToggle} />
        {step.region !== 'all' ? (
          <>
            <Action icon="swap-horizontal" label={step.invert ? 'Inverted' : 'Invert'} onPress={onInvert} />
            <Action icon="scan-outline" label="Hold: area" onPressIn={() => onShowArea(true)} onPressOut={() => onShowArea(false)} />
          </>
        ) : null}
        <View style={{ flex: 1 }} />
        <Action icon="trash-outline" label="Remove" onPress={onRemove} danger />
      </View>
    </View>
  );
}

function Action(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  danger?: boolean;
}) {
  const tint = props.danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={props.onPress}
      onPressIn={props.onPressIn}
      onPressOut={props.onPressOut}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={props.label}
    >
      <Ionicons name={props.icon} size={16} color={tint} />
      <Text style={[styles.actionText, { color: tint }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  value: { color: colors.accent, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  slider: { marginTop: 6, height: 36 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm },
  actionText: { fontSize: 13, fontWeight: '600' },
});
