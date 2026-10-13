// Keeps the open photo's edits on disk: the first edit creates a session (with
// its own copy of the photo), later changes are saved shortly after they happen,
// and anything pending is flushed when the app is backgrounded or the editor closes.
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { makeThumbnail } from '../engine/photo';
import type { EditStackState } from './editStack';
import type { SavedStack, SessionRecord } from './sessionStore';
import { sessions } from './sessions';

export interface SessionSource {
  /** The normalized photo file to copy into the session. */
  fileUri: string;
  origin: string;
  /** Set when the editor was opened from a saved session. */
  existing?: SessionRecord | null;
}

export function useAutosave(state: EditStackState, source: SessionSource | null, delayMs = 400) {
  const record = useRef<SessionRecord | null>(null);
  const creating = useRef(false);
  const pending = useRef<SavedStack | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    record.current = source?.existing ?? null;
  }, [source]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const stack = pending.current;
    if (!stack || !record.current) return;
    pending.current = null;
    try {
      record.current = sessions.save(record.current, stack);
    } catch (error) {
      if (__DEV__) console.warn('[autosave] save failed', error);
    }
  }, []);

  useEffect(() => {
    if (!source) return;
    const stack: SavedStack = { steps: state.steps, past: state.past, future: state.future };
    if (!record.current) {
      if (!stack.steps.length && !stack.past.length) return; // nothing worth keeping yet
      if (creating.current) {
        pending.current = stack;
        return;
      }
      creating.current = true;
      void (async () => {
        try {
          const thumb = await makeThumbnail(source.fileUri).catch(() => undefined);
          record.current = await sessions.create(source.fileUri, source.origin, stack, thumb);
        } catch (error) {
          if (__DEV__) console.warn('[autosave] could not create the session', error);
        } finally {
          creating.current = false;
          flush();
        }
      })();
      return;
    }
    pending.current = stack;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delayMs);
  }, [state.steps, state.past, state.future, source, delayMs, flush]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') flush();
    });
    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);
}
