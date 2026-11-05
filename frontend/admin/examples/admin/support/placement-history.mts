/** Bounded undo/redo snapshots for immutable placement draft state. */
export type PlacementHistory<T> = {
  past: PlacementSnapshot<T>[];
  future: PlacementSnapshot<T>[];
  group: string | null;
  limit: number;
};

export type PlacementHistoryMove<T> = { state: T; changed: boolean };
type PlacementSnapshot<T> = { state: T };

const defaultHistoryLimit = 50;

/** Compare immutable drafts without serializing unchanged image data on pointer updates. */
export function placementDraftEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const left = first as Record<string, unknown>;
  const right = second as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && placementDraftEqual(left[key], right[key]))
  );
}

export function createPlacementHistory<T>(limit = defaultHistoryLimit): PlacementHistory<T> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(defaultHistoryLimit, Math.max(1, Math.floor(limit)))
    : defaultHistoryLimit;
  return { past: [], future: [], group: null, limit: boundedLimit };
}

function pushBounded<T>(items: PlacementSnapshot<T>[], state: T, limit: number): void {
  items.push({ state });
  if (items.length > limit) items.shift();
}

/** Record a new immutable state; calls with the same group share one undo step. */
export function commitPlacementHistory<T>(history: PlacementHistory<T>, current: T, next: T, group?: string): void {
  if (Object.is(current, next)) return;

  if (!group || history.group !== group) pushBounded(history.past, current, history.limit);
  history.future.length = 0;
  history.group = group ?? null;
}

/** Commit one product draft only when its visible data changed. */
export function commitPlacementDraftChange<T>(
  history: PlacementHistory<T>,
  current: T,
  next: T,
  group?: string,
): boolean {
  if (placementDraftEqual(current, next)) return false;
  commitPlacementHistory(history, current, next, group);
  return true;
}

export function undoPlacementHistory<T>(history: PlacementHistory<T>, current: T): PlacementHistoryMove<T> {
  history.group = null;
  const snapshot = history.past.pop();
  if (!snapshot) return { state: current, changed: false };
  pushBounded(history.future, current, history.limit);
  return { state: snapshot.state, changed: true };
}

export function redoPlacementHistory<T>(history: PlacementHistory<T>, current: T): PlacementHistoryMove<T> {
  history.group = null;
  const snapshot = history.future.pop();
  if (!snapshot) return { state: current, changed: false };
  pushBounded(history.past, current, history.limit);
  return { state: snapshot.state, changed: true };
}

export function endPlacementHistoryGroup<T>(history: PlacementHistory<T>): void {
  history.group = null;
}

export function resetPlacementHistory<T>(history: PlacementHistory<T>): void {
  history.past.length = 0;
  history.future.length = 0;
  history.group = null;
}
