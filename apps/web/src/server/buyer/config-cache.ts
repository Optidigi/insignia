/** Owner decision 10 Nov 2026: public configuration reads are reused briefly. */
export const CONFIG_CACHE_MS = 30_000;
/** Per-shop budget for uncached configuration reads (each costs Admin API calls). */
export const CONFIG_MISS_BURST = 60;
export const CONFIG_MISS_PER_SECOND = 2;
const MAX_ENTRIES = 2048;

/**
 * Display-only reuse of a configuration's provider reads, keyed by shop, installation, product,
 * published revision/content hash and country, so a new publication is never served from an
 * older entry. Proposal and acceptance still re-check the revision and re-price. Single-flight per
 * key; failures are not cached. Uncached reads draw from a per-shop token bucket, so one public
 * caller cannot drain the shop's Admin API budget through this unauthenticated route.
 */
export function createConfigCache<T>(clock: () => number = Date.now) {
  const entries = new Map<string, { until: number; value?: T; pending?: Promise<T> }>();
  const buckets = new Map<string, { tokens: number; at: number }>();
  function admit(shopId: string): boolean {
    const now = clock();
    const bucket = buckets.get(shopId) ?? { tokens: CONFIG_MISS_BURST, at: now };
    bucket.tokens = Math.min(CONFIG_MISS_BURST, bucket.tokens + ((now - bucket.at) / 1000) * CONFIG_MISS_PER_SECOND);
    bucket.at = now;
    buckets.set(shopId, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
  function prune(now: number) {
    if (entries.size <= MAX_ENTRIES) return;
    for (const [key, entry] of entries) if (!entry.pending && entry.until <= now) entries.delete(key);
    for (const [shop, bucket] of buckets)
      if (bucket.tokens + ((now - bucket.at) / 1000) * CONFIG_MISS_PER_SECOND >= CONFIG_MISS_BURST)
        buckets.delete(shop);
  }
  return {
    /** Resolves the cached value (`hit`) or loads it within the shop's budget; `null` when throttled. */
    async read(
      shopId: string,
      key: readonly string[],
      load: () => Promise<T>,
    ): Promise<{ value: T; cache: 'hit' | 'miss' } | null> {
      const id = JSON.stringify([shopId, ...key]);
      const now = clock();
      const entry = entries.get(id);
      if (entry?.pending) return { value: await entry.pending, cache: 'hit' };
      if (entry && 'value' in entry && now < entry.until) return { value: entry.value as T, cache: 'hit' };
      if (!admit(shopId)) return null;
      prune(now);
      const pending = load();
      entries.set(id, { until: 0, pending });
      try {
        const value = await pending;
        entries.set(id, { until: clock() + CONFIG_CACHE_MS, value });
        return { value, cache: 'miss' };
      } catch (error) {
        if (entries.get(id)?.pending === pending) entries.delete(id);
        throw error;
      }
    },
  };
}
