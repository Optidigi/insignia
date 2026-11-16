/**
 * The Settings page's "Email customers about missing artwork" switch. One owner for the store's
 * saved choice, the change being saved and its outcome. The server's view is the only authority:
 * a save shows the requested value only while it is in flight, and every outcome settles back to
 * what the server last confirmed. Late completions are fenced by load generation and operation.
 */
export type CustomerEmailNotice = 'save-failed' | 'busy' | 'changed-elsewhere';
export type CustomerEmailSettingState =
  | { phase: 'loading'; generation: number; operation: number; notice: CustomerEmailNotice | null }
  | { phase: 'unavailable'; generation: number; operation: number }
  | {
      phase: 'ready';
      generation: number;
      operation: number;
      enabled: boolean;
      canEdit: boolean;
      notice: CustomerEmailNotice | null;
    }
  | { phase: 'saving'; generation: number; operation: number; enabled: boolean; requested: boolean };

export type CustomerEmailSettingEvent =
  | { type: 'load-started'; generation: number }
  | { type: 'loaded'; generation: number; enabled: boolean; canEdit: boolean }
  | { type: 'load-failed'; generation: number }
  | { type: 'change-requested'; operation: number; enabled: boolean }
  | { type: 'save-succeeded'; operation: number; enabled: boolean }
  | { type: 'save-failed'; operation: number; reason: 'failed' | 'busy' }
  | { type: 'save-conflicted'; operation: number };

export function initialCustomerEmailSettingState(): CustomerEmailSettingState {
  return { phase: 'loading', generation: 0, operation: 0, notice: null };
}

export function customerEmailSettingReducer(
  state: CustomerEmailSettingState,
  event: CustomerEmailSettingEvent,
): CustomerEmailSettingState {
  switch (event.type) {
    case 'load-started':
      // A reload never interrupts a save; the save's own outcome settles first.
      if (event.generation <= state.generation || state.phase === 'saving') return state;
      return {
        phase: 'loading',
        generation: event.generation,
        operation: state.operation,
        notice: state.phase === 'loading' || state.phase === 'ready' ? state.notice : null,
      };
    case 'loaded':
      if (state.phase !== 'loading' || event.generation !== state.generation) return state;
      return {
        phase: 'ready',
        generation: state.generation,
        operation: state.operation,
        enabled: event.enabled,
        canEdit: event.canEdit,
        notice: state.notice,
      };
    case 'load-failed':
      if (state.phase !== 'loading' || event.generation !== state.generation) return state;
      return { phase: 'unavailable', generation: state.generation, operation: state.operation };
    case 'change-requested':
      if (
        state.phase !== 'ready' ||
        !state.canEdit ||
        event.operation <= state.operation ||
        event.enabled === state.enabled
      )
        return state;
      return {
        phase: 'saving',
        generation: state.generation,
        operation: event.operation,
        enabled: state.enabled,
        requested: event.enabled,
      };
    case 'save-succeeded':
      if (state.phase !== 'saving' || event.operation !== state.operation) return state;
      return {
        phase: 'ready',
        generation: state.generation,
        operation: state.operation,
        enabled: event.enabled,
        canEdit: true,
        notice: null,
      };
    case 'save-failed':
      if (state.phase !== 'saving' || event.operation !== state.operation) return state;
      return {
        phase: 'ready',
        generation: state.generation,
        operation: state.operation,
        enabled: state.enabled,
        canEdit: true,
        notice: event.reason === 'busy' ? 'busy' : 'save-failed',
      };
    case 'save-conflicted':
      // Someone else changed it: show nothing as saved until the current value is read again.
      if (state.phase !== 'saving' || event.operation !== state.operation) return state;
      return {
        phase: 'ready',
        generation: state.generation,
        operation: state.operation,
        enabled: state.enabled,
        canEdit: true,
        notice: 'changed-elsewhere',
      };
  }
}

/** What the switch shows: the requested value only while it is being saved. */
export function customerEmailSettingChecked(state: CustomerEmailSettingState): boolean | null {
  if (state.phase === 'saving') return state.requested;
  return state.phase === 'ready' ? state.enabled : null;
}
