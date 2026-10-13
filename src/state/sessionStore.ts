// Autosaved editing sessions, so progress survives the app being closed or
// killed. Each session keeps its own copy of the original photo (picker and
// cache files don't survive relaunch) plus the edit stack with undo history:
//   sessions/<id>/original.jpg, thumb.jpg, session.json
import { z } from 'zod';

import { ADJUSTMENTS, REGIONS } from '../edits/catalog';
import type { EditStackState, EditStep } from './editStack';

/** The file operations the store needs; paths are relative to the app's documents folder. */
export interface Storage {
  /** Contents of a text file, or null when it doesn't exist. */
  readText(path: string): Promise<string | null>;
  /** Synchronous so the editor can flush on unmount. */
  writeText(path: string, text: string): void;
  /** Copy a file from any URI into the documents folder. */
  copyFile(fromUri: string, toPath: string): Promise<void>;
  /** Names of the sub-folders of a folder (empty when it doesn't exist). */
  listDirs(path: string): string[];
  /** Delete a file or folder (recursively); no error when missing. */
  remove(path: string): void;
  /** file:// URI of a path, for decoding or displaying it. */
  uri(path: string): string;
}

export interface SessionMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Where the photo came from: "library" or "sample:portrait". */
  origin: string;
  stepCount: number;
}

export type SavedStack = Pick<EditStackState, 'steps' | 'past' | 'future'>;

export interface SessionRecord extends SessionMeta {
  stack: SavedStack;
}

const ROOT = 'sessions';
const HISTORY_KEPT = 20;
const VERSION = 1;

const StepSchema = z.object({
  id: z.string(),
  adjustment: z.enum(ADJUSTMENTS),
  region: z.enum(REGIONS),
  amount: z.number(),
  invert: z.boolean(),
  enabled: z.boolean(),
  source: z.enum(['local', 'on-device-ai', 'cloud', 'manual', 'auto']),
  command: z.string().optional(),
});

const FileSchema = z.object({
  version: z.number(),
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  origin: z.string(),
  steps: z.array(z.unknown()),
  past: z.array(z.array(z.unknown())).optional(),
  future: z.array(z.array(z.unknown())).optional(),
});

/** Keep the steps that still validate (e.g. after a catalog change) instead of losing the session. */
function validSteps(raw: unknown[]): EditStep[] {
  return raw.flatMap((s) => {
    const parsed = StepSchema.safeParse(s);
    return parsed.success ? [parsed.data] : [];
  });
}

export function serializeSession(record: SessionRecord): string {
  return JSON.stringify({
    version: VERSION,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    origin: record.origin,
    steps: record.stack.steps,
    past: record.stack.past.slice(-HISTORY_KEPT),
    future: record.stack.future.slice(0, HISTORY_KEPT),
  });
}

export function parseSession(text: string): SessionRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = FileSchema.safeParse(json);
  if (!parsed.success) return null;
  const f = parsed.data;
  const steps = validSteps(f.steps);
  return {
    id: f.id,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    origin: f.origin,
    stepCount: steps.length,
    stack: { steps, past: (f.past ?? []).map(validSteps), future: (f.future ?? []).map(validSteps) },
  };
}

export interface SessionStoreOptions {
  maxSessions?: number;
  now?: () => number;
  newId?: () => string;
}

export function createSessionStore(storage: Storage, options: SessionStoreOptions = {}) {
  const maxSessions = options.maxSessions ?? 12;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const path = (id: string, file: string) => `${ROOT}/${id}/${file}`;

  async function load(id: string): Promise<SessionRecord | null> {
    const text = await storage.readText(path(id, 'session.json'));
    return text ? parseSession(text) : null;
  }

  async function list(): Promise<SessionMeta[]> {
    const records = await Promise.all(storage.listDirs(ROOT).map((id) => load(id).catch(() => null)));
    return records
      .filter((r): r is SessionRecord => r !== null)
      .map(({ stack: _stack, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function remove(id: string) {
    storage.remove(`${ROOT}/${id}`);
  }

  return {
    load,
    list,
    remove,

    /** Start a session: copy the photo (and its thumbnail) into the documents folder. */
    async create(photoUri: string, origin: string, stack: SavedStack, thumbUri?: string): Promise<SessionRecord> {
      const id = newId();
      await storage.copyFile(photoUri, path(id, 'original.jpg'));
      if (thumbUri) await storage.copyFile(thumbUri, path(id, 'thumb.jpg')).catch(() => undefined);
      const t = now();
      const record: SessionRecord = { id, createdAt: t, updatedAt: t, origin, stepCount: stack.steps.length, stack };
      storage.writeText(path(id, 'session.json'), serializeSession(record));
      await this.prune();
      return record;
    },

    /** Persist the current stack (synchronous write). */
    save(record: SessionRecord, stack: SavedStack): SessionRecord {
      const next: SessionRecord = { ...record, updatedAt: now(), stepCount: stack.steps.length, stack };
      storage.writeText(path(record.id, 'session.json'), serializeSession(next));
      return next;
    },

    /** Drop the oldest sessions beyond the limit, with their files, and folders with no readable session. */
    async prune() {
      const ids = storage.listDirs(ROOT);
      const metas = await list();
      const keep = new Set(metas.slice(0, maxSessions).map((m) => m.id));
      for (const id of ids) if (!keep.has(id)) remove(id);
    },

    originalUri: (id: string) => storage.uri(path(id, 'original.jpg')),
    thumbUri: (id: string) => storage.uri(path(id, 'thumb.jpg')),
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

/** In-memory Storage, for tests. */
export function createMemoryStorage(): Storage & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readText(p) {
      return files.get(p) ?? null;
    },
    writeText(p, text) {
      files.set(p, text);
    },
    async copyFile(from, to) {
      files.set(to, `copy of ${from}`);
    },
    listDirs(p) {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
      }
      return [...names];
    },
    remove(p) {
      for (const key of [...files.keys()]) if (key === p || key.startsWith(`${p}/`)) files.delete(key);
    },
    uri: (p) => `memory://${p}`,
  };
}
