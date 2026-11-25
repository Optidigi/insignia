const ordinary = Object.freeze({ timeoutMs: 10000, minimumValidityMs: 2000 });
/** #468: the server starts a publication step only while the request's session token has at least
 * PUBLICATION_STEP_MARGIN_MS (15 s) left, and a publish POST spends up to ~1.75 s (online token exchange
 * included) before its first step. A token with less than this left would only be answered `resend`, so
 * the publish waits for the next one instead. App Bridge cannot issue a token on demand: `idToken()`
 * returns its cached token until it expires (measured natively 25 Nov 2026, App Bridge 0.41.6), so the
 * wait is the existing poll. When the session ends between steps the server answers `resend` with the
 * validity its next request needs. */
export const PUBLICATION_SEND_VALIDITY_MS = 17000;
const publication = Object.freeze({ timeoutMs: 60000, minimumValidityMs: PUBLICATION_SEND_VALIDITY_MS });
// App Bridge session tokens live 60 s; a larger requirement could never be met.
const longestValidityMs = 50000;

/** Scheduling only. Real signature, expiry and authority checks remain server-side. */
export function adminRequestPolicy(path: string, init: RequestInit = {}, resendValidityMs?: number) {
  if (
    /^\/api\/admin\/products\/[1-9][0-9]*\/config$/.test(path) &&
    init.method?.toUpperCase() === 'POST' &&
    typeof init.body === 'string'
  ) {
    try {
      const body: unknown = JSON.parse(init.body);
      if (body && typeof body === 'object' && 'action' in body && body.action === 'publish')
        return resendValidityMs === undefined || !Number.isFinite(resendValidityMs)
          ? publication
          : Object.freeze({
              timeoutMs: publication.timeoutMs,
              minimumValidityMs: Math.min(
                Math.max(resendValidityMs, publication.minimumValidityMs),
                longestValidityMs,
              ),
            });
    } catch {
      /* Malformed requests retain the ordinary budget and server validation. */
    }
  }
  return ordinary;
}
