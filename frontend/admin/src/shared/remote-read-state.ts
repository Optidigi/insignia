type Observation<T> =
  | { phase: 'ready'; value: T }
  | { phase: 'loading' | 'failed'; value: T | null }
  | { phase: 'denied' | 'missing'; value: null };

/** Per-resource observation, never an application cache or permission authority. */
export type RemoteReadState<T> = Observation<T> & {
  request: number;
  hasLoaded: boolean;
  message: string;
  status: number | undefined;
};
export type RemoteReadEvent<T> =
  | { type: 'read-started'; request: number; clear?: boolean }
  | { type: 'read-succeeded'; request: number; value: T }
  | { type: 'read-failed'; request: number; status: number | undefined; message: string }
  | { type: 'observation-replaced'; request: number; value: T }
  | { type: 'access-revoked'; request: number; status: number; message: string }
  | { type: 'context-reset'; request: number };

export function initialRemoteReadState<T>(): RemoteReadState<T> {
  return { phase: 'loading', value: null, request: 0, hasLoaded: false, message: '', status: undefined };
}

export function remoteReadReducer<T>(state: RemoteReadState<T>, event: RemoteReadEvent<T>): RemoteReadState<T> {
  if (event.request < state.request) return state;
  switch (event.type) {
    case 'context-reset':
      return { ...initialRemoteReadState<T>(), request: event.request };
    case 'read-started':
      return {
        ...state,
        phase: 'loading',
        value: event.clear ? null : state.value,
        request: event.request,
        message: '',
        status: undefined,
      };
    case 'access-revoked':
      return {
        ...state,
        phase: 'denied',
        value: null,
        request: event.request,
        status: event.status,
        message: event.message,
      };
    case 'observation-replaced':
      return {
        phase: 'ready',
        value: event.value,
        request: event.request,
        hasLoaded: true,
        message: '',
        status: undefined,
      };
    case 'read-succeeded':
      return event.request === state.request && state.phase === 'loading'
        ? { ...state, phase: 'ready', value: event.value, hasLoaded: true, message: '', status: undefined }
        : state;
    case 'read-failed': {
      if (event.request !== state.request || state.phase !== 'loading') return state;
      if (event.status === 401 || event.status === 403)
        return { ...state, phase: 'denied', value: null, status: event.status, message: event.message };
      if (event.status === 404)
        return { ...state, phase: 'missing', value: null, status: event.status, message: event.message };
      return { ...state, phase: 'failed', message: event.message, status: event.status };
    }
  }
}
