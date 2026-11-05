import { useEffect, useMemo } from 'preact/hooks';
import { GuestLocaleProvider, guestLocaleController, useGuestLocale } from '../shared/guest-i18n';
import type { ArtworkPreview, ArtworkSelection, JsonApi } from './artwork-upload';
import type { ArtworkUploadNotice } from './artwork-upload-state';
import { createGuestArtworkApi } from './guest-artwork';
import { useArtworkUpload } from './use-artwork-upload';

/** M6 artwork only: no quote, cart or checkout behavior. */
export default function GuestArtworkUpload({
  proxyBase,
  productId,
  onPreview,
  onAssetChange,
  injectedJsonApi,
  locale,
}: {
  injectedJsonApi?: JsonApi;
  proxyBase: string;
  productId: string;
  onPreview: (preview: ArtworkPreview | null) => void;
  onAssetChange?: (asset: ArtworkSelection | null) => void;
  locale?: string | null;
}) {
  const localization = useMemo(() => guestLocaleController(locale), []);
  useEffect(() => {
    void localization.setLocale(locale ?? document.documentElement.lang);
  }, [locale, localization]);
  const api = useMemo(
    () => injectedJsonApi ?? createGuestArtworkApi({ proxyBase, productId }),
    [proxyBase, productId, injectedJsonApi],
  );
  return (
    <GuestLocaleProvider controller={localization}>
      <StorefrontArtworkUpload key={productId} api={api} onPreview={onPreview} onAssetChange={onAssetChange} />
    </GuestLocaleProvider>
  );
}

function uploadNotice(notice: ArtworkUploadNotice, locale: ReturnType<typeof useGuestLocale>): string {
  const { t } = locale;
  switch (notice.kind) {
    case 'requirements':
      return t('guest-artwork:upload.requirements');
    case 'file-rejected':
      return notice.reason === 'format' ? t('guest-artwork:upload.invalidFormat') : t('guest-artwork:upload.tooLarge');
    case 'progress':
      return notice.stage === 'allocating'
        ? t('guest-artwork:upload.allocating')
        : notice.stage === 'uploading'
          ? t('guest-artwork:upload.uploading')
          : t('guest-artwork:upload.processing');
    case 'verified':
      return t('guest-artwork:upload.verified', {
        expiresAt: new Intl.DateTimeFormat(locale.formatLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(notice.originalExpiresAt),
        ),
      });
    case 'preview-renewed':
      return t('guest-artwork:upload.previewRenewed');
    case 'download-prepared':
      return t('guest-artwork:upload.downloadPrepared');
    case 'expired':
      return t('guest-artwork:upload.expired');
    case 'inspection-rejected':
      return t('guest-artwork:upload.inspectionRejected');
    case 'processing-timeout':
      return t('guest-artwork:upload.processingTimeout');
    case 'upload-failed':
      return t('guest-artwork:upload.failed');
    case 'resume-failed':
      return t('guest-artwork:upload.resumeFailed');
    case 'preview-failed':
      return t('guest-artwork:upload.previewFailed');
    case 'download-failed':
      return t('guest-artwork:upload.downloadFailed');
    case 'access-denied':
      return t('guest-artwork:upload.accessDenied');
  }
}

/** Storefront custom elements are self-contained and do not load the merchant Polaris runtime. */
function StorefrontArtworkUpload(props: {
  api: JsonApi;
  onPreview: (preview: ArtworkPreview | null) => void;
  onAssetChange?: (asset: ArtworkSelection | null) => void;
}) {
  const localization = useGuestLocale();
  const { t } = localization;
  const { notice, busy, pending, asset, preview, selected, resumeUploaded, renewPreview } = useArtworkUpload(props);
  return (
    <section aria-label={t('guest-artwork:upload.privateArtwork')} lang={localization.lang} dir={localization.dir}>
      <h3>{t('guest-artwork:upload.previewHeading')}</h3>
      <label>
        {t('guest-artwork:upload.uploadAction')}{' '}
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
        {uploadNotice(notice, localization)}
      </p>
      {preview && (
        <img
          src={preview.url}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          alt={t('guest-artwork:upload.verifiedPreview')}
          style={{ maxWidth: '160px', maxHeight: '160px' }}
        />
      )}
      {pending && (
        <button type="button" disabled={busy} onClick={() => void resumeUploaded()}>
          {t('guest-artwork:upload.retryUpload')}
        </button>
      )}
      {asset && !preview && (
        <button type="button" disabled={busy} onClick={() => void renewPreview()}>
          {t('guest-artwork:upload.retryPreview')}
        </button>
      )}
    </section>
  );
}
