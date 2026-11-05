/** Lifecycle only: prepared bytes, object URLs and disposal stay with each export adapter. */
export type PreparedExportState<Message> = {
  phase: 'idle' | 'preparing' | 'ready' | 'downloading' | 'failed';
  attempt: number;
  message: Message | null;
  progress: Message | null;
  completed: number;
};

export type PreparedExportEvent<Message> =
  | { type: 'invalidated'; attempt: number; message?: Message }
  | { type: 'preparation-started'; attempt: number; label: Message }
  | { type: 'preparation-progress'; attempt: number; label: Message; completed?: number }
  | { type: 'prepared'; attempt: number }
  | { type: 'download-started'; attempt: number; label?: Message }
  | { type: 'download-finished'; attempt: number };

export function initialPreparedExportState<Message>(): PreparedExportState<Message> {
  return { phase: 'idle', attempt: 0, message: null, progress: null, completed: 0 };
}

export function preparedExportReducer<Message>(
  state: PreparedExportState<Message>,
  event: PreparedExportEvent<Message>,
): PreparedExportState<Message> {
  if (event.attempt < state.attempt) return state;
  if (event.type === 'invalidated')
    return {
      ...initialPreparedExportState<Message>(),
      attempt: event.attempt,
      phase: event.message ? 'failed' : 'idle',
      message: event.message ?? null,
    };
  if (event.type === 'preparation-started')
    return {
      ...initialPreparedExportState<Message>(),
      phase: 'preparing',
      attempt: event.attempt,
      progress: event.label,
    };
  if (event.attempt !== state.attempt) return state;
  switch (event.type) {
    case 'preparation-progress':
      if (state.phase !== 'preparing' && state.phase !== 'downloading') return state;
      return { ...state, progress: event.label, completed: event.completed ?? state.completed };
    case 'prepared':
      return state.phase === 'preparing' ? { ...state, phase: 'ready', progress: null } : state;
    case 'download-started':
      return state.phase === 'ready'
        ? { ...state, phase: 'downloading', progress: event.label ?? null, message: null }
        : state;
    case 'download-finished':
      return state.phase === 'downloading' ? { ...state, phase: 'ready', progress: null } : state;
  }
}
