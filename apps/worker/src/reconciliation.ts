import type { createArtworkService } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import type { RuntimeErrorClass } from '@insignia/observability';
import {
  maintainCustomerPrivacy,
  maintainWebhookRetention,
  recoverPendingUninstalls,
  recoverUninstallPrivacy,
} from './handlers.js';
import { createHeldRowReporter } from './held-rows.js';
import type { PgBossRuntime } from './runtime.js';

/** Production maintenance composition; facade/queue implementations own durable effects. */
export function createWorkerReconciliation(input: {
  core: DurableCore;
  queue: PgBossRuntime;
  artwork?: Pick<ReturnType<typeof createArtworkService>, 'cleanup'>;
  usage?: { runOnce(): Promise<{ failed: number }>; stop(): Promise<void> };
  purchases?: { recover(): Promise<unknown>; discoverChanges(): Promise<unknown> };
  lifecycle?: { runOnce(): Promise<void> };
  signingKeys?: { destroyExpired?(maximumRows?: number): Promise<number> };
  /** #466 B, absent when INSIGNIA_PUBLICATION_ABANDONMENT=off. */
  publicationAbandonment?: { runOnce(): Promise<unknown> };
  clock?: () => Date;
}) {
  let stopped = false;
  const clock = input.clock ?? (() => new Date());
  const signingKeys = input.signingKeys ?? input.core.signingKeys;
  // Held rows repeat every pass: one line per class when it appears, changes or clears, else hourly.
  const held = createHeldRowReporter(() => clock().getTime());
  // Daily: retired or revoked signing keys whose window closed become destroyed. Idempotent; a
  // failed day is retried on the next pass, a completed day is skipped until the UTC day changes.
  let signingKeysDestroyedDay: number | undefined;
  const destroyExpiredSigningKeys = async () => {
    const day = Math.floor(clock().getTime() / 86_400_000);
    if (signingKeysDestroyedDay === day || !signingKeys.destroyExpired) return;
    let count = 0;
    for (let batch = 0; batch < 50; batch += 1) {
      const destroyed = await signingKeys.destroyExpired(100);
      count += destroyed;
      if (destroyed < 100) break;
    }
    signingKeysDestroyedDay = day;
    // Reporting cannot turn a completed pass into a failure.
    try {
      input.queue.observability.logger.info('signing_key_destruction', { count });
    } catch {}
  };
  const pass = (operations: { errorClass: RuntimeErrorClass; run: () => unknown }[]) => {
    let active: Promise<void> | undefined;
    return () => {
      if (stopped) return active ?? Promise.resolve();
      if (active) return active;
      active = (async () => {
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
  };
  const maintenance = pass([
    { errorClass: 'UNINSTALL_PRIVACY_RECOVERY_UNAVAILABLE', run: () => recoverUninstallPrivacy(input.core) },
    {
      errorClass: 'CUSTOMER_PRIVACY_CLEANUP_UNAVAILABLE',
      run: () => maintainCustomerPrivacy(input.core, input.queue, held),
    },
    {
      errorClass: 'WEBHOOK_RETENTION_UNAVAILABLE',
      run: () => maintainWebhookRetention(input.core, input.queue, held),
    },
    {
      errorClass: 'UNINSTALL_RECOVERY_UNAVAILABLE',
      run: () => recoverPendingUninstalls(input.core, input.queue, held),
    },
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
    {
      errorClass: 'SHOP_PRIVACY_FINALIZATION_UNAVAILABLE',
      run: async () => {
        const summary = await input.core.customerPrivacy.finalizePendingShops();
        if (summary.failed) throw new Error('Shop privacy finalization failed');
        held.report(
          input.queue.observability.logger,
          'SHOP_PRIVACY_DEPENDENCY_PENDING',
          summary.dependency_pending ?? 0,
        );
      },
    },
    { errorClass: 'UNINSTALL_ENROLLMENT_UNAVAILABLE', run: () => input.lifecycle?.runOnce() },
    { errorClass: 'SIGNING_KEY_DESTRUCTION_UNAVAILABLE', run: destroyExpiredSigningKeys },
    // Bounded (2 restores, 20 s), so it cannot starve the recovery passes above.
    {
      errorClass: 'PUBLICATION_ABANDONMENT_UNAVAILABLE',
      run: () => input.publicationAbandonment?.runOnce(),
    },
  ]);
  // Slow Shopify reads share a purchase pass, but each tick can still run private-data maintenance.
  const purchases = pass([
    { errorClass: 'PURCHASE_RECOVERY_UNAVAILABLE', run: () => input.purchases?.recover() },
    { errorClass: 'PURCHASE_DISCOVERY_UNAVAILABLE', run: () => input.purchases?.discoverChanges() },
  ]);
  const runOnce = () => {
    if (stopped) return Promise.resolve();
    const currentMaintenance = maintenance();
    if (!input.purchases) return currentMaintenance;
    return Promise.all([currentMaintenance, purchases()]).then(() => {});
  };
  return {
    runOnce,
    async stop() {
      stopped = true;
      try {
        await input.usage?.stop();
      } finally {
        await Promise.all([maintenance(), purchases()]);
      }
    },
  };
}
