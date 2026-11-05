import { useEffect, useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import {
  type ArtworkPreview,
  type ArtworkSelection,
  ArtworkUploadError,
  createArtworkUpload,
  type JsonApi,
} from './artwork-upload';
import {
  type ArtworkUploadNotice,
  artworkFailureClearsSelection,
  artworkUploadReducer,
  initialArtworkUploadState,
} from './artwork-upload-state';

export type ArtworkUploadStateProps = {
  onPreview: (preview: ArtworkPreview | null) => void;
  onAssetChange?: (asset: ArtworkSelection | null) => void;
  onAuthenticationDenied?: (error: unknown) => void;
  api: JsonApi;
};

/** The model owns lease facts. This adapter owns private URLs, cancellation and callbacks. */
export function useArtworkUpload({ onPreview, onAssetChange, onAuthenticationDenied, api }: ArtworkUploadStateProps) {
  const [state, dispatch] = useReducer(artworkUploadReducer, undefined, initialArtworkUploadState);
  const privateAsset = useRef<ArtworkPreview | null>(null);
  const privateDownload = useRef<{ url: string; expiresAt: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const operationKind = useRef<'upload' | 'resume' | 'renew' | 'download' | null>(null);
  const generation = useRef(0);
  const selectionEpoch = useRef(0);
  const callback = useRef(onPreview);
  callback.current = onPreview;
  const assetCallback = useRef(onAssetChange);
  assetCallback.current = onAssetChange;
  const deniedCallback = useRef(onAuthenticationDenied);
  deniedCallback.current = onAuthenticationDenied;
  const pending = state.selection.kind === 'pending' ? state.selection.asset : null;
  const asset =
    state.selection.kind === 'verified' && privateAsset.current?.assetId === state.selection.asset.assetId
      ? privateAsset.current
      : null;
  const preview = asset && state.previewExpiresAt === asset.expiresAt ? asset : null;
  const downloadLink = privateDownload.current?.expiresAt === state.downloadExpiresAt ? privateDownload.current : null;
  const busy = state.operation.kind !== 'idle';

  function clearResources() {
    active.current?.abort();
    active.current = null;
    operationKind.current = null;
    privateAsset.current = null;
    privateDownload.current = null;
  }
  function begin(kind: NonNullable<typeof operationKind.current>) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    operationKind.current = kind;
    return { controller, id: ++generation.current };
  }
  function owns(controller: AbortController) {
    return active.current === controller && !controller.signal.aborted;
  }
  function finish(controller: AbortController) {
    if (active.current !== controller) return;
    active.current = null;
    operationKind.current = null;
  }
  useEffect(
    () => () => {
      selectionEpoch.current++;
      clearResources();
      callback.current(null);
      assetCallback.current?.(null);
    },
    [],
  );
  useLayoutEffect(() => {
    assetCallback.current?.(asset ? { assetId: asset.assetId, assetExpiresAt: asset.assetExpiresAt } : null);
  }, [asset?.assetId, asset?.assetExpiresAt]);
  useLayoutEffect(() => {
    selectionEpoch.current++;
    clearResources();
    dispatch({ type: 'context-reset' });
    callback.current(null);
  }, [api]);
  useEffect(() => {
    const retained = asset ?? pending;
    if (!retained) return;
    const epoch = selectionEpoch.current;
    const timer = setTimeout(
      () => {
        if (epoch !== selectionEpoch.current) return;
        if (privateAsset.current && privateAsset.current.assetExpiresAt !== retained.assetExpiresAt) return;
        clearResources();
        dispatch({ type: 'asset-expired', assetId: retained.assetId, expiresAt: retained.assetExpiresAt });
        callback.current(null);
      },
      Math.max(0, Date.parse(retained.assetExpiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [asset?.assetId, asset?.assetExpiresAt, pending?.assetId, pending?.assetExpiresAt]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => {
        if (privateAsset.current !== preview) return;
        dispatch({ type: 'preview-expired', assetId: preview.assetId, expiresAt: preview.expiresAt });
        callback.current(null);
        void renewPreview(preview);
      },
      Math.max(0, Date.parse(preview.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview, api]);
  useEffect(() => {
    if (!downloadLink) return;
    const timer = setTimeout(
      () => {
        if (privateDownload.current !== downloadLink) return;
        privateDownload.current = null;
        dispatch({ type: 'download-expired', expiresAt: downloadLink.expiresAt });
      },
      Math.max(0, Date.parse(downloadLink.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [downloadLink]);

  function failure(kind: NonNullable<typeof operationKind.current>, id: number, error: unknown) {
    const status =
      error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
    if (artworkFailureClearsSelection(kind, status)) {
      privateAsset.current = null;
      privateDownload.current = null;
      callback.current(null);
    }
    const notice: ArtworkUploadNotice =
      status === 401 || status === 403
        ? { kind: 'access-denied' }
        : error instanceof ArtworkUploadError && error.reason === 'expired'
          ? kind === 'download'
            ? { kind: 'download-failed' }
            : { kind: 'expired' }
          : error instanceof ArtworkUploadError && error.reason === 'processing-timeout'
            ? { kind: 'processing-timeout' }
            : error instanceof ArtworkUploadError && error.reason === 'inspection-rejected'
              ? { kind: 'inspection-rejected' }
              : error instanceof ArtworkUploadError && error.reason === 'file-format-rejected'
                ? { kind: 'file-rejected', reason: 'format' }
                : error instanceof ArtworkUploadError && error.reason === 'file-size-rejected'
                  ? { kind: 'file-rejected', reason: 'size' }
                  : status === 410 && kind !== 'download'
                    ? { kind: 'expired' }
                    : status === 422
                      ? { kind: 'inspection-rejected' }
                      : kind === 'upload'
                        ? { kind: 'upload-failed' }
                        : kind === 'resume'
                          ? { kind: 'resume-failed' }
                          : kind === 'renew'
                            ? { kind: 'preview-failed' }
                            : { kind: 'download-failed' };
    dispatch({ type: 'failed', id, status, notice });
    if (status === 401 || status === 403) deniedCallback.current?.(error);
  }
  function verified(id: number, result: ArtworkPreview) {
    privateAsset.current = result;
    dispatch({
      type: 'verified',
      id,
      asset: { assetId: result.assetId, assetExpiresAt: result.assetExpiresAt },
      previewExpiresAt: result.expiresAt,
      originalExpiresAt: result.assetExpiresAt,
    });
    callback.current(result);
  }
  async function selected(file: File | undefined) {
    if (!file) return;
    selectionEpoch.current++;
    const { controller, id } = begin('upload');
    privateAsset.current = null;
    privateDownload.current = null;
    dispatch({ type: 'upload-started', id });
    callback.current(null);
    try {
      const result = await createArtworkUpload({
        api,
        onPending: (admitted) => {
          if (owns(controller)) dispatch({ type: 'admitted', id, asset: admitted });
        },
      }).upload(
        file,
        (stage) => {
          if (owns(controller)) dispatch({ type: 'progress', id, stage });
        },
        controller.signal,
      );
      if (!owns(controller)) return;
      verified(id, result);
    } catch (error) {
      if (owns(controller)) failure('upload', id, error);
    } finally {
      finish(controller);
    }
  }
  async function resumeUploaded() {
    if (!pending || active.current) return;
    const retained = pending;
    const { controller, id } = begin('resume');
    dispatch({ type: 'resume-started', id, assetId: retained.assetId });
    try {
      const result = await createArtworkUpload({ api }).resume(
        retained,
        (message) => {
          if (owns(controller)) dispatch({ type: 'progress', id, stage: message });
        },
        controller.signal,
      );
      if (!owns(controller)) return;
      verified(id, result);
    } catch (error) {
      if (owns(controller)) failure('resume', id, error);
    } finally {
      finish(controller);
    }
  }
  async function renewPreview(selectedAsset = privateAsset.current) {
    if (!selectedAsset || privateAsset.current !== selectedAsset) return;
    if (active.current && operationKind.current === 'renew') return;
    const { controller, id } = begin('renew');
    dispatch({ type: 'renew-started', id, assetId: selectedAsset.assetId });
    try {
      const result = await createArtworkUpload({ api }).renew(selectedAsset, controller.signal);
      if (!owns(controller) || privateAsset.current !== selectedAsset) return;
      verified(id, result);
    } catch (error) {
      if (owns(controller)) failure('renew', id, error);
    } finally {
      finish(controller);
    }
  }
  async function download() {
    if (!asset || active.current) return;
    const retained = asset;
    const { controller, id } = begin('download');
    dispatch({ type: 'download-started', id, assetId: retained.assetId });
    try {
      const result = await api(`/api/artwork/${retained.assetId}/download`, { signal: controller.signal });
      if (!owns(controller) || privateAsset.current !== retained) return;
      if (
        result === null ||
        typeof result !== 'object' ||
        !('url' in result) ||
        typeof result.url !== 'string' ||
        !('expiresAt' in result) ||
        typeof result.expiresAt !== 'string'
      )
        throw new ArtworkUploadError('invalid-response');
      const url = new URL(result.url);
      if (url.protocol !== 'https:') throw new ArtworkUploadError('invalid-response');
      if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now())
        throw new ArtworkUploadError('expired', 410);
      privateDownload.current = { url: url.href, expiresAt: result.expiresAt };
      dispatch({ type: 'download-prepared', id, expiresAt: result.expiresAt });
    } catch (error) {
      if (owns(controller)) failure('download', id, error);
    } finally {
      finish(controller);
    }
  }
  return {
    notice: state.notice,
    rejectFile: (reason: 'format' | 'size') => dispatch({ type: 'file-rejected', reason }),
    busy,
    pending,
    asset,
    preview,
    downloadLink,
    selected,
    resumeUploaded,
    renewPreview,
    download,
  };
}
