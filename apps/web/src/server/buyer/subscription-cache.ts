/** Owner decision 10 Nov 2026: a shop's Partner subscription read is reused for 60 s. */
export const SUBSCRIPTION_CACHE_MS = 60_000;
/** A reused snapshot must still be this far inside the entitlement policy's freshness bound. */
export const SUBSCRIPTION_FRESHNESS_MARGIN_MS = 5_000;
const MAX_ENTRIES = 1024;

/**
 * How long a snapshot may be reused. It never outlives the policy's own freshness bound (minus a
 * margin): a reused snapshot past maxAgeMs is projected as stale and the quote fails.
 */
export function subscriptionReuseMs(policyMaxAgeMs: number): number {
  if (!Number.isSafeInteger(policyMaxAgeMs) || policyMaxAgeMs < 1) throw new Error('Entitlement policy age invalid');
  return Math.max(0, Math.min(SUBSCRIPTION_CACHE_MS, policyMaxAgeMs - SUBSCRIPTION_FRESHNESS_MARGIN_MS));
}

/**
 * Single-flight, per-shop reuse of a successful Partner subscription snapshot for up to 60 s (and
 * never past the policy's maxAgeMs minus 5 s) after
 * its own observation. The snapshot keeps its original observation time, so entitlement projection
 * still applies the policy's freshness bound to the true age. Failures are never cached. A
 * cancelled merchant can therefore receive new quotes for at most 60 s after cancellation.
 */
export function createSubscriptionCache<T extends { observedAt: string }>(
  read: (target: { appId: string; shopId: string }) => Promise<T>,
  policyMaxAgeMs: number,
  clock: () => number = Date.now,
) {
  const reuseMs = subscriptionReuseMs(policyMaxAgeMs);
  const entries = new Map<string, { value?: T; until: number; pending?: Promise<T> }>();
  return async (target: { appId: string; shopId: string }): Promise<T> => {
    const key = `${target.appId}\0${target.shopId}`;
    const now = clock();
    const entry = entries.get(key);
    if (entry?.pending) return entry.pending;
    if (entry?.value && now < entry.until && now >= Date.parse(entry.value.observedAt)) return entry.value;
    const pending = read(target);
    entries.set(key, { pending, until: 0 });
    try {
      const value = await pending;
      const observed = Date.parse(value.observedAt);
      if (Number.isFinite(observed)) {
        if (entries.size > MAX_ENTRIES)
          for (const [other, item] of entries) if (!item.pending && item.until <= now) entries.delete(other);
        entries.set(key, { value, until: observed + reuseMs });
      } else entries.delete(key);
      return value;
    } catch (error) {
      entries.delete(key);
      throw error;
    }
  };
}
