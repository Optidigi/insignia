import { useState } from 'preact/hooks';
import type { ProductConfig } from './config';
import { useLocale } from './customer-locale';
import { FileName } from './file-name';
import { IconChevronDown, IconChevronUp, IconCloudUpload } from './legacy-icons';
import type { Artwork, Print, Quantities } from './model';
import { createProductModel } from './model';
import { resolveOptionPresentation } from './option-presentation';
import { printSizeLabel } from './position-geometry';
import { type DesignerQuoteReview, quoteReviewMoney } from './quote-review';

interface ReviewPanelProps {
  quoteStatus?: 'loading' | 'unavailable';
  productionChoices?: Record<string, string>;
  quoteReview?: DesignerQuoteReview;
  onSelectQuoteGroup?: (id: string) => void;
  config: ProductConfig;
  prints: Print[];
  artworks: Artwork[];
  quantities: Quantities;
  colorRows: string[];
  onEditArtwork: (id: string) => void;
  onEditQuantities: () => void;
}

export function ReviewPanel({
  config,
  productionChoices,
  prints,
  artworks,
  quantities,
  colorRows,
  onEditArtwork,
  onEditQuantities,
  quoteReview,
  quoteStatus,
  onSelectQuoteGroup,
}: ReviewPanelProps) {
  const { t, formatLocale } = useLocale();
  const optionPresentation = resolveOptionPresentation(config.optionPresentation);
  const { rowOption } = optionPresentation;
  const { positionFor, methodFor, printPrice, unitPrice, money, basePriceRange, moneyRange } = createProductModel(
    config,
    formatLocale,
  );
  function displayPrintSizeLabel(position: ProductConfig['positions'][number], sizeIndex: number): string {
    return printSizeLabel(position, sizeIndex, (dimension) =>
      t('customer:positioning.centimeters', { dimension: String(dimension) }),
    );
  }
  const unit = unitPrice(prints);
  const baseRange = basePriceRange(quantities);
  const decoration = unit - config.basePrice;
  const rows = colorRows
    .map((id) => ({
      color: config.colors.find((color) => color.id === id),
      sizes: config.sizes
        .map((size) => ({
          ...size,
          quantity: quantities[`${id}:${size.id}`] ?? 0,
        }))
        .filter((size) => size.quantity > 0),
    }))
    .filter((row) => row.color && row.sizes.length);
  const firstPrint = prints[0];
  return (
    <>
      <div className="section-heading">
        <h2>{t('customer:steps.review')}</h2>
      </div>
      {config.productionOptions?.map((option) => (
        <section className="review-section" key={option.id}>
          <div className="section-label">
            <h3>{option.label}</h3>
            <button type="button" className="text-action" onClick={onEditQuantities}>
              {t('customer:review.edit')}
            </button>
          </div>
          <p>
            {option.values.find((value) => value.id === productionChoices?.[option.id])?.label ??
              t('common:summary.unavailable')}
          </p>
        </section>
      ))}
      <section className="review-section" aria-labelledby="review-artwork-title">
        <div className="section-label">
          <h3 id="review-artwork-title">{t('customer:review.artwork')}</h3>
          {firstPrint && (
            <button
              className="text-action"
              aria-label={t('customer:review.editArtwork')}
              onClick={() => onEditArtwork(firstPrint.id)}
            >
              {t('customer:review.edit')}
            </button>
          )}
        </div>
        <div className="review-artworks">
          {prints.map((print) => {
            const position = positionFor(print.id);
            const artwork = artworks.find((art) => art.id === print.artworkId);
            return (
              <ReviewArtwork
                key={print.id}
                positionId={print.id}
                positionName={position.name}
                methodLabel={methodFor(print.method).label}
                sizeLabel={displayPrintSizeLabel(position, print.size)}
                artwork={artwork}
                customPosition={Boolean(
                  print.position &&
                    (Math.abs(print.position.x - position.x) > 0.01 || Math.abs(print.position.y - position.y) > 0.01),
                )}
                onEdit={onEditArtwork}
              />
            );
          })}
        </div>
      </section>
      <section className="review-section" aria-labelledby="review-items-title">
        <div className="section-label">
          <h3 id="review-items-title">{t('customer:review.items')}</h3>
          <button className="text-action" aria-label={t('customer:review.editQuantities')} onClick={onEditQuantities}>
            {t('customer:review.edit')}
          </button>
        </div>
        <ul className="review-items" aria-label={t('customer:review.items')}>
          {rows.map((row) => {
            if (!row.color) return null;
            const count = row.sizes.reduce((sum, size) => sum + size.quantity, 0);
            return (
              <li key={row.color.id}>
                <div className="review-option-heading">
                  <h4 className="review-option-name">
                    {rowOption.display === 'swatch' && row.color.hex && (
                      <span className="mini-swatch" style={{ background: row.color.hex }} aria-hidden="true" />
                    )}
                    <span>
                      {row.color.nameSource === 'generic-selection'
                        ? t('customer:options.selectionFallback')
                        : row.color.name}
                    </span>
                  </h4>
                  <span className="review-option-count">{t('customer:review.itemCount', { count })}</span>
                </div>
                <dl className={`review-size-list${rowOption.display === 'named-choice' ? ' named-choice-list' : ''}`}>
                  {row.sizes.map((size) => (
                    <div key={size.id}>
                      <dt>{size.label}</dt>
                      <dd>
                        <span aria-hidden="true">× </span>
                        {size.quantity}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
      <details className="review-pricing">
        <summary>
          <span>{t('customer:review.pricePerItem')}</span>
          <strong>
            <bdi>
              {quoteStatus
                ? t(quoteStatus === 'loading' ? 'customer:chrome.calculatingQuote' : 'common:summary.unavailable')
                : moneyRange([baseRange[0] + decoration, baseRange[1] + decoration])}
            </bdi>
          </strong>
          <DisclosureIcon />
        </summary>
        <dl className="review-costs">
          <div>
            <dt>{t('customer:review.baseItem')}</dt>
            <dd>
              <bdi>
                {quoteStatus
                  ? t(quoteStatus === 'loading' ? 'customer:chrome.calculatingQuote' : 'common:summary.unavailable')
                  : moneyRange(baseRange)}
              </bdi>
            </dd>
          </div>
          {prints.map((print) => (
            <div key={print.id}>
              <dt>{positionFor(print.id).name}</dt>
              <dd>
                <bdi>
                  {quoteStatus
                    ? t(quoteStatus === 'loading' ? 'customer:chrome.calculatingQuote' : 'common:summary.unavailable')
                    : money(printPrice(print))}
                </bdi>
              </dd>
            </div>
          ))}
          {quoteReview?.groups.map((group) => (
            <div key={group.id}>
              <dt>
                {group.editable && onSelectQuoteGroup ? (
                  <button className="text-action" onClick={() => onSelectQuoteGroup(group.id)}>
                    {group.label}
                  </button>
                ) : (
                  group.label
                )}{' '}
                · {t('customer:review.itemCount', { count: group.quantity })}
              </dt>
              <dd>
                <bdi>
                  {quoteStatus
                    ? t(quoteStatus === 'loading' ? 'customer:chrome.calculatingQuote' : 'common:summary.unavailable')
                    : group.totalMinor !== undefined
                      ? quoteReviewMoney(group.totalMinor, quoteReview.currency, quoteReview.exponent, formatLocale)
                      : t('common:summary.unavailable')}
                </bdi>
              </dd>
            </div>
          ))}
        </dl>
      </details>
      {prints.some((print) => print.artworkId === 'later') && (
        <p className="review-artwork-note">{t('customer:review.artworkRequiredBeforeProduction')}</p>
      )}
      <p className="preview-disclaimer">{t('customer:review.previewDisclaimer')}</p>
    </>
  );
}

function DisclosureIcon() {
  return (
    <>
      <IconChevronDown className="when-closed" size={16} aria-hidden="true" />
      <IconChevronUp className="when-open" size={16} aria-hidden="true" />
    </>
  );
}

interface ReviewArtworkProps {
  positionId: string;
  positionName: string;
  methodLabel: string;
  sizeLabel: string;
  artwork: Artwork | undefined;
  customPosition: boolean;
  onEdit: (id: string) => void;
}
function ReviewArtwork({
  positionId,
  positionName,
  methodLabel,
  sizeLabel,
  artwork,
  customPosition,
  onEdit,
}: ReviewArtworkProps) {
  const { t } = useLocale();
  const [truncated, setTruncated] = useState(false);
  return (
    <article className="review-artwork">
      <button
        className="review-edit"
        aria-label={t('customer:review.editPositionArtwork', { positionName })}
        aria-describedby={`review-details-${positionId} review-filename-${positionId}`}
        onClick={() => onEdit(positionId)}
      >
        <span className="artwork-thumb">
          {artwork ? <img src={artwork.url} alt="" width={36} height={36} /> : <IconCloudUpload size={20} />}
        </span>
        <span className="review-artwork-info">
          <span className="review-artwork-head">
            <strong>{positionName}</strong>
            <span id={`review-details-${positionId}`}>
              {customPosition
                ? t('customer:review.methodSizeCustom', {
                    methodLabel,
                    sizeLabel,
                    customPosition: t('customer:review.customPosition'),
                  })
                : t('customer:review.methodSize', { methodLabel, sizeLabel })}
            </span>
          </span>
          <span className="review-artwork-filename" id={`review-filename-${positionId}`}>
            {artwork ? (
              <FileName name={artwork.name} onTruncationChange={setTruncated} />
            ) : (
              t('customer:review.artworkToFollow')
            )}
          </span>
        </span>
      </button>
      {artwork && truncated && (
        <details className="review-filename">
          <summary>
            {t('customer:files.fullFilename')}
            <DisclosureIcon />
          </summary>
          <div className="full-review-filename">{artwork.name}</div>
        </details>
      )}
    </article>
  );
}
