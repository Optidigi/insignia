import type { DurableCore } from '@insignia/database';

type Configs = Pick<
  DurableCore['configs'],
  'getRevisionPresentation' | 'getRevisionGeometry' | 'getValidatedPublishedRevision'
>;
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 1024;

/**
 * Published revisions, their geometry and presentation are immutable rows (database triggers), so
 * buyer reads reuse them per (shop, revision) for a bounded time. Only found rows are reused; a
 * missing row is re-read. Which revision is effective is never cached: callers keep reading the
 * current publication pointer.
 */
export function createRevisionReads(configs: Configs, clock: () => number = Date.now): Configs {
  const entries = new Map<string, { until: number; value: Promise<unknown> }>();
  function memo<T>(kind: string, shopId: string, revisionId: string, load: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([kind, shopId, revisionId]);
    const now = clock();
    const entry = entries.get(key);
    if (entry && entry.until > now) return entry.value as Promise<T>;
    if (entries.size >= MAX_ENTRIES)
      for (const [other, item] of entries) if (item.until <= now || entries.size >= MAX_ENTRIES) entries.delete(other);
    const value = load().then(
      (result) => {
        if (result == null && entries.get(key)?.value === value) entries.delete(key);
        return result;
      },
      (error: unknown) => {
        if (entries.get(key)?.value === value) entries.delete(key);
        throw error;
      },
    );
    entries.set(key, { until: now + TTL_MS, value });
    return value;
  }
  return {
    getRevisionPresentation: (shopId, revisionId) =>
      memo('presentation', shopId, revisionId, () => configs.getRevisionPresentation(shopId, revisionId)),
    getRevisionGeometry: (shopId, revisionId) =>
      memo('geometry', shopId, revisionId, () => configs.getRevisionGeometry(shopId, revisionId)),
    getValidatedPublishedRevision: (shopId, revisionId) =>
      memo('published', shopId, revisionId, () => configs.getValidatedPublishedRevision(shopId, revisionId)),
  };
}
