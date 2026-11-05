export type AttachmentErrorCode = 'accessFailed' | 'artworkChanged' | 'attachmentFailed';

export type AttachmentState = {
  identity: string;
  selected: string | null;
  replacing: boolean;
  operation: 'idle' | 'preview' | 'download' | 'attach';
  request: number;
  errorCode: AttachmentErrorCode | null;
};
export type AttachmentEvent =
  | { type: 'context-changed'; identity: string; request: number }
  | { type: 'replacement-requested' | 'replacement-cancelled'; identity: string }
  | { type: 'upload-selected'; identity: string; assetId: string | null }
  | { type: 'operation-started'; identity: string; request: number; operation: 'preview' | 'download' | 'attach' }
  | { type: 'operation-finished'; identity: string; request: number }
  | { type: 'operation-failed'; identity: string; request: number; errorCode: AttachmentErrorCode };
export function initialAttachmentState(identity: string): AttachmentState {
  return { identity, selected: null, replacing: false, operation: 'idle', request: 0, errorCode: null };
}
export function attachmentReducer(state: AttachmentState, event: AttachmentEvent): AttachmentState {
  if (event.type === 'context-changed')
    return event.request < state.request
      ? state
      : { ...initialAttachmentState(event.identity), request: event.request };
  if (event.identity !== state.identity) return state;
  switch (event.type) {
    case 'replacement-requested':
      return state.operation === 'idle' ? { ...state, replacing: true, errorCode: null } : state;
    case 'replacement-cancelled':
      return state.operation === 'idle' ? { ...state, selected: null, replacing: false, errorCode: null } : state;
    case 'upload-selected':
      return state.operation === 'attach' ? state : { ...state, selected: event.assetId };
    case 'operation-started':
      if (
        event.request <= state.request ||
        state.operation !== 'idle' ||
        (event.operation === 'attach' && !state.selected)
      )
        return state;
      return { ...state, operation: event.operation, request: event.request, errorCode: null };
    case 'operation-finished':
      return event.request === state.request && state.operation !== 'idle' ? { ...state, operation: 'idle' } : state;
    case 'operation-failed':
      return event.request === state.request && state.operation !== 'idle'
        ? { ...state, operation: 'idle', errorCode: event.errorCode }
        : state;
  }
}
