import type { EditStep } from '../editStack';
import { createMemoryStorage, createSessionStore, parseSession, serializeSession, type SavedStack } from '../sessionStore';

const step = (id: string, amount = 0.3): EditStep => ({
  id,
  adjustment: 'exposure',
  region: 'face',
  amount,
  invert: false,
  enabled: true,
  source: 'local',
  command: 'brighter',
});

const stack = (...steps: EditStep[]): SavedStack => ({ steps, past: [[]], future: [] });

function setup(max = 3) {
  let t = 1000;
  let n = 0;
  const storage = createMemoryStorage();
  const store = createSessionStore(storage, { maxSessions: max, now: () => t, newId: () => `s${++n}` });
  return { storage, store, tick: (ms = 1000) => (t += ms) };
}

describe('session store', () => {
  it('creates a session with its own copy of the photo and thumbnail', async () => {
    const { storage, store } = setup();
    const record = await store.create('file:///cache/photo.jpg', 'library', stack(step('a')), 'file:///cache/thumb.jpg');
    expect(storage.files.get('sessions/s1/original.jpg')).toBe('copy of file:///cache/photo.jpg');
    expect(storage.files.get('sessions/s1/thumb.jpg')).toBe('copy of file:///cache/thumb.jpg');
    expect(record).toMatchObject({ id: 's1', origin: 'library', stepCount: 1 });
    expect(store.originalUri('s1')).toBe('memory://sessions/s1/original.jpg');
  });

  it('round-trips the stack, including undo history', async () => {
    const { store, tick } = setup();
    const record = await store.create('p', 'sample:portrait', stack(step('a')));
    tick();
    store.save(record, { steps: [step('a'), step('b', 0.5)], past: [[], [step('a')]], future: [] });
    const loaded = await store.load('s1');
    expect(loaded?.stack.steps.map((s) => s.id)).toEqual(['a', 'b']);
    expect(loaded?.stack.past).toHaveLength(2);
    expect(loaded?.updatedAt).toBe(2000);
    expect(loaded?.stepCount).toBe(2);
  });

  it('lists newest first and skips corrupt sessions', async () => {
    const { storage, store, tick } = setup(10);
    await store.create('p1', 'library', stack());
    tick();
    await store.create('p2', 'library', stack(step('x')));
    storage.files.set('sessions/broken/session.json', '{not json');
    const list = await store.list();
    expect(list.map((m) => m.id)).toEqual(['s2', 's1']);
  });

  it('keeps only the newest sessions and deletes the rest with their files', async () => {
    const { storage, store, tick } = setup(2);
    for (let i = 0; i < 4; i++) {
      await store.create(`p${i}`, 'library', stack());
      tick();
    }
    expect((await store.list()).map((m) => m.id)).toEqual(['s4', 's3']);
    expect([...storage.files.keys()].some((k) => k.startsWith('sessions/s1/'))).toBe(false);
  });

  it('removes a session', async () => {
    const { store } = setup();
    await store.create('p', 'library', stack());
    store.remove('s1');
    expect(await store.load('s1')).toBeNull();
  });

  it('drops steps that no longer validate instead of losing the session', () => {
    const text = serializeSession({
      id: 'x',
      createdAt: 1,
      updatedAt: 2,
      origin: 'library',
      stepCount: 2,
      stack: { steps: [step('ok'), { ...step('old'), adjustment: 'teleport' as never }], past: [], future: [] },
    });
    const parsed = parseSession(text);
    expect(parsed?.stack.steps.map((s) => s.id)).toEqual(['ok']);
    expect(parseSession('{"version":1}')).toBeNull();
  });
});
