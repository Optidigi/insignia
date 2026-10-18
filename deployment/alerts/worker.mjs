const COMPONENTS = ['availability', 'backup', 'processing', 'deletion'];
const FIVE_MINUTES = 300_000;
const SIX_HOURS = 21_600_000;
const SEVEN_DAYS = 604_800_000;
const MAX_EVENTS = 20_000;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const keys = (object, expected) =>
  object &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  Object.keys(object).sort().join(',') === [...expected].sort().join(',');
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;

export function validSignals(signals) {
  return (
    keys(signals, COMPONENTS) &&
    COMPONENTS.every(
      (key) =>
        keys(signals[key], ['status', 'count']) &&
        ['ok', 'problem', 'unknown'].includes(signals[key].status) &&
        count(signals[key].count),
    )
  );
}
function validPayload(payload, heartbeat) {
  const fields = heartbeat
    ? ['version', 'eventId', 'timestamp', 'signals']
    : ['version', 'eventId', 'timestamp', 'component', 'event', 'severity', 'incidentId', 'count'];
  return (
    keys(payload, fields) &&
    payload.version === 1 &&
    opaque(payload.eventId) &&
    Number.isSafeInteger(payload.timestamp) &&
    payload.timestamp >= 0 &&
    (heartbeat
      ? validSignals(payload.signals)
      : COMPONENTS.includes(payload.component) &&
        ['problem', 'recovery'].includes(payload.event) &&
        (payload.event === 'recovery'
          ? payload.severity === 'info'
          : ['warning', 'critical'].includes(payload.severity)) &&
        opaque(payload.incidentId) &&
        count(payload.count))
  );
}
async function authenticated(request, secret) {
  const hash = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const supplied = request.headers.get('authorization') ?? '';
  if (supplied.length > 256) return false;
  const [a, b] = await Promise.all([hash(supplied), hash(`Bearer ${secret}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function boundedJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw 415;
  const reader = request.body?.getReader();
  if (!reader) throw 400;
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw 413;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw 400;
  }
}
const monitor = (env) => env.MONITOR.getByName('insignia-production');
export default {
  async fetch(request, env) {
    try {
      if (typeof env.RELAY_SECRET !== 'string' || env.RELAY_SECRET.length < 32 || env.RELAY_SECRET.length > 128)
        return json({ error: 'relay_unconfigured' }, 503);
      if (!(await authenticated(request, env.RELAY_SECRET))) return json({ error: 'unauthorized' }, 401);
      const path = new URL(request.url).pathname;
      if (path === '/v1/status' && request.method === 'GET')
        return monitor(env).fetch(new Request('https://internal/status'));
      if (!['/v1/heartbeat', '/v1/alerts'].includes(path)) return json({ error: 'not_found' }, 404);
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const payload = await boundedJson(request);
      if (!validPayload(payload, path === '/v1/heartbeat')) return json({ error: 'invalid_payload' }, 400);
      return await monitor(env).fetch(
        new Request(`https://internal${path}`, { method: 'POST', body: JSON.stringify(payload) }),
      );
    } catch (error) {
      return json({ error: 'request_failed' }, Number.isInteger(error) ? error : 503);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      monitor(env)
        .fetch(new Request('https://internal/tick', { method: 'POST' }))
        .then((response) => {
          if (!response.ok) throw new Error('Alert watchdog failed');
        }),
    );
  },
};

export class AlertMonitor {
  constructor(ctx, env, clock = Date.now) {
    this.storage = ctx.storage;
    this.env = env;
    this.clock = clock;
  }
  async fetch(request) {
    const now = this.clock();
    const path = new URL(request.url).pathname;
    const payload = path.startsWith('/v1/') ? await request.json() : null;
    if (payload && Math.abs(now - payload.timestamp) > FIVE_MINUTES) return json({ error: 'stale_timestamp' }, 400);
    const canonical = (value) =>
      value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
    const digest = payload
      ? [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(payload)))),
          ),
        ]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
      : null;
    const result = await this.storage.transaction(async (tx) => {
      const state = (await tx.get('monitor')) ?? {
        heartbeat: null,
        eventCount: 0,
        incidents: {},
        day: '',
        sent: 0,
        suppressed: 0,
        duplicates: 0,
      };
      const day = new Date(now).toISOString().slice(0, 10);
      if (state.day !== day) {
        state.day = day;
        state.sent = 0;
      }
      // Expiry keys sort by timestamp; cap cleanup work per request.
      const expired = await tx.list({
        prefix: 'expiry:',
        end: `expiry:${String(Math.max(0, now - SEVEN_DAYS)).padStart(16, '0')}:`,
        limit: 256,
      });
      for (const [key, id] of expired) {
        await tx.delete([key, `event:${id}`]);
        state.eventCount--;
      }
      const putEvent = async (id, event) => {
        await tx.put(`event:${id}`, event);
        await tx.put(`expiry:${String(now).padStart(16, '0')}:${id}`, id);
        state.eventCount++;
      };
      const claims = [];
      const persist = async (value, status = 200) => {
        await tx.put('monitor', state);
        return { value, status, claims };
      };
      const eventKey = payload ? `e:${payload.eventId}` : null;
      const existing = eventKey ? await tx.get(`event:${eventKey}`) : null;
      if (existing) {
        if (existing.digest !== digest) return persist({ error: 'event_id_conflict' }, 409);
        state.duplicates++;
        return persist({ state: existing.state === 'claimed' ? 'unknown' : existing.state });
      }
      if (eventKey && state.eventCount >= MAX_EVENTS - 32) return persist({ error: 'dedup_capacity' }, 429);
      const claim = async (id, details) => {
        const previous = await tx.get(`event:${id}`);
        if (previous) return previous.state;
        const record = {
          at: now,
          digest: id === eventKey ? digest : null,
          state: state.sent < 20 ? 'claimed' : 'capped',
        };
        await putEvent(id, record);
        if (record.state === 'capped') state.suppressed++;
        else {
          state.sent++;
          claims.push({ id, details });
        }
        return record.state;
      };
      const transition = async (
        component,
        problem,
        incidentId,
        count,
        severity,
        id,
        evidence = problem ? 'problem' : 'ok',
      ) => {
        const active = state.incidents[component];
        if (problem) {
          if (active && (active.id !== incidentId || now - active.lastNotice < SIX_HOURS)) return 'suppressed';
          state.incidents[component] = { id: incidentId, lastNotice: now };
        } else {
          if (!active || active.id !== incidentId) return 'suppressed';
          delete state.incidents[component];
        }
        return claim(id, {
          component,
          event: problem ? (active ? 'reminder' : 'problem') : 'recovery',
          severity,
          count,
          incidentId,
          evidence,
        });
      };
      if (path === '/status')
        return persist({
          armed: state.heartbeat !== null,
          heartbeatState: !state.heartbeat
            ? 'unarmed'
            : now - state.heartbeat.timestamp >= FIVE_MINUTES
              ? 'missing'
              : 'current',
          readiness: 'unqualified',
          lastHeartbeatAt: state.heartbeat?.timestamp ?? null,
          signals: state.heartbeat?.signals ?? null,
          mailAttemptsToday: state.sent,
          capped: state.suppressed,
          duplicates: state.duplicates,
          retainedEvents: state.eventCount,
        });
      if (path === '/v1/heartbeat') {
        if (state.heartbeat && payload.timestamp <= state.heartbeat.timestamp)
          return persist({ error: 'out_of_order_heartbeat' }, 409);
        state.heartbeat = { timestamp: payload.timestamp, signals: payload.signals };
        await putEvent(eventKey, { at: now, digest, state: 'recorded' });
        return persist({ state: 'recorded' });
      }
      if (path === '/v1/alerts') {
        const outcome = await transition(
          payload.component,
          payload.event === 'problem',
          payload.incidentId,
          payload.count,
          payload.severity,
          eventKey,
        );
        if (!(await tx.get(`event:${eventKey}`))) await putEvent(eventKey, { at: now, digest, state: outcome });
        return persist({ state: outcome });
      }
      if (path !== '/tick') return persist({ error: 'not_found' }, 404);
      if (state.heartbeat) {
        const down = now - state.heartbeat.timestamp >= FIVE_MINUTES;
        const active = state.incidents.watchdog;
        await transition(
          'watchdog',
          down,
          active?.id ?? `outage-${state.heartbeat.timestamp}`,
          0,
          down ? 'critical' : 'info',
          `$watchdog:${down ? 'problem' : 'recovery'}:${now}`,
        );
        if (!down)
          for (const component of COMPONENTS) {
            const signal = state.heartbeat.signals[component];
            await transition(
              component,
              signal.status !== 'ok',
              state.incidents[component]?.id ?? `signal-${now}`,
              signal.count,
              signal.status === 'ok' ? 'info' : 'warning',
              `$${component}:${signal.status}:${now}`,
              signal.status,
            );
          }
      }
      return persist({ armed: state.heartbeat !== null });
    });
    for (const { id, details } of result.claims) {
      let outcome = { state: 'unknown' };
      try {
        const sent = await this.env.ALERT_EMAIL.send({
          from: { email: 'insignia-alerts@optidigi.nl', name: 'Insignia Alerts' },
          to: 'admin@optidigi.nl',
          subject: `[Insignia production] ${details.component} ${details.event}`,
          text: `Automated operational notice.\nComponent: ${details.component}\nEvent: ${details.event}\nIncident: ${details.incidentId}\nEvidence: ${details.evidence}\nSeverity: ${details.severity}\nAggregate count: ${details.count}\nObserved at: ${new Date(now).toISOString()}\nThis notice does not establish application or merchant readiness.`,
        });
        if (typeof sent?.messageId === 'string' && sent.messageId.length <= 256)
          outcome = { state: 'submitted', messageId: sent.messageId };
      } catch {
        /* A thrown send can have an unresolved effect. Never automatically redispatch. */
      }
      await this.storage.transaction(async (tx) => {
        const record = await tx.get(`event:${id}`);
        Object.assign(record, outcome);
        await tx.put(`event:${id}`, record);
      });
    }
    if (result.claims.length && payload) {
      result.value.state = (await this.storage.get(`event:e:${payload.eventId}`)).state;
    }
    return json(result.value, result.status);
  }
}
