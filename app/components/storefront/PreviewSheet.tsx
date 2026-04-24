/**
 * E7 — Mobile bottom-sheet preview overlay.
 *
 * Hidden on desktop (CSS rule). Drag handle at top dismisses on swipe-down.
 * Sticky header with title + close button. Body contains a PreviewCanvas
 * scrolled into a `min(85dvh, 720px)` bounded surface so iOS URL bar
 * collapse can't crop content.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { PreviewCanvas } from "./PreviewCanvas";
import { IconX } from "./icons";

type PreviewSheetProps = {
  open: boolean;
  onClose: () => void;
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  logo: LogoState;
  /** Placement id the embedded PreviewCanvas should zoom toward. */
  zoomTargetPlacementId?: string | null;
  t: TranslationStrings;
};

const DISMISS_THRESHOLD_PX = 80;

export function PreviewSheet({
  open,
  onClose,
  config,
  placementSelections,
  logo,
  zoomTargetPlacementId,
  t,
}: PreviewSheetProps) {
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef<number | null>(null);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStartRef.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartRef.current == null) return;
    const delta = e.clientY - dragStartRef.current;
    if (delta > 0) setDragY(delta);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartRef.current == null) return;
      const delta = e.clientY - dragStartRef.current;
      dragStartRef.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      if (delta > DISMISS_THRESHOLD_PX) {
        setDragY(0);
        onClose();
      } else {
        setDragY(0);
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="insignia-preview-sheet-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="insignia-preview-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.previewSheet.title}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragStartRef.current == null ? "transform var(--insignia-dur-med) var(--insignia-ease-out)" : "none",
        }}
      >
        <div
          className="insignia-preview-sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStartRef.current = null;
            setDragY(0);
          }}
          role="button"
          aria-label={t.v2.preview.dragHandle}
          tabIndex={0}
        />
        <div className="insignia-preview-sheet-header">
          <span className="insignia-preview-sheet-title">{t.previewSheet.title}</span>
          <button
            type="button"
            className="insignia-modal-close"
            onClick={onClose}
            aria-label={t.v2.preview.closeSheet}
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="insignia-preview-sheet-body">
          <PreviewCanvas
            config={config}
            placementSelections={placementSelections}
            logo={logo}
            zoomTargetPlacementId={zoomTargetPlacementId}
            context="sheet"
            t={t}
          />
        </div>
      </div>
    </>
  );
}
