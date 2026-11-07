const ordinary = Object.freeze({ timeoutMs: 10000, minimumValidityMs: 2000 });
const publication = Object.freeze({ timeoutMs: 60000, minimumValidityMs: 30000 });

/** Scheduling only. Real signature, expiry and authority checks remain server-side. */
export function adminRequestPolicy(path: string, init: RequestInit = {}) {
  if (
    /^\/api\/admin\/products\/[1-9][0-9]*\/config$/.test(path) &&
    init.method?.toUpperCase() === 'POST' &&
    typeof init.body === 'string'
  ) {
    try {
      const body: unknown = JSON.parse(init.body);
      if (body && typeof body === 'object' && 'action' in body && body.action === 'publish') return publication;
    } catch {
      /* Malformed requests retain the ordinary budget and server validation. */
    }
  }
  return ordinary;
}
