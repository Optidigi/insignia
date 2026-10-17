import { type OfflineCredentialLifecyclePort, refreshExpiringOfflineCredentials } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import type { ShopifyOfflineRefreshTransport } from '@insignia/shopify';
import type { PgBossRuntime, WorkerHandlers } from './runtime.js';

/** Maps the opaque durable facade to the application refresh port. */
export function credentialLifecycle(core: DurableCore): OfflineCredentialLifecyclePort {
  return {
    async install(input) {
      await core.credentials.install({ ...input, pair: input.pair });
    },
    acquire: (input) => core.credentials.acquire(input),
    replaceClaim: (input) => core.credentials.replaceClaim(input),
    async releaseClaim(input) {
      await core.credentials.releaseClaim(input);
    },
    async markReauthRequired(input) {
      return (await core.credentials.markReauthRequired(input)) ? 'marked' : 'stale';
    },
  };
}

/** Known order topics use the explicitly supplied independent reader; uninstall authority and credential refresh retain their existing contracts. */
export function createDurableWorkerHandlers(
  core: DurableCore,
  transport: ShopifyOfflineRefreshTransport,
  purchaseRunner?: { processInbox(inboxId: string): Promise<'deferred' | undefined> },
): WorkerHandlers {
  const credentials = credentialLifecycle(core);
  return {
    async processInbox(inboxId) {
      const state = await core.webhooks.getById(inboxId);
      if (!state) throw new Error('Shopify inbox identity is absent');
      if (state.resolution === 'expired') return 'expired';
      if (state.resolution === 'exhausted') return 'exhausted';
      if (state.state === 'processed') return;
      if (
        state.topic === 'customers/data_request' ||
        state.topic === 'customers/redact' ||
        state.topic === 'shop/redact'
      ) {
        // Topic is routing only. The durable function rederives the operation,
        // shop and order identities from the retained authenticated raw body.
        const result = await core.customerPrivacy.processInbox(inboxId);
        // Both paths have durable handoffs: erasure to isolated cleanup, data
        // requests to authenticated merchant export. Neither claims customer
        // delivery or physical object deletion from a successful queue attempt.
        return result.kind === 'SHOP_ERASURE_BLOCKED' ? 'deferred' : undefined;
      }
      if (['orders/create', 'orders/paid', 'orders/updated', 'refunds/create'].includes(state.topic))
        return purchaseRunner ? purchaseRunner.processInbox(inboxId) : 'deferred';
      if (state.topic !== 'app/uninstalled') return 'deferred';
      const result = await core.webhooks.processUninstall(inboxId);
      if (result === 'unresolved' || result === 'not_found') throw new Error('Uninstall delivery cannot yet resolve');
      if (result === 'unverified' || result === 'unqualified') return 'deferred';
      if (result === 'expired') return 'expired';
      if (result === 'exhausted') return 'exhausted';
    },
    async refreshCredential(shopId, installationGeneration) {
      const result = await refreshExpiringOfflineCredentials(credentials, transport, {
        shopId,
        installationGeneration: String(installationGeneration),
        minimumRemainingMs: 60_000,
        claimLeaseMs: 30_000,
      });
      if (result.kind === 'busy' || result.kind === 'retryable') return 'contention';
      if (result.kind === 'blocked') throw new Error(`Credential refresh blocked: ${result.failure}`);
      if (result.kind === 'reauth_required') return 'reauth_required';
      return 'success';
    },
  };
}

/** Bounded queue handoff recovery preserves receipts; it cannot supply uninstall authority. */
export async function recoverPendingUninstalls(core: DurableCore, queue: PgBossRuntime): Promise<number> {
  const ids = await core.webhooks.selectUninstallRecoveryIds(100);
  let confirmed = 0;
  for (const id of ids) {
    try {
      await queue.ensureWebhookEnqueued(id);
      confirmed++;
    } catch {
      queue.observability.metrics.queue('failure');
      queue.observability.logger.error('queue_job_rejected', { errorClass: 'UninstallRecoveryUnresolved' });
    }
  }
  return confirmed;
}

/** Source-owned bounded transient cleanup, not privacy request fulfillment. */
export async function maintainWebhookRetention(core: DurableCore, queue: PgBossRuntime) {
  await core.customerPrivacy.cleanupInboxes(100);
  const blockedShopErasures = await core.customerPrivacy.blockedShopErasureCount();
  if (blockedShopErasures) {
    queue.observability.metrics.queue('failure');
    queue.observability.logger.error('queue_job_rejected', {
      errorClass: 'ShopPrivacyAuthorityRequired',
      count: blockedShopErasures,
    });
  }
  const result = await core.webhooks.eraseExpiredPayloads(100);
  for (const [category, count] of [
    ['TransientPayloadExpiredUnresolved', result.unresolvedExpiredCount],
    ['PrivacyRetentionBlocked', result.blockedPrivacyCount],
    ['UninstallPayloadRetentionBlocked', result.blockedUninstallCount],
    ['UnknownPayloadRetentionBlocked', result.blockedUnknownCount],
    ['UnsupportedPayloadRetentionBlocked', result.blockedUnsupportedCount],
  ] as const) {
    if (count) {
      queue.observability.metrics.queue('failure');
      queue.observability.logger.error('queue_job_rejected', { errorClass: category, count });
    }
  }
  const cleanedIds = await core.webhooks.cleanupExpiredQueueJobs(100, (id) => queue.removeExpiredWebhookJob(id));
  return { ...result, cleanedIds };
}
