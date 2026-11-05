import type { ArtworkSelection } from './artwork-upload';

type Selection = { kind: 'none' } | { kind: 'pending' | 'verified'; asset: ArtworkSelection };
type Operation = { kind: 'idle' } | { kind: 'upload' | 'resume' | 'renew' | 'download'; id: number };
export type ArtworkUploadNotice =
  | { kind: 'requirements' }
  | { kind: 'file-rejected'; reason: 'format' | 'size' }
  | { kind: 'progress'; stage: 'allocating' | 'uploading' | 'processing' }
  | { kind: 'verified'; originalExpiresAt: string }
  | { kind: 'preview-renewed' }
  | { kind: 'download-prepared' }
  | { kind: 'expired' }
  | { kind: 'inspection-rejected' }
  | { kind: 'processing-timeout' }
  | { kind: 'upload-failed' }
  | { kind: 'resume-failed' }
  | { kind: 'preview-failed' }
  | { kind: 'download-failed' }
  | { kind: 'access-denied' };

/** Only lease facts and stable notice reasons enter this model. Private URLs and copy stay outside. */
export type ArtworkUploadState = {
  selection: Selection;
  operation: Operation;
  previewExpiresAt: string | null;
  downloadExpiresAt: string | null;
  notice: ArtworkUploadNotice;
};
export type ArtworkUploadEvent =
  | { type: 'context-reset' }
  | { type: 'upload-started'; id: number }
  | { type: 'resume-started' | 'renew-started' | 'download-started'; id: number; assetId: string }
  | { type: 'admitted'; id: number; asset: ArtworkSelection }
  | { type: 'progress'; id: number; stage: 'allocating' | 'uploading' | 'processing' }
  | { type: 'verified'; id: number; asset: ArtworkSelection; previewExpiresAt: string; originalExpiresAt: string }
  | { type: 'failed'; id: number; status: number | undefined; notice: ArtworkUploadNotice }
  | { type: 'download-prepared'; id: number; expiresAt: string }
  | { type: 'asset-expired'; assetId: string; expiresAt: string }
  | { type: 'preview-expired'; assetId: string; expiresAt: string }
  | { type: 'download-expired'; expiresAt: string }
  | { type: 'file-rejected'; reason: 'format' | 'size' };

export function initialArtworkUploadState(): ArtworkUploadState {
  return {
    selection: { kind: 'none' },
    operation: { kind: 'idle' },
    previewExpiresAt: null,
    downloadExpiresAt: null,
    notice: { kind: 'requirements' },
  };
}

export function artworkFailureClearsSelection(
  kind: 'upload' | 'resume' | 'renew' | 'download',
  status: number | undefined,
): boolean {
  return (
    status === 401 || status === 403 || (kind !== 'download' && (status === 404 || status === 410 || status === 422))
  );
}

export function artworkUploadReducer(state: ArtworkUploadState, event: ArtworkUploadEvent): ArtworkUploadState {
  switch (event.type) {
    case 'context-reset':
      return initialArtworkUploadState();
    case 'upload-started':
      return {
        ...initialArtworkUploadState(),
        operation: { kind: 'upload', id: event.id },
        notice: { kind: 'progress', stage: 'allocating' },
      };
    case 'resume-started':
    case 'renew-started':
    case 'download-started': {
      const expected = event.type === 'resume-started' ? 'pending' : 'verified';
      if (state.selection.kind !== expected || state.selection.asset.assetId !== event.assetId) return state;
      return {
        ...state,
        operation: {
          kind: event.type === 'resume-started' ? 'resume' : event.type === 'renew-started' ? 'renew' : 'download',
          id: event.id,
        },
        notice: event.type === 'download-started' ? state.notice : { kind: 'progress', stage: 'processing' },
      };
    }
    case 'file-rejected':
      return { ...state, notice: { kind: 'file-rejected', reason: event.reason } };
    case 'asset-expired':
      if (
        state.selection.kind === 'none' ||
        state.selection.asset.assetId !== event.assetId ||
        state.selection.asset.assetExpiresAt !== event.expiresAt
      )
        return state;
      return { ...initialArtworkUploadState(), notice: { kind: 'expired' } };
    case 'preview-expired':
      if (
        state.selection.kind !== 'verified' ||
        state.selection.asset.assetId !== event.assetId ||
        state.previewExpiresAt !== event.expiresAt
      )
        return state;
      return { ...state, previewExpiresAt: null };
    case 'download-expired':
      return state.downloadExpiresAt === event.expiresAt ? { ...state, downloadExpiresAt: null } : state;
    default:
      if (state.operation.kind === 'idle' || state.operation.id !== event.id) return state;
      switch (event.type) {
        case 'progress':
          return { ...state, notice: { kind: 'progress', stage: event.stage } };
        case 'admitted':
          return state.operation.kind === 'upload'
            ? { ...state, selection: { kind: 'pending', asset: event.asset } }
            : state;
        case 'verified':
          if (state.operation.kind === 'download') return state;
          if (state.selection.kind !== 'none' && state.selection.asset.assetId !== event.asset.assetId) return state;
          return {
            ...state,
            operation: { kind: 'idle' },
            selection: { kind: 'verified', asset: event.asset },
            previewExpiresAt: event.previewExpiresAt,
            notice:
              state.operation.kind === 'renew'
                ? { kind: 'preview-renewed' }
                : { kind: 'verified', originalExpiresAt: event.originalExpiresAt },
          };
        case 'download-prepared':
          return state.operation.kind === 'download'
            ? {
                ...state,
                operation: { kind: 'idle' },
                downloadExpiresAt: event.expiresAt,
                notice: { kind: 'download-prepared' },
              }
            : state;
        case 'failed': {
          const clear = artworkFailureClearsSelection(state.operation.kind, event.status);
          return {
            ...(clear ? initialArtworkUploadState() : state),
            operation: { kind: 'idle' },
            notice: event.notice,
          };
        }
      }
  }
}
