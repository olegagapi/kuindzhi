import { Ionicons } from '@expo/vector-icons';
import type { SkImage } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Region } from '../edits/catalog';
import type { PlanSource } from '../edits/schema';
import { autoEnhance } from '../engine/analyze';
import { writeDevCapture } from '../dev/devScript';
import { disposeAll } from '../engine/gpu';
import { loadPhoto, saveToLibrary, shareImage } from '../engine/photo';
import { PhotoSession, type AnalysisState } from '../engine/session';
import { createCloudPlanner } from '../nlp/cloudPlanner';
import { onDevicePlanner } from '../nlp/onDevicePlanner';
import { planCommand } from '../nlp/planner';
import { useVoiceCommand } from '../speech/useVoiceCommand';
import { editStackReducer, initialEditStack } from '../state/editStack';
import { CommandBar } from '../ui/CommandBar';
import { SOURCE_LABEL } from '../ui/format';
import { PhotoView } from '../ui/PhotoView';
import { StepChips } from '../ui/StepChips';
import { StepPanel } from '../ui/StepPanel';
import { colors, radius } from '../ui/theme';

const SAMPLES: Record<string, number> = {
  portrait: require('../../assets/samples/portrait.jpg'),
  sunset: require('../../assets/samples/sunset.jpg'),
};

// Per-launch id so the planner Worker can rate-limit per client.
const DEVICE_ID = `d-${Math.random().toString(36).slice(2, 12)}`;

async function resolveSource(params: { uri?: string; sample?: string }): Promise<string> {
  if (params.uri) return params.uri;
  const module = SAMPLES[params.sample ?? 'portrait'] ?? SAMPLES.portrait;
  const [asset] = await Asset.loadAsync(module);
  return asset.localUri ?? asset.uri;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Editor() {
  const params = useLocalSearchParams<{ uri?: string; sample?: string; command?: string; capture?: string; save?: string }>();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<PhotoSession | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>('pending');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(editStackReducer, initialEditStack);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [rendered, setRendered] = useState<SkImage | null>(null);
  const [original, setOriginal] = useState<SkImage | null>(null);
  const [overlay, setOverlay] = useState<SkImage | null>(null);
  const [area, setArea] = useState<{ region: Region; invert: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reply, setReply] = useState<{ text: string; source?: PlanSource } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tiers = useMemo(() => [onDevicePlanner, createCloudPlanner({ deviceId: DEVICE_ID })], []);

  // Open the photo, then analyse it (people + faces) in the background.
  useEffect(() => {
    let cancelled = false;
    let opened: PhotoSession | null = null;
    (async () => {
      try {
        const image = await loadPhoto(await resolveSource(params));
        if (cancelled) return;
        opened = new PhotoSession(image);
        setSession(opened);
        setOriginal(opened.renderPreview([]));
        await opened.analyze();
        if (!cancelled) setAnalysis(opened.analysis);
      } catch (e) {
        if (!cancelled) setLoadError(message(e));
      }
    })();
    return () => {
      cancelled = true;
      opened?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri, params.sample]);

  // Re-render the preview whenever the stack (or the masks) change; coalesced per frame.
  useEffect(() => {
    if (!session) return;
    const handle = requestAnimationFrame(() => {
      try {
        setRendered(session.renderPreview(state.steps));
      } catch (e) {
        setReply({ text: `Render failed: ${message(e)}` });
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [session, state.steps, analysis]);

  // Selection overlay ("this is what I selected").
  useEffect(() => {
    if (!session || !area) {
      setOverlay(null);
      return;
    }
    setOverlay(session.selectionOverlay(area.region, area.invert));
  }, [session, area, analysis]);

  const flashArea = useCallback((region: Region, invert: boolean) => {
    clearTimeout(flashTimer.current);
    setArea({ region, invert });
    flashTimer.current = setTimeout(() => setArea(null), 1400);
  }, []);

  const runCommand = useCallback(
    async (command: string) => {
      if (!session) return;
      setBusy(true);
      setReply(null);
      try {
        const { plan, source } = await planCommand(command, session.context(stateRef.current.steps), tiers);
        switch (plan.intent) {
          case 'edit': {
            if (plan.steps.length) {
              dispatch({ type: 'apply', steps: plan.steps, source, command });
              const masked = plan.steps.find((s) => s.region !== 'all');
              if (masked) flashArea(masked.region, masked.invert);
            }
            setReply({ text: plan.reply || 'Done.', source });
            break;
          }
          case 'auto-enhance': {
            const steps = autoEnhance(session.stats, session.faces.length);
            dispatch({ type: 'apply', steps, source: 'auto', command });
            setReply({ text: 'Auto-enhanced from this photo’s own histogram.', source: 'auto' });
            break;
          }
          case 'undo':
            dispatch({ type: 'undo' });
            setReply({ text: 'Undone.', source });
            break;
          case 'redo':
            dispatch({ type: 'redo' });
            setReply({ text: 'Redone.', source });
            break;
          case 'reset':
            dispatch({ type: 'reset' });
            setReply({ text: 'Back to the original.', source });
            break;
          case 'unsupported':
            setReply({ text: plan.reply, source });
            break;
        }
      } catch (e) {
        setReply({ text: message(e) });
      } finally {
        setBusy(false);
      }
    },
    [session, tiers, flashArea],
  );

  // Deep-link / dev-script automation: kuindzhi://editor?sample=portrait&command=make%20my%20face%20brighter
  // (several commands separated by newlines run in order).
  const autoRan = useRef(false);
  useEffect(() => {
    if (params.command && analysis !== 'pending' && session && !autoRan.current) {
      autoRan.current = true;
      void (async () => {
        for (const command of params.command!.split('\n').filter(Boolean)) await runCommand(command);
        if (__DEV__ && params.capture && session) {
          // Let the reducer settle, then write the full-res result for inspection.
          await new Promise((r) => setTimeout(r, 300));
          writeDevCapture(session.renderFull(stateRef.current.steps), params.capture);
        }
        if (__DEV__ && params.save === '1') {
          await exportPhoto('save');
          console.log('[dev] saved to library');
        }
      })();
    }
  }, [params.command, params.capture, analysis, session, runCommand]);

  const voice = useVoiceCommand(runCommand);

  const exportPhoto = async (mode: 'save' | 'share') => {
    if (!session || exporting) return;
    setExporting(true);
    try {
      const full = session.renderFull(stateRef.current.steps);
      try {
        if (mode === 'save') await saveToLibrary(full);
        else await shareImage(full);
      } finally {
        disposeAll(full);
      }
      if (mode === 'save') setReply({ text: `Saved to your library at ${session.source.width()}×${session.source.height()}.` });
    } catch (e) {
      setReply({ text: message(e) });
    } finally {
      setExporting(false);
    }
  };

  const selected = state.steps.find((s) => s.id === state.selectedId) ?? null;
  const regions = session && analysis !== 'pending' ? session.availableRegions() : [];
  const suggestions = selected ? [] : buildSuggestions(regions, state.steps.length > 0);
  const statusText = analysisLabel(analysis, session);
  const shownReply = voice.error ? { text: voice.error } : reply;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <View style={styles.status}>
          <View style={[styles.dot, analysis === 'ready' && styles.dotReady, analysis === 'limited' && styles.dotLimited]} />
          <Text style={styles.statusText} numberOfLines={1}>
            {statusText}
          </Text>
        </View>
        <IconButton icon="arrow-undo" label="Undo" disabled={!state.past.length} onPress={() => dispatch({ type: 'undo' })} />
        <IconButton icon="arrow-redo" label="Redo" disabled={!state.future.length} onPress={() => dispatch({ type: 'redo' })} />
        <IconButton icon="download-outline" label="Save to Photos" disabled={!session || exporting} onPress={() => exportPhoto('save')} />
        <IconButton icon="share-outline" label="Share" disabled={!session || exporting} onPress={() => exportPhoto('share')} />
      </View>

      <View style={styles.photo}>
        {loadError ? (
          <Text style={styles.loadError}>Couldn’t open this photo: {loadError}</Text>
        ) : (
          <PhotoView image={rendered} original={original} overlay={overlay} loading={!rendered || exporting} />
        )}
      </View>

      {shownReply ? (
        <Pressable style={styles.reply} onPress={() => (voice.error ? voice.clearError() : setReply(null))}>
          <Text style={styles.replyText}>{shownReply.text}</Text>
          {'source' in shownReply && shownReply.source ? (
            <Text style={styles.replySource}>{SOURCE_LABEL[shownReply.source]}</Text>
          ) : null}
        </Pressable>
      ) : null}

      <StepChips steps={state.steps} selectedId={state.selectedId} onSelect={(id) => dispatch({ type: 'select', id })} />

      {selected ? (
        <StepPanel
          step={selected}
          onChange={(amount, commit) => dispatch({ type: 'update', id: selected.id, patch: { amount }, commit })}
          onToggle={() => dispatch({ type: 'update', id: selected.id, patch: { enabled: !selected.enabled } })}
          onInvert={() => {
            dispatch({ type: 'update', id: selected.id, patch: { invert: !selected.invert } });
            flashArea(selected.region, !selected.invert);
          }}
          onRemove={() => dispatch({ type: 'remove', id: selected.id })}
          onShowArea={(show) => {
            clearTimeout(flashTimer.current);
            setArea(show ? { region: selected.region, invert: selected.invert } : null);
          }}
        />
      ) : null}

      <View style={styles.command}>
        <CommandBar
          busy={busy || !session}
          listening={voice.listening}
          transcript={voice.transcript}
          suggestions={suggestions}
          onSubmit={runCommand}
          onMicStart={voice.start}
          onMicStop={voice.stop}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function IconButton(props: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, (pressed || props.disabled) && { opacity: props.disabled ? 0.3 : 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={props.label}
    >
      <Ionicons name={props.icon} size={22} color={colors.text} />
    </Pressable>
  );
}

function analysisLabel(analysis: AnalysisState, session: PhotoSession | null): string {
  if (!session) return 'Opening…';
  if (analysis === 'pending') return 'Finding people and faces…';
  if (analysis === 'limited') return 'Basic regions only';
  const found: string[] = [];
  const faces = session.faces.length;
  if (faces) found.push(`${faces} face${faces > 1 ? 's' : ''}`);
  if (session.masks.isAvailable('person')) found.push('person');
  if (session.masks.isAvailable('hair')) found.push('hair');
  return found.length ? `Found ${found.join(', ')}` : 'No people found';
}

function buildSuggestions(regions: Region[], hasSteps: boolean): string[] {
  const has = (r: Region) => regions.includes(r);
  const out: string[] = [];
  if (has('face')) out.push('Make my face brighter');
  if (has('background')) out.push('Blur the background');
  if (has('skin')) out.push('Smooth skin');
  out.push('Warmer and more contrast');
  out.push('Make the sky dramatic');
  if (has('eyes')) out.push('Brighten my eyes');
  out.push('Vintage look', 'Auto enhance');
  if (hasSteps) out.unshift('Undo');
  return out;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 2, height: 48 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  statusText: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textMuted },
  dotReady: { backgroundColor: colors.moon },
  dotLimited: { backgroundColor: colors.danger },
  photo: { flex: 1, marginHorizontal: 8, marginBottom: 8 },
  loadError: { color: colors.danger, padding: 24, textAlign: 'center' },
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
  },
  replyText: { color: colors.text, fontSize: 14, flex: 1 },
  replySource: { color: colors.textMuted, fontSize: 11 },
  command: { paddingTop: 10 },
});
