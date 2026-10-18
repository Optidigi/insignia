import assert from 'node:assert/strict';
import test from 'node:test';
import { collectHeartbeat, sendHeartbeat } from './heartbeat.mjs';

const now = Date.parse('2026-10-18T12:00:00Z');
test('aggregates actual probes and deadline evidence; missing sources remain unknown', async () => {
  const payload = await collectHeartbeat({
    now,
    eventId: 'test-1',
    backupMaxAgeSeconds: 86_400,
    probeAvailability: async () => false,
    readAggregate: async (kind) =>
      kind === 'backup'
        ? { completedAt: now - 90_000_000 }
        : kind === 'processing'
          ? { observedAt: now, stalledCount: 3 }
          : null,
  });
  assert.deepEqual(payload.signals, {
    availability: { status: 'problem', count: 1 },
    backup: { status: 'problem', count: 1 },
    processing: { status: 'problem', count: 3 },
    deletion: { status: 'unknown', count: 0 },
  });
});
test('rejects stale or malformed aggregate evidence instead of reporting a healthy application', async () => {
  const payload = await collectHeartbeat({
    now,
    eventId: 'test-2',
    backupMaxAgeSeconds: 86_400,
    probeAvailability: async () => true,
    readAggregate: async (kind) =>
      kind === 'backup'
        ? { completedAt: now + 1 }
        : kind === 'processing'
          ? { observedAt: now - 120_001, stalledCount: 0 }
          : { observedAt: now, overdueCount: -1 },
  });
  assert.equal(payload.signals.availability.status, 'ok');
  for (const kind of ['backup', 'processing', 'deletion']) assert.equal(payload.signals[kind].status, 'unknown');
});
test('uses only the fixed HTTPS heartbeat route and does not retry failed responses', async () => {
  let calls = 0;
  const input = {
    endpoint: 'https://alerts.example',
    secret: 'test-only-secret-with-at-least-32-characters',
    payload: {},
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, 'https://alerts.example/v1/heartbeat');
      assert.equal(options.redirect, 'error');
      return new Response('', { status: 503 });
    },
  };
  await assert.rejects(sendHeartbeat(input));
  assert.equal(calls, 1);
  await assert.rejects(sendHeartbeat({ ...input, endpoint: 'http://alerts.example' }));
  assert.equal(calls, 1);
});
