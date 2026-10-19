import { createObservability } from '@insignia/observability';
import type { PgBossRuntime } from '../../dist/runtime.js';

/** Unexpected queue operations fail; scenarios override their explicit allowed operations. */
export function queueFixture(overrides: Partial<PgBossRuntime>): PgBossRuntime {
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected queue operation');
  };
  return {
    durableReady: false,
    observability: createObservability(),
    start: unexpected,
    stop: unexpected,
    work: unexpected,
    schemaVersion: unexpected,
    checkDurableReady: unexpected,
    ensureWebhookEnqueued: unexpected,
    enqueueRefresh: unexpected,
    removeExpiredWebhookJob: unexpected,
    ...overrides,
  };
}
