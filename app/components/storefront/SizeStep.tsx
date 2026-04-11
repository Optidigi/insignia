/**
 * Step 3: Size selection per placement — card selector or preview mode.
 * - 2+ steps: clickable size cards with price display
 * - 1 step: preview confirmation with canvas (auto-skipped when ALL placements have ≤1 step)
 * Modal-spec: modal-spec.md, design-intent/storefront-modal.md
 */

import { useEffect, useState } from "react";
import type { StorefrontConfig } from "./types";
import type { PlacementSelections, LogoState } from "./CustomizationModal";
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

  // Compute sizeMultiplier from step index for NativeCanvas
  const totalSteps = currentPlacement.steps.length;
  const sizeMultiplier = totalSteps > 1 ? 0.3 + (stepIndex / (totalSteps - 1)) * 0.7 : 0.6;

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
            sizeMultiplier={sizeMultiplier}
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
              <div className="insignia-size-row">
                <input
                  type="range"
                  className="insignia-size-slider"
                  min={0}
                  max={currentPlacement.steps.length - 1}
                  value={stepIndex}
                  onChange={(e) => setStepIndex(Number(e.target.value))}
                  aria-label={`${t.size.sizeLabel} for ${currentPlacement.name}`}
                />
              </div>
              <div className="insignia-size-ticks">
                {currentPlacement.steps.map((s, i) => (
                  <span
                    key={i}
                    style={{
                      left: currentPlacement.steps.length > 1
                        ? `${(i / (currentPlacement.steps.length - 1)) * 100}%`
                        : "50%",
                    }}
                    data-active={i === stepIndex ? "true" : undefined}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
              <span className="insignia-size-label">
                {currentPlacement.steps[stepIndex]?.label ?? "—"}
                {currentPlacement.steps[stepIndex] && currentPlacement.steps[stepIndex].priceAdjustmentCents !== 0 && (
                  <span style={{ color: "var(--insignia-text-secondary)", fontWeight: 400 }}>
                    {" "}{currentPlacement.steps[stepIndex].priceAdjustmentCents > 0 ? "+" : ""}{formatCurrency(currentPlacement.steps[stepIndex].priceAdjustmentCents, config.currency)}
                  </span>
                )}
              </span>
            </>
          ) : (
            <div className="insignia-preview-confirmation">
              <SizePreview
                config={config}
                placementSelections={placementSelections}
                logo={logo}
                highlightPlacementId={currentPlacement.id}
                sizeMultiplier={0.6}
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
