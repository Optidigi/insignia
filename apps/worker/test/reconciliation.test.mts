import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import type { RuntimeEvent, RuntimeLogDetails } from '@insignia/observability';
import { createObservability } from '@insignia/observability';
import { createWorkerReconciliation } from '../dist/reconciliation.js';
import type { PgBossRuntime } from '../dist/runtime.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';
import { queueFixture } from './support/queue-fixture.mts';

test('buyer payload expiry runs independently when artwork erasure fails', async () => {
  const input = fixture();
  let erased = 0;
  input.core.buyers.cleanupDue = async (limit) => {
    assert.equal(limit, 100);
    erased++;
    return 0;
  };
  input.artwork.cleanup = async () => {
    throw new Error('storage unavailable');
  };
  await createWorkerReconciliation(input).runOnce();
  assert.equal(erased, 1);
});

type Input = Parameters<typeof createWorkerReconciliation>[0];
function fixture(): Omit<Input, 'queue'> & {
  queue: { -readonly [K in keyof PgBossRuntime]: PgBossRuntime[K] };
  artwork: NonNullable<Input['artwork']>;
  seen: string[];
  errors: { event: RuntimeEvent; metadata?: RuntimeLogDetails }[];
} {
  const seen: string[] = [],
    errors: { event: RuntimeEvent; metadata?: RuntimeLogDetails }[] = [];
  const core = durableCoreFixture({
    buyers: {
      async cleanupDue() {
        return 0;
      },
    },
    purchases: {
      async cleanupDue() {
        return 0;
      },
    },
    uninstallLifecycle: {
      async coverGenericCleanup() {
        return 0;
      },
    },
    uninstallPrivacy: {
      async recoverPending() {
        return 0;
      },
      async status() {
        return {
          blockedReceiptCount: 0,
          legacyScopeReceiptCount: 0,
          recoveryDecisionCount: 0,
          activeGenerationHoldCount: 0,
          unrecoveredBlockedReceiptCount: 0,
        };
      },
    },
    customerPrivacy: {
      async cleanupInboxes() {
        return 0;
      },
      async blockedShopErasureCount() {
        return 0;
      },
    },
    webhooks: {
      async eraseExpiredPayloads(limit) {
        assert.equal(limit, 100);
        seen.push('payload-erasure');
        return {
          erasedIds: [],
          unresolvedExpiredIds: [],
          blockedPrivacyIds: [],
          blockedUninstallIds: [],
          blockedUnknownIds: [],
          blockedUnsupportedIds: [],
          unresolvedExpiredCount: 0,
          blockedPrivacyCount: 0,
          blockedUninstallCount: 0,
          blockedUnknownCount: 0,
          blockedUnsupportedCount: 0,
        };
      },
      async cleanupExpiredQueueJobs(limit, remove) {
        assert.equal(limit, 100);
        await remove('owned-inbox');
        return ['owned-inbox'];
      },
      async selectUninstallRecoveryIds(limit) {
        assert.equal(limit, 100);
        seen.push('uninstall-recovery');
        return ['pending-uninstall'];
      },
    },
  });
  const queue = queueFixture({
    async removeExpiredWebhookJob(): Promise<boolean> {
      seen.push('queue-removal');
      throw new Error('secret endpoint failed');
    },
    async ensureWebhookEnqueued(inboxId) {
      seen.push('uninstall-enqueued');
      return { inboxId, status: 'enqueued' };
    },
    observability: {
      ...createObservability(),
      metrics: { ...createObservability().metrics, queue() {}, usageQualification() {} },
      logger: {
        info() {},
        error(event, metadata) {
          errors.push({ event, metadata });
        },
      },
    },
  });
  const artwork = {
    async cleanup(limit: number) {
      assert.equal(limit, 20);
      seen.push('artwork-cleanup');
      return 1;
    },
  };
  return { core, queue, artwork, seen, errors };
}

test('privacy cleanup failure cannot suppress ordinary transport retention or independent artwork work', async () => {
  const input = fixture();
  input.core.customerPrivacy.cleanupInboxes = async () => {
    throw new Error('privacy capability unavailable');
  };
  input.queue.removeExpiredWebhookJob = async () => true;
  await createWorkerReconciliation(input).runOnce();
  assert.ok(input.seen.includes('payload-erasure'));
  assert.ok(input.seen.includes('artwork-cleanup'));
  assert.ok(input.errors.some((entry) => entry.metadata?.errorClass === 'CUSTOMER_PRIVACY_CLEANUP_UNAVAILABLE'));
});

test('persistent expired-job removal failure never blocks independent uninstall recovery or artwork erasure', async () => {
  const input = fixture(),
    maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  await maintenance.runOnce();
  assert.deepEqual(input.seen, [
    'payload-erasure',
    'queue-removal',
    'uninstall-recovery',
    'uninstall-enqueued',
    'artwork-cleanup',
    'payload-erasure',
    'queue-removal',
    'uninstall-recovery',
    'uninstall-enqueued',
    'artwork-cleanup',
  ]);
  assert.deepEqual(input.errors, [
    { event: 'queue_job_rejected', metadata: { errorClass: 'WEBHOOK_RETENTION_UNAVAILABLE' } },
    { event: 'queue_job_rejected', metadata: { errorClass: 'WEBHOOK_RETENTION_UNAVAILABLE' } },
  ]);
  await maintenance.stop();
});

test('uninstall and artwork failures are reported independently and a later pass remains possible', async () => {
  const input = fixture();
  input.queue.removeExpiredWebhookJob = async () => true;
  input.core.webhooks.selectUninstallRecoveryIds = async () => {
    input.seen.push('uninstall-recovery');
    throw new Error('database failure');
  };
  input.artwork.cleanup = async () => {
    input.seen.push('artwork-cleanup');
    throw new Error('private storage path');
  };
  const maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  await maintenance.runOnce();
  assert.deepEqual(input.seen, [
    'payload-erasure',
    'uninstall-recovery',
    'artwork-cleanup',
    'payload-erasure',
    'uninstall-recovery',
    'artwork-cleanup',
  ]);
  assert.deepEqual(
    input.errors.map((entry) => entry.metadata?.errorClass),
    [
      'UNINSTALL_RECOVERY_UNAVAILABLE',
      'ARTWORK_CLEANUP_UNAVAILABLE',
      'UNINSTALL_RECOVERY_UNAVAILABLE',
      'ARTWORK_CLEANUP_UNAVAILABLE',
    ],
  );
  await maintenance.stop();
});

test('a failed logger cannot suppress unrelated retention work', async () => {
  const input = fixture();
  input.queue.observability.logger.error = () => {
    throw new Error('logger unavailable');
  };
  const maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  assert.ok(input.seen.includes('artwork-cleanup'));
  await maintenance.stop();
});

test('concurrent ticks coalesce and shutdown drains the active operation before further maintenance dispatch', async () => {
  const input = fixture();
  let began: () => void = () => {
    throw new Error('Fixture not started');
  };
  let unblock: () => void = () => {
    throw new Error('Fixture not started');
  };
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const erase = input.core.webhooks.eraseExpiredPayloads;
  input.core.webhooks.eraseExpiredPayloads = async (limit) => {
    began();
    await blocked;
    return erase(limit);
  };
  const maintenance = createWorkerReconciliation(input);
  const first = maintenance.runOnce(),
    second = maintenance.runOnce();
  assert.equal(first, second);
  await started;
  let stopped = false;
  const shutdown = maintenance.stop().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  await maintenance.runOnce();
  unblock();
  await Promise.all([first, second, shutdown]);
  assert.equal(stopped, true);
  assert.deepEqual(input.seen, ['payload-erasure', 'queue-removal']);
  await maintenance.runOnce();
  assert.deepEqual(input.seen, ['payload-erasure', 'queue-removal']);
});

test('purchase discovery and storage failures never suppress purchase private cleanup', async () => {
  const input = fixture();
  let cleaned = 0;
  input.purchases = {
    async recover() {
      throw new Error('provider');
    },
    async discoverChanges() {
      throw new Error('provider');
    },
  };
  input.core.purchases.cleanupDue = async (limit) => {
    assert.equal(limit, 100);
    cleaned++;
    return 0;
  };
  input.artwork.cleanup = async () => {
    throw new Error('private storage');
  };
  await createWorkerReconciliation(input).runOnce();
  assert.equal(cleaned, 1);
  assert.ok(input.errors.some((x) => x.metadata?.errorClass === 'PURCHASE_DISCOVERY_UNAVAILABLE'));
});

test('usage failure cannot suppress private cleanup and shutdown drains usage', async () => {
  const input = fixture();
  let cleaned = 0,
    stopped = 0;
  input.usage = {
    async runOnce() {
      throw new Error('private usage source');
    },
    async stop() {
      stopped++;
    },
  };
  input.core.purchases.cleanupDue = async () => {
    cleaned++;
    return 0;
  };
  const maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  assert.equal(cleaned, 1);
  assert.ok(input.errors.some((entry) => entry.metadata?.errorClass === 'USAGE_QUALIFICATION_UNAVAILABLE'));
  await maintenance.stop();
  assert.equal(stopped, 1);
});

test('shutdown awaits an active usage pass and prevents subsequent maintenance work', async () => {
  const input = fixture();
  let begin: () => void = () => {
    throw new Error('Fixture not started');
  };
  let release: () => void = () => {
    throw new Error('Fixture not started');
  };
  let active: Promise<{ failed: number }> | undefined;
  let drained = false;
  const began = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  input.usage = {
    runOnce() {
      active = (async () => {
        begin();
        await blocked;
        return { failed: 0 };
      })();
      return active;
    },
    async stop() {
      await active;
      drained = true;
    },
  };
  const maintenance = createWorkerReconciliation(input);
  const pass = maintenance.runOnce();
  await began;
  const stopping = maintenance.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  release();
  await Promise.all([pass, stopping]);
  assert.equal(drained, true);
  assert.equal(input.seen.includes('artwork-cleanup'), false);
});

test('returned usage failure summary is reported without blocking private cleanup', async () => {
  const input = fixture();
  let cleaned = 0;
  input.usage = {
    async runOnce() {
      return { failed: 1 };
    },
    async stop() {},
  };
  input.core.purchases.cleanupDue = async () => {
    cleaned++;
    return 0;
  };
  const maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  assert.equal(cleaned, 1);
  assert.equal(
    input.errors.filter((entry) => entry.metadata?.errorClass === 'USAGE_QUALIFICATION_UNAVAILABLE').length,
    1,
  );
  await maintenance.stop();
});

test('usage maintenance exposes completed passes and failures without purchase data or suppressing cleanup', async () => {
  const input = fixture();
  input.queue.observability = createObservability({
    stream: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
  let pass = 0,
    cleaned = 0;
  input.usage = {
    async runOnce() {
      pass++;
      if (pass === 3) throw new Error('private source');
      return { processed: 0, staged: 0, held: 0, failed: pass === 2 ? 1 : 0 };
    },
    async stop() {},
  };
  input.core.purchases.cleanupDue = async () => {
    cleaned++;
    return 0;
  };
  const maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  await maintenance.runOnce();
  await maintenance.runOnce();
  assert.equal(cleaned, 3);
  const metrics = await input.queue.observability.registry.metrics();
  assert.match(metrics, /insignia_usage_qualification_pass_total\{outcome="success"\} 1/);
  assert.match(metrics, /insignia_usage_qualification_pass_total\{outcome="failure"\} 2/);
  assert.doesNotMatch(metrics, /private source|purchaseId|shop_id/);
  await maintenance.stop();
});
