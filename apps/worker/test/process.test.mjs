import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { startWorkerProcess } from '../dist/process.js';

test('process starts queues and workers before readiness; stop makes readiness unavailable', async () => {
  const events = [];
  const queue = {
    durableReady: false,
    observability: createObservability(),
    async checkDurableReady() {
      return this.durableReady;
    },
    async start() {
      events.push('queue.start');
    },
    async work() {
      events.push('queue.work');
      this.durableReady = true;
    },
    async stop() {
      events.push('queue.stop');
      this.durableReady = false;
    },
  };
  const process = await startWorkerProcess({
    queue,
    handlers: { async processInbox() {}, async refreshCredential() {} },
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
  const events = [];
  const queue = {
    durableReady: false,
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
      handlers: { async processInbox() {}, async refreshCredential() {} },
      port: 0,
    }),
    /synthetic worker registration failure/,
  );
  assert.deepEqual(events, ['start', 'stop']);
});
