import { ARTWORK_UPLOAD_ACCEPT } from '@insignia/contracts';
import type { Ref } from 'preact';
import AdminSkeleton from '../components/AdminSkeleton';
import PrivatePreviewImage from '../components/PrivatePreviewImage';
import { useAdminLocale } from '../shared/admin-i18n';
import { authenticatedJson } from '../shared/admin-request';
import { type ArtworkUploadStateProps, useArtworkUpload } from './use-artwork-upload';

type Props = Omit<ArtworkUploadStateProps, 'api'> & {
  disabled?: boolean;
  api?: ArtworkUploadStateProps['api'];
  allowOriginalDownload?: boolean;
  focusRef?: Ref<HTMLElement>;
};
/** Merchant upload controls use Polaris; state and privacy fences are shared with storefront. */
export default function ArtworkUpload({
  disabled = false,
  api = authenticatedJson,
  allowOriginalDownload = true,
  focusRef,
  ...props
}: Props) {
  const { t, formatLocale } = useAdminLocale();
  const {
    notice,
    rejectFile,
    busy,
    pending,
    asset,
    preview,
    downloadLink,
    selected,
    resumeUploaded,
    renewPreview,
    download,
  } = useArtworkUpload({ ...props, api });
  const noticeCopy = (() => {
    switch (notice.kind) {
      case 'requirements':
        return t('artwork:upload.requirement');
      case 'file-rejected':
        return notice.reason === 'format' ? t('artwork:upload.invalidFormat') : t('artwork:upload.tooLarge');
      case 'progress':
        return notice.stage === 'allocating'
          ? t('artwork:upload.progress.allocating')
          : notice.stage === 'uploading'
            ? t('artwork:upload.progress.uploading')
            : t('artwork:upload.progress.processing');
      case 'verified':
        return t('artwork:upload.verified', {
          expiry: new Intl.DateTimeFormat(formatLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(notice.originalExpiresAt),
          ),
        });
      case 'preview-renewed':
        return t('artwork:upload.previewRenewed');
      case 'download-prepared':
        return t('artwork:upload.downloadPrepared');
      case 'expired':
        return t('artwork:upload.expired');
      case 'inspection-rejected':
        return t('artwork:upload.inspectionRejected');
      case 'processing-timeout':
        return t('artwork:upload.processingTimeout');
      case 'upload-failed':
        return t('artwork:upload.uploadFailed');
      case 'resume-failed':
        return t('artwork:upload.resumeFailed');
      case 'preview-failed':
        return t('artwork:upload.previewFailed');
      case 'download-failed':
        return t('artwork:upload.downloadFailed');
      case 'access-denied':
        return t('artwork:upload.accessDenied');
    }
  })();
  return (
    <section ref={focusRef} tabIndex={-1} aria-label={t('artwork:upload.region')}>
      <s-stack gap="base">
        <s-drop-zone
          label={t('artwork:upload.action')}
          accessibilityLabel={t('artwork:upload.action')}
          accept={ARTWORK_UPLOAD_ACCEPT}
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.currentTarget.files[0];
            event.currentTarget.value = '';
            void selected(file);
          }}
          onDropRejected={() => rejectFile('format')}
        />
        {busy ? (
          <AdminSkeleton variant="inline" label={t('artwork:upload.progress.processing')} rows={1} />
        ) : (
          <div role="status" aria-live="polite">
            <s-paragraph>{noticeCopy}</s-paragraph>
          </div>
        )}
        {preview && (
          <PrivatePreviewImage
            src={preview.url}
            alt={t('artwork:upload.verifiedPreviewAlt')}
            aspectRatio={preview.aspectRatio}
          />
        )}
        {pending && (
          <s-button disabled={disabled || busy} onClick={() => void resumeUploaded()}>
            {t('artwork:upload.actions.retryUploaded')}
          </s-button>
        )}
        {asset && !preview && (
          <s-button disabled={disabled || busy} onClick={() => void renewPreview()}>
            {t('artwork:upload.actions.retryPreview')}
          </s-button>
        )}
        {asset && allowOriginalDownload && (
          <s-button disabled={disabled || busy} onClick={() => void download()}>
            {t('artwork:upload.actions.prepareDownload')}
          </s-button>
        )}
        {asset && downloadLink && (
          <s-link href={downloadLink.url} target="_blank">
            {t('artwork:upload.actions.downloadVerifiedOriginal')}
          </s-link>
        )}
      </s-stack>
    </section>
  );
}
