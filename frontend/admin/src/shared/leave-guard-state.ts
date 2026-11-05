export type LeaveGuardState = {
  phase: 'idle' | 'awaiting-runtime' | 'confirming' | 'host-confirming' | 'leaving';
  request: number;
  destination: string | null;
};
export type LeaveGuardEvent =
  | { type: 'confirmation-requested'; request: number; destination: string | null; host: boolean; allowed: boolean }
  | { type: 'dialog-ready'; request: number }
  | { type: 'confirmed'; request: number; allowed: boolean }
  | { type: 'dismissed'; request: number };

export function initialLeaveGuardState(): LeaveGuardState {
  return { phase: 'idle', request: 0, destination: null };
}
export function leaveGuardReducer(state: LeaveGuardState, event: LeaveGuardEvent): LeaveGuardState {
  if (event.type === 'confirmation-requested') {
    if (!event.allowed || state.phase !== 'idle' || event.request <= state.request) return state;
    return {
      phase: event.host ? 'host-confirming' : 'awaiting-runtime',
      request: event.request,
      destination: event.destination,
    };
  }
  if (event.request !== state.request) return state;
  switch (event.type) {
    case 'dialog-ready':
      return state.phase === 'awaiting-runtime' ? { ...state, phase: 'confirming' } : state;
    case 'confirmed':
      if (!event.allowed || (state.phase !== 'confirming' && state.phase !== 'host-confirming')) return state;
      return { ...state, phase: state.destination ? 'leaving' : 'idle', destination: state.destination };
    case 'dismissed':
      return state.phase === 'leaving' ? state : { ...initialLeaveGuardState(), request: state.request };
  }
}
