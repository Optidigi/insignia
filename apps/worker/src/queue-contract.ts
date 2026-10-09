export const QUEUE_SCHEMA_VERSION = 43;
export const WEBHOOK_QUEUE = 'insignia.shopify-webhook.v1';
export const REFRESH_QUEUE = 'insignia.token-refresh.v1';
export const QUEUE_POLICY = Object.freeze({
  policy: 'standard' as const,
  retryLimit: 5,
  retryDelay: 2,
  retryBackoff: true,
  expireInSeconds: 120,
  retentionSeconds: 14 * 86400,
  deleteAfterSeconds: 7 * 86400,
  partition: false,
});

export function assertQueueContract(name: string, queue: unknown): void {
  if (!queue || typeof queue !== 'object') throw new Error('Reviewed queue is unavailable');
  const row = queue as Record<string, unknown>;
  if (
    row.name !== name ||
    row.table !== 'job_common' ||
    row.notify !== false ||
    row.deadLetter !== null ||
    row.heartbeatSeconds !== null ||
    row.retryDelayMax !== null ||
    Object.entries(QUEUE_POLICY).some(([key, value]) => row[key] !== value)
  )
    throw new Error('Reviewed queue policy differs');
}
