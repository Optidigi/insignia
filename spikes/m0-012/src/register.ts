import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MAX_EVENTS = 3;
const MAX_ACQUISITIONS = 6;
const MAX_POSTS = 6;
const SHOP = 'gid://shopify/Shop/105501393179';
const METER = 'customized_order_paid';
const ENDPOINT = 'https://api.shopify.com/app/2026-07/events';

type Outcome = { kind: 'HTTP'; status: number; responseSuccess?: boolean | null;
  replay?: boolean | null; requestId?: string | null } | { kind: 'TOKEN_REJECTED' } |
  { kind: 'GUARD_REJECTED' | 'USE_DEADLINE' | 'TIMEOUT' | 'UNAVAILABLE' |
    'UNSAFE_REDIRECT' | 'OVERSIZE_RESPONSE'; status?: number };
type Attempt = { ordinal: number; state: 'RESERVED' | 'MAY_HAVE_SENT' | 'DONE';
  mayHaveSent: boolean;
  outcome?: Outcome };
export type BillingObservation = { kind: 'PROCESSED' | 'REPLAY_NO_DELTA';
  observedAt: string; logReference: string | null; meterQuantity: number;
  meterCost: string };
type Event = { body: string; sha256: string; timestamp: string; attempts: Attempt[];
  billingObservations: BillingObservation[] };
export type RegisterState = { version: 1; runId: string; endpoint: string;
  sourceHash: string; createdAt: string; tokenReservations: number;
  postReservations: number; events: Record<string, Event> };
type Result = { kind: 'CONFLICT' | 'LIMIT' | 'REGISTERED' | 'EXISTING' | 'MARKED' |
  'RECORDED' | 'INITIALIZED' } | { kind: 'RESERVED'; ordinal: number };
type Inspection = { kind: 'CONFLICT' } | { kind: 'READY'; state: RegisterState };

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function eventIdentity(body: string): { key: string; timestamp: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const data = object(parsed), attributes = object(data?.attributes);
  if (!data || Object.keys(data).sort().join(',') !==
      'attributes,event_handle,idempotency_key,shop_id,timestamp' ||
      data.shop_id !== SHOP || data.event_handle !== METER ||
      typeof data.idempotency_key !== 'string' ||
      !/^[a-f0-9]{1,64}$/.test(data.idempotency_key) ||
      typeof data.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(data.timestamp)) ||
      !attributes || Object.keys(attributes).length !== 1 || attributes.value !== 1 ||
      Buffer.byteLength(body) > 4096) return null;
  return { key: data.idempotency_key, timestamp: data.timestamp };
}
function validState(value: unknown): value is RegisterState {
  const s = object(value), events = object(s?.events);
  if (!s || s.version !== 1 || typeof s.runId !== 'string' || !s.runId ||
      s.endpoint !== ENDPOINT || typeof s.sourceHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(s.sourceHash) || typeof s.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(s.createdAt)) || !events ||
      !Number.isSafeInteger(s.tokenReservations) || Number(s.tokenReservations) > MAX_ACQUISITIONS ||
      !Number.isSafeInteger(s.postReservations) || Number(s.postReservations) > MAX_POSTS ||
      Number(s.tokenReservations) < 0 || Number(s.postReservations) < 0 ||
      Object.keys(events).length > MAX_EVENTS) return false;
  let tokenCount = 0, postCount = 0;
  const ordinals = new Set<number>();
  for (const [key, raw] of Object.entries(events)) {
    const event = object(raw);
      if (!event || typeof event.body !== 'string' || typeof event.sha256 !== 'string' ||
        digest(event.body) !== event.sha256 || eventIdentity(event.body)?.key !== key ||
        typeof event.timestamp !== 'string' ||
        eventIdentity(event.body)?.timestamp !== event.timestamp ||
        !Array.isArray(event.attempts) || !Array.isArray(event.billingObservations) ||
        event.billingObservations.length > 2) return false;
    for (const attemptRaw of event.attempts) {
      const attempt = object(attemptRaw);
      if (!attempt || !Number.isSafeInteger(attempt.ordinal) ||
          Number(attempt.ordinal) < 1 || Number(attempt.ordinal) > MAX_ACQUISITIONS ||
          ordinals.has(Number(attempt.ordinal)) || typeof attempt.mayHaveSent !== 'boolean' ||
          !['RESERVED', 'MAY_HAVE_SENT', 'DONE'].includes(String(attempt.state))) return false;
      ordinals.add(Number(attempt.ordinal));
      tokenCount++;
      if (attempt.mayHaveSent) postCount++;
      if (attempt.state === 'MAY_HAVE_SENT' && !attempt.mayHaveSent ||
          attempt.state === 'RESERVED' && attempt.mayHaveSent) return false;
      if (attempt.state === 'DONE' && !object(attempt.outcome)) return false;
    }
    for (const observationRaw of event.billingObservations) {
      const observation = object(observationRaw);
      if (!observation || !['PROCESSED', 'REPLAY_NO_DELTA'].includes(String(observation.kind)) ||
          typeof observation.observedAt !== 'string' ||
          !Number.isFinite(Date.parse(observation.observedAt)) ||
          !Number.isSafeInteger(observation.meterQuantity) ||
          Number(observation.meterQuantity) < 0 || observation.meterCost !== '0.0' ||
          !(observation.logReference === null ||
            typeof observation.logReference === 'string' && observation.logReference.length <= 500))
        return false;
    }
  }
  return tokenCount === s.tokenReservations && postCount === s.postReservations &&
    Array.from({ length: tokenCount }, (_unused, i) => i + 1).every(n => ordinals.has(n));
}

/** One fixed, private, operator-owned path. A retained locator prevents budget reset. */
export class RunRegister {
  private readonly active = new Set<string>();
  private readonly root: string;
  private readonly receiptPath: string;
  constructor(root: string, receiptPath = `${root}.receipt.json`) {
    this.root = root; this.receiptPath = receiptPath;
  }
  private locator() { return join(this.root, 'locator.json'); }
  private statePath() { return join(this.root, 'register.json'); }
  private async locked<T>(work: () => Promise<T>): Promise<T | { kind: 'CONFLICT' }> {
    try { await mkdir(this.root, { recursive: true, mode: 0o700 }); }
    catch { return { kind: 'CONFLICT' }; }
    let lock;
    try { lock = await open(join(this.root, 'register.lock'), 'wx', 0o600); }
    catch { return { kind: 'CONFLICT' }; }
    try { return await work(); }
    catch { return { kind: 'CONFLICT' }; }
    finally { await lock.close(); await unlink(join(this.root, 'register.lock')); }
  }
  private async read(): Promise<RegisterState | null> {
    const receipt = object(JSON.parse(await readFile(this.receiptPath, 'utf8')));
    const locator = object(JSON.parse(await readFile(this.locator(), 'utf8')));
    const state: unknown = JSON.parse(await readFile(this.statePath(), 'utf8'));
    if (!receipt || !locator || !validState(state) ||
        receipt.runId !== state.runId || receipt.endpoint !== state.endpoint ||
        receipt.sourceHash !== state.sourceHash || receipt.createdAt !== state.createdAt ||
        locator.runId !== state.runId ||
        locator.endpoint !== state.endpoint || locator.sourceHash !== state.sourceHash ||
        locator.createdAt !== state.createdAt) return null;
    return state;
  }
  private async durable(path: string, content: string): Promise<void> {
    const temp = `${path}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, path);
    const dir = await open(dirname(path), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
  async initialize(meta: Omit<RegisterState, 'version' | 'tokenReservations' |
    'postReservations' | 'events'>): Promise<Result> {
    return this.locked(async () => {
      if (meta.endpoint !== ENDPOINT || !meta.runId ||
          !/^[a-f0-9]{64}$/.test(meta.sourceHash) ||
          !Number.isFinite(Date.parse(meta.createdAt))) return { kind: 'CONFLICT' };
      // Even a partial prior initialization must never silently reset the run.
      for (const path of [this.receiptPath, this.locator(), this.statePath()]) {
        try { await readFile(path); return { kind: 'CONFLICT' }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          return { kind: 'CONFLICT' }; }
      }
      const state: RegisterState = { version: 1, ...meta, tokenReservations: 0,
        postReservations: 0, events: {} };
      // Separate operator-held receipt is written first. Losing the run directory
      // cannot create a fresh budget while the independent receipt remains.
      await this.durable(this.receiptPath, JSON.stringify(meta));
      await this.durable(this.locator(), JSON.stringify(meta));
      await this.durable(this.statePath(), JSON.stringify(state));
      return { kind: 'INITIALIZED' };
    });
  }
  async inspect(): Promise<Inspection> {
    return this.locked(async () => {
      const state = await this.read();
      return state ? { kind: 'READY', state } : { kind: 'CONFLICT' };
    });
  }
  async registerEvent(body: string): Promise<Result> {
    return this.locked(async () => {
      const state = await this.read(), identity = eventIdentity(body);
      if (!state || !identity) return { kind: 'CONFLICT' };
      const current = state.events[identity.key];
      if (current) return { kind: current.body === body ? 'EXISTING' : 'CONFLICT' };
      if (Object.keys(state.events).length >= MAX_EVENTS) return { kind: 'LIMIT' };
      state.events[identity.key] = { body, sha256: digest(body),
        timestamp: identity.timestamp, attempts: [], billingObservations: [] };
      await this.durable(this.statePath(), JSON.stringify(state));
      return { kind: 'REGISTERED' };
    });
  }
  async reserveAcquisition(key: string, body: string): Promise<Result> {
    return this.locked(async () => {
      const state = await this.read();
      if (!state || state.events[key]?.body !== body ||
          Object.values(state.events).some(e => e.attempts.some(a => a.state !== 'DONE')))
        return { kind: 'CONFLICT' };
      if (state.tokenReservations >= MAX_ACQUISITIONS ||
          state.postReservations >= MAX_POSTS) return { kind: 'LIMIT' };
      const ordinal = ++state.tokenReservations;
      state.events[key]!.attempts.push({ ordinal, state: 'RESERVED', mayHaveSent: false });
      await this.durable(this.statePath(), JSON.stringify(state));
      return { kind: 'RESERVED', ordinal };
    });
  }
  async markMayDispatch(key: string, ordinal: number): Promise<Result> {
    return this.locked(async () => {
      const state = await this.read();
      const attempt = state?.events[key]?.attempts.find(a => a.ordinal === ordinal);
      if (!state || !attempt || attempt.state !== 'RESERVED') return { kind: 'CONFLICT' };
      if (state.postReservations >= MAX_POSTS) return { kind: 'LIMIT' };
      attempt.state = 'MAY_HAVE_SENT'; attempt.mayHaveSent = true;
      state.postReservations++;
      await this.durable(this.statePath(), JSON.stringify(state));
      this.active.add(`${key}:${ordinal}`);
      return { kind: 'MARKED' };
    });
  }
  async recordOutcome(key: string, ordinal: number, outcome: Outcome): Promise<Result> {
    return this.locked(async () => {
      const state = await this.read();
      const attempt = state?.events[key]?.attempts.find(a => a.ordinal === ordinal);
      if (!state || !attempt || attempt.state === 'DONE' ||
          (attempt.state === 'MAY_HAVE_SENT' && !this.active.has(`${key}:${ordinal}`)) ||
          (attempt.state === 'RESERVED' && outcome.kind === 'HTTP') ||
          (attempt.state === 'MAY_HAVE_SENT' && outcome.kind !== 'HTTP' &&
            outcome.kind !== 'TIMEOUT' && outcome.kind !== 'UNAVAILABLE' &&
            outcome.kind !== 'UNSAFE_REDIRECT' && outcome.kind !== 'OVERSIZE_RESPONSE'))
        return { kind: 'CONFLICT' };
      attempt.state = 'DONE'; attempt.outcome = outcome;
      await this.durable(this.statePath(), JSON.stringify(state));
      this.active.delete(`${key}:${ordinal}`);
      return { kind: 'RECORDED' };
    });
  }

  /** Human-reviewed native billing-log evidence, paired with a fresh meter read. */
  async recordBillingObservation(key: string, observation: BillingObservation): Promise<Result> {
    return this.locked(async () => {
      const state = await this.read(), event = state?.events[key];
      if (!state || !event || !Number.isFinite(Date.parse(observation.observedAt)) ||
          !Number.isSafeInteger(observation.meterQuantity) ||
          observation.meterQuantity < 0 || observation.meterCost !== '0.0' ||
          event.billingObservations.some(x => x.kind === observation.kind) ||
          event.billingObservations.length >= 2) return { kind: 'CONFLICT' };
      const accepted = event.attempts.filter(a => a.state === 'DONE' &&
        a.outcome?.kind === 'HTTP' && a.outcome.status === 202 &&
        a.outcome.responseSuccess === true);
      if (observation.kind === 'PROCESSED') {
        if (accepted.length < 1 || !observation.logReference ||
            !observation.logReference.startsWith(
              'https://dev.shopify.com/dashboard/200969036/apps/429028933633/logs') ||
            observation.logReference.length > 500)
          return { kind: 'CONFLICT' };
      } else if (observation.kind === 'REPLAY_NO_DELTA') {
        if (accepted.length !== 2 || !event.billingObservations.some(x => x.kind === 'PROCESSED') ||
            observation.logReference !== null) return { kind: 'CONFLICT' };
      } else return { kind: 'CONFLICT' };
      event.billingObservations.push(observation);
      await this.durable(this.statePath(), JSON.stringify(state));
      return { kind: 'RECORDED' };
    });
  }
}
