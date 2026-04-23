/**
 * Step 4 — Review.
 *
 * Sectioned summary: garment row, method row, per-placement rows with
 * "Included" tone for free placements, per-garment total. Logo card at top
 * (D1 with thumbnail when uploaded; D10 amber clock when "later"). Quantity
 * grid (D9): 4-column compact cards, each with size label + minus/input/plus
 * stepper. iOS-friendly numeric input per design intent doc spec.
 *
 * Backend bindings: none in this component. The shell calls /price for the
 * authoritative total and /prepare + /cart-confirm at submit time.
 */

import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatCurrency, formatPriceDelta } from "./currency";
import { IconAlertTriangle, IconHelpCircle, IconMapPin, IconSparkles } from "./icons";
import { QuantityGrid } from "./QuantityGrid";

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
  priceResult: PriceResult | null;
  priceLoading: boolean;
  t: TranslationStrings;
};

function originalFileName(logo: LogoState): string {
  if (logo.type !== "uploaded") return "";
  const url = logo.previewPngUrl;
  // Best-effort: pick out the basename after the last slash, before query.
  const path = url.split("?")[0];
  const segs = path.split("/");
  return segs[segs.length - 1] || "logo";
}

export function ReviewStep({
  config,
  selectedMethodId,
  placementSelections,
  logo,
  quantities,
  onQuantitiesChange,
  priceResult,
  priceLoading,
  t,
}: ReviewStepProps) {
  const fmt = (cents: number) => formatCurrency(cents, config.currency);

  const methodName =
    config.methods.find((m) => m.id === selectedMethodId)?.customerName ??
    config.methods.find((m) => m.id === selectedMethodId)?.name ??
    selectedMethodId;
  const methodFeeCents =
    config.methods.find((m) => m.id === selectedMethodId)?.basePriceCents ?? 0;

  // Iterate config.placements (canonical order) so the summary matches the
  // order on Placement + Size steps. Object.entries(placementSelections)
  // returns click-insertion order, which would scramble the rows here.
  const selectedPlacements = config.placements
    .filter((p) => placementSelections[p.id] !== undefined)
    .map((p) => {
      const stepIndex = placementSelections[p.id]!;
      const step = p.steps[stepIndex];
      return {
        id: p.id,
        name: p.name,
        sizeLabel: step?.label ?? "",
        placementCents: p.basePriceAdjustmentCents,
        stepCents: step?.priceAdjustmentCents ?? 0,
      };
    });

  const perGarmentCents =
    (config.baseProductPriceCents || 0) +
    methodFeeCents +
    selectedPlacements.reduce((s, p) => s + p.placementCents + p.stepCents, 0);
  const unitPriceCents = priceResult?.unitPriceCents ?? perGarmentCents;
  const totalQty = Object.values(quantities).reduce((s, n) => s + n, 0);

  return (
    <section aria-labelledby="insignia-review-heading">
      <div className="insignia-step-heading">
        <h2 id="insignia-review-heading" className="insignia-step-heading-title">
          {t.review.orderSummary}
        </h2>
      </div>

      <div className="insignia-review-summary">
        {logo.type === "uploaded" && (
          <div className="insignia-review-logo-card">
            <img
              src={logo.previewPngUrl}
              alt=""
              className="insignia-review-logo-thumb"
            />
            <div className="insignia-review-logo-text">
              <span className="insignia-review-logo-label">{t.v2.review.yourLogo}</span>
              <span className="insignia-review-logo-name">{originalFileName(logo)}</span>
            </div>
          </div>
        )}
        {logo.type === "later" && (
          <div className="insignia-review-logo-card insignia-review-logo-card--later">
            <span className="insignia-review-logo-thumb insignia-review-logo-thumb--later">
              <IconHelpCircle size={20} />
            </span>
            <div className="insignia-review-logo-text">
              <span className="insignia-review-logo-label">{t.v2.review.artworkLabel}</span>
              <span className="insignia-review-logo-name">{t.v2.review.artworkLaterBody}</span>
            </div>
          </div>
        )}

        <div className="insignia-review-row">
          <span className="insignia-review-row-label">{config.productTitle}</span>
          <span className="insignia-review-row-value">{fmt(config.baseProductPriceCents)}</span>
        </div>
        <div className="insignia-review-row">
          <span className="insignia-review-row-label">
            <IconSparkles className="icon" size={14} />
            <span>{methodName}</span>
          </span>
          <span
            className="insignia-review-row-value"
            data-tone={methodFeeCents > 0 ? "accent" : "success"}
          >
            {methodFeeCents === 0 ? t.v2.placement.included : formatPriceDelta(methodFeeCents, config.currency)}
          </span>
        </div>

        <div className="insignia-review-row" data-tone="header">
          <span className="insignia-review-row-label">
            <span className="insignia-section-label" style={{ margin: 0 }}>
              {t.v2.review.customizationsLabel}
            </span>
          </span>
          <span className="insignia-review-customizations-meta">
            {(selectedPlacements.length === 1
              ? t.v2.review.placementCount.one
              : t.v2.review.placementCount.other
            ).replace("{count}", String(selectedPlacements.length))}
          </span>
        </div>

        {selectedPlacements.map((p) => {
          const cents = p.placementCents + p.stepCents;
          const free = cents === 0;
          return (
            <div key={p.id} className="insignia-review-row">
              <span className="insignia-review-row-label">
                <IconMapPin className="icon" size={14} />
                <span>
                  {p.name}
                  {p.sizeLabel ? ` · ${p.sizeLabel}` : ""}
                </span>
              </span>
              <span
                className="insignia-review-row-value"
                data-tone={free ? "success" : "accent"}
              >
                {free ? t.v2.placement.included : formatPriceDelta(cents, config.currency)}
              </span>
            </div>
          );
        })}

        <div className="insignia-review-row" data-tone="total">
          <span className="insignia-review-row-label">{t.v2.review.perGarment}</span>
          <span className="insignia-review-row-value">
            {priceLoading ? "—" : fmt(unitPriceCents)}
          </span>
        </div>
      </div>

      {logo.type === "later" && (
        <div className="insignia-review-later-alert" role="note">
          <IconAlertTriangle size={16} />
          <div>
            <p className="insignia-review-later-alert-title">
              {t.v2.review.artworkLaterAlertTitle}
            </p>
            <p className="insignia-review-later-alert-body">
              {t.v2.review.artworkLaterAlertBody}
            </p>
          </div>
        </div>
      )}

      <div className="insignia-qty-header">
        <span className="insignia-qty-header-title">{t.v2.review.orderQuantities}</span>
        <span className="insignia-qty-header-meta">
          {(() => {
            // Defensive fallback: older caches may not have variantAxis yet
            const axis = config.variantAxis ?? "size";
            const unitStrings = t.v2.review.variantsUnit[axis];
            const count = config.variants.length;
            const unit = count === 1 ? unitStrings.one : unitStrings.other;
            return t.v2.review.variantsItems
              .replace("{count}", String(count))
              .replace("{unit}", unit)
              .replace("{items}", String(totalQty))
              .replace(
                "{itemsUnit}",
                totalQty === 1 ? t.v2.review.itemsUnit.one : t.v2.review.itemsUnit.other,
              );
          })()}
        </span>
      </div>

      <QuantityGrid
        variants={config.variants}
        quantities={quantities}
        onChange={onQuantitiesChange}
        t={t}
      />
    </section>
  );
}
