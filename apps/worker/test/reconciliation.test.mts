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
    signingKeys: {
      async destroyExpired() {
        return 0;
      },
    },
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
      async finalizePendingShops() {
        seen.push('shop-privacy-finalization');
        return {};
      },
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
        warn() {},
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
  assert.ok(input.seen.includes('shop-privacy-finalization'));
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
    'shop-privacy-finalization',
    'payload-erasure',
    'queue-removal',
    'uninstall-recovery',
    'uninstall-enqueued',
    'artwork-cleanup',
    'shop-privacy-finalization',
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
    'shop-privacy-finalization',
    'payload-erasure',
    'uninstall-recovery',
    'artwork-cleanup',
    'shop-privacy-finalization',
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

test('slow purchase discovery allows another cleanup tick and shutdown drains the purchase pass', async () => {
  const input = fixture();
  let releaseDiscovery = () => {};
  let markStarted = () => {};
  const discovery = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let discoveries = 0;
  let cleanups = 0;
  input.purchases = {
    async recover() {},
    async discoverChanges() {
      discoveries++;
      markStarted();
      await discovery;
    },
  };
  input.core.purchases.cleanupDue = async () => ++cleanups;
  const worker = createWorkerReconciliation(input);
  const first = worker.runOnce();
  await started;
  let stopped = false;
  let shutdown: Promise<void> | undefined;
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cleanups, 1);
    void worker.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cleanups, 2);
    assert.equal(discoveries, 1);
    shutdown = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false);
    await worker.runOnce();
    assert.equal(cleanups, 2);
  } finally {
    releaseDiscovery();
    await first;
    await (shutdown ?? worker.stop());
  }
  assert.equal(stopped, true);
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

test('signing key destruction runs once per UTC day, logs only a count, and retries a failed day', async () => {
  const input = fixture();
  const infos: { event: RuntimeEvent; metadata?: RuntimeLogDetails }[] = [];
  input.queue.observability = {
    ...input.queue.observability,
    logger: {
      info(event, metadata) {
        infos.push({ event, metadata });
      },
      warn() {},
      error(event, metadata) {
        input.errors.push({ event, metadata });
      },
    },
  };
  let now = Date.parse('2026-11-12T00:05:00.000Z');
  const calls: number[] = [];
  let fail = true;
  const batches = [100, 3, 0];
  const reconciliation = createWorkerReconciliation({
    ...input,
    clock: () => new Date(now),
    signingKeys: {
      async destroyExpired(limit) {
        calls.push(limit ?? -1);
        if (fail) throw new Error('database unavailable');
        return batches.shift() ?? 0;
      },
    },
  });
  await reconciliation.runOnce();
  assert.deepEqual(
    input.errors.filter((entry) => entry.metadata?.errorClass === 'SIGNING_KEY_DESTRUCTION_UNAVAILABLE').length,
    1,
  );
  fail = false;
  await reconciliation.runOnce();
  assert.deepEqual(calls, [100, 100, 100]);
  assert.deepEqual(
    infos.filter((entry) => entry.event === 'signing_key_destruction'),
    [{ event: 'signing_key_destruction', metadata: { count: 103 } }],
  );
  await reconciliation.runOnce();
  assert.equal(calls.length, 3, 'same UTC day is skipped');
  now += 86_400_000;
  await reconciliation.runOnce();
  assert.equal(calls.length, 4, 'next UTC day runs again (idempotent: zero destroyed)');
  assert.deepEqual(infos.at(-1), { event: 'signing_key_destruction', metadata: { count: 0 } });
});

test('signing key destruction is a known runtime event for the real logger', () => {
  const lines: string[] = [];
  const observability = createObservability({
    stream: new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    }),
  });
  observability.logger.info('signing_key_destruction', { count: 2 });
  assert.equal(lines.length, 1);
  assert.deepEqual((({ event, count }) => ({ event, count }))(JSON.parse(lines[0] ?? '{}')), {
    event: 'signing_key_destruction',
    count: 2,
  });
});

test('every class reconciliation reports reaches the operator through the real logger', async () => {
  // The worker's own calls are the source of truth: tee each one through the real logger.
  const lines: Record<string, unknown>[] = [];
  const real = createObservability({
    stream: new Writable({
      write(chunk, _encoding, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  });
  const input = fixture();
  const emitted: unknown[] = [];
  input.queue.observability = {
    ...real,
    logger: {
      ...real.logger,
      error(event, metadata) {
        emitted.push(metadata?.errorClass);
        real.logger.error(event, metadata);
      },
    },
  };
  const fail = async (): Promise<never> => {
    throw new Error('synthetic failure');
  };
  // Pass 1: every maintenance operation fails.
  input.core.uninstallPrivacy.recoverPending = fail;
  input.core.customerPrivacy.cleanupInboxes = fail;
  input.core.webhooks.eraseExpiredPayloads = fail;
  input.core.webhooks.selectUninstallRecoveryIds = fail;
  input.core.purchases.cleanupDue = fail;
  input.core.buyers.cleanupDue = fail;
  input.artwork.cleanup = fail;
  input.purchases = { recover: fail, discoverChanges: fail };
  input.usage = { runOnce: async () => ({ failed: 1 }), stop: async () => {} };
  input.lifecycle = { runOnce: fail };
  let keysFail = true;
  input.signingKeys = { destroyExpired: async () => (keysFail ? fail() : 0) };
  const maintenance = createWorkerReconciliation(input);
  await maintenance.runOnce();
  // Pass 2: operations complete but report blocked work they cannot resolve.
  const clean = fixture();
  Object.assign(input.core, clean.core);
  input.artwork.cleanup = clean.artwork.cleanup;
  input.purchases = { recover: async () => undefined, discoverChanges: async () => undefined };
  input.usage = { runOnce: async () => ({ failed: 0 }), stop: async () => {} };
  input.lifecycle = { runOnce: async () => {} };
  keysFail = false;
  input.core.uninstallPrivacy.status = async () => ({
    blockedReceiptCount: 0,
    legacyScopeReceiptCount: 0,
    recoveryDecisionCount: 0,
    activeGenerationHoldCount: 1,
    unrecoveredBlockedReceiptCount: 0,
  });
  const erase = clean.core.webhooks.eraseExpiredPayloads;
  input.core.webhooks.eraseExpiredPayloads = async (limit) => ({
    ...(await erase(limit)),
    unresolvedExpiredCount: 1,
    blockedPrivacyCount: 1,
    blockedUninstallCount: 1,
    blockedUnknownCount: 1,
    blockedUnsupportedCount: 1,
  });
  input.queue.removeExpiredWebhookJob = async () => true;
  input.queue.ensureWebhookEnqueued = fail;
  await maintenance.runOnce();
  await maintenance.stop();

  assert.equal(emitted.length, 19);
  assert.ok(emitted.every((errorClass) => typeof errorClass === 'string'));
  assert.deepEqual(
    lines.filter((line) => line.level === 50).map((line) => [line.event, line.errorClass]),
    emitted.map((errorClass) => ['queue_job_rejected', errorClass]),
  );
});

// Held rows stay held for hours or days: one error line per class per minute (about 4,300 a day in
// production) says nothing new. A class logs when it appears, when its count changes, at most hourly
// while it is unchanged, and once at info when it clears; the failure counter still counts every pass.
test('held-row errors log on change and at most hourly while unchanged; the failure metric counts every pass', async () => {
  const input = fixture();
  let now = Date.parse('2026-11-24T00:00:00Z');
  input.clock = () => new Date(now);
  input.queue.removeExpiredWebhookJob = async () => true;
  const lines: [string, string, unknown, unknown][] = [];
  let failures = 0;
  input.queue.observability = {
    ...input.queue.observability,
    metrics: {
      ...input.queue.observability.metrics,
      queue(outcome) {
        if (outcome === 'failure') failures++;
      },
    },
    logger: {
      info(event, metadata) {
        if (event.startsWith('queue_job')) lines.push(['info', event, metadata?.errorClass, metadata?.count]);
      },
      warn() {},
      error(event, metadata) {
        if (event.startsWith('queue_job')) lines.push(['error', event, metadata?.errorClass, metadata?.count]);
      },
    },
  };
  let held = 0;
  const erase = input.core.webhooks.eraseExpiredPayloads;
  input.core.webhooks.eraseExpiredPayloads = async (limit) => ({ ...(await erase(limit)), blockedPrivacyCount: held });
  let pending = 0;
  input.core.customerPrivacy.finalizePendingShops = async () => ({ dependency_pending: pending });
  let holds = 0;
  const status = input.core.uninstallPrivacy.status;
  input.core.uninstallPrivacy.status = async () => ({ ...(await status()), activeGenerationHoldCount: holds });
  let enqueue = true;
  input.queue.ensureWebhookEnqueued = async (inboxId) => {
    if (enqueue) throw new Error('queue unavailable');
    return { inboxId, status: 'enqueued' };
  };
  const maintenance = createWorkerReconciliation(input);
  const pass = async (minutes = 1) => {
    now += minutes * 60_000;
    lines.length = 0;
    await maintenance.runOnce();
    return [...lines];
  };

  held = 2;
  pending = 1;
  holds = 3;
  const first = await pass();
  assert.deepEqual(first, [
    ['error', 'queue_job_rejected', 'ShopPrivacyAuthorityRequired', 3],
    ['error', 'queue_job_rejected', 'PrivacyRetentionBlocked', 2],
    ['error', 'queue_job_rejected', 'UninstallRecoveryUnresolved', 1],
    ['error', 'queue_job_rejected', 'SHOP_PRIVACY_DEPENDENCY_PENDING', 1],
  ]);
  assert.equal(failures, 3, 'the metric counts as before (dependency_pending never counted)');
  // Unchanged counts: silent for the rest of the hour, while the metric keeps counting.
  for (let minute = 1; minute < 60; minute++) assert.deepEqual(await pass(), [], `minute ${minute}`);
  assert.equal(failures, 3 * 60);
  assert.deepEqual(await pass(), first, 'repeated after an hour');
  // A changed count logs at once; the others stay quiet.
  held = 5;
  assert.deepEqual(await pass(), [['error', 'queue_job_rejected', 'PrivacyRetentionBlocked', 5]]);
  // Cleared classes log once at info, then nothing; a class that returns logs immediately.
  held = 0;
  pending = 0;
  holds = 0;
  enqueue = false;
  assert.deepEqual(await pass(), [
    ['info', 'queue_job_rejection_cleared', 'ShopPrivacyAuthorityRequired', undefined],
    ['info', 'queue_job_rejection_cleared', 'PrivacyRetentionBlocked', undefined],
    ['info', 'queue_job_rejection_cleared', 'UninstallRecoveryUnresolved', undefined],
    ['info', 'queue_job_rejection_cleared', 'SHOP_PRIVACY_DEPENDENCY_PENDING', undefined],
  ]);
  assert.deepEqual(await pass(), []);
  held = 5;
  assert.deepEqual(await pass(), [['error', 'queue_job_rejected', 'PrivacyRetentionBlocked', 5]]);
  await maintenance.stop();
});

test('a cleared held-row class is a known runtime event for the real logger', () => {
  const lines: Record<string, unknown>[] = [];
  const real = createObservability({
    stream: new Writable({
      write(chunk, _encoding, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  });
  real.logger.info('queue_job_rejection_cleared', { errorClass: 'PrivacyRetentionBlocked' });
  assert.deepEqual(
    lines.map((line) => [line.level, line.event, line.errorClass]),
    [[30, 'queue_job_rejection_cleared', 'PrivacyRetentionBlocked']],
  );
});
