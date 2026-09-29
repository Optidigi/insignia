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

/** M3-002 handles uninstall and credential refresh; future business topics remain queued/visible. */
export function createDurableWorkerHandlers(
  core: DurableCore,
  transport: ShopifyOfflineRefreshTransport,
): WorkerHandlers {
  const credentials = credentialLifecycle(core);
  return {
    async processInbox(inboxId) {
      const state = await core.webhooks.getById(inboxId);
      if (!state) throw new Error('Shopify inbox identity is absent');
      if (state.state === 'processed') return;
      if (state.topic !== 'app/uninstalled') return 'deferred';
      const result = await core.webhooks.processUninstall(inboxId);
      if (result === 'unresolved' || result === 'not_found') throw new Error('Uninstall delivery cannot yet resolve');
      if (result === 'unverified') return 'deferred';
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

/** Periodic bounded recovery bridges installation after an unresolved signed uninstall. */
export async function recoverPendingUninstalls(core: DurableCore, queue: PgBossRuntime): Promise<number> {
  const ids = await core.webhooks.pendingUninstallIds(100);
  let confirmed = 0;
  for (const id of ids) {
    try {
      await queue.ensureWebhookEnqueued(id);
      confirmed++;
    } catch {
      queue.observability.metrics.queue('failure');
      queue.observability.logger.error('queue_job_rejected', { inboxId: id });
    }
  }
  return confirmed;
}
