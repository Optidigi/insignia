/**
 * Step 2: Placement selection — choose one or more print locations.
 * Design: tiles with checkbox (filled blue when selected, grey border when not),
 * name (#374151 unselected / #111827 selected), price (#9CA3AF normal / #2563EB bold selected).
 * Desktop shows a page heading + method badge.
 */

import { useEffect } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { TranslationStrings } from "./i18n";
import { formatCurrency } from "./currency";
import { IconCheck, IconSparkles } from "./icons";

type PlacementStepProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  onPlacementSelectionsChange: (s: PlacementSelections) => void;
  onContinue: () => void;
  selectedMethodId: string | null;
  t: TranslationStrings;
};

export function PlacementStep({
  config,
  placementSelections,
  onPlacementSelectionsChange,
  selectedMethodId,
  t,
}: PlacementStepProps) {
  const fmt = (cents: number) => formatCurrency(cents, config.currency);
  const toggle = (placementId: string, defaultStepIndex: number) => {
    const next = { ...placementSelections };
    if (next[placementId] !== undefined) {
      delete next[placementId];
    } else {
      next[placementId] = defaultStepIndex;
    }
    onPlacementSelectionsChange(next);
  };

  // Auto-select when there is exactly one placement and nothing is selected yet
  useEffect(() => {
    if (
      config.placements.length === 1 &&
      placementSelections[config.placements[0].id] === undefined
    ) {
      onPlacementSelectionsChange({
        [config.placements[0].id]: config.placements[0].defaultStepIndex,
      });
    }
  }, [config.placements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-labelledby="placement-heading">
      <h2 id="placement-heading" className="visually-hidden">
        {t.placement.title}
      </h2>

      {/* Desktop-only step heading */}
      <div className="insignia-step-heading">
        <p className="insignia-step-heading-title">{t.placement.title}</p>
        <p className="insignia-step-heading-sub">{t.placement.subtitle}</p>
      </div>

      {/* Method badge */}
      {selectedMethodId && (
        <div className="insignia-method-badge">
          <IconSparkles size={14} />
          <span>{config.methods.find((m) => m.id === selectedMethodId)?.name ?? ""}</span>
        </div>
      )}

      <p className="insignia-section-label">{t.placement.sectionLabel}</p>
      <div className="insignia-placement-grid">
        {config.placements.map((p) => {
          const selected = placementSelections[p.id] !== undefined;
          const priceText =
            selected && p.basePriceAdjustmentCents === 0
              ? "Included"
              : `+${fmt(p.basePriceAdjustmentCents)}`;
          return (
            <button
              key={p.id}
              type="button"
              className="insignia-placement-tile"
              data-selected={selected ? "true" : undefined}
              onClick={() => toggle(p.id, p.defaultStepIndex)}
              aria-pressed={selected}
            >
              <div className="insignia-checkbox" data-checked={selected ? "true" : undefined}>
                {selected && <IconCheck size={12} style={{ color: "white" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">{p.name}</div>
                {(!p.hidePriceWhenZero || p.basePriceAdjustmentCents > 0 || selected) && (
                  <div
                    className="price"
                    data-included={
                      selected && p.basePriceAdjustmentCents === 0 ? "true" : undefined
                    }
                  >
                    {priceText}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {config.placements.length === 1 && (
        <p style={{ color: "var(--insignia-text-secondary)", fontSize: 13, marginTop: 8 }}>
          This product has one print area.
        </p>
      )}
    </section>
  );
}
