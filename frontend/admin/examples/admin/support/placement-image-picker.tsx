import { useEffect, useId, useRef, useState } from 'preact/hooks';
import AdminTruncatedLabel from '../../../src/components/AdminTruncatedLabel.tsx';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import { StoredPreviewUnreadableError } from '../../../src/shared/stored-preview-error.ts';
import type { EditorProductImage } from './placement-workflow-model.mts';

const maxFileSize = 5 * 1024 * 1024;
const maxDataUrlLength = 1_000_000;
const maxImageEdge = 1200;
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
type ImagePreparationFailure =
  | 'canvas-unavailable'
  | 'webp-unsupported'
  | 'too-detailed'
  | 'invalid-dimensions'
  | 'processing-failed';
type ImageUploadIssue = {
  fileName?: string;
  reason: ImagePreparationFailure | 'format-rejected' | 'size-rejected' | 'preview-unreadable';
};

class ImagePreparationError extends Error {
  constructor(readonly reason: Exclude<ImagePreparationFailure, 'processing-failed'>) {
    super(reason);
  }
}

type ImageFilter = 'all' | 'unused' | 'in-use';

function imageDimensions(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encodeWebp(bitmap: ImageBitmap): { dataUrl: string; width: number; height: number } {
  let { width, height } = imageDimensions(bitmap.width, bitmap.height, maxImageEdge);
  const canvas = document.createElement('canvas');
  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new ImagePreparationError('canvas-unavailable');
      context.drawImage(bitmap, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/webp', 0.85);
      if (!dataUrl.startsWith('data:image/webp;base64,')) {
        throw new ImagePreparationError('webp-unsupported');
      }
      if (dataUrl.length <= maxDataUrlLength) return { dataUrl, width, height };

      const shrink = Math.min(0.88, Math.sqrt(maxDataUrlLength / dataUrl.length) * 0.9);
      const nextWidth = Math.max(1, Math.floor(width * shrink));
      const nextHeight = Math.max(1, Math.floor(height * shrink));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  throw new ImagePreparationError('too-detailed');
}

function imageIssueReason(reason: ImageUploadIssue['reason'], t: ReturnType<typeof useAdminLocale>['t']): string {
  switch (reason) {
    case 'format-rejected':
      return t('editor:placementImagePicker.errors.formatRejected');
    case 'size-rejected':
      return t('editor:placementImagePicker.errors.sizeRejected');
    case 'canvas-unavailable':
      return t('editor:placementImagePicker.errors.canvasUnavailable');
    case 'webp-unsupported':
      return t('editor:placementImagePicker.errors.webpUnsupported');
    case 'too-detailed':
      return t('editor:placementImagePicker.errors.tooDetailed');
    case 'invalid-dimensions':
      return t('editor:placementImagePicker.errors.invalidDimensions');
    case 'processing-failed':
      return t('editor:placementImagePicker.errors.processingFailed');
    case 'preview-unreadable':
      return t('editor:placementImagePicker.errors.previewUnreadable');
  }
}

function imageUploadError(
  issues: ImageUploadIssue[],
  t: ReturnType<typeof useAdminLocale>['t'],
  locale: string,
): string {
  if (!issues.length) return '';
  if (issues.length === 1) {
    const issue = issues[0];
    if (!issue) return '';
    if (!issue.fileName) return imageIssueReason(issue.reason, t);
    return t('editor:placementImagePicker.errors.fileIssue', {
      fileName: issue.fileName,
      reason: imageIssueReason(issue.reason, t),
    });
  }
  const shown = issues.slice(0, 3).map((issue) =>
    issue.fileName
      ? t('editor:placementImagePicker.errors.fileIssue', {
          fileName: issue.fileName,
          reason: imageIssueReason(issue.reason, t),
        })
      : imageIssueReason(issue.reason, t),
  );
  if (issues.length > shown.length)
    shown.push(
      t('editor:placementImagePicker.errors.moreFailures', {
        formattedCount: new Intl.NumberFormat(locale).format(issues.length - shown.length),
      }),
    );
  return t('editor:placementImagePicker.errors.imagesFailed', {
    count: issues.length,
    formattedCount: new Intl.NumberFormat(locale).format(issues.length),
    details: new Intl.ListFormat(locale, { type: 'conjunction' }).format(shown),
  });
}

export default function PlacementImagePicker({
  images,
  selection,
  usedBy,
  onUpload,
  upload,
  onBusyChange,
  onSelectionReadyChange,
}: {
  images: EditorProductImage[];
  selection:
    | { kind: 'single'; value: string; onChange(id: string): void }
    | { kind: 'multiple'; values: string[]; onChange(ids: string[]): void };
  usedBy: Record<string, string>;
  onUpload(image: EditorProductImage): void;
  upload?(image: EditorProductImage): Promise<EditorProductImage>;
  onBusyChange?(busy: boolean): void;
  onSelectionReadyChange?(ready: boolean, imageIds: string[]): void;
}) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [uploading, setUploading] = useState(false);
  const gallery = useRef<HTMLElement>(null);
  const emptyUpload = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const uploadIds = useRef(new Map<string, string>());
  const [uploadIssues, setUploadIssues] = useState<ImageUploadIssue[]>([]);
  const [filter, setFilter] = useState<ImageFilter>('all');
  const [query, setQuery] = useState('');
  const [imageStates, setImageStates] = useState<Record<string, 'loaded' | 'failed'>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const currentImages = useRef(images);
  currentImages.current = images;
  const currentAttempts = useRef(attempts);
  currentAttempts.current = attempts;
  const imageKey = (image: EditorProductImage) => JSON.stringify([image.id, image.url, attempts[image.id] ?? 0]);
  const imageReady = (image: EditorProductImage) => imageStates[imageKey(image)] === 'loaded';
  const [fileValue, setFileValue] = useState<'' | null>('');
  const radioName = useId();
  const selected = (id: string) =>
    selection.kind === 'single' ? selection.value === id : selection.values.includes(id);
  const selectedCount = selection.kind === 'single' ? Number(Boolean(selection.value)) : selection.values.length;
  const inUseCount = images.filter((image) => Boolean(usedBy[image.id]?.trim())).length;
  const unusedCount = images.length - inUseCount;
  const showLibraryControls = images.length > 0;
  const normalizedQuery = query.trim().toLocaleLowerCase(formatLocale);
  const formattedCount = (count: number) => new Intl.NumberFormat(formatLocale).format(count);
  const imageLabel = (image: EditorProductImage, index: number) =>
    image.alt.trim() ||
    translateUi('editor:placementImagePicker.fallbackProductImage', {
      formattedNumber: formattedCount(index + 1),
    });
  const filterLabel = (filterName: ImageFilter, count: number) => {
    const params = { count, formattedCount: formattedCount(count) };
    switch (filterName) {
      case 'all':
        return translateUi('editor:placementImagePicker.countFilters.all', params);
      case 'unused':
        return translateUi('editor:placementImagePicker.countFilters.unused', params);
      case 'in-use':
        return translateUi('editor:placementImagePicker.countFilters.inUse', params);
    }
  };
  const visibleImages = images.filter((image, index) => {
    const inUse = Boolean(usedBy[image.id]?.trim());
    if (filter === 'unused' && inUse) return false;
    if (filter === 'in-use' && !inUse) return false;
    if (!normalizedQuery) return true;
    const label = imageLabel(image, index);
    return `${label} ${usedBy[image.id] ?? ''}`.toLocaleLowerCase(formatLocale).includes(normalizedQuery);
  });

  const selectedIds = selection.kind === 'single' ? (selection.value ? [selection.value] : []) : selection.values;
  const uploadError = imageUploadError(uploadIssues, translateUi, formatLocale);
  const selectionReady =
    selectedIds.length > 0 &&
    selectedIds.every((id) => {
      const image = images.find((image) => image.id === id);
      return image ? imageReady(image) : false;
    });
  const readinessCallback = useRef(onSelectionReadyChange);
  readinessCallback.current = onSelectionReadyChange;
  const readinessKey = JSON.stringify([selectionReady, selectedIds]);
  useEffect(() => {
    readinessCallback.current?.(selectionReady, selectedIds);
  }, [readinessKey]);
  const inputIsActive = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(
    () => () => {
      inputIsActive.current = false;
      busyCallback.current?.(false);
      readinessCallback.current?.(false, selectedIds);
    },
    [],
  );

  function choose(id: string) {
    const image = images.find((image) => image.id === id);
    if (!image || !imageReady(image) || uploading) return;
    if (selection.kind === 'single') selection.onChange(id);
    else
      selection.onChange(selected(id) ? selection.values.filter((value) => value !== id) : [...selection.values, id]);
  }

  function recordImageState(image: EditorProductImage, attempt: number, state: 'loaded' | 'failed') {
    if (
      !inputIsActive.current ||
      !currentImages.current.some((current) => current.id === image.id && current.url === image.url) ||
      (currentAttempts.current[image.id] ?? 0) !== attempt
    )
      return;
    const key = JSON.stringify([image.id, image.url, attempt]);
    setImageStates((current) => ({ ...current, [key]: state }));
  }
  function retryImage(image: EditorProductImage) {
    const next = { ...currentAttempts.current, [image.id]: (currentAttempts.current[image.id] ?? 0) + 1 };
    currentAttempts.current = next;
    setAttempts(next);
  }

  async function handleFileChange(event: Event) {
    const dropZone = event.currentTarget as HTMLElementTagNameMap['s-drop-zone'] | null;
    if (!dropZone) return;
    const files = Array.from(dropZone.files);
    dropZone.value = '';
    setFileValue(null);
    await processFiles(files);
  }

  async function processFiles(files: File[]) {
    if (!files.length || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setUploadIssues([]);
    setUploading(true);
    onBusyChange?.(true);
    const additions: EditorProductImage[] = [];
    const errors: ImageUploadIssue[] = [];
    try {
      for (const file of files) {
        if (!inputIsActive.current) return;
        if (!acceptedMimeTypes.has(file.type)) {
          errors.push({ fileName: file.name, reason: 'format-rejected' });
          continue;
        }
        if (file.size <= 0 || file.size > maxFileSize) {
          errors.push({ fileName: file.name, reason: 'size-rejected' });
          continue;
        }

        // After a stored photo's preview could not be read, retrying the same file reuses its upload identity so the
        // server returns the media it already stored instead of adding another row.
        const fileKey = JSON.stringify([file.name, file.type, file.size, file.lastModified]);
        const uploadId = uploadIds.current.get(fileKey) ?? crypto.randomUUID();
        let bitmap: ImageBitmap | undefined;
        try {
          bitmap = await createImageBitmap(file);
          if (!bitmap.width || !bitmap.height) throw new ImagePreparationError('invalid-dimensions');
          const encoded = encodeWebp(bitmap);
          if (!inputIsActive.current) return;
          const prepared: EditorProductImage = {
            id: uploadId,
            url: encoded.dataUrl,
            width: encoded.width,
            height: encoded.height,
            alt: file.name.slice(0, 160),
          };
          const stored = upload ? await upload(prepared) : prepared;
          uploadIds.current.delete(fileKey);
          if (!inputIsActive.current) return;
          additions.push(stored);
        } catch (cause) {
          if (cause instanceof StoredPreviewUnreadableError) uploadIds.current.set(fileKey, uploadId);
          else uploadIds.current.delete(fileKey);
          errors.push({
            fileName: file.name,
            reason:
              cause instanceof ImagePreparationError
                ? cause.reason
                : cause instanceof StoredPreviewUnreadableError
                  ? 'preview-unreadable'
                  : 'processing-failed',
          });
        } finally {
          bitmap?.close();
        }
      }

      if (!inputIsActive.current) return;
      additions.forEach(onUpload);
      if (additions.length) {
        setFilter('all');
        setQuery('');
      }
      if (selection.kind === 'multiple' && additions.length) {
        selection.onChange([...selection.values, ...additions.map((image) => image.id)]);
      } else if (selection.kind === 'single' && additions[0]) {
        selection.onChange(additions[0].id);
      }
      // The native drop zone can reject part of a batch before passing us its accepted files.
      // Keep that rejection while those accepted files finish processing.
      if (errors.length) setUploadIssues(errors);
    } finally {
      uploadInFlight.current = false;
      if (inputIsActive.current) {
        requestAnimationFrame(() => gallery.current?.scrollTo(0, 0));
        setUploading(false);
        onBusyChange?.(false);
      }
    }
  }

  function handleDropRejected() {
    setUploadIssues([{ reason: 'format-rejected' }]);
  }

  const uploadControl = (
    <s-drop-zone
      label={translateUi(
        selection.kind === 'single'
          ? 'editor:placementImagePicker.uploadOne'
          : 'editor:placementImagePicker.uploadMultiple',
      )}
      accessibilityLabel={translateUi(
        selection.kind === 'single'
          ? 'editor:placementImagePicker.uploadOneForView'
          : 'editor:placementImagePicker.uploadMultiple',
      )}
      labelAccessibilityVisibility={images.length ? 'exclusive' : 'visible'}
      accept="image/jpeg,image/png,image/webp"
      multiple={selection.kind === 'multiple'}
      disabled={uploading}
      error={images.length ? '' : uploadError}
      value={fileValue}
      onInput={handleFileChange}
      onDropRejected={handleDropRejected}
    />
  );

  return (
    <div class="placement-image-picker" aria-busy={uploading}>
      {images.length ? (
        <>
          <div class="placement-image-picker-toolbar">
            {showLibraryControls && (
              <div class="placement-image-picker-controls">
                <div class="placement-image-search">
                  <s-search-field
                    label={translateUi('editor:placementImagePicker.searchProductImages')}
                    labelAccessibilityVisibility="exclusive"
                    placeholder={translateUi('editor:placementImagePicker.search')}
                    value={query}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                  />
                </div>
                <div class="placement-image-filter">
                  <s-select
                    label={translateUi('editor:placementImagePicker.filterImages')}
                    labelAccessibilityVisibility="exclusive"
                    name="placement-image-filter"
                    value={filter}
                    onChange={(event) => setFilter(event.currentTarget.value as ImageFilter)}
                  >
                    <s-option value="all">{filterLabel('all', images.length)}</s-option>
                    <s-option value="unused">{filterLabel('unused', unusedCount)}</s-option>
                    <s-option value="in-use">{filterLabel('in-use', inUseCount)}</s-option>
                  </s-select>
                </div>
              </div>
            )}
            <div class="placement-image-selection-actions">
              <span class="placement-image-selection-count" role="status" aria-live="polite">
                {uploading
                  ? translateUi('editor:placementImagePicker.selectionStatus.processing')
                  : translateUi('editor:placementImagePicker.selectionStatus.selected', {
                      count: selectedCount,
                      formattedCount: formattedCount(selectedCount),
                    })}
              </span>
              {selection.kind === 'multiple' && (
                <s-button
                  variant="tertiary"
                  disabled={!selectedCount || uploading}
                  onClick={() => selection.onChange([])}
                >
                  {translateUi('editor:placementImagePicker.clearSelection')}
                </s-button>
              )}
            </div>
          </div>

          {uploadError && (
            <div class="placement-image-error">
              <s-banner tone="critical">{uploadError}</s-banner>
            </div>
          )}

          <section
            ref={gallery}
            class="placement-image-grid"
            data-empty={!visibleImages.length || undefined}
            aria-label={translateUi('editor:placementImagePicker.productImages')}
          >
            {visibleImages.length > 0 && (
              <div class="placement-upload-tile">
                <div class="placement-image-upload-field">{uploadControl}</div>
                <span class="placement-image-upload-details">
                  {translateUi('editor:placementImagePicker.upTo5MBPerImage')}
                </span>
              </div>
            )}
            {visibleImages.length ? (
              visibleImages.map((image) => {
                const index = images.indexOf(image);
                const label = imageLabel(image, index);
                const usage = usedBy[image.id]?.trim();
                const attempt = attempts[image.id] ?? 0;
                const imageUnavailable = imageStates[imageKey(image)] === 'failed';
                const ready = imageReady(image);
                const preview = imageUnavailable ? (
                  <span class="placement-image-fallback" aria-hidden="true">
                    <s-icon type="image" />
                    <span>{translateUi('editor:placementImagePicker.previewUnavailable')}</span>
                  </span>
                ) : (
                  <img
                    key={imageKey(image)}
                    src={image.url}
                    width="120"
                    height="120"
                    alt=""
                    loading={selected(image.id) ? 'eager' : 'lazy'}
                    onLoad={() => recordImageState(image, attempt, 'loaded')}
                    onError={() => recordImageState(image, attempt, 'failed')}
                  />
                );
                const details = (
                  <>
                    <AdminTruncatedLabel className="placement-image-label" text={label} />
                    <AdminTruncatedLabel
                      className="placement-image-usage"
                      id={`placement-image-usage-${image.id}`}
                      text={
                        usage
                          ? translateUi('editor:placementImagePicker.usage.usedIn', { usage })
                          : translateUi('editor:placementImagePicker.usage.unused')
                      }
                    />
                  </>
                );
                const choice =
                  selection.kind === 'single' ? (
                    <label class="placement-image-choice" aria-busy={!ready && !imageUnavailable}>
                      <span class="placement-image-thumbnail">
                        <input
                          type="radio"
                          name={radioName}
                          aria-label={label}
                          aria-describedby={`placement-image-usage-${image.id}`}
                          checked={selected(image.id)}
                          disabled={uploading || !ready}
                          onChange={() => choose(image.id)}
                        />
                        {preview}
                      </span>
                      {details}
                    </label>
                  ) : (
                    <button
                      class="placement-image-choice"
                      type="button"
                      aria-busy={!ready && !imageUnavailable}
                      aria-label={
                        selected(image.id)
                          ? translateUi(
                              imageUnavailable
                                ? 'editor:placementImagePicker.accessible.selectedImagePreviewUnavailable'
                                : 'editor:placementImagePicker.accessible.selectedImage',
                              { imageName: label },
                            )
                          : translateUi(
                              imageUnavailable
                                ? 'editor:placementImagePicker.accessible.selectImagePreviewUnavailable'
                                : 'editor:placementImagePicker.accessible.selectImage',
                              { imageName: label },
                            )
                      }
                      aria-pressed={selected(image.id)}
                      aria-describedby={`placement-image-usage-${image.id}`}
                      disabled={uploading || !ready}
                      onClick={() => choose(image.id)}
                    >
                      <span class="placement-image-thumbnail">
                        {preview}
                        <span class="placement-image-check" aria-hidden="true">
                          {selected(image.id) && <s-icon type="check" size="small" />}
                        </span>
                      </span>
                      {details}
                    </button>
                  );
                return (
                  <div key={image.id} class="placement-image-tile" style={{ minWidth: 0 }}>
                    {choice}
                    {imageUnavailable && (
                      <s-stack direction="inline" justifyContent="center">
                        <s-button
                          accessibilityLabel={translateUi('editor:placementImagePicker.accessible.retryImage', {
                            imageName: label,
                          })}
                          disabled={uploading}
                          onClick={() => retryImage(image)}
                        >
                          {translateUi('editor:placementImagePicker.retry')}
                        </s-button>
                      </s-stack>
                    )}
                  </div>
                );
              })
            ) : (
              <div class="placement-image-no-results">
                <s-heading>{translateUi('editor:placementImagePicker.noImagesFound')}</s-heading>
                <s-paragraph color="subdued">
                  {translateUi('editor:placementImagePicker.tryAnotherSearchOrUploadAProductImage')}
                </s-paragraph>
                <div class="placement-image-empty-actions">
                  <s-button disabled={uploading} onClick={() => emptyUpload.current?.click()}>
                    {translateUi('editor:placementImagePicker.uploadImage')}
                  </s-button>
                  <input
                    ref={emptyUpload}
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple={selection.kind === 'multiple'}
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = '';
                      void processFiles(files);
                    }}
                  />
                  <s-button
                    variant="tertiary"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    {translateUi('editor:placementImagePicker.showAllImages')}
                  </s-button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <div class="placement-image-empty">
          <div class="placement-empty-upload">{uploadControl}</div>
          <span class="placement-image-upload-details">
            {translateUi('editor:placementImagePicker.upTo5MBPerImage')}
          </span>
          <s-heading>{translateUi('editor:placementImagePicker.noProductImagesYet')}</s-heading>
          <s-paragraph>{translateUi('editor:placementImagePicker.uploadProductPhotosToAddThemAsViews')}</s-paragraph>
        </div>
      )}
    </div>
  );
}
