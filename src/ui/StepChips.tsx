import { ScrollView, StyleSheet, Pressable, Text } from 'react-native';

import type { EditStep } from '../state/editStack';
import { formatAmount, stepTitle } from './format';
import { colors, radius } from './theme';

interface Props {
  steps: EditStep[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** The edit stack as a strip of chips — every voice/text command lands here as editable steps. */
export function StepChips({ steps, selectedId, onSelect }: Props) {
  if (!steps.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
      {steps.map((step) => {
        const selected = step.id === selectedId;
        return (
          <Pressable
            key={step.id}
            onPress={() => onSelect(selected ? null : step.id)}
            style={[styles.chip, selected && styles.chipSelected, !step.enabled && styles.chipDisabled]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.title, selected && styles.titleSelected]} numberOfLines={1}>
              {stepTitle(step)}
            </Text>
            <Text style={[styles.amount, selected && styles.titleSelected]}>{formatAmount(step.amount)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 4, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipDisabled: { opacity: 0.45 },
  title: { color: colors.text, fontSize: 13, fontWeight: '600', maxWidth: 190 },
  titleSelected: { color: colors.accentInk },
  amount: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
});
