const ordinary = Object.freeze({ timeoutMs: 10000, minimumValidityMs: 2000 });
// #468: a publish is sent with the ordinary token window. When the staff session ends between
// publication steps the server answers `continue` with the validity its next request needs.
const publication = Object.freeze({ timeoutMs: 60000, minimumValidityMs: 2000 });
// App Bridge session tokens live 60 s; a larger requirement could never be met.
const longestValidityMs = 50000;

/** Scheduling only. Real signature, expiry and authority checks remain server-side. */
export function adminRequestPolicy(path: string, init: RequestInit = {}, continuationValidityMs?: number) {
  if (
    /^\/api\/admin\/products\/[1-9][0-9]*\/config$/.test(path) &&
    init.method?.toUpperCase() === 'POST' &&
    typeof init.body === 'string'
  ) {
    try {
      const body: unknown = JSON.parse(init.body);
      if (body && typeof body === 'object' && 'action' in body && body.action === 'publish')
        return continuationValidityMs === undefined || !Number.isFinite(continuationValidityMs)
          ? publication
          : Object.freeze({
              timeoutMs: publication.timeoutMs,
              minimumValidityMs: Math.min(
                Math.max(continuationValidityMs, publication.minimumValidityMs),
                longestValidityMs,
              ),
            });
    } catch {
      /* Malformed requests retain the ordinary budget and server validation. */
    }
  }
  return ordinary;
}
