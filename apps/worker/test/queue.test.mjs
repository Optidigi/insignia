import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPgBossRuntime, REFRESH_QUEUE, WEBHOOK_QUEUE } from '../dist/runtime.js';

function fakeBoss() {
  const jobs = new Map();
  const workers = new Map();
  const calls = [];
  return {
    jobs,
    workers,
    calls,
    async start() {
      calls.push('start');
      return this;
    },
    async stop(options) {
      calls.push(['stop', options]);
    },
    async createQueue(name, options) {
      calls.push(['createQueue', name, options]);
    },
    async send(name, data, options) {
      calls.push(['send', name, data, options]);
      const id = options?.id ?? randomUUID();
      if (jobs.has(id)) return null;
      jobs.set(id, { id, name, data, state: 'created' });
      return id;
    },
    async findJobs(name, options) {
      calls.push(['findJobs', name, options]);
      const job = jobs.get(options.id);
      return job?.name === name ? [job] : [];
    },
    async retry(name, id) {
      calls.push(['retry', name, id]);
      const job = jobs.get(id);
      if (job?.name === name && job.state === 'failed') job.state = 'retry';
      return { affected: job?.state === 'retry' ? 1 : 0 };
    },
    async work(name, options, handler) {
      calls.push(['work', name, options]);
      workers.set(name, handler);
      return randomUUID();
    },
    async offWork(name, options) {
      calls.push(['offWork', name, options]);
    },
    async schemaVersion() {
      return 43;
    },
  };
}

test('enqueue confirms exact inbox identity, including completed job replay', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ boss });
  const inboxId = randomUUID();
  await queue.start();
  assert.deepEqual(await queue.ensureWebhookEnqueued(inboxId), { inboxId, status: 'enqueued' });
  boss.jobs.get(inboxId).state = 'completed';
  assert.deepEqual(await queue.ensureWebhookEnqueued(inboxId), { inboxId, status: 'already_enqueued' });
  assert.ok(
    boss.calls.some(
      ([method, name, options]) => method === 'findJobs' && name === WEBHOOK_QUEUE && options.id === inboxId,
    ),
  );
  assert.deepEqual(boss.jobs.get(inboxId).data, { inboxId });
  assert.equal(await queue.schemaVersion(), 43);
  await queue.stop();
});

test('null send without same persisted job is retryable, never an acknowledgement', async () => {
  const boss = fakeBoss();
  boss.send = async () => null;
  const queue = createPgBossRuntime({ boss });
  await queue.start();
  await assert.rejects(queue.ensureWebhookEnqueued(randomUUID()), /not confirmed/);
  boss.jobs.set('01234567-89ab-4cde-8123-456789abcdef', {
    id: '01234567-89ab-4cde-8123-456789abcdef',
    name: WEBHOOK_QUEUE,
    data: { inboxId: 'different-id' },
    state: 'created',
  });
  await assert.rejects(queue.ensureWebhookEnqueued('01234567-89ab-4cde-8123-456789abcdef'), /identity mismatch/);
  boss.jobs.get('01234567-89ab-4cde-8123-456789abcdef').data = {
    inboxId: '01234567-89ab-4cde-8123-456789abcdef',
  };
  boss.jobs.get('01234567-89ab-4cde-8123-456789abcdef').state = 'failed';
  assert.deepEqual(await queue.ensureWebhookEnqueued('01234567-89ab-4cde-8123-456789abcdef'), {
    inboxId: '01234567-89ab-4cde-8123-456789abcdef',
    status: 'enqueued',
  });
  assert.equal(boss.jobs.get('01234567-89ab-4cde-8123-456789abcdef').state, 'retry');
});

test('workers pass IDs only to injected durable handlers; failed attempt retries safely', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ boss, credentialKeysReady: true });
  const inboxId = randomUUID();
  const shopId = randomUUID();
  const calls = [];
  await queue.start();
  const refreshId = await queue.enqueueRefresh(shopId, 7);
  assert.equal(boss.jobs.get(refreshId).name, REFRESH_QUEUE);
  assert.deepEqual(boss.jobs.get(refreshId).data, { shopId, installationGeneration: 7 });
  await queue.work({
    async processInbox(id) {
      calls.push(['inbox', id]);
      if (calls.length === 1) throw new Error('synthetic crash before acknowledgement');
    },
    async refreshCredential(id, generation) {
      calls.push(['refresh', id, generation]);
    },
  });
  const webhookHandler = boss.workers.get(WEBHOOK_QUEUE);
  const job = {
    id: inboxId,
    name: WEBHOOK_QUEUE,
    data: { inboxId },
    retryCount: 0,
    retryLimit: 5,
    signal: new AbortController().signal,
  };
  await assert.rejects(webhookHandler([job]), /synthetic crash/);
  await webhookHandler([{ ...job, retryCount: 1 }]);
  assert.deepEqual(calls.slice(0, 2), [
    ['inbox', inboxId],
    ['inbox', inboxId],
  ]);
  const refreshHandler = boss.workers.get(REFRESH_QUEUE);
  await refreshHandler([
    {
      id: refreshId,
      name: REFRESH_QUEUE,
      data: { shopId, installationGeneration: 7 },
      retryCount: 0,
      retryLimit: 5,
      signal: new AbortController().signal,
    },
  ]);
  assert.deepEqual(calls[2], ['refresh', shopId, 7]);
  const metrics = await queue.observability.registry.metrics();
  assert.match(metrics, /insignia_inbox_processing_total\{outcome="failure"\} 1/);
  assert.match(metrics, /insignia_inbox_processing_total\{outcome="success"\} 1/);
  assert.match(metrics, /insignia_credential_refresh_total\{outcome="success"\} 1/);
  await queue.stop();
  assert.ok(boss.calls.some(([method]) => method === 'offWork'));
});

test('invalid job body and identity fail closed without invoking application', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ boss, credentialKeysReady: true });
  let invoked = false;
  await queue.start();
  await queue.work({
    async processInbox() {
      invoked = true;
    },
    async refreshCredential() {
      invoked = true;
    },
  });
  const handler = boss.workers.get(WEBHOOK_QUEUE);
  const id = randomUUID();
  await assert.rejects(
    handler([
      {
        id,
        data: { inboxId: randomUUID(), token: 'secret' },
        retryCount: 0,
        retryLimit: 5,
        signal: new AbortController().signal,
      },
    ]),
    /job identity/,
  );
  assert.equal(invoked, false);
});

test('enabled worker refuses missing credential-key configuration and stays not ready', async () => {
  const queue = createPgBossRuntime({ boss: fakeBoss() });
  await queue.start();
  assert.equal(queue.durableReady, false);
  await assert.rejects(
    queue.work({ async processInbox() {}, async refreshCredential() {} }),
    /Credential wrapping keys not configured/,
  );
  await queue.stop();
});

test('refresh claim contention is retried rather than silently completing its job', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ boss, credentialKeysReady: true });
  await queue.start();
  await queue.work({
    async processInbox() {},
    async refreshCredential() {
      return 'contention';
    },
  });
  const jobId = randomUUID();
  const shopId = randomUUID();
  const handler = boss.workers.get(REFRESH_QUEUE);
  await assert.rejects(
    handler([
      {
        id: jobId,
        data: { shopId, installationGeneration: 2 },
        retryCount: 0,
        retryLimit: 5,
        signal: new AbortController().signal,
      },
    ]),
    /Refresh claim contention/,
  );
  const metrics = await queue.observability.registry.metrics();
  assert.match(metrics, /insignia_refresh_claim_contention_total 1/);
  assert.match(metrics, /insignia_queue_attempt_total\{outcome="retry"\} 1/);
  await queue.stop();
});
