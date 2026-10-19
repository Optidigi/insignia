import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createArtworkRunner } from '../dist/artwork-runner.js';

const inspect: NonNullable<Parameters<typeof createArtworkRunner>[0]['inspect']> = async (bytes) => ({
  version: 'm6-inspection-v1',
  mimeType: 'image/svg+xml',
  width: 16,
  height: 8,
  originalSha256: createHash('sha256').update(bytes).digest('hex'),
  preview: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
  previewMimeType: 'image/png',
});
test('qualification and durable scan precede readiness; concurrent passes remain serial', async () => {
  let scans = 0,
    active = 0,
    maxActive = 0;
  const seen: string[] = [];
  let unblock: () => void = () => {
    throw new Error('Fixture not started');
  };
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const runner = createArtworkRunner({
    inspect,
    store: {
      async selectPending(limit) {
        assert.equal(limit, 5);
        scans++;
        return ['a', 'b'];
      },
    },
    service: {
      async process(id) {
        active++;
        maxActive = Math.max(maxActive, active);
        seen.push(id);
        if (id === 'a') await blocked;
        active--;
        return 'usable';
      },
    },
  });
  assert.equal(runner.ready, false);
  await runner.start();
  const first = runner.runOnce();
  const second = runner.runOnce();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(scans, 1);
  assert.equal(runner.ready, true);
  unblock();
  await Promise.all([first, second]);
  await runner.stop();
  assert.equal(maxActive, 1);
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(runner.ready, false);
});
test('scan infrastructure failures remove readiness and recover from durable pending rows', async () => {
  let broken = false,
    scans = 0;
  const errors: string[] = [];
  const seen: string[] = [];
  let now = new Date('2026-10-12T00:00:00Z');
  const runner = createArtworkRunner({
    inspect,
    clock: () => now,
    onError: (code) => errors.push(code),
    timing: { pollMs: 30000, heartbeatMaxAgeMs: 1000 },
    store: {
      async selectPending() {
        scans++;
        if (broken) throw new Error('https://secret.example/token');
        return ['pending'];
      },
    },
    service: {
      async process(id) {
        seen.push(id);
        return 'usable';
      },
    },
  });
  await runner.start();
  await runner.runOnce();
  assert.equal(runner.ready, true);
  broken = true;
  await runner.runOnce();
  assert.equal(runner.ready, false);
  assert.equal(runner.readiness().error, 'ARTWORK_RUNNER_UNAVAILABLE');
  assert.deepEqual(errors, ['ARTWORK_RUNNER_UNAVAILABLE']);
  broken = false;
  await runner.runOnce();
  assert.equal(runner.ready, true);
  assert.deepEqual(seen, ['pending', 'pending']);
  now = new Date(now.getTime() + 1001);
  assert.equal(runner.ready, false);
  await runner.stop();
  assert.ok(scans >= 3);
});
test('stop aborts active inspection and does not dispatch the next pending asset', async () => {
  let began: () => void = () => {
    throw new Error('Fixture not started');
  };
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const seen: string[] = [];
  const runner = createArtworkRunner({
    inspect,
    store: {
      async selectPending() {
        return ['first', 'second'];
      },
    },
    service: {
      async process(id, signal) {
        seen.push(id);
        began();
        assert(signal);
        await new Promise((_resolve, reject) => {
          assert(signal);
          signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
        });
        return 'usable';
      },
    },
  });
  await runner.start();
  const pass = runner.runOnce();
  await started;
  await runner.stop();
  await pass;
  assert.deepEqual(seen, ['first']);
  assert.equal(runner.ready, false);
  assert.equal(runner.readiness().error, 'ARTWORK_RUNNER_ABORTED');
});
test('inspection deadline cancels before the durable lease and reports a coarse unavailable pass', async () => {
  let aborted = false;
  const runner = createArtworkRunner({
    inspect,
    timing: { deadlineMs: 30, pollMs: 30000 },
    store: {
      async selectPending() {
        return ['pending'];
      },
    },
    service: {
      async process(_id, signal) {
        await new Promise((_resolve, reject) => {
          assert(signal);
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('secret object key'));
            },
            { once: true },
          );
        });
        return 'usable';
      },
    },
  });
  await runner.start();
  await runner.runOnce();
  assert.equal(aborted, true);
  assert.equal(runner.ready, false);
  assert.equal(runner.readiness().error, 'ARTWORK_RUNNER_DEADLINE');
  await runner.stop();
});
test('unqualified host cannot scan or claim pending uploads', async () => {
  let scans = 0;
  const runner = createArtworkRunner({
    inspect: async () => {
      throw new Error('host unavailable');
    },
    store: {
      async selectPending() {
        scans++;
        return [];
      },
    },
    service: {
      async process() {
        return 'usable';
      },
    },
  });
  await assert.rejects(runner.start(), /qualification unavailable/);
  assert.equal(runner.ready, false);
  assert.equal(scans, 0);
  await assert.rejects(runner.runOnce(), /unavailable/);
  await runner.stop();
});
test('a hung durable scan cannot refresh a stale heartbeat', async () => {
  let now = new Date('2026-10-12T00:00:00Z'),
    blocked = false,
    unblock: (value: string[]) => void = () => {
      throw new Error('Fixture not started');
    };
  const pending = new Promise<string[]>((resolve) => {
    unblock = resolve;
  });
  const runner = createArtworkRunner({
    inspect,
    clock: () => now,
    timing: { pollMs: 30000, heartbeatMaxAgeMs: 60 },
    store: {
      async selectPending() {
        if (blocked) return pending;
        return [];
      },
    },
    service: {
      async process() {
        return 'not_claimed';
      },
    },
  });
  await runner.start();
  await runner.runOnce();
  assert.equal(runner.ready, true);
  blocked = true;
  const pass = runner.runOnce();
  now = new Date(now.getTime() + 61);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runner.ready, false);
  unblock([]);
  await pass;
  assert.equal(runner.ready, true);
  await runner.stop();
});
test('a pass never dispatches more than five uploads even with an oversized pending result', async () => {
  const seen: string[] = [];
  const runner = createArtworkRunner({
    inspect,
    store: {
      async selectPending() {
        return ['1', '2', '3', '4', '5', '6'];
      },
    },
    service: {
      async process(id) {
        seen.push(id);
        return 'rejected';
      },
    },
  });
  await runner.start();
  await runner.runOnce();
  await runner.stop();
  assert.deepEqual(seen, ['1', '2', '3', '4', '5']);
});
test('a known processing outage requires requalification before readiness can recover', async () => {
  let outage = false,
    scans = 0,
    qualifications = 0;
  const runner = createArtworkRunner({
    inspect: async (bytes, options) => {
      qualifications++;
      if (outage) throw new Error('host absent');
      return inspect(bytes, options);
    },
    store: {
      async selectPending() {
        scans++;
        return ['pending'];
      },
    },
    service: {
      async process() {
        if (outage) throw new Error('UNAVAILABLE');
        return 'usable';
      },
    },
  });
  await runner.start();
  await runner.runOnce();
  assert.equal(runner.ready, true);
  outage = true;
  await runner.runOnce();
  assert.equal(runner.ready, false);
  await runner.runOnce();
  assert.equal(scans, 2);
  assert.equal(qualifications, 2);
  assert.equal(runner.ready, false);
  await runner.stop();
});

test('one asset failure leaves other tenants processing while the outage is reported', async () => {
  const seen: string[] = [],
    errors: string[] = [];
  const runner = createArtworkRunner({
    inspect,
    timing: { pollMs: 30000 },
    onError: (code) => errors.push(code),
    store: {
      async selectPending() {
        return ['missing', 'other-tenant'];
      },
    },
    service: {
      async process(id) {
        seen.push(id);
        if (id === 'missing') throw new Error('UNAVAILABLE');
        return 'usable';
      },
    },
  });
  await runner.start();
  assert.equal(await runner.runOnce(), 1);
  assert.deepEqual(seen, ['missing', 'other-tenant']);
  assert.equal(runner.ready, false);
  assert.deepEqual(errors, ['ARTWORK_RUNNER_UNAVAILABLE']);
  await runner.stop();
});
