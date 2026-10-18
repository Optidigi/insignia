import AdminSkeleton from '../components/AdminSkeleton';
import PrivatePreviewImage from '../components/PrivatePreviewImage';
import { authenticatedJson } from '../shared/admin-request';
import { type ArtworkUploadStateProps, useArtworkUpload } from './use-artwork-upload';

type Props = Omit<ArtworkUploadStateProps, 'api'> & {
  disabled?: boolean;
  api?: ArtworkUploadStateProps['api'];
  allowOriginalDownload?: boolean;
};
/** Merchant upload controls use Polaris; state and privacy fences are shared with storefront. */
export default function ArtworkUpload({
  disabled = false,
  api = authenticatedJson,
  allowOriginalDownload = true,
  ...props
}: Props) {
  const {
    message,
    setMessage,
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
  return (
    <section aria-label="Private artwork">
      <s-heading>Artwork preview</s-heading>
      <s-drop-zone
        label="Upload artwork"
        accessibilityLabel="Upload artwork"
        accept="image/svg+xml,image/png,image/jpeg"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.currentTarget.files[0];
          event.currentTarget.value = '';
          void selected(file);
        }}
        onDropRejected={() => setMessage('Choose an SVG, PNG or JPEG up to 5 MiB.')}
      />
      {busy ? (
        <AdminSkeleton label="Processing artwork" rows={1} />
      ) : (
        <div role="status" aria-live="polite">
          <s-paragraph>{message}</s-paragraph>
        </div>
      )}
      {preview && (
        <PrivatePreviewImage src={preview.url} alt="Verified artwork preview" aspectRatio={preview.aspectRatio} />
      )}
      {pending && (
        <s-button disabled={disabled || busy} onClick={() => void resumeUploaded()}>
          Retry uploaded artwork
        </s-button>
      )}
      {asset && !preview && (
        <s-button disabled={disabled || busy} onClick={() => void renewPreview()}>
          Retry artwork preview
        </s-button>
      )}
      {asset && allowOriginalDownload && (
        <s-button disabled={disabled || busy} onClick={() => void download()}>
          Prepare original download
        </s-button>
      )}
      {asset && downloadLink && (
        <s-link href={downloadLink.url} target="_blank">
          Download verified original
        </s-link>
      )}
    </section>
  );
}
