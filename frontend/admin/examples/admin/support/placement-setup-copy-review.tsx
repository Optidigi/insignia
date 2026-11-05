/** Compact review of the source setup before it is copied to other products. */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import { placementColor } from './placement-canvas-tools.mts';
import type { EditorView, PlacementProduct } from './placement-workflow-model.mts';

export interface PlacementSetupCopyReviewProps {
  source: PlacementProduct;
  sourceKind: 'current' | 'saved';
  children?: ComponentChildren;
  selectedViewIds: string[];
  includeProductPrices: boolean;
  busy: boolean;
  onViewsChange(ids: string[]): void;
  onPricesChange(includePrices: boolean): void;
}

function placementCountLabel(count: number, t: ReturnType<typeof useAdminLocale>['t'], locale: string): string {
  return t('editor:placementSetupCopyReview.placementCount', {
    count,
    formattedCount: new Intl.NumberFormat(locale).format(count),
  });
}

function placementRectangle(view: EditorView) {
  const { imageWidth, imageHeight } = view;
  return view.placements.map(({ id, rect }) => ({
    id,
    color: placementColor(id),
    x: (rect.centerX - rect.width / 2) * imageWidth,
    y: (rect.centerY - rect.height / 2) * imageHeight,
    width: rect.width * imageWidth,
    height: rect.height * imageHeight,
  }));
}

function ViewImage({ view }: { view: EditorView }) {
  const { t: translateUi } = useAdminLocale();
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const imageFailed = Boolean(view.imageUrl) && failedImageUrl === view.imageUrl;
  const rectangles = placementRectangle(view);
  const imageRatio = view.imageWidth / view.imageHeight;

  return (
    <div class="placement-setup-copy-review__image-stage">
      <div
        class="placement-setup-copy-review__image"
        style={{
          aspectRatio: `${view.imageWidth} / ${view.imageHeight}`,
          width: `min(100%, calc(var(--layout-image-height) * ${imageRatio}))`,
        }}
      >
        {view.imageUrl && !imageFailed ? (
          <img
            src={view.imageUrl}
            alt=""
            width={view.imageWidth}
            height={view.imageHeight}
            loading="lazy"
            onError={() => setFailedImageUrl(view.imageUrl)}
          />
        ) : (
          <span
            class="placement-setup-copy-review__image-empty"
            role="img"
            aria-label={translateUi(
              imageFailed
                ? 'editor:placementSetupCopyReview.sourceImageUnavailable'
                : 'editor:placementSetupCopyReview.noSourceImageSelected',
            )}
          >
            <s-icon type="image" />
            {imageFailed && <s-text>{translateUi('editor:placementSetupCopyReview.imageUnavailable')}</s-text>}
          </span>
        )}
        {rectangles.length > 0 && (
          <svg
            class="placement-setup-copy-review__overlay"
            viewBox={`0 0 ${view.imageWidth} ${view.imageHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {rectangles.map((rectangle) => (
              <g key={rectangle.id}>
                <rect
                  class="placement-setup-copy-review__overlay-halo"
                  x={rectangle.x}
                  y={rectangle.y}
                  width={rectangle.width}
                  height={rectangle.height}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={rectangle.x}
                  y={rectangle.y}
                  width={rectangle.width}
                  height={rectangle.height}
                  fill={rectangle.color.fill}
                  stroke={rectangle.color.stroke}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function ViewRow({
  view,
  selected,
  disabled,
  onToggle,
}: {
  view: EditorView;
  selected: boolean;
  disabled: boolean;
  onToggle(checked: boolean): void;
}) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const name = view.name || translateUi('editor:placementSetupCopyReview.untitledView');
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard selection is handled once by the native child checkbox; the row only extends its pointer hit area.
    <article
      class={`placement-setup-copy-review__view-row${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={(event) => {
        if (disabled || event.composedPath().some((node) => node instanceof Element && node.localName === 's-checkbox'))
          return;
        onToggle(!selected);
      }}
    >
      <s-checkbox
        label={translateUi('editor:placementSetupCopyReview.copyView', { viewName: name })}
        labelAccessibilityVisibility="exclusive"
        name="copySetupViews"
        checked={selected}
        disabled={disabled}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <ViewImage view={view} />
      <div class="placement-setup-copy-review__view-details">
        <div class="placement-setup-copy-review__view-copy">
          <s-text type="strong">{name}</s-text>
          <s-text color="subdued">
            {view.placements.length === 0
              ? translateUi('editor:placementSetupCopyReview.noPlacements')
              : placementCountLabel(view.placements.length, translateUi, formatLocale)}
          </s-text>
        </div>
      </div>
    </article>
  );
}

export default function PlacementSetupCopyReview({
  source,
  sourceKind,
  children,
  selectedViewIds,
  includeProductPrices,
  busy,
  onViewsChange,
  onPricesChange,
}: PlacementSetupCopyReviewProps) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [showAbout, setShowAbout] = useState(false);
  const selected = new Set(selectedViewIds);
  const selectedViews = source.views.filter((view) => selected.has(view.id));
  const selectedPlacementCount = selectedViews.reduce((total, view) => total + view.placements.length, 0);
  const sourceMethods = new Map<string, PlacementProduct['methods'][number]>();
  for (const method of source.methods) sourceMethods.set(method.id, method);
  const hasProductPricesInViews = (viewIds: readonly string[]) => {
    const includedViews = new Set(viewIds);
    return source.views
      .filter((view) => includedViews.has(view.id))
      .some((view) =>
        view.placements.some((area) =>
          area.methodIds.some(
            (methodId) =>
              sourceMethods.get(methodId)?.pricing === 'product' &&
              area.sizes.some((size) => Boolean(size.prices[methodId]?.trim())),
          ),
        ),
      );
  };
  const hasProductPrices = hasProductPricesInViews(selectedViewIds);

  useEffect(() => {
    setShowAbout(false);
  }, [source.id, sourceKind]);

  useEffect(() => {
    if (!hasProductPrices && includeProductPrices) onPricesChange(false);
  }, [hasProductPrices, includeProductPrices, onPricesChange]);

  const changeSelectedViews = (ids: string[]) => {
    onViewsChange(ids);
    if (!hasProductPricesInViews(ids)) onPricesChange(false);
  };

  const setViewSelected = (viewId: string, isSelected: boolean) => {
    const next = new Set(source.views.filter((view) => selected.has(view.id)).map((view) => view.id));
    if (isSelected) next.add(viewId);
    else next.delete(viewId);
    changeSelectedViews(source.views.filter((view) => next.has(view.id)).map((view) => view.id));
  };

  return (
    <div class="placement-setup-copy-review" aria-busy={busy}>
      <div class="placement-setup-copy-review__context">
        <div class="placement-setup-copy-review__source">
          {source.images[0] ? (
            <s-thumbnail src={source.images[0].url} alt="" size="small" />
          ) : (
            <span class="placement-setup-copy-review__source-image" aria-hidden="true">
              <s-icon type="image" />
            </span>
          )}
          <div class="placement-setup-copy-review__source-copy">
            <s-text type="strong">{source.title}</s-text>
            <s-text color="subdued">
              {translateUi(
                sourceKind === 'current'
                  ? 'editor:placementSetupCopyReview.fromCurrentDraft'
                  : 'editor:placementSetupCopyReview.fromSavedDraft',
              )}
            </s-text>
          </div>
        </div>
        {children}
      </div>

      <section
        class="placement-setup-copy-review__layouts"
        aria-label={translateUi('editor:placementSetupCopyReview.viewsToCopy')}
      >
        <div class="placement-setup-copy-review__layouts-heading">
          <div class="placement-setup-copy-review__layout-title">
            <s-heading>{translateUi('editor:placementSetupCopyReview.viewsToCopy')}</s-heading>
            <s-text color="subdued">
              {translateUi('editor:placementSetupCopyReview.selectedSummary', {
                formattedSelectedCount: new Intl.NumberFormat(formatLocale).format(selectedViews.length),
                formattedTotalCount: new Intl.NumberFormat(formatLocale).format(source.views.length),
                placementSummary: placementCountLabel(selectedPlacementCount, translateUi, formatLocale),
              })}
            </s-text>
          </div>
          <div class="placement-setup-copy-review__layout-actions">
            {selectedViews.length > 0 && (
              <s-button variant="tertiary" disabled={busy} onClick={() => changeSelectedViews([])}>
                {translateUi('editor:placementSetupCopyReview.clearSelection')}
              </s-button>
            )}
            {selectedViews.length < source.views.length && (
              <s-button
                variant="tertiary"
                disabled={busy || source.views.length === 0}
                onClick={() => changeSelectedViews(source.views.map((view) => view.id))}
              >
                {translateUi('editor:placementSetupCopyReview.selectAll')}
              </s-button>
            )}
          </div>
        </div>
        <div class="placement-setup-copy-review__list">
          {source.views.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              selected={selected.has(view.id)}
              disabled={busy}
              onToggle={(checked) => setViewSelected(view.id, checked)}
            />
          ))}
        </div>
        {selectedViews.length === 0 && (
          <s-banner tone="warning">
            {translateUi('editor:placementSetupCopyReview.selectAtLeastOneViewToCopy')}
          </s-banner>
        )}
        {selectedViews.length > 0 && selectedPlacementCount === 0 && (
          <s-text color="subdued">
            {translateUi('editor:placementSetupCopyReview.theseViewsHaveNoPlacementsYet')}
          </s-text>
        )}
      </section>

      {hasProductPrices && (
        <div class="placement-setup-copy-review__prices">
          <s-checkbox
            label={translateUi('editor:placementSetupCopyReview.copyPerSizeDecorationPrices')}
            name="copySetupPrices"
            checked={includeProductPrices}
            disabled={busy}
            onChange={(event) => onPricesChange(event.currentTarget.checked)}
          />
          <s-text color="subdued">
            {translateUi('editor:placementSetupCopyReview.onlyForMethodsThatUseProductPricingOnBothProducts')}
          </s-text>
        </div>
      )}

      <div class="placement-setup-copy-review__consequence">
        <s-text color="subdued">
          {translateUi('editor:placementSetupCopyReview.eachCopyIsAnIndependentDraftAddTargetImagesAndReviewAlignment')}
        </s-text>
        <s-button
          variant="tertiary"
          icon="info"
          disabled={busy}
          accessibilityLabel={translateUi(
            showAbout
              ? 'editor:placementSetupCopyReview.hideCopiedSettingsDetails'
              : 'editor:placementSetupCopyReview.aboutCopiedSettings',
          )}
          onClick={() => setShowAbout((visible) => !visible)}
        />
      </div>

      {showAbout && (
        <section
          id="placement-setup-copy-about"
          class="placement-setup-copy-review__about"
          aria-label={translateUi('editor:placementSetupCopyReview.aboutCopiedSettings')}
        >
          <s-heading>{translateUi('editor:placementSetupCopyReview.aboutCopiedSettings')}</s-heading>
          <s-text color="subdued">
            {translateUi('editor:placementSetupCopyReview.sourceImagesAndImageMeasurementsArenTCopied')}
          </s-text>
          <s-text color="subdued">
            {translateUi(
              'editor:placementSetupCopyReview.artworkAreasAndEnabledCustomerMovementAreasAreCopiedReviewBothAgainstEachTargetImage',
            )}
          </s-text>
          <s-text color="subdued">
            {translateUi(
              'editor:placementSetupCopyReview.aMethodAlreadySetUpOnATargetKeepsItsSettingsMissingMethodsAreCopiedFromTheSource',
            )}
          </s-text>
        </section>
      )}
    </div>
  );
}
