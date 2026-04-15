/**
 * Step 4: Review — sectioned summary, B2B per-size quantities,
 * gradient total bar, artwork section, green Add to Cart button.
 */

import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatCurrency } from "./currency";
import { IconEye, IconShoppingCart } from "./icons";

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
  quantities: Record<string, number>;
  onQuantitiesChange: (q: Record<string, number>) => void;
  customizationId: string | null;
  priceResult: PriceResult | null;
  prepareResult: {
    slotVariantId: string;
    configHash: string;
    pricingVersion: string;
    unitPriceCents: number;
    feeCents: number;
  } | null;
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
  logo,
  quantities,
  onQuantitiesChange,
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
    selectedPlacements.reduce(
      (sum, p) => sum + p.placementPriceCents + p.sizePriceCents,
      0
    );

  // Variants are pre-filtered by the backend to only include sizes matching
  // the selected variant's non-size options (e.g. same color).
  const sizeVariants = config.variants;

  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);
  const unitCents =
    priceResult?.unitPriceCents ?? baseProductPriceCents + totalFeeCents;
  const totalCents = unitCents * totalQuantity;

  const setQty = (variantId: string, qty: number) => {
    onQuantitiesChange({ ...quantities, [variantId]: Math.max(0, qty) });
  };

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading" className="visually-hidden">
        {t.review.orderSummary}
      </h2>

      {/* Desktop step heading */}
      <div className="insignia-step-heading">
        <p className="insignia-step-heading-title">{t.review.orderSummary}</p>
        <p className="insignia-step-heading-sub">{t.review.reviewSubtitle}</p>
      </div>

      {/* Summary Card */}
      <div className="insignia-review-summary">
        {/* PRODUCT section */}
        <span className="insignia-review-section-label">{t.review.product}</span>
        <div className="insignia-review-line">
          <span className="insignia-review-line-name">{productTitle}</span>
          <span className="insignia-review-line-price">
            {fmt(baseProductPriceCents)}
          </span>
        </div>

        <div className="insignia-review-divider" />

        {/* DECORATION section */}
        <span className="insignia-review-section-label">
          {t.review.decoration}
        </span>
        <div className="insignia-review-line">
          <span className="insignia-review-line-name">{methodName}</span>
          <span className="insignia-review-line-price insignia-review-line-price--blue">
            +{fmt(methodPriceCents)}
          </span>
        </div>

        <div className="insignia-review-divider" />

        {/* CUSTOMIZATIONS section */}
        <span className="insignia-review-section-label">
          {t.review.customizations}
        </span>
        {selectedPlacements.map((p) => (
          <div key={p.id} className="insignia-review-line">
            <span className="insignia-review-line-name">
              {p.name} placement
            </span>
            <span className="insignia-review-line-price">
              +{fmt(p.placementPriceCents)}
            </span>
          </div>
        ))}
        {selectedPlacements
          .filter((p) => p.sizePriceCents !== 0)
          .map((p) => (
            <div key={`${p.id}-size`} className="insignia-review-line">
              <span className="insignia-review-line-name">
                {p.sizeLabel} size
              </span>
              <span className="insignia-review-line-price insignia-review-line-price--blue">
                +{fmt(p.sizePriceCents)}
              </span>
            </div>
          ))}

        <div className="insignia-review-divider" />

        {/* ARTWORK section */}
        <span className="insignia-review-section-label">
          {t.review.artwork}
        </span>
        <div className="insignia-review-line">
          <span className="insignia-review-line-name">{t.review.logo}</span>
          {logo.type === "later" ? (
            <span className="insignia-review-artwork-badge">
              {t.review.uploadAfterPurchase}
            </span>
          ) : (
            <span className="insignia-review-line-price">✓</span>
          )}
        </div>
      </div>

      {/* B2B per-size quantities */}
      {sizeVariants.length > 0 && (
        <div className="insignia-qty-section">
          <div className="insignia-qty-section-header">
            <span className="insignia-qty-section-title">
              {t.review.orderQuantities}
            </span>
            <span className="insignia-qty-section-badge">
              {totalQuantity} {t.review.items}
            </span>
          </div>
          {sizeVariants.map((variant) => {
            const qty = quantities[variant.id] ?? 0;
            const unavailable = !variant.available;
            return (
              <div key={variant.id} className="insignia-qty-row" style={unavailable ? { opacity: 0.5 } : undefined}>
                <span className="insignia-qty-row-label">
                  {variant.sizeLabel}
                  {unavailable && <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: 6 }}>Sold out</span>}
                </span>
                <div className="insignia-qty-row-stepper">
                  <button
                    type="button"
                    className="insignia-qty-btn"
                    disabled={qty <= 0 || unavailable}
                    onClick={() => setQty(variant.id, qty - 1)}
                    aria-label={`Decrease ${variant.sizeLabel}`}
                  >
                    −
                  </button>
                  <div className="insignia-qty-val">{qty}</div>
                  <button
                    type="button"
                    className="insignia-qty-btn"
                    disabled={unavailable || qty >= 999}
                    onClick={() => setQty(variant.id, qty + 1)}
                    aria-label={`Increase ${variant.sizeLabel}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
          <div className="insignia-qty-total-row">
            <span>{t.review.total}</span>
            <span>
              {totalQuantity} {t.review.items}
            </span>
          </div>
        </div>
      )}

      {/* Fallback single quantity if no variants */}
      {config.variants.length === 0 && (
        <div className="insignia-review-quantity">
          <label htmlFor="insignia-qty" className="insignia-review-qty-label">
            {t.review.quantity}
          </label>
          <div className="insignia-qty-stepper">
            <button
              type="button"
              className="insignia-qty-btn"
              onClick={() => {
                const currentQty = Object.values(quantities)[0] ?? 1;
                const key = Object.keys(quantities)[0] ?? "_default";
                onQuantitiesChange({ [key]: Math.max(1, currentQty - 1) });
              }}
              disabled={(Object.values(quantities)[0] ?? 1) <= 1}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <input
              id="insignia-qty"
              type="number"
              className="insignia-quantity-input"
              min={1}
              max={999}
              value={Object.values(quantities)[0] ?? 1}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const key = Object.keys(quantities)[0] ?? "_default";
                if (!isNaN(v) && v >= 1) onQuantitiesChange({ [key]: v });
              }}
            />
            <button
              type="button"
              className="insignia-qty-btn insignia-qty-btn--plus"
              onClick={() => {
                const currentQty = Object.values(quantities)[0] ?? 1;
                const key = Object.keys(quantities)[0] ?? "_default";
                onQuantitiesChange({ [key]: currentQty + 1 });
              }}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Gradient total bar */}
      <div className="insignia-review-total-bar">
        <div>
          <span className="label">{t.review.orderTotalLabel}</span>
          <span className="breakdown">
            {totalQuantity} × ({fmt(baseProductPriceCents)} +{" "}
            {fmt(totalFeeCents)} custom) · {t.review.perItem}
          </span>
        </div>
        <span className="amount">{fmt(totalCents)}</span>
      </div>

      {/* Floating preview button — mobile only */}
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
          className="insignia-review-back-link"
          onClick={onBack}
        >
          ← {t.review.btnBack}
        </button>
        <button
          type="button"
          className="insignia-btn insignia-btn-success"
          disabled={
            totalQuantity < 1 || submitLoading || !priceResult?.validation?.ok
          }
          onClick={() => onPrepareAndAddToCart()}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <IconShoppingCart size={16} />
          <span>
            {submitLoading
              ? "Adding…"
              : `${t.review.addToCartWithPrice} — ${fmt(totalCents)}`}
          </span>
        </button>
      </div>
    </section>
  );
}
