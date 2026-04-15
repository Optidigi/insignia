/**
 * Step 3: Size selection per placement — card selector or preview mode.
 * - 2+ steps: clickable size cards with price display
 * - 1 step: preview confirmation with canvas (auto-skipped when ALL placements have ≤1 step)
 * Modal-spec: modal-spec.md, design-intent/storefront-modal.md
 */

import { useEffect, useState } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatCurrency } from "./currency";
import { SizePreview } from "./SizePreview";

type SizeStepProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  onPlacementSelectionsChange: (s: PlacementSelections) => void;
  logo: LogoState;
  onContinue: () => void;
  t: TranslationStrings;
};

export function SizeStep({
  config,
  placementSelections,
  onPlacementSelectionsChange,
  logo,
  onContinue,
  t,
}: SizeStepProps) {
  const selectedPlacementIds = config.placements.filter((p) => placementSelections[p.id] !== undefined);
  const [currentPlacementIndex, setCurrentPlacementIndex] = useState(0);
  const currentPlacement = selectedPlacementIds[currentPlacementIndex];

  // Auto-skip when ALL selected placements have ≤1 step
  useEffect(() => {
    const allSingle = selectedPlacementIds.every((p) => p.steps.length <= 1);
    if (allSingle) {
      onContinue();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentPlacement) {
    return (
      <section>
        <p>No placements selected. Go back and select at least one.</p>
      </section>
    );
  }

  const stepIndex = placementSelections[currentPlacement.id] ?? currentPlacement.defaultStepIndex;
  const setStepIndex = (idx: number) => {
    onPlacementSelectionsChange({
      ...placementSelections,
      [currentPlacement.id]: Math.max(0, Math.min(idx, currentPlacement.steps.length - 1)),
    });
  };

  return (
    <section aria-labelledby="size-heading">
      <h2 id="size-heading" className="visually-hidden">
        {t.size.sizeLabel}
      </h2>
      <div className="insignia-size-layout">
        <div className="insignia-size-canvas">
          <SizePreview
            config={config}
            placementSelections={placementSelections}
            logo={logo}
            highlightPlacementId={currentPlacement.id}
          />
        </div>
        <div className="insignia-size-controls">
          {currentPlacement.steps.length > 1 ? (
            <>
              <h3>Logo size</h3>
              {selectedPlacementIds.length > 1 && (
                <span className="insignia-position-badge">
                  {t.size.position} {currentPlacementIndex + 1} {t.size.of} {selectedPlacementIds.length}: {currentPlacement.name}
                </span>
              )}
              {/* Size cards — replaces the old range slider */}
              <div className="insignia-size-cards" role="group" aria-label={t.size.sizeLabel}>
                {currentPlacement.steps.map((step, i) => {
                  const isSelected = i === stepIndex;
                  const isDefault = i === currentPlacement.defaultStepIndex;
                  const hasPriceDelta = step.priceAdjustmentCents !== 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`insignia-size-card${isSelected ? " insignia-size-card--selected" : ""}`}
                      onClick={() => setStepIndex(i)}
                      aria-pressed={isSelected}
                      aria-label={`${step.label}${isDefault ? `, ${t.placement.recommended}` : ""}${hasPriceDelta ? `, ${step.priceAdjustmentCents > 0 ? "+" : ""}${formatCurrency(step.priceAdjustmentCents, config.currency)}` : ""}`}
                    >
                      <span className="insignia-size-card-letter">{step.label.charAt(0).toUpperCase()}</span>
                      <span className="insignia-size-card-info">
                        <span className="insignia-size-card-name">
                          {step.label}
                          {isDefault && (
                            <span className="insignia-size-card-badge">{t.placement.recommended}</span>
                          )}
                        </span>
                        <span className="insignia-size-card-scale">{step.scaleFactor}x</span>
                      </span>
                      {hasPriceDelta ? (
                        <span className="insignia-size-card-price">
                          {step.priceAdjustmentCents > 0 ? "+" : ""}{formatCurrency(step.priceAdjustmentCents, config.currency)}
                        </span>
                      ) : isDefault ? (
                        <span className="insignia-size-card-included">Included</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="insignia-preview-confirmation">
              <SizePreview
                config={config}
                placementSelections={placementSelections}
                logo={logo}
                highlightPlacementId={currentPlacement.id}
              />
              <div className="insignia-preview-info">
                <strong>Your logo on {currentPlacement.name}</strong>
                <span style={{ color: 'var(--insignia-text-secondary)' }}>Fixed size</span>
              </div>
              <div className="insignia-preview-ready" style={{
                background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8,
                padding: '12px 14px', display: 'flex', gap: 8, alignItems: 'center'
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#16A34A">
                  <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.5 5.5L7 10l-2.5-2" stroke="#16A34A" strokeWidth="1.5" fill="none"/>
                </svg>
                <div>
                  <strong style={{ color: '#15803D' }}>Ready to add to cart</strong>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>Your logo will be placed at the size shown above.</div>
                </div>
              </div>
            </div>
          )}
          {selectedPlacementIds.length > 1 && (
            <div className="insignia-footer-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="insignia-btn insignia-btn-secondary"
                disabled={currentPlacementIndex === 0}
                onClick={() => setCurrentPlacementIndex((i) => i - 1)}
              >
                {t.size.btnBack}
              </button>
              <button
                type="button"
                className="insignia-btn insignia-btn-primary"
                disabled={currentPlacementIndex === selectedPlacementIds.length - 1}
                onClick={() => setCurrentPlacementIndex((i) => i + 1)}
              >
                {t.size.btnNextPos}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
