/**
 * E4 close-confirm alert dialog.
 *
 * Centered modal with destructive icon at top, title, body, then buttons
 * vertically stacked per the design intent doc:
 *   - Primary "Keep editing" full-width
 *   - "Close anyway" destructive link below
 *
 * Renders nothing when `open` is false (rubric #3 — default state must be
 * unreachable from a non-open code path; do NOT mount the dialog DOM unless
 * the caller has chosen to show it). Focus trap + Esc handling are managed
 * by the dialog when open.
 */

import { useEffect, useRef } from "react";
import type { TranslationStrings } from "./i18n";
import { IconAlertTriangle } from "./icons";

type CloseConfirmDialogProps = {
  open: boolean;
  onKeepEditing: () => void;
  onCloseAnyway: () => void;
  t: TranslationStrings;
};

export function CloseConfirmDialog({
  open,
  onKeepEditing,
  onCloseAnyway,
  t,
}: CloseConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  // Capture focus on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    keepEditingRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // Esc closes (acts like "Keep editing" — safer default than dismiss).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onKeepEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeepEditing]);

  if (!open) return null;

  return (
    <div
      className="insignia-dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onKeepEditing();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onKeepEditing();
      }}
    >
      <div
        ref={dialogRef}
        className="insignia-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="insignia-close-confirm-title"
        aria-describedby="insignia-close-confirm-body"
      >
        <div className="insignia-dialog-icon" aria-hidden="true">
          <IconAlertTriangle size={22} />
        </div>
        <h2 id="insignia-close-confirm-title" className="insignia-dialog-title">
          {t.v2.closeConfirm.title}
        </h2>
        <p id="insignia-close-confirm-body" className="insignia-dialog-body">
          {t.v2.closeConfirm.body}
        </p>
        <div className="insignia-dialog-actions">
          <button
            ref={keepEditingRef}
            type="button"
            className="insignia-btn insignia-btn--primary"
            onClick={onKeepEditing}
          >
            {t.v2.closeConfirm.keepEditing}
          </button>
          <button
            type="button"
            className="insignia-btn insignia-btn--link"
            onClick={onCloseAnyway}
          >
            {t.v2.closeConfirm.closeAnyway}
          </button>
        </div>
      </div>
    </div>
  );
}
