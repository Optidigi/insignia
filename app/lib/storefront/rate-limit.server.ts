/**
 * In-memory sliding window rate limiter for storefront App Proxy endpoints.
 * Limit: 60 requests per 60-second window, keyed by shopId.
 *
 * Note: This is per-process only. With multiple server instances, limits are
 * not shared, but that is acceptable for this use case — burst traffic is
 * handled per-instance and DoS protection is a secondary layer on top of
 * Shopify's own App Proxy rate limiting.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 60;
const PURGE_INTERVAL = 100; // purge stale entries every N calls

// Map<shopId, timestamps[]>
const store = new Map<string, number[]>();
let callCount = 0;

/**
 * Purge stores for shops that have had no activity in the last 2 windows.
 * Called automatically every PURGE_INTERVAL requests to prevent unbounded growth.
 */
function purgeStaleEntries(): void {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [shopId, timestamps] of store) {
    const last = timestamps[timestamps.length - 1];
    if (!last || last < cutoff) store.delete(shopId);
  }
}

/**
 * Check if the shop has exceeded the rate limit.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 */
export function checkRateLimit(
  shopId: string
): { allowed: true } | { allowed: false; retryAfter: number } {
  // Lazily purge stale entries to prevent memory growth
  callCount++;
  if (callCount % PURGE_INTERVAL === 0) purgeStaleEntries();

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Get or initialize timestamps for this shop, pruning old entries
  const timestamps = (store.get(shopId) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    // Oldest request in window; retry after it expires
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    store.set(shopId, timestamps);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  timestamps.push(now);
  store.set(shopId, timestamps);
  return { allowed: true };
}
