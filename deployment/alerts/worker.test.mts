import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { AlertMonitor, type EmailMessage, type Environment, type MonitorStorage } from './worker.mts';

const secret = 'test-only-relay-key-that-is-at-least-32-characters';
const at = Date.parse('2026-10-18T12:00:00Z');
const signals = {
  availability: { status: 'ok', count: 0 },
  backup: { status: 'unknown', count: 0 },
  processing: { status: 'ok', count: 0 },
  deletion: { status: 'ok', count: 0 },
};
const heartbeat = (id = 'heartbeat-1') => ({ version: 1, eventId: id, timestamp: at, signals });
const alert = (id = 'alert-1') => ({
  version: 1,
  eventId: id,
  timestamp: at,
  component: 'processing',
  event: 'problem',
  severity: 'critical',
  incidentId: 'processing-1',
  count: 2,
});
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  assert(isRecord(value));
  return value;
}
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  return record(value);
}
function messageAt(messages: EmailMessage[], index: number): EmailMessage {
  const message = messages[index];
  assert(message, `Expected message at index ${index}`);
  return message;
}
function fixture(
  send: (message: EmailMessage) => Promise<unknown> = async () => ({ messageId: 'provider-id' }),
  initial: [string, unknown][] = [],
) {
  const data = new Map<string, unknown>(initial);
  let queue: Promise<unknown> = Promise.resolve();
  const storage: MonitorStorage = {
    async get(key) {
      return structuredClone(data.get(key));
    },
    async put(key, value) {
      data.set(key, structuredClone(value));
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
    async list({ prefix, end, limit }) {
      return new Map(
        [...data.entries()]
          .filter(([key]) => key.startsWith(prefix) && key < end)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit),
      );
    },
    transaction(callback) {
      const next = queue.then(() => callback(storage));
      queue = next.catch(() => {});
      return next;
    },
  };
  let time = at;
  const messages: EmailMessage[] = [];
  let monitor: AlertMonitor;
  const env: Environment = {
    RELAY_SECRET: secret,
    MONITOR: { getByName: () => monitor },
    ALERT_EMAIL: {
      async send(message) {
        messages.push(message);
        return send(message);
      },
    },
  };
  const create = () => new AlertMonitor({ storage }, env, () => time);
  monitor = create();
  const request = (path: string, payload: unknown, token = secret) =>
    worker.fetch(
      new Request(`https://alerts.example${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env,
    );
  return {
    env,
    messages,
    request,
    tick: () => monitor.fetch(new Request('https://internal/tick', { method: 'POST' })),
    restart() {
      monitor = create();
    },
    advance(ms: number) {
      time += ms;
    },
  };
}

test('authenticates before content and rejects untrusted mail fields and oversized bodies', async () => {
  const f = fixture();
  assert.equal((await f.request('/v1/alerts', alert(), 'wrong')).status, 401);
  assert.equal((await f.request('/v1/alerts', { ...alert(), to: 'other@example.com' })).status, 400);
  assert.equal((await f.request('/v1/alerts', { ...alert(), eventId: 'x'.repeat(5000) })).status, 413);
  assert.equal(f.messages.length, 0);
});

test('claims durably before send, deduplicates across concurrency/restart, and rejects conflicting ID reuse', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.request('/v1/alerts', alert())));
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(f.messages.length, 1);
  f.restart();
  assert.equal((await readJson(await f.request('/v1/alerts', alert()))).state, 'submitted');
  assert.equal((await f.request('/v1/alerts', { ...alert(), count: 3 })).status, 409);
  assert.equal(f.messages[0]?.to, 'admin@optidigi.nl');
  assert.deepEqual(f.messages[0]?.from, { email: 'insignia-alerts@optidigi.nl', name: 'Insignia Alerts' });
});

test('exposes acknowledged provider references to the authenticated operator for delivery reconciliation', async () => {
  const f = fixture();
  const submitted = await readJson(await f.request('/v1/alerts', alert()));
  assert.equal(submitted.messageId, 'provider-id');
  f.restart();
  const duplicate = await readJson(await f.request('/v1/alerts', alert()));
  assert.equal(duplicate.messageId, 'provider-id');
  const status = await readJson(
    await worker.fetch(
      new Request('https://alerts.example/v1/status', { headers: { authorization: `Bearer ${secret}` } }),
      f.env,
    ),
  );
  assert.equal(record(status.lastSubmission).messageId, 'provider-id');
  assert.equal(f.messages.length, 1);
  f.advance(604_800_000);
  const expired = await readJson(
    await worker.fetch(
      new Request('https://alerts.example/v1/status', { headers: { authorization: `Bearer ${secret}` } }),
      f.env,
    ),
  );
  assert.equal(expired.lastSubmission, null);
});

test('stays unarmed until first heartbeat, detects outage independently, persists reminders and sends one recovery', async () => {
  const f = fixture();
  await f.tick();
  assert.equal(f.messages.length, 0);
  const healthy = { ...heartbeat(), signals: { ...signals, backup: { status: 'ok', count: 0 } } };
  assert.equal((await f.request('/v1/heartbeat', healthy)).status, 200);
  assert.equal(f.messages.length, 0, 'heartbeat never dispatches email');
  f.advance(300_000);
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(f.messages.length, 1);
  assert.match(messageAt(f.messages, 0).subject, /watchdog problem/);
  f.restart();
  f.advance(21_600_000);
  await f.tick();
  assert.equal(f.messages.length, 2);
  assert.match(messageAt(f.messages, 1).subject, /watchdog reminder/);
  await f.request('/v1/heartbeat', { ...healthy, eventId: 'resumed', timestamp: at + 21_900_000 });
  await f.tick();
  await f.tick();
  assert.equal(f.messages.length, 3);
  assert.match(messageAt(f.messages, 2).subject, /watchdog recovery/);
});

test('ambiguous email submission and a crash after durable claim are never automatically resent', async () => {
  const f = fixture(async () => {
    throw new Error('simulated response loss');
  });
  assert.equal((await readJson(await f.request('/v1/alerts', alert()))).state, 'unknown');
  f.restart();
  assert.equal((await readJson(await f.request('/v1/alerts', alert()))).state, 'unknown');
  assert.equal(f.messages.length, 1);
  const completion: { release?: (value: unknown) => void } = {};
  const hanging = fixture(
    () =>
      new Promise((resolve) => {
        completion.release = resolve;
      }),
  );
  const first = hanging.request('/v1/alerts', alert());
  while (!completion.release) await new Promise((resolve) => setImmediate(resolve));
  hanging.restart();
  assert.equal((await readJson(await hanging.request('/v1/alerts', alert()))).state, 'unknown');
  assert.equal(hanging.messages.length, 1);
  completion.release({ messageId: 'accepted' });
  await first;
});

test('empty provider references remain unknown and cannot authorize an automatic resend', async () => {
  const f = fixture(async () => ({ messageId: '' }));
  assert.equal((await readJson(await f.request('/v1/alerts', alert()))).state, 'unknown');
  f.restart();
  assert.equal((await readJson(await f.request('/v1/alerts', alert()))).state, 'unknown');
  assert.equal(f.messages.length, 1);
});

test('bounds total mail across alert classes and preserves capped and suppressed identities', async () => {
  const f = fixture();
  for (let i = 0; i < 22; i++) {
    const payload = {
      ...alert(`event-${i}`),
      incidentId: 'same-incident',
      event: i % 2 ? 'recovery' : 'problem',
      severity: i % 2 ? 'info' : 'critical',
    };
    const response = await f.request('/v1/alerts', payload);
    assert.equal(response.status, 200);
    if (i >= 20) assert.equal((await readJson(response)).state, 'capped');
  }
  assert.equal(f.messages.length, 20);
});

test('unknown aggregate is a warning, never proof of application readiness; stale or reordered heartbeats fail', async () => {
  const f = fixture();
  await f.request('/v1/heartbeat', heartbeat());
  await f.tick();
  assert.match(messageAt(f.messages, 0).subject, /backup problem/);
  assert.equal((await f.request('/v1/heartbeat', heartbeat('another-id'))).status, 409);
  assert.equal((await f.request('/v1/heartbeat', { ...heartbeat('old'), timestamp: at - 300_001 })).status, 400);
  const status = await worker.fetch(
    new Request('https://alerts.example/v1/status', { headers: { authorization: `Bearer ${secret}` } }),
    f.env,
  );
  assert.equal((await readJson(status)).readiness, 'unqualified');
});

test('operator status reports missing heartbeat and resets the UTC daily mail counter without another send', async () => {
  const f = fixture();
  await f.request('/v1/alerts', alert());
  await f.request('/v1/heartbeat', heartbeat());
  f.advance(86_400_000);
  const status = await worker.fetch(
    new Request('https://alerts.example/v1/status', { headers: { authorization: `Bearer ${secret}` } }),
    f.env,
  );
  const value = await readJson(status);
  assert.equal(value.mailAttemptsToday, 0);
  assert.equal(value.heartbeatState, 'missing');
});

test('expired event cleanup remains durable when a reordered heartbeat is rejected', async () => {
  const expiredAt = at - 604_800_001;
  const f = fixture(undefined, [
    [
      'monitor',
      {
        heartbeat: { timestamp: at, signals },
        eventCount: 1,
        incidents: {},
        day: '',
        sent: 0,
        suppressed: 0,
        duplicates: 0,
      },
    ],
    ['event:e:expired', { at: expiredAt, digest: 'expired', state: 'recorded' }],
    [`expiry:${String(expiredAt).padStart(16, '0')}:e:expired`, 'e:expired'],
  ]);
  assert.equal((await f.request('/v1/heartbeat', heartbeat('reordered'))).status, 409);
  f.restart();
  const status = await worker.fetch(
    new Request('https://alerts.example/v1/status', { headers: { authorization: `Bearer ${secret}` } }),
    f.env,
  );
  assert.equal((await readJson(status)).retainedEvents, 0);
});

test('malformed persisted monitor and event records fail closed without sending or replacing history', async () => {
  for (const initial of [[['monitor', { heartbeat: null }]], [['event:e:alert-1', { state: 'claimed' }]]] satisfies [
    string,
    unknown,
  ][][]) {
    const f = fixture(undefined, initial);
    assert.equal((await f.request('/v1/alerts', alert())).status, 503);
    f.restart();
    assert.equal((await f.request('/v1/alerts', alert())).status, 503);
    assert.equal(f.messages.length, 0);
  }
});

test('scheduled dispatch waits for the internal watchdog and propagates its failure', async () => {
  const f = fixture();
  let pending: Promise<unknown> | undefined;
  worker.scheduled(undefined, f.env, {
    waitUntil(value) {
      pending = value;
    },
  });
  await pending;
  assert.equal(f.messages.length, 0);
  const env: Environment = {
    ...f.env,
    MONITOR: {
      getByName: () => ({
        async fetch() {
          return new Response(null, { status: 503 });
        },
      }),
    },
  };
  worker.scheduled(undefined, env, {
    waitUntil(value) {
      pending = value;
    },
  });
  assert(pending);
  await assert.rejects(pending, /Alert watchdog failed/);
});
