import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerReconciliation } from '../dist/reconciliation.js';

function fixture() {
  const seen = [],
    errors = [];
  const core = {
    webhooks: {
      async eraseExpiredPayloads(limit) {
        assert.equal(limit, 100);
        seen.push('payload-erasure');
        return {
          unresolvedExpiredCount: 0,
          blockedPrivacyCount: 0,
          blockedUninstallCount: 0,
          blockedUnknownCount: 0,
          blockedUnsupportedCount: 0,
        };
      },
      async cleanupExpiredQueueJobs(limit, remove) {
        assert.equal(limit, 100);
        return [await remove('owned-inbox')];
      },
      async selectUninstallRecoveryIds(limit) {
        assert.equal(limit, 100);
        seen.push('uninstall-recovery');
        return ['pending-uninstall'];
      },
    },
  };
  const queue = {
    async removeExpiredWebhookJob() {
      seen.push('queue-removal');
      throw new Error('secret endpoint failed');
    },
    async ensureWebhookEnqueued() {
      seen.push('uninstall-enqueued');
      return {};
    },
    observability: {
      metrics: { queue() {} },
      logger: {
        error(event, metadata) {
          errors.push({ event, metadata });
        },
      },
    },
  };
  const artwork = {
    async cleanup(limit) {
      assert.equal(limit, 20);
      seen.push('artwork-cleanup');
      return 1;
    },
  };
  return { core, queue, artwork, seen, errors };
}

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
    input.errors.map((entry) => entry.metadata.errorClass),
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
  let began, unblock;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const blocked = new Promise((resolve) => {
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
