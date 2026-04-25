/**
 * proxy-url.client.ts
 *
 * Utility for building URLs that route through the Shopify App Proxy.
 *
 * WHY THIS EXISTS
 * ---------------
 * `app/root.tsx` injects, for any /apps/* path:
 *   <base href="https://<app-host>/">
 * so that React Router's bundled JS/CSS files (e.g.
 * /build/client/entry.client.js) are loaded from the app server rather
 * than the store domain. (Previously this <base> was emitted by
 * <AppProxyProvider> in each leaf route, but that produced a duplicate
 * <base> tag — root in <head> AND provider in <body> — which iOS Safari
 * resolved differently than Chromium and broke modal hydration.)
 *
 * Modern browsers resolve JavaScript `fetch()` relative URLs against
 * the document's base URL (i.e. the <base> element), NOT window.location.
 * This means:
 *   fetch('/apps/insignia/config?...')
 *   → https://<tunnel>/apps/insignia/config?...   (WRONG — bypasses proxy)
 *
 * Instead we must use window.location.origin explicitly:
 *   fetch(proxyUrl('/apps/insignia/config?...'))
 *   → https://insignia-app.myshopify.com/apps/insignia/config?...   (CORRECT)
 * which then goes through the Shopify App Proxy, receives the HMAC signature,
 * and is authenticated correctly by authenticate.public.appProxy().
 *
 * USAGE
 * -----
 * All storefront component fetch() calls to /apps/insignia/* must use
 * proxyUrl() to ensure the request travels through the App Proxy.
 * The cart.client.ts helpers are exempt because they already use the
 * absolute CART_ROOT constant.
 */

/**
 * Prepends window.location.origin to a path so the request goes through
 * the Shopify storefront (and therefore through the App Proxy).
 * Safe to call in both SSR (returns path unchanged) and browser contexts.
 */
export function proxyUrl(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }
  return `${window.location.origin}${path}`;
}
