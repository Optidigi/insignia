const COMPONENTS = ['availability', 'backup', 'processing', 'deletion'] as const;
type Component = (typeof COMPONENTS)[number];
export type Signal = { status: 'ok' | 'problem' | 'unknown'; count: number };
export type Signals = Record<Component, Signal>;
export type Heartbeat = { version: 1; eventId: string; timestamp: number; signals: Signals };
type Alert = {
  version: 1;
  eventId: string;
  timestamp: number;
  component: Component;
  event: 'problem' | 'recovery';
  severity: 'info' | 'warning' | 'critical';
  incidentId: string;
  count: number;
};
type Payload = Heartbeat | Alert;
type EventState = 'claimed' | 'capped' | 'suppressed' | 'recorded' | 'unknown' | 'submitted';
type EventRecord = { at: number; digest: string | null; state: EventState; messageId?: string };
type MonitorState = {
  heartbeat: Pick<Heartbeat, 'timestamp' | 'signals'> | null;
  eventCount: number;
  incidents: Partial<Record<Component | 'watchdog', { id: string; lastNotice: number }>>;
  day: string;
  sent: number;
  suppressed: number;
  duplicates: number;
  lastSubmission?: { messageId: string; submittedAt: number };
};
export interface StorageTransaction {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string | string[]): Promise<unknown>;
  list(options: { prefix: string; end: string; limit: number }): Promise<Map<string, unknown>>;
}
export interface MonitorStorage extends StorageTransaction {
  transaction<T>(callback: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}
export type EmailMessage = { from: { email: string; name: string }; to: string; subject: string; text: string };
export interface Environment {
  RELAY_SECRET: string;
  MONITOR: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  ALERT_EMAIL: { send(message: EmailMessage): Promise<unknown> };
}
type Details = {
  component: Component | 'watchdog';
  event: 'problem' | 'reminder' | 'recovery';
  severity: Alert['severity'];
  count: number;
  incidentId: string;
  evidence: Signal['status'];
};
type Claim = { id: string; details: Details };
type ResultValue = { state?: EventState; messageId?: string } & Record<string, unknown>;
const FIVE_MINUTES = 300_000;
const SIX_HOURS = 21_600_000;
const SEVEN_DAYS = 604_800_000;
const MAX_EVENTS = 20_000;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const keys = (object: unknown, expected: readonly string[]): object is Record<string, unknown> =>
  object !== null &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  Object.keys(object).sort().join(',') === [...expected].sort().join(',');
const opaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const member = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.some((choice) => choice === value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function isEvent(value: unknown): value is EventRecord {
  return (
    isRecord(value) &&
    finite(value.at) &&
    (value.digest === null || typeof value.digest === 'string') &&
    member(value.state, ['claimed', 'capped', 'suppressed', 'recorded', 'unknown', 'submitted']) &&
    (value.messageId === undefined || typeof value.messageId === 'string')
  );
}
function decodeEvent(value: unknown): EventRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isEvent(value)) throw new Error('Invalid stored event');
  return value;
}
function isState(value: unknown): value is MonitorState {
  return (
    isRecord(value) &&
    (value.heartbeat === null ||
      (isRecord(value.heartbeat) && finite(value.heartbeat.timestamp) && validSignals(value.heartbeat.signals))) &&
    finite(value.eventCount) &&
    isRecord(value.incidents) &&
    Object.entries(value.incidents).every(
      ([key, incident]) =>
        member(key, [...COMPONENTS, 'watchdog']) &&
        isRecord(incident) &&
        typeof incident.id === 'string' &&
        finite(incident.lastNotice),
    ) &&
    typeof value.day === 'string' &&
    finite(value.sent) &&
    finite(value.suppressed) &&
    finite(value.duplicates) &&
    (value.lastSubmission === undefined ||
      (isRecord(value.lastSubmission) &&
        typeof value.lastSubmission.messageId === 'string' &&
        finite(value.lastSubmission.submittedAt)))
  );
}
function decodeState(value: unknown): MonitorState | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isState(value)) throw new Error('Invalid stored monitor');
  return value;
}

export function validSignals(signals: unknown): signals is Signals {
  return (
    keys(signals, COMPONENTS) &&
    COMPONENTS.every(
      (key) =>
        keys(signals[key], ['status', 'count']) &&
        member(signals[key].status, ['ok', 'problem', 'unknown']) &&
        count(signals[key].count),
    )
  );
}
function validPayload(payload: unknown, heartbeat: boolean): payload is Payload {
  const fields = heartbeat
    ? ['version', 'eventId', 'timestamp', 'signals']
    : ['version', 'eventId', 'timestamp', 'component', 'event', 'severity', 'incidentId', 'count'];
  return (
    keys(payload, fields) &&
    payload.version === 1 &&
    opaque(payload.eventId) &&
    typeof payload.timestamp === 'number' &&
    Number.isSafeInteger(payload.timestamp) &&
    payload.timestamp >= 0 &&
    (heartbeat
      ? validSignals(payload.signals)
      : member(payload.component, COMPONENTS) &&
        member(payload.event, ['problem', 'recovery']) &&
        (payload.event === 'recovery'
          ? payload.severity === 'info'
          : member(payload.severity, ['warning', 'critical'])) &&
        opaque(payload.incidentId) &&
        count(payload.count))
  );
}
async function authenticated(request: Request, secret: string) {
  const hash = async (text: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const supplied = request.headers.get('authorization') ?? '';
  if (supplied.length > 256) return false;
  const [a, b] = await Promise.all([hash(supplied), hash(`Bearer ${secret}`)]);
  let diff = 0;
  for (const [index, value] of a.entries()) diff |= value ^ (b[index] ?? 0);
  return diff === 0;
}
async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw 415;
  const reader = request.body?.getReader();
  if (!reader) throw 400;
  const chunks: Uint8Array[] = [];
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
const monitor = (env: Environment) => env.MONITOR.getByName('insignia-production');
export default {
  async fetch(request: Request, env: Environment) {
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
      return json({ error: 'request_failed' }, typeof error === 'number' && Number.isInteger(error) ? error : 503);
    }
  },
  async scheduled(_controller: unknown, env: Environment, ctx: { waitUntil(promise: Promise<unknown>): void }) {
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
  private readonly storage: MonitorStorage;
  private readonly env: Pick<Environment, 'ALERT_EMAIL'>;
  private readonly clock: () => number;
  constructor(ctx: { storage: MonitorStorage }, env: Pick<Environment, 'ALERT_EMAIL'>, clock = Date.now) {
    this.storage = ctx.storage;
    this.env = env;
    this.clock = clock;
  }
  async fetch(request: Request) {
    const now = this.clock();
    const path = new URL(request.url).pathname;
    const raw: unknown = path.startsWith('/v1/') ? await request.json() : null;
    if (path.startsWith('/v1/') && !validPayload(raw, path === '/v1/heartbeat'))
      return json({ error: 'invalid_payload' }, 400);
    const payload = validPayload(raw, path === '/v1/heartbeat') ? raw : null;
    if (payload && Math.abs(now - payload.timestamp) > FIVE_MINUTES) return json({ error: 'stale_timestamp' }, 400);
    const canonical = (value: unknown): unknown =>
      value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(Reflect.get(value, key))]),
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
      const state: MonitorState = decodeState(await tx.get('monitor')) ?? {
        heartbeat: null,
        eventCount: 0,
        incidents: {},
        day: '',
        sent: 0,
        suppressed: 0,
        duplicates: 0,
      };
      if (state.lastSubmission && now - state.lastSubmission.submittedAt >= SEVEN_DAYS) delete state.lastSubmission;
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
        if (typeof id !== 'string') throw new Error('Invalid stored expiry');
        await tx.delete([key, `event:${id}`]);
        state.eventCount--;
      }
      const putEvent = async (id: string, event: EventRecord) => {
        await tx.put(`event:${id}`, event);
        await tx.put(`expiry:${String(now).padStart(16, '0')}:${id}`, id);
        state.eventCount++;
      };
      const claims: Claim[] = [];
      const persist = async (value: ResultValue, status = 200) => {
        await tx.put('monitor', state);
        return { value, status, claims };
      };
      const eventKey = payload ? `e:${payload.eventId}` : null;
      const existing = eventKey ? decodeEvent(await tx.get(`event:${eventKey}`)) : null;
      if (existing) {
        if (existing.digest !== digest) return persist({ error: 'event_id_conflict' }, 409);
        state.duplicates++;
        return persist({
          state: existing.state === 'claimed' ? 'unknown' : existing.state,
          ...(existing.state === 'submitted' ? { messageId: existing.messageId } : {}),
        });
      }
      if (eventKey && state.eventCount >= MAX_EVENTS - 32) return persist({ error: 'dedup_capacity' }, 429);
      const claim = async (id: string, details: Details): Promise<EventState> => {
        const previous = decodeEvent(await tx.get(`event:${id}`));
        if (previous) return previous.state;
        const record: EventRecord = {
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
        component: Component | 'watchdog',
        problem: boolean,
        incidentId: string,
        count: number,
        severity: Alert['severity'],
        id: string,
        evidence: Signal['status'] = problem ? 'problem' : 'ok',
      ): Promise<EventState> => {
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
          lastSubmission: state.lastSubmission ?? null,
        });
      if (path === '/v1/heartbeat' && payload && 'signals' in payload && eventKey) {
        if (state.heartbeat && payload.timestamp <= state.heartbeat.timestamp)
          return persist({ error: 'out_of_order_heartbeat' }, 409);
        state.heartbeat = { timestamp: payload.timestamp, signals: payload.signals };
        await putEvent(eventKey, { at: now, digest, state: 'recorded' });
        return persist({ state: 'recorded' });
      }
      if (path === '/v1/alerts' && payload && 'component' in payload && eventKey) {
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
      let outcome: { state: 'unknown' } | { state: 'submitted'; messageId: string } = { state: 'unknown' };
      try {
        const sent = await this.env.ALERT_EMAIL.send({
          from: { email: 'insignia-alerts@optidigi.nl', name: 'Insignia Alerts' },
          to: 'admin@optidigi.nl',
          subject: `[Insignia production] ${details.component} ${details.event}`,
          text: `Automated operational notice.\nComponent: ${details.component}\nEvent: ${details.event}\nIncident: ${details.incidentId}\nEvidence: ${details.evidence}\nSeverity: ${details.severity}\nAggregate count: ${details.count}\nObserved at: ${new Date(now).toISOString()}\nThis notice does not establish application or merchant readiness.`,
        });
        if (
          isRecord(sent) &&
          typeof sent.messageId === 'string' &&
          sent.messageId.trim().length > 0 &&
          sent.messageId.length <= 256
        )
          outcome = { state: 'submitted', messageId: sent.messageId };
      } catch {
        /* A thrown send can have an unresolved effect. Never automatically redispatch. */
      }
      await this.storage.transaction(async (tx) => {
        const record = decodeEvent(await tx.get(`event:${id}`));
        if (!record) throw new Error('Claim missing');
        Object.assign(record, outcome);
        await tx.put(`event:${id}`, record);
        if (outcome.state === 'submitted') {
          const state = decodeState(await tx.get('monitor'));
          if (!state) throw new Error('Monitor missing');
          state.lastSubmission = { messageId: outcome.messageId, submittedAt: this.clock() };
          await tx.put('monitor', state);
        }
      });
    }
    if (result.claims.length && payload) {
      const record = decodeEvent(await this.storage.get(`event:e:${payload.eventId}`));
      if (!record) throw new Error('Event missing');
      result.value.state = record.state;
      if (record.state === 'submitted') result.value.messageId = record.messageId;
    }
    return json(result.value, result.status);
  }
}
