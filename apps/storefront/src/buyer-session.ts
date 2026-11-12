/**
 * The browser's one home for the buyer session capability (#340).
 *
 * `localStorage` is shared by every tab of the storefront origin, which serves one shop, as the Shopify
 * cart is. Every tab therefore acts as one buyer session, and owns the cart's accepted sets, until the
 * server expires it. The key adds the App Proxy mount. The stored value is only the bearer capability,
 * its session ID and explicit expiry (spec §8.2): never designs, artwork, URLs or personal data. An
 * expired, malformed or server-rejected value is removed rather than kept.
 */
export type BuyerSessionGrant = { capability: string; sessionId: string; expiresAt: string };
export type BuyerSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Shared storage for buyer state that outlives one tab; undefined where the browser blocks it. */
export function sharedBuyerStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function buyerSessionKey(proxyBase: string): string {
  return `insignia-buyer-session:${proxyBase.slice(proxyBase.lastIndexOf('/apps/'))}`;
}

/** The stored session while it is unexpired; anything else stored there is removed. */
export function readBuyerSession(
  storage: BuyerSessionStorage | undefined,
  proxyBase: string,
): BuyerSessionGrant | undefined {
  if (!storage) return undefined;
  const key = buyerSessionKey(proxyBase);
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null');
    if (value === null) return undefined;
    if (
      typeof value.capability === 'string' &&
      typeof value.sessionId === 'string' &&
      Date.parse(value.expiresAt) > Date.now()
    )
      return { capability: value.capability, sessionId: value.sessionId, expiresAt: value.expiresAt };
  } catch {
    /* Invalid local hints do not become authority. */
  }
  try {
    storage.removeItem(key);
  } catch {
    /* Storage unavailable: nothing persists. */
  }
  return undefined;
}

export function writeBuyerSession(
  storage: BuyerSessionStorage | undefined,
  proxyBase: string,
  value: BuyerSessionGrant,
): void {
  try {
    storage?.setItem(
      buyerSessionKey(proxyBase),
      JSON.stringify({ capability: value.capability, sessionId: value.sessionId, expiresAt: value.expiresAt }),
    );
  } catch {
    /* Storage full or blocked: this page keeps its session in memory. */
  }
}

/** Removes a rejected capability, unless another tab already stored its replacement. */
export function forgetBuyerSession(storage: BuyerSessionStorage | undefined, proxyBase: string, capability: string) {
  if (readBuyerSession(storage, proxyBase)?.capability !== capability) return;
  try {
    storage?.removeItem(buyerSessionKey(proxyBase));
  } catch {
    /* Storage unavailable. */
  }
}

/**
 * Before #340 each tab kept its session in `sessionStorage` under the same key. Called under the lock when
 * the shared store is empty, it moves an unexpired one there, so a tab mid-journey across the deploy keeps
 * owning its cart. Remove once no such session can still be unexpired (seven days after deploy).
 */
export function adoptTabSession(storage: BuyerSessionStorage | undefined, proxyBase: string) {
  if (!storage || storage !== sharedBuyerStorage()) return undefined;
  let tab: BuyerSessionStorage;
  try {
    tab = globalThis.sessionStorage;
  } catch {
    return undefined;
  }
  const value = readBuyerSession(tab, proxyBase);
  if (!value) return undefined;
  writeBuyerSession(storage, proxyBase, value);
  try {
    tab.removeItem(buyerSessionKey(proxyBase));
  } catch {
    /* The shared copy now governs. */
  }
  return value;
}

/**
 * Runs `work` while no other tab of this origin runs it for the same mount, so tabs opened together
 * create one session instead of one each. Without the Web Locks API it runs unserialized.
 */
export async function withBuyerSessionLock<T>(proxyBase: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'object' ? navigator.locks : undefined;
  return locks ? await locks.request(buyerSessionKey(proxyBase), work) : work();
}
