/** Owner decision 10 Nov 2026: a shop's Partner subscription read is reused for 60 s. */
export const SUBSCRIPTION_CACHE_MS = 60_000;
const MAX_ENTRIES = 1024;

/**
 * Single-flight, per-shop reuse of a successful Partner subscription snapshot for up to 60 s after
 * its own observation. The snapshot keeps its original observation time, so entitlement projection
 * still applies the policy's freshness bound to the true age. Failures are never cached. A
 * cancelled merchant can therefore receive new quotes for at most 60 s after cancellation.
 */
export function createSubscriptionCache<T extends { observedAt: string }>(
  read: (target: { appId: string; shopId: string }) => Promise<T>,
  clock: () => number = Date.now,
) {
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
        entries.set(key, { value, until: observed + SUBSCRIPTION_CACHE_MS });
      } else entries.delete(key);
      return value;
    } catch (error) {
      entries.delete(key);
      throw error;
    }
  };
}
