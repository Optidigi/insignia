/**
 * Shopify loads each admin page with `shop`, `host` and `embedded` in the query. App Bridge needs `shop`
 * (and `host`) to start; when an in-app link drops them, App Bridge falls back to what it saved in session
 * storage. With third-party cookies blocked (Chrome incognito) that storage is denied, so the next page
 * fails with "missing required configuration fields: shop" (App Store requirement 1.1.1). App-owned
 * navigation therefore carries these three values forward. Tokens and signatures (`id_token`, `hmac`,
 * `session`, `timestamp`) are never copied.
 */
export const EMBEDDED_CONTEXT_PARAMS = ['shop', 'host', 'embedded'] as const;

export function withEmbeddedContext(href: string, currentUrl: string): string {
  try {
    const current = new URL(currentUrl);
    const url = new URL(href, current);
    if (url.origin !== current.origin || !url.pathname.startsWith('/admin/')) return href;
    let changed = false;
    for (const name of EMBEDDED_CONTEXT_PARAMS) {
      const value = current.searchParams.get(name);
      if (value !== null && !url.searchParams.has(name)) {
        url.searchParams.set(name, value);
        changed = true;
      }
    }
    return changed ? `${url.pathname}${url.search}${url.hash}` : href;
  } catch {
    return href;
  }
}
