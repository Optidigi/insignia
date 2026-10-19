import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { startWorkerProcess } from '../dist/process.js';
import type { PgBossRuntime } from '../dist/runtime.js';

test('process starts queues and workers before readiness; stop makes readiness unavailable', async () => {
  const events: string[] = [];
  let ready = false;
  const queue: PgBossRuntime = {
    ensureWebhookEnqueued: async () => {
      throw new Error('Unexpected enqueue');
    },
    removeExpiredWebhookJob: async () => {
      throw new Error('Unexpected expiry');
    },
    enqueueRefresh: async () => {
      throw new Error('Unexpected refresh');
    },
    schemaVersion: async () => {
      throw new Error('Unexpected schema read');
    },
    get durableReady() {
      return ready;
    },
    observability: createObservability(),
    async checkDurableReady() {
      return this.durableReady;
    },
    async start() {
      events.push('queue.start');
    },
    async work() {
      events.push('queue.work');
      ready = true;
    },
    async stop() {
      events.push('queue.stop');
      ready = false;
    },
  };
  const process = await startWorkerProcess({
    queue,
    handlers: {
      async processInbox() {
        return undefined;
      },
      async refreshCredential() {
        return undefined;
      },
    },
    port: 0,
  });
  assert.deepEqual(events, ['queue.start', 'queue.work']);
  assert.equal((await fetch(`${process.url}/ready`)).status, 200);
  await process.stop();
  assert.deepEqual(events, ['queue.start', 'queue.work', 'queue.stop']);
  assert.equal(process.durableReady, false);
  await assert.rejects(fetch(`${process.url}/live`));
});

test('startup failure closes a started queue without reporting readiness', async () => {
  const events: string[] = [];
  const ready = false;
  const queue: PgBossRuntime = {
    ensureWebhookEnqueued: async () => {
      throw new Error('Unexpected enqueue');
    },
    removeExpiredWebhookJob: async () => {
      throw new Error('Unexpected expiry');
    },
    enqueueRefresh: async () => {
      throw new Error('Unexpected refresh');
    },
    schemaVersion: async () => {
      throw new Error('Unexpected schema read');
    },
    get durableReady() {
      return ready;
    },
    observability: createObservability(),
    async checkDurableReady() {
      return this.durableReady;
    },
    async start() {
      events.push('start');
    },
    async work() {
      throw new Error('synthetic worker registration failure');
    },
    async stop() {
      events.push('stop');
    },
  };
  await assert.rejects(
    startWorkerProcess({
      queue,
      handlers: {
        async processInbox() {
          return undefined;
        },
        async refreshCredential() {
          return undefined;
        },
      },
      port: 0,
    }),
    /synthetic worker registration failure/,
  );
  assert.deepEqual(events, ['start', 'stop']);
});
