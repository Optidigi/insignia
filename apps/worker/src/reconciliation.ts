import type { createArtworkService } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import { maintainCustomerPrivacy, maintainWebhookRetention, recoverPendingUninstalls } from './handlers.js';
import type { PgBossRuntime } from './runtime.js';

/** Production maintenance composition; facade/queue implementations own durable effects. */
export function createWorkerReconciliation(input: {
  core: DurableCore;
  queue: PgBossRuntime;
  artwork?: Pick<ReturnType<typeof createArtworkService>, 'cleanup'>;
  usage?: { runOnce(): Promise<{ failed: number }>; stop(): Promise<void> };
  purchases?: { recover(): Promise<unknown>; discoverChanges(): Promise<unknown> };
}) {
  let active: Promise<void> | undefined;
  let stopped = false;
  const runOnce = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      const operations = [
        {
          errorClass: 'CUSTOMER_PRIVACY_CLEANUP_UNAVAILABLE',
          run: () => maintainCustomerPrivacy(input.core, input.queue),
        },
        { errorClass: 'WEBHOOK_RETENTION_UNAVAILABLE', run: () => maintainWebhookRetention(input.core, input.queue) },
        { errorClass: 'UNINSTALL_RECOVERY_UNAVAILABLE', run: () => recoverPendingUninstalls(input.core, input.queue) },
        { errorClass: 'PURCHASE_RECOVERY_UNAVAILABLE', run: () => input.purchases?.recover() },
        { errorClass: 'PURCHASE_DISCOVERY_UNAVAILABLE', run: () => input.purchases?.discoverChanges() },
        {
          errorClass: 'USAGE_QUALIFICATION_UNAVAILABLE',
          run: async () => {
            const summary = await input.usage?.runOnce();
            if (summary && summary.failed > 0) throw new Error('USAGE_QUALIFICATION_UNAVAILABLE');
            if (summary) input.queue.observability.metrics.usageQualification('success');
          },
        },
        { errorClass: 'PURCHASE_PAYLOAD_CLEANUP_UNAVAILABLE', run: () => input.core.purchases?.cleanupDue(100) },
        { errorClass: 'ARTWORK_CLEANUP_UNAVAILABLE', run: () => input.artwork?.cleanup(20) },
        {
          errorClass: 'BUYER_PAYLOAD_CLEANUP_UNAVAILABLE',
          run: () => input.core.buyers?.cleanupDue(100),
        },
      ];
      for (const operation of operations) {
        if (stopped) break;
        try {
          await operation.run();
        } catch {
          // Reporting failures cannot become another cross-operation barrier.
          try {
            if (operation.errorClass === 'USAGE_QUALIFICATION_UNAVAILABLE')
              input.queue.observability.metrics.usageQualification('failure');
          } catch {}
          try {
            input.queue.observability.logger.error('queue_job_rejected', { errorClass: operation.errorClass });
          } catch {}
        }
      }
    })().finally(() => {
      active = undefined;
    });
    return active;
  };
  return {
    runOnce,
    async stop() {
      stopped = true;
      await input.usage?.stop();
      await active;
    },
  };
}
