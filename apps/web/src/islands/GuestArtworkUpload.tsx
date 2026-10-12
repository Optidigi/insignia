import { useMemo } from 'preact/hooks';
import ArtworkUpload from './ArtworkUpload';
import type { ArtworkPreview } from './artwork-upload';
import { createGuestArtworkApi } from './guest-artwork';

/** M6 artwork only: no quote, cart or checkout behavior. */
export default function GuestArtworkUpload({
  proxyBase,
  productId,
  onPreview,
}: {
  proxyBase: string;
  productId: string;
  onPreview: (preview: ArtworkPreview | null) => void;
}) {
  const api = useMemo(() => createGuestArtworkApi({ proxyBase, productId }), [proxyBase, productId]);
  return <ArtworkUpload key={productId} api={api} allowOriginalDownload={false} onPreview={onPreview} />;
}
