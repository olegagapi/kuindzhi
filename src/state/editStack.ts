// Non-destructive edit history. Pure reducer so undo/redo semantics are tested
// without React.
import type { Adjustment, Region } from '../edits/catalog';
import type { PlanSource, PlanStep } from '../edits/schema';

export interface EditStep {
  id: string;
  adjustment: Adjustment;
  region: Region;
  amount: number;
  invert: boolean;
  enabled: boolean;
  source: PlanSource;
  /** The command that produced this step, for the history list. */
  command?: string;
}

export interface EditStackState {
  steps: EditStep[];
  past: EditStep[][];
  future: EditStep[][];
  selectedId: string | null;
}

export type EditAction =
  | { type: 'apply'; steps: PlanStep[]; source: PlanSource; command?: string }
  | { type: 'update'; id: string; patch: Partial<Pick<EditStep, 'amount' | 'enabled' | 'invert'>>; commit?: boolean }
  | { type: 'remove'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

export const initialEditStack: EditStackState = { steps: [], past: [], future: [], selectedId: null };

const HISTORY_LIMIT = 50;
let counter = 0;
const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

function commit(state: EditStackState, steps: EditStep[], selectedId = state.selectedId): EditStackState {
  return {
    steps,
    past: [...state.past, state.steps].slice(-HISTORY_LIMIT),
    future: [],
    selectedId: steps.some((s) => s.id === selectedId) ? selectedId : null,
  };
}

export function editStackReducer(state: EditStackState, action: EditAction): EditStackState {
  switch (action.type) {
    case 'apply': {
      if (!action.steps.length) return state;
      const added = action.steps.map<EditStep>((s) => ({
        ...s,
        id: newId(),
        enabled: true,
        source: action.source,
        command: action.command,
      }));
      return commit(state, [...state.steps, ...added], added[added.length - 1].id);
    }
    case 'update': {
      const steps = state.steps.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s));
      // Slider drags update in place; the final value commits one history entry.
      return action.commit === false ? { ...state, steps } : commit(state, steps);
    }
    case 'remove':
      return commit(
        state,
        state.steps.filter((s) => s.id !== action.id),
      );
    case 'select':
      return { ...state, selectedId: action.id };
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        steps: previous,
        past: state.past.slice(0, -1),
        future: [state.steps, ...state.future],
        selectedId: null,
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { steps: next, past: [...state.past, state.steps], future: rest, selectedId: null };
    }
    case 'reset':
      return state.steps.length ? commit(state, [], null) : state;
  }
}
