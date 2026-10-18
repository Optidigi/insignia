import { useMemo } from 'preact/hooks';
import type { ArtworkPreview, ArtworkSelection, JsonApi } from './artwork-upload';
import { createGuestArtworkApi } from './guest-artwork';
import { useArtworkUpload } from './use-artwork-upload';

/** M6 artwork only: no quote, cart or checkout behavior. */
export default function GuestArtworkUpload({
  proxyBase,
  productId,
  onPreview,
  onAssetChange,
  injectedJsonApi,
}: {
  injectedJsonApi?: JsonApi;
  proxyBase: string;
  productId: string;
  onPreview: (preview: ArtworkPreview | null) => void;
  onAssetChange?: (asset: ArtworkSelection | null) => void;
}) {
  const api = useMemo(
    () => injectedJsonApi ?? createGuestArtworkApi({ proxyBase, productId }),
    [proxyBase, productId, injectedJsonApi],
  );
  return <StorefrontArtworkUpload key={productId} api={api} onPreview={onPreview} onAssetChange={onAssetChange} />;
}

/** Storefront custom elements are self-contained and do not load the merchant Polaris runtime. */
function StorefrontArtworkUpload(props: {
  api: JsonApi;
  onPreview: (preview: ArtworkPreview | null) => void;
  onAssetChange?: (asset: ArtworkSelection | null) => void;
}) {
  const { message, busy, pending, asset, preview, selected, resumeUploaded, renewPreview } = useArtworkUpload(props);
  return (
    <section aria-label="Private artwork">
      <h3>Artwork preview</h3>
      <label>
        Upload artwork{' '}
        <input
          type="file"
          accept="image/svg+xml,image/png,image/jpeg"
          disabled={busy}
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
          referrerPolicy="no-referrer"
          alt="Verified artwork preview"
          style={{ maxWidth: '160px', maxHeight: '160px' }}
        />
      )}
      {pending && (
        <button type="button" disabled={busy} onClick={() => void resumeUploaded()}>
          Retry uploaded artwork
        </button>
      )}
      {asset && !preview && (
        <button type="button" disabled={busy} onClick={() => void renewPreview()}>
          Retry artwork preview
        </button>
      )}
    </section>
  );
}
