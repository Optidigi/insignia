const ordinary = Object.freeze({ timeoutMs: 10000, minimumValidityMs: 2000 });
// #468: a publish is sent with the ordinary token window. Its steps may run on the server for up to
// 60 s after it accepts the request, past the token's expiry (owner decision, 25 Nov 2026); near that
// limit the server answers `resend` with the validity its next request needs. The deadline covers that
// 60 s plus the longest token wait (a resend waits up to ~31 s for a new 60 s token) and the network.
const publication = Object.freeze({ timeoutMs: 95000, minimumValidityMs: 2000 });
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
