import { editStackReducer, initialEditStack, type EditStackState } from '../editStack';

const apply = (state: EditStackState, amount = 0.3) =>
  editStackReducer(state, {
    type: 'apply',
    source: 'local',
    command: 'brighter',
    steps: [{ adjustment: 'exposure', region: 'face', amount, invert: false }],
  });

describe('editStackReducer', () => {
  it('applies plan steps and selects the newest', () => {
    const s = apply(initialEditStack);
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]).toMatchObject({ adjustment: 'exposure', enabled: true, source: 'local', command: 'brighter' });
    expect(s.selectedId).toBe(s.steps[0].id);
  });

  it('ignores empty plans', () => {
    const s = editStackReducer(initialEditStack, { type: 'apply', steps: [], source: 'local' });
    expect(s).toBe(initialEditStack);
  });

  it('undoes and redoes', () => {
    const one = apply(initialEditStack);
    const two = apply(one, 0.5);
    const undone = editStackReducer(two, { type: 'undo' });
    expect(undone.steps).toEqual(one.steps);
    const redone = editStackReducer(undone, { type: 'redo' });
    expect(redone.steps).toEqual(two.steps);
  });

  it('clears redo history on a new edit', () => {
    const undone = editStackReducer(apply(apply(initialEditStack)), { type: 'undo' });
    expect(apply(undone).future).toHaveLength(0);
  });

  it('slider drags do not flood history until committed', () => {
    const s = apply(initialEditStack);
    const id = s.steps[0].id;
    const dragging = editStackReducer(s, { type: 'update', id, patch: { amount: 0.4 }, commit: false });
    expect(dragging.past).toHaveLength(s.past.length);
    const done = editStackReducer(dragging, { type: 'update', id, patch: { amount: 0.45 } });
    expect(done.past).toHaveLength(s.past.length + 1);
    expect(done.steps[0].amount).toBe(0.45);
  });

  it('resets as an undoable step', () => {
    const s = editStackReducer(apply(initialEditStack), { type: 'reset' });
    expect(s.steps).toHaveLength(0);
    expect(editStackReducer(s, { type: 'undo' }).steps).toHaveLength(1);
  });

  it('restores a saved stack with its history', () => {
    const saved = apply(apply(initialEditStack));
    const restored = editStackReducer(initialEditStack, {
      type: 'restore',
      stack: { steps: saved.steps, past: saved.past, future: [] },
    });
    expect(restored.steps).toEqual(saved.steps);
    expect(editStackReducer(restored, { type: 'undo' }).steps).toHaveLength(1);
  });

  it('removes a step and clears its selection', () => {
    const s = apply(initialEditStack);
    const removed = editStackReducer(s, { type: 'remove', id: s.steps[0].id });
    expect(removed.steps).toHaveLength(0);
    expect(removed.selectedId).toBeNull();
  });
});
