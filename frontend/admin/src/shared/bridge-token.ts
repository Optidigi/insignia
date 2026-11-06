/** Expiry is only a client-side scheduling hint. The backend still verifies every
 * signature, expiry, staff permission and installation binding. */
function expired(token: string): boolean {
  try {
    const body = token.split('.')[1];
    if (!body) return false;
    const payload: unknown = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload || typeof payload !== 'object' || !('exp' in payload)) return false;
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) && payload.exp * 1000 <= Date.now();
  } catch {
    return false; // Unreadable tokens still require backend validation, never local acceptance.
  }
}

/** The caller owns the existing request deadline. A host may briefly return its
 * expired cached token even when idToken() is called again immediately. */
export async function readFreshBridgeToken(getToken: () => Promise<string>, signal: AbortSignal): Promise<string> {
  for (;;) {
    signal.throwIfAborted();
    const token = await getToken();
    signal.throwIfAborted();
    if (!expired(token)) return token;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 250);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
