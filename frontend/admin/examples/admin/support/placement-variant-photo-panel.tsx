import type { AdminTranslator } from '@insignia/ui-localization/admin';
/** Shared selected image assignment controls, embedded in the existing view settings. */
import { useEffect, useId, useState } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import {
  filterVariantPhotoGroups,
  getRegroupedVariantPhotoGroupKey,
  getVariantPhotoGroupingImpact,
  getVariantPhotoGroups,
  resolveVariantPhotoView,
  setVariantPhotoGrouping,
  setVariantPhotoImage,
  VariantPhotoError,
  type VariantPhotoErrorReason,
} from './placement-variant-photos.mts';
import type { PlacementProduct } from './placement-workflow-model.mts';

const sharedPreviewValue = '__shared-image__';

function groupingImpactMessage(
  impact: ReturnType<typeof getVariantPhotoGroupingImpact>,
  t: AdminTranslator,
  locale: string,
): string | null {
  const { missingImageAssignments, alignmentReviewAssignments } = impact;
  if (!missingImageAssignments && !alignmentReviewAssignments) return null;
  if (missingImageAssignments && alignmentReviewAssignments) {
    return [
      t('editor:variantPanel.regroupMissing', {
        count: missingImageAssignments,
        formattedCount: new Intl.NumberFormat(locale).format(missingImageAssignments),
      }),
      t('editor:variantPanel.regroupReview', {
        count: alignmentReviewAssignments,
        formattedCount: new Intl.NumberFormat(locale).format(alignmentReviewAssignments),
      }),
    ].join(' ');
  }
  if (missingImageAssignments)
    return t('editor:variantPanel.regroupMissing', {
      count: missingImageAssignments,
      formattedCount: new Intl.NumberFormat(locale).format(missingImageAssignments),
    });
  return t('editor:variantPanel.regroupReview', {
    count: alignmentReviewAssignments,
    formattedCount: new Intl.NumberFormat(locale).format(alignmentReviewAssignments),
  });
}

type VariantPhotoSelectorProps = {
  product: PlacementProduct;
  value: string | null;
  onChange(value: string | null): void;
  disabled?: boolean;
};

/** Selecting a preview image does not change the scope of shared artwork edits. */
export function VariantPhotoSelector({ product, value, onChange, disabled }: VariantPhotoSelectorProps) {
  const { t: translateUi } = useAdminLocale();
  const groups = getVariantPhotoGroups(product);
  if (!groups.length) return null;
  const label =
    product.variantPhotos?.groupingOptionIds
      .map((id) => product.variantPhotos?.options.find((option) => option.id === id)?.name)
      .filter(Boolean)
      .join(' / ') || translateUi('editor:variantPanel.productVariant');
  return (
    <div class="variant-photo-selector">
      <span class="variant-photo-selector__label" aria-hidden="true">
        {label}
      </span>
      <div class="variant-photo-selector__field">
        <s-select
          label={label}
          labelAccessibilityVisibility="exclusive"
          disabled={disabled}
          value={groups.some((group) => group.key === value) ? (value ?? sharedPreviewValue) : sharedPreviewValue}
          onChange={(event) =>
            onChange(event.currentTarget.value === sharedPreviewValue ? null : event.currentTarget.value)
          }
        >
          <s-option value={sharedPreviewValue}>{translateUi('editor:variantPanel.sharedImage')}</s-option>
          {groups.map((group) => (
            <s-option key={group.key} value={group.key}>
              {group.label}
            </s-option>
          ))}
        </s-select>
      </div>
    </div>
  );
}

type VariantPhotoPanelProps = {
  product: PlacementProduct;
  viewId: string;
  activeGroupKey: string | null;
  onSelectGroup(key: string | null): void;
  onChange(product: PlacementProduct): void;
  onChooseImage(groupKeys: string[]): void;
  onReviewAlignment?(groupKey: string): void;
  onImageStatus?(url: string, failed: boolean): void;
  failedImageUrls: readonly string[];
  pendingImageUrls: readonly string[];
  imageRetryRevisions: Readonly<Record<string, number>>;
  onRetryImage(url: string): void;
};

export default function PlacementVariantPhotoPanel({
  product,
  viewId,
  activeGroupKey,
  onSelectGroup,
  onChange,
  onChooseImage,
  onReviewAlignment,
  onImageStatus,
  failedImageUrls,
  pendingImageUrls,
  imageRetryRevisions,
  onRetryImage,
}: VariantPhotoPanelProps) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'review'>('all');
  const [editingGrouping, setEditingGrouping] = useState(false);
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [error, setError] = useState<VariantPhotoErrorReason | 'grouping-failed' | 'shared-failed' | null>(null);
  const headingId = useId();
  const setup = product.variantPhotos;
  const groups = getVariantPhotoGroups(product);
  const groupSignature = groups.map((group) => group.key).join('|');
  useEffect(() => {
    setSelectedKeys([]);
    setQuery('');
    setStatusFilter('all');
    setError(null);
  }, [viewId, groupSignature]);
  useEffect(() => setSelectedKeys([]), [product.variantPhotos?.assignments]);
  if (!setup || !product.views.some((view) => view.id === viewId)) return null;

  const view = product.views.find((item) => item.id === viewId);
  const selected = selectedKeys.filter((key) => groups.some((group) => group.key === key));
  const missingGroups = groups.filter(
    (group) => resolveVariantPhotoView(product, viewId, group.key).status === 'missing',
  );
  const reviewGroups = groups.filter(
    (group) => resolveVariantPhotoView(product, viewId, group.key).needsAlignmentReview,
  );
  const visibleGroups = filterVariantPhotoGroups(product, query, formatLocale).filter(
    (group) =>
      statusFilter === 'all' ||
      (statusFilter === 'missing' ? missingGroups : reviewGroups).some((item) => item.key === group.key),
  );
  const selectedVisibleCount = visibleGroups.filter((group) => selected.includes(group.key)).length;
  const allVisibleSelected = visibleGroups.length > 0 && selectedVisibleCount === visibleGroups.length;
  const groupingNames = setup.groupingOptionIds.flatMap((id) => {
    const option = setup.options.find((item) => item.id === id);
    return option ? [option.name] : [];
  });
  const firstOption = draftOptions[0] ?? '';
  const savedGroupingOptions = [...setup.groupingOptionIds];
  const otherOptions = setup.options.filter((option) => option.id !== firstOption);
  const groupingImpact =
    editingGrouping && !draftOptions.includes('')
      ? getVariantPhotoGroupingImpact(product, draftOptions.filter(Boolean))
      : { missingImageAssignments: 0, alignmentReviewAssignments: 0 };
  const groupingImpactCopy = groupingImpactMessage(groupingImpact, translateUi, formatLocale);

  function toggleGroup(key: string, checked: boolean) {
    setSelectedKeys((current) => (checked ? [...new Set([...current, key])] : current.filter((id) => id !== key)));
  }
  function editGrouping() {
    setDraftOptions(savedGroupingOptions);
    setEditingGrouping(true);
    setError(null);
  }
  function applyGrouping() {
    try {
      const nextProduct = setVariantPhotoGrouping(product, draftOptions.filter(Boolean));
      const nextGroups = getVariantPhotoGroups(nextProduct);
      onChange(nextProduct);
      setEditingGrouping(false);
      setSelectedKeys([]);
      onSelectGroup(getRegroupedVariantPhotoGroupKey(activeGroupKey, groups, nextGroups));
      setError(null);
    } catch (reason) {
      setError(reason instanceof VariantPhotoError ? reason.reason : 'grouping-failed');
    }
  }
  function useSharedImages() {
    try {
      onChange(setVariantPhotoImage(product, viewId, selected, null, { useShared: true }));
      setSelectedKeys([]);
      setError(null);
    } catch (reason) {
      setError(reason instanceof VariantPhotoError ? reason.reason : 'shared-failed');
    }
  }

  return (
    <section class="variant-photo-panel" data-variant-photo-panel tabIndex={-1} aria-labelledby={headingId}>
      <div class="variant-photo-panel__heading">
        <s-heading id={headingId}>
          {translateUi('editor:variantPanel.viewImages', { viewName: view?.name ?? '' })}
        </s-heading>
        {!editingGrouping && setup.options.length > 0 && (
          <s-button
            variant="tertiary"
            accessibilityLabel={translateUi('editor:variantPanel.editImageGrouping')}
            onClick={editGrouping}
          >
            {translateUi('editor:variantPanel.editGrouping')}
          </s-button>
        )}
      </div>
      {editingGrouping ? (
        <div class="variant-photo-panel__grouping">
          <s-select
            label={translateUi('editor:variantPanel.photosVaryBy')}
            details={translateUi('editor:variantPanel.groupingScope')}
            value={firstOption}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setDraftOptions(next ? [next, ...draftOptions.slice(1).filter((id) => id && id !== next)] : []);
            }}
          >
            <s-option value="">{translateUi('editor:variantPanel.sameImageForAllVariants')}</s-option>
            {setup.options.map((option) => (
              <s-option key={option.id} value={option.id}>
                {option.name}
              </s-option>
            ))}
          </s-select>
          <s-text color="subdued">
            {translateUi('editor:variantPanel.methodsDecorationSizesAndPricesStayTheSameAcrossVariants')}
          </s-text>
          {firstOption &&
            draftOptions.slice(1).map((optionId, index) => (
              <s-select
                key={index}
                label={translateUi(
                  index === 0 ? 'editor:variantPanel.alsoVariesBy' : 'editor:variantPanel.additionalOption',
                )}
                value={optionId}
                onChange={(event) => {
                  const next = [...draftOptions];
                  next[index + 1] = event.currentTarget.value;
                  setDraftOptions(next);
                }}
              >
                <s-option value="">{translateUi('editor:variantPanel.chooseAnOption')}</s-option>
                {otherOptions
                  .filter((option) => option.id === optionId || !draftOptions.includes(option.id))
                  .map((option) => (
                    <s-option key={option.id} value={option.id}>
                      {option.name}
                    </s-option>
                  ))}
              </s-select>
            ))}
          {firstOption && draftOptions.length < setup.options.length && !draftOptions.includes('') && (
            <s-button variant="tertiary" icon="plus" onClick={() => setDraftOptions([...draftOptions, ''])}>
              {translateUi('editor:variantPanel.addAnotherOption')}
            </s-button>
          )}
          {draftOptions.length > 1 && (
            <s-button variant="tertiary" onClick={() => setDraftOptions(draftOptions.slice(0, -1))}>
              {translateUi('editor:variantPanel.removeLastOption')}
            </s-button>
          )}
          {groupingImpactCopy && <s-banner tone="warning">{groupingImpactCopy}</s-banner>}
          <div class="variant-photo-panel__actions">
            <s-button
              variant="secondary"
              onClick={() => {
                setEditingGrouping(false);
                setError(null);
              }}
            >
              {translateUi('editor:variantPanel.cancel')}
            </s-button>
            <s-button variant="primary" disabled={draftOptions.includes('')} onClick={applyGrouping}>
              {translateUi('editor:variantPanel.applyGrouping')}
            </s-button>
          </div>
        </div>
      ) : (
        <s-text color="subdued">
          {groupingNames.length
            ? translateUi(
                groupingNames.length > 1
                  ? 'editor:variantPanel.onePhotoPerCombination'
                  : 'editor:variantPanel.onePhotoPerOption',
                { options: new Intl.ListFormat(formatLocale, { type: 'conjunction' }).format(groupingNames) },
              )
            : translateUi('editor:variantPanel.sameImageForAll')}
        </s-text>
      )}
      {error && <s-banner tone="critical">{translateUi(`editor:variantPanel.errors.${error}`)}</s-banner>}
      {groups.length > 0 && (
        <>
          {groups.length > 8 && (
            <div class="variant-photo-panel__filters">
              <s-search-field
                label={translateUi('editor:variantPanel.findVariantImages')}
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
              <s-select
                label={translateUi('editor:variantPanel.showVariantImages')}
                labelAccessibilityVisibility="exclusive"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
              >
                <s-option value="all">
                  {translateUi('editor:variantPanel.allCount', {
                    formattedCount: new Intl.NumberFormat(formatLocale).format(groups.length),
                  })}
                </s-option>
                <s-option value="missing">
                  {translateUi('editor:variantPanel.missingCount', {
                    formattedCount: new Intl.NumberFormat(formatLocale).format(missingGroups.length),
                  })}
                </s-option>
                <s-option value="review">
                  {translateUi('editor:variantPanel.reviewCount', {
                    formattedCount: new Intl.NumberFormat(formatLocale).format(reviewGroups.length),
                  })}
                </s-option>
              </s-select>
            </div>
          )}
          <div class="variant-photo-panel__selection">
            <s-checkbox
              label={
                selected.length
                  ? translateUi('editor:variantPanel.selectedCount', {
                      formattedCount: new Intl.NumberFormat(formatLocale).format(selected.length),
                    })
                  : query.trim() || statusFilter !== 'all'
                    ? translateUi('editor:variantPanel.selectShown')
                    : translateUi('editor:variantPanel.selectAll')
              }
              checked={allVisibleSelected}
              indeterminate={selectedVisibleCount > 0 && !allVisibleSelected}
              disabled={visibleGroups.length === 0}
              onChange={(event) =>
                setSelectedKeys(
                  event.currentTarget.checked
                    ? [...new Set([...selected, ...visibleGroups.map((group) => group.key)])]
                    : selected.filter((key) => !visibleGroups.some((group) => group.key === key)),
                )
              }
            />
            {selected.length > 0 && (
              <s-button variant="tertiary" onClick={() => setSelectedKeys([])}>
                {translateUi('editor:variantPanel.clear')}
              </s-button>
            )}
          </div>
          {selected.length > 0 && (
            <div class="variant-photo-panel__bulk">
              <s-button variant="secondary" onClick={() => onChooseImage(selected)}>
                {translateUi('editor:variantPanel.useOneImage')}
              </s-button>
              <s-button variant="tertiary" disabled={!view?.imageUrl} onClick={useSharedImages}>
                {translateUi('editor:variantPanel.useSharedImage')}
              </s-button>
            </div>
          )}
          <div class="variant-photo-panel__list">
            {visibleGroups.map((group) => {
              const resolved = resolveVariantPhotoView(product, viewId, group.key);
              const imageUrl = resolved.status === 'ready' ? resolved.view.imageUrl : '';
              const pending = !!imageUrl && pendingImageUrls.includes(imageUrl);
              const failed = imageUrl && failedImageUrls.includes(imageUrl) && !pending;
              return (
                <div
                  class={`variant-photo-panel__row${activeGroupKey === group.key ? ' is-previewing' : ''}`}
                  key={group.key}
                  data-photo-group-key={group.key}
                >
                  <s-checkbox
                    label={translateUi('editor:variantPanel.selectGroup', { groupName: group.label })}
                    labelAccessibilityVisibility="exclusive"
                    checked={selected.includes(group.key)}
                    onChange={(event) => toggleGroup(group.key, event.currentTarget.checked)}
                  />
                  <s-clickable
                    padding="small-100"
                    borderRadius="base"
                    accessibilityLabel={
                      resolved.status === 'missing'
                        ? translateUi('editor:variantPanel.addViewImage', {
                            viewName: view?.name ?? '',
                            groupName: group.label,
                          })
                        : translateUi('editor:variantPanel.previewGroup', { groupName: group.label })
                    }
                    onClick={() =>
                      resolved.status === 'missing' ? onChooseImage([group.key]) : onSelectGroup(group.key)
                    }
                  >
                    <div class="variant-photo-panel__preview">
                      <span class="variant-photo-panel__thumbnail">
                        {imageUrl && !failed ? (
                          <img
                            key={`${imageUrl}:${imageRetryRevisions[imageUrl] ?? 0}`}
                            src={imageUrl}
                            alt=""
                            width="40"
                            height="48"
                            loading="lazy"
                            onLoad={() => onImageStatus?.(imageUrl, false)}
                            onError={() => {
                              onImageStatus?.(imageUrl, true);
                            }}
                          />
                        ) : (
                          <s-icon type="image" />
                        )}
                      </span>
                      <div class="variant-photo-panel__facts">
                        <s-text type="strong">{group.label}</s-text>
                        <s-text color="subdued">
                          {translateUi(
                            resolved.imageSource === 'shared'
                              ? 'editor:variantPanel.sharedVariants'
                              : 'editor:variantPanel.variants',
                            {
                              count: group.variantIds.length,
                              formattedCount: new Intl.NumberFormat(formatLocale).format(group.variantIds.length),
                            },
                          )}
                        </s-text>
                        {pending ? (
                          <s-text color="subdued">{translateUi('editor:variantPanel.loadingImage')}</s-text>
                        ) : failed ? (
                          <s-badge tone="critical">{translateUi('editor:variantPanel.imageUnavailable')}</s-badge>
                        ) : resolved.status === 'missing' ? (
                          <s-badge tone="critical">{translateUi('editor:variantPanel.imageNeeded')}</s-badge>
                        ) : resolved.needsAlignmentReview ? (
                          <s-badge tone="warning">{translateUi('editor:variantPanel.checkAlignment')}</s-badge>
                        ) : null}
                      </div>
                    </div>
                  </s-clickable>
                  <div class="variant-photo-panel__row-actions">
                    {!failed && resolved.needsAlignmentReview && resolved.status === 'ready' && onReviewAlignment && (
                      <s-button
                        variant="tertiary"
                        accessibilityLabel={translateUi('editor:variantPanel.reviewAlignment', {
                          groupName: group.label,
                        })}
                        onClick={() => onReviewAlignment(group.key)}
                      >
                        {translateUi('editor:variantPanel.review')}
                      </s-button>
                    )}
                    {(failed || pending) && (
                      <s-button
                        variant="tertiary"
                        loading={pending}
                        accessibilityLabel={translateUi('editor:variantPanel.retryImage', { groupName: group.label })}
                        onClick={() => {
                          onRetryImage(imageUrl);
                        }}
                      >
                        {translateUi('editor:variantPanel.retry')}
                      </s-button>
                    )}
                    <s-button
                      variant="tertiary"
                      accessibilityLabel={translateUi('editor:variantPanel.chooseImage', { groupName: group.label })}
                      onClick={() => onChooseImage([group.key])}
                    >
                      {translateUi(
                        resolved.status === 'missing' ? 'editor:variantPanel.add' : 'editor:variantPanel.change',
                      )}
                    </s-button>
                  </div>
                </div>
              );
            })}
            {visibleGroups.length === 0 && (
              <div class="variant-photo-panel__empty">
                <s-text color="subdued">{translateUi('editor:variantPanel.noMatchingVariants')}</s-text>
                <s-button
                  variant="tertiary"
                  onClick={() => {
                    setQuery('');
                    setStatusFilter('all');
                  }}
                >
                  {translateUi(
                    statusFilter === 'all' ? 'editor:variantPanel.clearSearch' : 'editor:variantPanel.showAllImages',
                  )}
                </s-button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
