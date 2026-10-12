import { useMemo } from 'preact/hooks';
import ArtworkUpload from './ArtworkUpload';
import type { ArtworkPreview, ArtworkSelection, JsonApi } from './artwork-upload';
import { createGuestArtworkApi } from './guest-artwork';

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
  return (
    <ArtworkUpload
      key={productId}
      api={api}
      allowOriginalDownload={false}
      onPreview={onPreview}
      onAssetChange={onAssetChange}
    />
  );
}
