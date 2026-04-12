import { useCallback, useEffect, useMemo, useState } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import NativeCanvas from "./NativeCanvas";
import { IconX, IconChevronLeft, IconChevronRight, IconInfo } from "./icons";

type PreviewSheetProps = {
  open: boolean;
  onClose: () => void;
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  logo: LogoState;
  t: TranslationStrings;
};

export function PreviewSheet({ open, onClose, config, placementSelections, logo, t }: PreviewSheetProps) {
  const [currentViewIndex, setCurrentViewIndex] = useState(0);

  // Derive logo URL from logo state (same logic as SizePreview)
  const logoUrl = useMemo(() => {
    if (logo.type === "uploaded") return logo.previewPngUrl;
    if (logo.type === "later" && config.placeholderLogo.mode === "merchant_asset" && config.placeholderLogo.imageUrl) {
      return config.placeholderLogo.imageUrl;
    }
    return null;
  }, [logo, config.placeholderLogo]);

  // Compute previewable views (views with image + at least one selected placement with geometry)
  const previewableViews = useMemo(() => {
    return config.views.filter(view => {
      if (!view.imageUrl) return false;
      return config.placements.some(p => {
        if (placementSelections[p.id] === undefined) return false;
        return p.geometryByViewId[view.id] != null;
      });
    });
  }, [config.views, config.placements, placementSelections]);

  // Build NativeCanvas placement data for current view
  const currentView = previewableViews[currentViewIndex];
  const canvasPlacements = useMemo(() => {
    if (!currentView) return [];
    return config.placements
      .filter(p => placementSelections[p.id] !== undefined && p.geometryByViewId[currentView.id] != null)
      .map(p => {
        const geom = p.geometryByViewId[currentView.id]!;
        return {
          id: p.id,
          centerXPercent: geom.centerXPercent,
          centerYPercent: geom.centerYPercent,
          maxWidthPercent: geom.maxWidthPercent,
        };
      });
  }, [config.placements, currentView, placementSelections]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Reset view index when opening
  useEffect(() => {
    if (open) setCurrentViewIndex(0);
  }, [open]);

  const goPrev = useCallback(() => {
    setCurrentViewIndex(i => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentViewIndex(i => Math.min(previewableViews.length - 1, i + 1));
  }, [previewableViews.length]);

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="insignia-preview-sheet-overlay" onClick={onClose} role="presentation">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="insignia-preview-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.previewSheet.title}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="insignia-preview-sheet-handle-wrap">
          <div className="insignia-preview-sheet-handle" />
        </div>

        {/* Header */}
        <div className="insignia-preview-sheet-header">
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#111827" }}>
            {t.previewSheet.title}
          </h3>
          <button
            type="button"
            className="insignia-preview-sheet-close"
            onClick={onClose}
            aria-label="Close preview"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Preview area */}
        <div className="insignia-preview-sheet-area">
          {currentView ? (
            <>
              <NativeCanvas
                imageUrl={currentView.imageUrl!}
                logoUrl={logoUrl}
                placements={canvasPlacements}
              />
              {previewableViews.length > 1 && (
                <>
                  <button
                    type="button"
                    className="insignia-preview-sheet-nav"
                    data-dir="prev"
                    onClick={goPrev}
                    disabled={currentViewIndex === 0}
                    aria-label="Previous view"
                  >
                    <IconChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    className="insignia-preview-sheet-nav"
                    data-dir="next"
                    onClick={goNext}
                    disabled={currentViewIndex === previewableViews.length - 1}
                    aria-label="Next view"
                  >
                    <IconChevronRight size={18} />
                  </button>
                </>
              )}
              <div className="insignia-preview-sheet-dots">
                {previewableViews.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="insignia-preview-sheet-dot"
                    data-active={i === currentViewIndex ? "true" : undefined}
                    onClick={() => setCurrentViewIndex(i)}
                    aria-label={`View ${i + 1}`}
                  />
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9CA3AF" }}>
              No preview available
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="insignia-preview-sheet-caption">
          <IconInfo size={14} />
          <span>{t.previewSheet.caption}</span>
        </div>
      </div>
    </div>
  );
}
