/**
 * Step 2 — Placement selection.
 *
 * Pattern: full-row tap target (label + hidden checkbox), one row per
 * configured placement. Selected row gets tint fill + accent border.
 *
 * Auto-selects when there's exactly one placement and nothing is set.
 *
 * Backend bindings: none (pure UI state on top of config.placements).
 */

import { useEffect } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatPriceDelta } from "./currency";
import { getPlacementCents } from "./pricing";
import { IconCheck } from "./icons";
import { PreviewCanvas } from "./PreviewCanvas";
import type { ImageMeta } from "./NativeCanvas";

type PlacementStepProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  onPlacementSelectionsChange: (s: PlacementSelections) => void;
  logo: LogoState;
  desktopActiveViewId?: string;
  onDesktopActiveViewChange?: (viewId: string) => void;
  highlightedPlacementId?: string | null;
  onImageMeta?: (viewId: string, meta: ImageMeta) => void;
  /** Currently-selected decoration method, for per-method placement-fee resolution. */
  selectedMethodId?: string | null;
  /**
   * Placement id that the canvas preview should zoom toward. Forwarded to
   * the embedded PreviewCanvas. Null = un-zoomed.
   */
  zoomTargetPlacementId?: string | null;
  /**
   * Fired when the user hovers, focuses, or taps-to-select a placement row,
   * so the shell can retarget the preview zoom. Hover-out does NOT emit null
   * (avoids flicker between adjacent rows).
   */
  onZoomTargetChange?: (placementId: string | null) => void;
  t: TranslationStrings;
  onAnalytics?: (name: string, detail: Record<string, unknown>) => void;
};

function viewName(view: { name: string | null; perspective: string }): string {
  if (view.name) return view.name;
  return view.perspective.charAt(0).toUpperCase() + view.perspective.slice(1);
}

export function PlacementStep({
  config,
  placementSelections,
  onPlacementSelectionsChange,
  logo,
  desktopActiveViewId,
  onDesktopActiveViewChange,
  highlightedPlacementId,
  onImageMeta,
  selectedMethodId = null,
  zoomTargetPlacementId,
  onZoomTargetChange,
  t,
  onAnalytics,
}: PlacementStepProps) {
  const totalPlacements = config.placements.length;
  const selectedCount = Object.keys(placementSelections).length;

  // Auto-select if exactly one placement is configured.
  useEffect(() => {
    if (
      config.placements.length === 1 &&
      placementSelections[config.placements[0].id] === undefined
    ) {
      onPlacementSelectionsChange({
        [config.placements[0].id]: config.placements[0].defaultStepIndex,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.placements.length]);

  const toggle = (placementId: string, defaultStepIndex: number) => {
    const next: PlacementSelections = { ...placementSelections };
    let action: "select" | "deselect";
    if (next[placementId] !== undefined) {
      delete next[placementId];
      action = "deselect";
    } else {
      next[placementId] = defaultStepIndex;
      action = "select";
    }
    onPlacementSelectionsChange(next);
    // Mobile zoom cue: when a row becomes selected, retarget the preview.
    // Deselect does not clear the zoom — keep the last target visible so the
    // customer doesn't see a jarring zoom-out mid-interaction.
    if (action === "select") {
      onZoomTargetChange?.(placementId);
    }
    onAnalytics?.("placement_selected", {
      placementId,
      selected: action === "select",
      totalSelected: Object.keys(next).length,
    });
  };

  return (
    <section aria-labelledby="insignia-placement-heading">
      <div className="insignia-step-heading">
        <h2 id="insignia-placement-heading" className="insignia-step-heading-title">
          {t.placement.title}
        </h2>
        <p className="insignia-step-heading-sub">{t.placement.subtitle}</p>
      </div>

      <PreviewCanvas
        config={config}
        placementSelections={placementSelections}
        logo={logo}
        highlightPlacementId={highlightedPlacementId}
        zoomTargetPlacementId={zoomTargetPlacementId}
        viewId={desktopActiveViewId}
        onViewChange={onDesktopActiveViewChange}
        onImageMeta={onImageMeta}
        context="step"
        t={t}
      />

      <div className="insignia-pick-header">
        <span className="insignia-pick-header-title">{t.v2.placement.title}</span>
        <span className="insignia-pick-header-meta">
          {t.v2.placement.selectedCount
            .replace("{count}", String(selectedCount))
            .replace("{total}", String(totalPlacements))}
        </span>
      </div>

      <div
        className="insignia-placement-list"
        // Clear zoom when the cursor leaves the entire list (not between
        // individual rows — onMouseLeave here fires only when we exit the
        // whole container, so row-to-row movement doesn't flicker).
        onMouseLeave={() => onZoomTargetChange?.(null)}
        // Keyboard equivalent: when focus leaves the list for something that
        // isn't another row inside the list, clear zoom.
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            onZoomTargetChange?.(null);
          }
        }}
      >
        {config.placements.map((p) => {
          const selected = placementSelections[p.id] !== undefined;
          // Find which view owns this placement so we can show its name as subtitle.
          const ownerView = config.views.find((v) => p.geometryByViewId[v.id] != null);
          const ownerLabel = ownerView ? `${viewName(ownerView)} view` : null;
          const placementCents = getPlacementCents(p, selectedMethodId);
          const isFree = placementCents === 0;
          // Zero-delta: green "Included" when selected, hidden otherwise.
          // Positive delta: always show "+€X.XX" in accent. Never render "+€0.00".
          const showPrice = isFree ? selected : true;

          return (
            <label
              key={p.id}
              className="insignia-placement-row"
              data-state={selected ? "selected" : undefined}
              onMouseEnter={() => {
                if (onDesktopActiveViewChange && ownerView?.id) {
                  onDesktopActiveViewChange(ownerView.id);
                }
                onZoomTargetChange?.(p.id);
              }}
              // Focus bubbles up from the nested checkbox (which is already
              // focusable), so keyboard users get the same zoom cue as mouse
              // users via hover. No extra tabIndex on the label needed.
              onFocus={() => {
                if (onDesktopActiveViewChange && ownerView?.id) {
                  onDesktopActiveViewChange(ownerView.id);
                }
                onZoomTargetChange?.(p.id);
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggle(p.id, p.defaultStepIndex)}
                aria-label={p.name}
              />
              <span className="insignia-checkbox" aria-hidden="true">
                <IconCheck className="insignia-checkbox-check" size={14} />
              </span>
              <span className="insignia-placement-row-text">
                <span className="insignia-placement-row-name">{p.name}</span>
                {ownerLabel && (
                  <span className="insignia-placement-row-view">{ownerLabel}</span>
                )}
              </span>
              {showPrice && (
                <span
                  className="insignia-placement-row-price"
                  data-included={selected && isFree ? "true" : undefined}
                >
                  {selected && isFree
                    ? t.v2.placement.included
                    : formatPriceDelta(placementCents, config.currency)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
