import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Request as BossRequest, SendOptions } from 'pg-boss';
import { QUEUE_POLICY } from '../dist/queue-contract.js';
import {
  createPgBossRuntime,
  type QueueAdapter,
  type QueueAttempt,
  type QueueJob,
  REFRESH_QUEUE,
  WEBHOOK_QUEUE,
} from '../dist/runtime.js';
import { queueBoundaryHandoff } from './queue-handoff-fixture.mts';

type Call = string | [string, ...unknown[]];
type FakeBoss = Omit<QueueAdapter, 'getQueue'> & {
  getQueue(name: string): Promise<Record<string, unknown> | null>;
  jobs: Map<string, QueueJob>;
  workers: Map<string, (jobs: QueueAttempt[]) => Promise<void>>;
  calls: Call[];
  retry(name: string, id: string): Promise<{ affected: number }>;
};
function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
function fakeBoss(): FakeBoss {
  const jobs = new Map<string, QueueJob>();
  const workers = new Map<string, (jobs: QueueAttempt[]) => Promise<void>>();
  const calls: Call[] = [];
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
    async getQueue(name) {
      calls.push(['getQueue', name]);
      return {
        name,
        ...QUEUE_POLICY,
        table: 'job_common',
        notify: false,
        deadLetter: null,
        heartbeatSeconds: null,
        retryDelayMax: null,
      };
    },
    async send(input: BossRequest | string, data?: object | null, options?: SendOptions) {
      const name = typeof input === 'string' ? input : input.name;
      if (typeof input !== 'string') {
        data = input.data;
        options = input.options;
      }
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
    async deleteJob(name, id) {
      assert(typeof id === 'string');
      const job = jobs.get(id);
      if (job?.name === name) jobs.delete(id);
      return {};
    },
    async retry(name: string, id: string) {
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
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss });
  const inboxId = randomUUID();
  await queue.start();
  assert.deepEqual(await queue.ensureWebhookEnqueued(inboxId), { inboxId, status: 'enqueued' });
  required(boss.jobs.get(inboxId)).state = 'completed';
  assert.deepEqual(await queue.ensureWebhookEnqueued(inboxId), { inboxId, status: 'already_enqueued' });
  assert.ok(
    boss.calls.some(
      (call) =>
        Array.isArray(call) &&
        call[0] === 'findJobs' &&
        call[1] === WEBHOOK_QUEUE &&
        typeof call[2] === 'object' &&
        call[2] !== null &&
        'id' in call[2] &&
        call[2].id === inboxId,
    ),
  );
  assert.deepEqual(required(boss.jobs.get(inboxId)).data, { inboxId });
  assert.equal(await queue.schemaVersion(), 43);
  await queue.stop();
});

test('omitted durable handoff port fails closed before any job inspection or send', async () => {
  const boss = fakeBoss();
  // @ts-expect-error Deliberately omit the required durable port to qualify fail-closed runtime admission.
  const queue = createPgBossRuntime({ boss });
  await queue.start();
  await assert.rejects(queue.ensureWebhookEnqueued(randomUUID()), /Durable webhook queue handoff is unavailable/);
  assert.equal(
    boss.calls.some((call) => call[0] === 'send' || call[0] === 'findJobs'),
    false,
  );
  await queue.stop();
});

test('null send without same persisted job is retryable, never an acknowledgement', async () => {
  const boss = fakeBoss();
  boss.send = async () => null;
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss });
  await queue.start();
  await assert.rejects(queue.ensureWebhookEnqueued(randomUUID()), /missing/);
  boss.jobs.set('01234567-89ab-4cde-8123-456789abcdef', {
    id: '01234567-89ab-4cde-8123-456789abcdef',
    name: WEBHOOK_QUEUE,
    data: { inboxId: 'different-id' },
    state: 'created',
  });
  await assert.rejects(queue.ensureWebhookEnqueued('01234567-89ab-4cde-8123-456789abcdef'), /identity mismatch/);
  required(boss.jobs.get('01234567-89ab-4cde-8123-456789abcdef')).data = {
    inboxId: '01234567-89ab-4cde-8123-456789abcdef',
  };
  required(boss.jobs.get('01234567-89ab-4cde-8123-456789abcdef')).state = 'failed';
  await assert.rejects(queue.ensureWebhookEnqueued('01234567-89ab-4cde-8123-456789abcdef'), /exhausted/);
  assert.equal(required(boss.jobs.get('01234567-89ab-4cde-8123-456789abcdef')).state, 'failed');
  assert.equal(
    boss.calls.some((call) => call[0] === 'retry'),
    false,
  );
});

test('workers pass IDs only to injected durable handlers; failed attempt retries safely', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss, credentialKeysReady: true });
  const inboxId = randomUUID();
  const shopId = randomUUID();
  const calls: [string, ...unknown[]][] = [];
  await queue.start();
  const refreshId = await queue.enqueueRefresh(shopId, 7);
  assert.equal(required(boss.jobs.get(refreshId)).name, REFRESH_QUEUE);
  assert.deepEqual(required(boss.jobs.get(refreshId)).data, { shopId, installationGeneration: 7 });
  await queue.work({
    async processInbox(id) {
      calls.push(['inbox', id]);
      if (calls.length === 1) throw new Error('synthetic crash before acknowledgement');
      return undefined;
    },
    async refreshCredential(id, generation) {
      calls.push(['refresh', id, generation]);
      return undefined;
    },
  });
  const webhookHandler = required(boss.workers.get(WEBHOOK_QUEUE));
  const job = {
    id: inboxId,
    name: WEBHOOK_QUEUE,
    state: 'active' as const,
    data: { inboxId },
    retryCount: 0,
    retryLimit: 5,
    signal: new AbortController().signal,
  };
  await assert.rejects(webhookHandler([job]), /Webhook processing failed/);
  await webhookHandler([{ ...job, retryCount: 1 }]);
  assert.deepEqual(calls.slice(0, 2), [
    ['inbox', inboxId],
    ['inbox', inboxId],
  ]);
  const refreshHandler = required(boss.workers.get(REFRESH_QUEUE));
  await refreshHandler([
    {
      id: refreshId,
      name: REFRESH_QUEUE,
      state: 'active',
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
  assert.ok(boss.calls.some((call) => Array.isArray(call) && call[0] === 'offWork'));
});

test('invalid job body and identity fail closed without invoking application', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss, credentialKeysReady: true });
  let invoked = false;
  await queue.start();
  await queue.work({
    async processInbox() {
      invoked = true;
      return undefined;
    },
    async refreshCredential() {
      invoked = true;
      return undefined;
    },
  });
  const handler = required(boss.workers.get(WEBHOOK_QUEUE));
  const id = randomUUID();
  await assert.rejects(
    handler([
      {
        id,
        name: WEBHOOK_QUEUE,
        state: 'active',
        data: { inboxId: randomUUID(), token: 'secret' },
        retryCount: 0,
        retryLimit: 5,
        signal: new AbortController().signal,
      },
    ]),
    /Webhook processing failed/,
  );
  assert.equal(invoked, false);
});

test('enabled worker refuses missing credential-key configuration and stays not ready', async () => {
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss: fakeBoss() });
  await queue.start();
  assert.equal(queue.durableReady, false);
  await assert.rejects(
    queue.work({
      async processInbox() {
        return undefined;
      },
      async refreshCredential() {
        return undefined;
      },
    }),
    /Credential wrapping keys not configured/,
  );
  await queue.stop();
});

test('refresh claim contention is retried rather than silently completing its job', async () => {
  const boss = fakeBoss();
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss, credentialKeysReady: true });
  await queue.start();
  await queue.work({
    async processInbox() {
      return undefined;
    },
    async refreshCredential() {
      return 'contention';
    },
  });
  const jobId = randomUUID();
  const shopId = randomUUID();
  const handler = required(boss.workers.get(REFRESH_QUEUE));
  await assert.rejects(
    handler([
      {
        id: jobId,
        name: REFRESH_QUEUE,
        state: 'active',
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

test('queue policy drift, missing queue and wrong schema fail startup; later drift fails readiness', async () => {
  for (const replacement of [null, { retryLimit: 99 }]) {
    const boss = fakeBoss();
    const original = boss.getQueue;
    boss.getQueue = async (name) => (replacement === null ? null : { ...(await original(name)), ...replacement });
    const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss });
    await assert.rejects(queue.start(), /queue/);
    assert.equal(queue.durableReady, false);
  }
  const boss = fakeBoss();
  boss.schemaVersion = async () => 42;
  await assert.rejects(createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss }).start(), /version differs/);
  boss.schemaVersion = async () => 43;
  const queue = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss, credentialKeysReady: true });
  await queue.start();
  await queue.work({
    async processInbox() {
      return undefined;
    },
    async refreshCredential() {
      return undefined;
    },
  });
  assert.equal(await queue.checkDurableReady(), true);
  boss.getQueue = async () => null;
  assert.equal(await queue.checkDurableReady(), false);
  await queue.stop();
});
