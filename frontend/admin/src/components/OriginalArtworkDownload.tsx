import { PurchasePrivateUrlSchema } from '@insignia/contracts';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { authenticatedJson } from '../shared/admin-request';
import { startOriginalArtworkDownload } from '../shared/original-artwork-download';

export default function OriginalArtworkDownload({
  purchaseId,
  assetId,
  deny,
}: {
  purchaseId: string;
  assetId: string;
  deny: (error: unknown) => void;
}) {
  const { t } = useAdminLocale();
  const [notice, setNotice] = useState<'expired' | 'download-failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    setBusy(false);
    setNotice(null);
    setUnavailable(false);
    return () => {
      request.current?.abort();
    };
  }, [purchaseId, assetId]);
  async function download() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice(null);
    try {
      const result = PurchasePrivateUrlSchema.parse(
        await authenticatedJson(
          `/api/purchases/v1/${encodeURIComponent(purchaseId)}/artwork/${encodeURIComponent(assetId)}/download`,
          { signal: controller.signal },
        ),
      );
      if (controller.signal.aborted) return;
      if (Date.parse(result.expiresAt) <= Date.now()) throw Object.assign(new Error(), { status: 410 });
      startOriginalArtworkDownload(result.url);
    } catch (e) {
      if (!controller.signal.aborted) {
        const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : undefined;
        if (status === 410) {
          setUnavailable(true);
          setNotice('expired');
        } else {
          setNotice('download-failed');
        }
        deny(e);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <s-stack direction="inline" gap="small">
      {!unavailable && (
        <s-button type="button" disabled={busy} loading={busy} onClick={() => void download()}>
          {t('orders:artworkDownload.action')}
        </s-button>
      )}
      {notice && (
        <div role="status">
          <s-text tone={unavailable ? 'warning' : 'critical'}>
            {notice === 'expired' ? t('orders:artworkDownload.expired') : t('orders:artworkDownload.failed')}
          </s-text>
        </div>
      )}
    </s-stack>
  );
}
