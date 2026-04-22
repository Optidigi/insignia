/**
 * Thin App Bridge v4 wrappers for admin routes.
 *
 * Single source of truth for toast / save bar / modal emissions. All admin
 * code should import from here; no `window.shopify` calls anywhere else
 * (the previous pattern is being migrated away from).
 *
 * `.client.ts` suffix enforces client-bundle-only per CLAUDE.md convention.
 * `useAppBridge()` is itself SSR-safe (returns a proxy) but keeping the
 * helpers behind a client boundary prevents accidental server import.
 *
 * There is no `shopify.print()` in @shopify/app-bridge-react@4.2.x —
 * callers that need print use `window.print()` or `window.open(printUrl)`.
 */

import { useAppBridge } from "@shopify/app-bridge-react";

type ToastOptions = {
  isError?: boolean;
  /** Duration in ms. Defaults to 5000 per App Bridge v4. */
  duration?: number;
};

export function useToast(): (message: string, opts?: ToastOptions) => void {
  const shopify = useAppBridge();
  return (message, opts = {}) => {
    shopify.toast.show(message, {
      isError: opts.isError ?? false,
      duration: opts.duration ?? 5000,
    });
  };
}

export function useSaveBar(): {
  show: (id: string) => void;
  hide: (id: string) => void;
  toggle: (id: string) => void;
  leaveConfirmation: () => Promise<void>;
} {
  const shopify = useAppBridge();
  return {
    show: (id) => shopify.saveBar.show(id),
    hide: (id) => shopify.saveBar.hide(id),
    toggle: (id) => shopify.saveBar.toggle(id),
    leaveConfirmation: () => shopify.saveBar.leaveConfirmation(),
  };
}

export function useModal(): {
  show: (id: string) => void;
  hide: (id: string) => void;
  toggle: (id: string) => void;
} {
  const shopify = useAppBridge();
  return {
    show: (id) => shopify.modal.show(id),
    hide: (id) => shopify.modal.hide(id),
    toggle: (id) => shopify.modal.toggle(id),
  };
}

/**
 * Open a printable URL in a new window and trigger the browser print dialog.
 * Used for per-order production sheets (`/app/orders/$id/print`).
 *
 * Caller's responsibility: the target URL must render a print-optimised page.
 * Popup blockers may intercept; the returned window may be null.
 */
export function printUrl(url: string): Window | null {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  // Browsers trigger print automatically via <script>window.print()</script>
  // on the target page. We don't call w.print() from here because the target
  // doc hasn't loaded yet.
  return w;
}
