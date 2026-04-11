/**
 * Step 4: Review & quantity — sectioned summary card, redesigned total bar,
 * floating preview button, and green Add to Cart button.
 */

import type { StorefrontConfig } from "./types";
import type { LogoState, PlacementSelections } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatCurrency } from "./currency";
import { IconMinus, IconPlus, IconEye } from "./icons";

type PriceResult = {
  unitPriceCents: number;
  feeCents: number;
  breakdown: Array<{ label: string; amountCents: number }>;
  validation: { ok: boolean };
};

type ReviewStepProps = {
  config: StorefrontConfig;
  selectedMethodId: string;
  placementSelections: PlacementSelections;
  logo: LogoState;
  quantity: number;
  onQuantityChange: (n: number) => void;
  customizationId: string | null;
  priceResult: PriceResult | null;
  prepareResult: { slotVariantId: string; configHash: string; pricingVersion: string; unitPriceCents: number; feeCents: number } | null;
  submitLoading: boolean;
  submitError: string | null;
  onSaveDraftAndPrice: () => Promise<void>;
  onPrepareAndAddToCart: () => Promise<void>;
  onBack: () => void;
  baseProductPriceCents: number;
  productTitle: string;
  onShowPreviewSheet: () => void;
  t: TranslationStrings;
};

export function ReviewStep({
  config,
  selectedMethodId,
  placementSelections,
  quantity,
  onQuantityChange,
  priceResult,
  submitLoading,
  submitError,
  onPrepareAndAddToCart,
  onBack,
  baseProductPriceCents,
  productTitle,
  onShowPreviewSheet,
  t,
}: ReviewStepProps) {
  const fmt = (cents: number) => formatCurrency(cents, config.currency);

  const methodName =
    config.methods.find((m) => m.id === selectedMethodId)?.name ?? selectedMethodId;
  const methodPriceCents =
    config.methods.find((m) => m.id === selectedMethodId)?.basePriceCents ?? 0;

  const selectedPlacements = Object.entries(placementSelections)
    .map(([placementId, stepIndex]) => {
      const placement = config.placements.find((p) => p.id === placementId);
      if (!placement) return null;
      const step = placement.steps[stepIndex];
      return {
        id: placementId,
        name: placement.name,
        placementPriceCents: placement.basePriceAdjustmentCents,
        sizeLabel: step?.label ?? "",
        sizePriceCents: step?.priceAdjustmentCents ?? 0,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const totalFeeCents =
    methodPriceCents +
    selectedPlacements.reduce((sum, p) => sum + p.placementPriceCents + p.sizePriceCents, 0);

  const unitCents = priceResult?.unitPriceCents ?? baseProductPriceCents + totalFeeCents;
  const totalCents = unitCents * quantity;

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading" className="visually-hidden">
        {t.review.title}
      </h2>

      {/* Summary Card */}
      <div className="insignia-review-summary">
        {/* PRODUCT section */}
        <span className="insignia-review-section-label">{t.review.product}</span>
        <div className="insignia-review-line">
          <span className="insignia-review-line-name">{productTitle}</span>
          <span className="insignia-review-line-price">{fmt(baseProductPriceCents)}</span>
        </div>

        <div className="insignia-review-divider" />

        {/* DECORATION section */}
        <span className="insignia-review-section-label">{t.review.decoration}</span>
        <div className="insignia-review-line">
          <span className="insignia-review-line-name">{methodName}</span>
          <span className="insignia-review-line-price insignia-review-line-price--blue">
            +{fmt(methodPriceCents)}
          </span>
        </div>

        <div className="insignia-review-divider" />

        {/* CUSTOMIZATIONS section */}
        <span className="insignia-review-section-label">{t.review.customizations}</span>
        {selectedPlacements.map((p) => (
          <div key={p.id} className="insignia-review-line">
            <span className="insignia-review-line-name">{p.name} placement</span>
            <span className="insignia-review-line-price">+{fmt(p.placementPriceCents)}</span>
          </div>
        ))}
        {selectedPlacements
          .filter((p) => p.sizePriceCents !== 0)
          .map((p) => (
            <div key={`${p.id}-size`} className="insignia-review-line">
              <span className="insignia-review-line-name">{p.sizeLabel} size adjustment</span>
              <span className="insignia-review-line-price">
                {p.sizePriceCents > 0 ? "+" : ""}
                {fmt(p.sizePriceCents)}
              </span>
            </div>
          ))}
      </div>

      {/* Quantity row */}
      <div className="insignia-review-quantity">
        <label htmlFor="insignia-qty" className="insignia-review-qty-label">
          {t.review.quantity}
        </label>
        <div className="insignia-qty-stepper">
          <button
            type="button"
            className="insignia-qty-btn"
            onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <IconMinus size={16} />
          </button>
          <input
            id="insignia-qty"
            type="number"
            className="insignia-quantity-input"
            min={1}
            max={999}
            value={quantity}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1) onQuantityChange(v);
            }}
          />
          <button
            type="button"
            className="insignia-qty-btn insignia-qty-btn--plus"
            onClick={() => onQuantityChange(quantity + 1)}
            aria-label="Increase quantity"
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>

      {/* Total bar */}
      <div className="insignia-review-total-bar">
        <div>
          <span className="label">Estimated total</span>
          <span className="breakdown">
            {fmt(baseProductPriceCents)} base · {fmt(totalFeeCents)} customization
          </span>
        </div>
        <span className="amount">{fmt(totalCents)}</span>
      </div>

      {/* Floating preview button — mobile only, CSS controls visibility */}
      <button
        type="button"
        className="insignia-preview-float-btn"
        onClick={onShowPreviewSheet}
      >
        <IconEye size={16} />
        <span>{t.review.previewBtn}</span>
      </button>

      {/* Error display */}
      {submitError && (
        <div className="insignia-error" role="alert" style={{ marginTop: 12 }}>
          {submitError}
        </div>
      )}

      {/* Footer actions */}
      <div className="insignia-review-actions">
        <button
          type="button"
          className="insignia-btn insignia-btn-secondary"
          onClick={onBack}
        >
          {t.review.btnBack}
        </button>
        <button
          type="button"
          className="insignia-btn insignia-btn-success"
          disabled={quantity < 1 || submitLoading || !priceResult?.validation?.ok}
          onClick={() => onPrepareAndAddToCart()}
        >
          {submitLoading ? "Adding…" : t.review.btnCart}
        </button>
      </div>
    </section>
  );
}
