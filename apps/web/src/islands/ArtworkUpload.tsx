import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { authenticatedJson } from '../shared/admin-request';
import { type ArtworkPreview, type ArtworkSelection, createArtworkUpload, type JsonApi } from './artwork-upload';

type Props = {
  onPreview: (preview: ArtworkPreview | null) => void;
  onAssetChange?: (asset: ArtworkSelection | null) => void;
  onAuthenticationDenied?: (error: unknown) => void;
  disabled?: boolean;
  api?: JsonApi;
  allowOriginalDownload?: boolean;
};
/** Only the verified PNG derivative is displayed or supplied to the visualizer. */
export default function ArtworkUpload({
  onPreview,
  onAuthenticationDenied,
  onAssetChange,
  disabled = false,
  api = authenticatedJson,
  allowOriginalDownload = true,
}: Props) {
  const [message, setMessage] = useState('SVG, PNG or JPEG, up to 5 MiB.');
  const [busy, setBusy] = useState(false);
  const [asset, setAsset] = useState<ArtworkPreview | null>(null);
  const [preview, setPreview] = useState<ArtworkPreview | null>(null);
  const [downloadLink, setDownloadLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const currentAsset = useRef<ArtworkPreview | null>(null);
  currentAsset.current = asset;
  const callback = useRef(onPreview);
  callback.current = onPreview;
  const assetCallback = useRef(onAssetChange);
  assetCallback.current = onAssetChange;
  useEffect(
    () => () => {
      active.current?.abort();
      callback.current(null);
      assetCallback.current?.(null);
    },
    [],
  );
  useLayoutEffect(() => {
    assetCallback.current?.(asset ? { assetId: asset.assetId, assetExpiresAt: asset.assetExpiresAt } : null);
  }, [asset?.assetId, asset?.assetExpiresAt]);
  useLayoutEffect(() => {
    active.current?.abort();
    currentAsset.current = null;
    setAsset(null);
    setPreview(null);
    setDownloadLink(null);
    setBusy(false);
    callback.current(null);
  }, [api]);
  useEffect(() => {
    if (!asset) return;
    const timer = setTimeout(
      () => {
        active.current?.abort();
        currentAsset.current = null;
        setAsset(null);
        setPreview(null);
        setDownloadLink(null);
        callback.current(null);
        setMessage('Artwork expired. Upload it again.');
      },
      Math.max(0, Date.parse(asset.assetExpiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [asset]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => {
        // Remove the expired derivative immediately; the immutable asset stays selected.
        setPreview(null);
        callback.current(null);
        void renewPreview(preview);
      },
      Math.max(0, Date.parse(preview.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview, api]);
  async function renewPreview(selectedAsset = currentAsset.current) {
    if (!selectedAsset) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const result = await createArtworkUpload({ api }).renew(selectedAsset, controller.signal);
      if (controller.signal.aborted || currentAsset.current?.assetId !== selectedAsset.assetId) return;
      setAsset(result);
      setPreview(result);
      callback.current(result);
      setMessage('Artwork preview renewed.');
    } catch (error) {
      if (controller.signal.aborted || currentAsset.current?.assetId !== selectedAsset.assetId) return;
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        currentAsset.current = null;
        setAsset(null);
        setPreview(null);
        setDownloadLink(null);
        callback.current(null);
        if (status === 401 || status === 403) onAuthenticationDenied?.(error);
      }
      setMessage(error instanceof Error ? error.message : 'Preview unavailable. Retry the preview.');
    } finally {
      if (active.current === controller) setBusy(false);
    }
  }
  useEffect(() => {
    if (!downloadLink) return;
    const timer = setTimeout(() => setDownloadLink(null), Math.max(0, Date.parse(downloadLink.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [downloadLink]);
  async function selected(file: File | undefined) {
    if (!file) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setAsset(null);
    currentAsset.current = null;
    setPreview(null);
    setDownloadLink(null);
    onPreview(null);
    setBusy(true);
    try {
      const result = await createArtworkUpload({ api }).upload(file, setMessage, controller.signal);
      if (controller.signal.aborted) return;
      setAsset(result);
      setPreview(result);
      onPreview(result);
      setMessage(`Artwork verified. Original retained until ${new Date(result.assetExpiresAt).toLocaleString()}.`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPreview(null);
      onPreview(null);
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) onAuthenticationDenied?.(error);
      setMessage(error instanceof Error ? error.message : 'Artwork unavailable');
    } finally {
      if (active.current === controller) setBusy(false);
    }
  }
  async function download() {
    if (!asset) return;
    const id = asset.assetId;
    try {
      const result = await api<{ url: string; expiresAt: string }>(`/api/artwork/${asset.assetId}/download`);
      const url = new URL(result.url);
      if (url.protocol !== 'https:') throw new Error('Invalid download');
      if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now())
        throw new Error('Download expired');
      if (currentAsset.current?.assetId !== id) return;
      setDownloadLink({ url: url.href, expiresAt: result.expiresAt });
      setMessage('Private download prepared. Use Download verified original.');
    } catch (error) {
      if (currentAsset.current?.assetId !== id) return;
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        setDownloadLink(null);
        currentAsset.current = null;
        setAsset(null);
        setPreview(null);
        onPreview(null);
        onAuthenticationDenied?.(error);
      }
      setMessage(error instanceof Error ? error.message : 'Download unavailable');
    }
  }
  return (
    <section aria-label="Private artwork">
      <h3>Artwork preview</h3>
      <label>
        Upload artwork{' '}
        <input
          type="file"
          accept="image/svg+xml,image/png,image/jpeg"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void selected(file);
          }}
        />
      </label>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {preview && (
        <img
          src={preview.url}
          crossOrigin="anonymous"
          alt="Verified artwork preview"
          style={{ maxWidth: '160px', maxHeight: '160px' }}
        />
      )}
      {asset && !preview && (
        <button type="button" disabled={busy} onClick={() => void renewPreview()}>
          Retry artwork preview
        </button>
      )}
      {asset && allowOriginalDownload && (
        <button type="button" onClick={() => void download()}>
          Prepare original download
        </button>
      )}
      {asset && downloadLink && (
        <a href={downloadLink.url} target="_blank" rel="noopener noreferrer">
          Download verified original
        </a>
      )}
    </section>
  );
}
