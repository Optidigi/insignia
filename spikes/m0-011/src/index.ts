import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAppEvent, classifyAppEventResponse } from '../../m0-010/src/app-events.ts';
import { PARTNER_ACTIVE_QUERY, PARTNER_HISTORY_QUERY, parseActiveSubscription, parseHistoryPage,
  type ActiveRead, type HistoricalStatusEvent } from '../../m0-010/src/partner.ts';
import type { AppEvent } from '../../m0-010/src/index.ts';
import { canonicalInstant } from '../../m0-010/src/time.ts';

const PARTNER_ORIGIN = 'https://partners.shopify.com';
const EVENT_URL = 'https://api.shopify.com/app/2026-07/events';
const DESIGNATED_SHOP_ID = 'gid://shopify/Shop/78935261342';
const RUN_JOURNAL_PATH = fileURLToPath(new URL('../.local-run/journal.json', import.meta.url));
const MAX_BODY = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const MAX_ATTEMPTS = 6;
const MAX_UNIQUE_EVENTS = 3;

type Token = string | { value: string; expiresAt: string };
export interface Credentials {
  partner(): Promise<Token>;
  appEvents(): Promise<Token>;
}
export interface BasePorts {
  appId: string;
  shopId: string;
  credentials: Credentials;
  fetch: typeof fetch;
  now: () => string;
  timeoutMs?: number;
}
export type AdapterResult = { kind: 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'UNAVAILABLE' |
  'UNSAFE_REDIRECT' | 'OVERSIZE_RESPONSE' | 'TIMEOUT' | 'MISMATCH' };
function validId(id: string, type: string): boolean {
  return new RegExp(`^gid://shopify/${type}/[1-9]\\d*$`).test(id);
}
function instant(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)) return null;
  const n = Date.parse(s);
  return Number.isFinite(n) && new Date(n).toISOString() === s ? n : null;
}
function tokenValue(value: Token, now: number): string | null {
  if (typeof value === 'string') return /^[^\s]{1,8192}$/.test(value) ? value : null;
  const expiry = instant(value?.expiresAt);
  return typeof value?.value === 'string' && /^[^\s]{1,8192}$/.test(value.value) &&
    expiry !== null && expiry > now + 30_000 ? value.value : null;
}
function validTimeout(value: number | undefined): boolean {
  return value === undefined || Number.isSafeInteger(value) && value >= 1 && value <= REQUEST_TIMEOUT_MS;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function zero(value: unknown): boolean { return typeof value === 'string' && /^0(?:\.0{1,9})?$/.test(value); }

async function boundedFetch(fetcher: typeof fetch, url: string, init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS): Promise<
  | { kind: 'HTTP'; status: number; body: unknown; headers: Headers }
  | AdapterResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (response.redirected || response.status >= 300 && response.status <= 399 ||
      response.url && response.url !== url)
      return { kind: 'UNSAFE_REDIRECT' };
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > MAX_BODY) return { kind: 'OVERSIZE_RESPONSE' };
    const reader = response.body?.getReader();
    if (!reader) return { kind: 'HTTP', status: response.status, body: null, headers: response.headers };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > MAX_BODY) { void reader.cancel(); return { kind: 'OVERSIZE_RESPONSE' }; }
      chunks.push(next.value);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) as unknown : null; } catch { /* Invalid JSON is rejected by parser. */ }
    return { kind: 'HTTP', status: response.status, body, headers: response.headers };
  } catch {
    return { kind: controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE' };
  } finally { clearTimeout(timeout); }
}

/** Fixed client-credentials exchange for a Dev Dashboard App Events API key. */
export class AppEventsTokenClient {
  private readonly ports: { clientId: string; clientSecret: string; fetch: typeof fetch;
    now: () => string; timeoutMs?: number };
  constructor(ports: { clientId: string; clientSecret: string; fetch: typeof fetch;
    now: () => string; timeoutMs?: number }) {
    if (!ports.clientId || !ports.clientSecret || ports.clientId.length > 512 ||
      ports.clientSecret.length > 4096 || !validTimeout(ports.timeoutMs))
      throw new Error('Invalid App Events credential configuration');
    this.ports = ports;
  }
  async getToken(): Promise<{ value: string; expiresAt: string } | null> {
    const now = instant(this.ports.now());
    if (now === null) return null;
    const body = JSON.stringify({ client_id: this.ports.clientId,
      client_secret: this.ports.clientSecret, grant_type: 'client_credentials' });
    if (Buffer.byteLength(body) > 8192) return null;
    const result = await boundedFetch(this.ports.fetch,
      'https://api.shopify.com/auth/access_token',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      this.ports.timeoutMs);
    if (result.kind !== 'HTTP' || result.status !== 200) return null;
    const data = object(result.body);
    if (!data || typeof data.access_token !== 'string' ||
      !/^[^\s]{1,8192}$/.test(data.access_token) ||
      typeof data.scope !== 'string' ||
      !data.scope.split(/\s+/).includes('write_global_api_app_events') ||
      !Number.isSafeInteger(data.expires_in) || Number(data.expires_in) < 31 ||
      Number(data.expires_in) > 3600) return null;
    return { value: data.access_token, expiresAt: new Date(now + Number(data.expires_in) * 1000).toISOString() };
  }
}

export type HistoryResult =
  | { kind: 'COMPLETE_PAGES'; events: HistoricalStatusEvent[]; from: string; through: string }
  | { kind: 'INCOMPLETE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'MISMATCH' |
      'UNSAFE_REDIRECT' | 'OVERSIZE_RESPONSE' | 'TIMEOUT' };

/** Read-only, exact-identity Partner API adapter. It never accepts caller-supplied GraphQL. */
export class PartnerClient {
  private readonly ports: BasePorts & { organizationId: string };
  constructor(ports: BasePorts & { organizationId: string }) {
    if (!validId(ports.appId, 'App') || !validId(ports.shopId, 'Shop') ||
      ports.shopId !== DESIGNATED_SHOP_ID ||
      !/^[1-9]\d{0,19}$/.test(ports.organizationId) || ports.appId.length > 128 ||
      ports.shopId.length > 128 || !validTimeout(ports.timeoutMs)) throw new Error('Invalid Partner configuration');
    this.ports = ports;
  }
  private async query(query: string, variables: Record<string, unknown>): Promise<
    | { kind: 'HTTP'; status: number; body: unknown }
    | AdapterResult> {
    let credential: Token;
    try { credential = await this.ports.credentials.partner(); } catch { return { kind: 'AUTH_REQUIRED' }; }
    const token = tokenValue(credential, Date.parse(this.ports.now()));
    if (!token) return { kind: 'AUTH_REQUIRED' };
    const body = JSON.stringify({ query, variables });
    if (Buffer.byteLength(body) > 16 * 1024) return { kind: 'UNAVAILABLE' };
    const url = `${PARTNER_ORIGIN}/${this.ports.organizationId}/api/2026-07/graphql.json`;
    return boundedFetch(this.ports.fetch, url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body },
      this.ports.timeoutMs);
  }
  async readActive(shopId: string): Promise<ActiveRead | AdapterResult> {
    if (shopId !== this.ports.shopId) return { kind: 'MISMATCH' };
    const result = await this.query(PARTNER_ACTIVE_QUERY, { appId: this.ports.appId, shopId });
    if (result.kind !== 'HTTP') return result;
    return parseActiveSubscription(result.status, result.body,
      { appId: this.ports.appId, shopId, observedAt: this.ports.now() });
  }
  /** Fresh raw envelope for the narrow no-charge guard; never grants historical coverage. */
  async readLiveEnvelope(shopId: string): Promise<
    | { kind: 'ACTIVE_ENVELOPE'; body: unknown; observedAt: string }
    | ActiveRead | AdapterResult> {
    if (shopId !== this.ports.shopId) return { kind: 'MISMATCH' };
    const result = await this.query(PARTNER_ACTIVE_QUERY, { appId: this.ports.appId, shopId });
    if (result.kind !== 'HTTP') return result;
    const observedAt = this.ports.now();
    const parsed = parseActiveSubscription(result.status, result.body,
      { appId: this.ports.appId, shopId, observedAt });
    if (parsed.kind !== 'ACTIVE') return parsed;
    return { kind: 'ACTIVE_ENVELOPE', body: result.body, observedAt };
  }
  async readHistory(shopId: string, from: string, through: string): Promise<HistoryResult> {
    const start = instant(from), end = instant(through);
    if (shopId !== this.ports.shopId) return { kind: 'MISMATCH' };
    if (start === null || end === null || end < start || end - start > 365 * 86_400_000 ||
      end > (instant(this.ports.now()) ?? -Infinity)) return { kind: 'INCOMPLETE' };
    let after: string | null = null;
    const cursors = new Set<string>();
    const ids = new Set<string>();
    const events: HistoricalStatusEvent[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.query(PARTNER_HISTORY_QUERY,
        { appId: this.ports.appId, shopId, from, through, after });
      if (result.kind !== 'HTTP') return result;
      const parsed = parseHistoryPage(result.status, result.body,
        { appId: this.ports.appId, shopId, observedAt: this.ports.now(), from, through });
      if (parsed.kind !== 'PAGE') return { kind: parsed.kind };
      for (const event of parsed.events) {
        if (ids.has(event.id) || Date.parse(event.occurredAt) < start || Date.parse(event.occurredAt) > end)
          return { kind: 'INCOMPLETE' };
        ids.add(event.id); events.push(event);
      }
      if (!parsed.hasNextPage) return { kind: 'COMPLETE_PAGES', events, from, through };
      if (!parsed.endCursor || cursors.has(parsed.endCursor)) return { kind: 'INCOMPLETE' };
      cursors.add(parsed.endCursor); after = parsed.endCursor;
    }
    return { kind: 'INCOMPLETE' };
  }
}

export interface LiveManifest {
  mode: 'LIVE_ZERO_PRICE_TEST'; appId: string; shopId: string; meterHandle: 'customized_order_paid';
  planHandle: string; runId: string; approvedAt: string; observedAt: string;
  cycleFrom: string; cycleUntil: string; zeroPrice: true;
  appGidVerified: true; meterVerified: true; installationVerified: true;
}
interface JournalState { version: 1; runId: string; attempts: number;
  events: Record<string, { body: string; hash: string; attempts: number }> }
export class FileRunJournal {
  readonly path: string;
  constructor(path: string = RUN_JOURNAL_PATH) { this.path = path; }
  /** Reserve an attempt and fsync before the provider call. A held lock refuses concurrent sends. */
  async reserve(runId: string, key: string, body: string,
    nowMs: number): Promise<'RESERVED' | 'LIMIT' | 'CONFLICT' | 'STALE_NEW'> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = await open(`${this.path}.lock`, 'wx', 0o600).catch(() => null);
    if (!lock) return 'CONFLICT';
    try {
      let state: JournalState;
      try { state = JSON.parse(await readFile(this.path, 'utf8')) as JournalState; }
      catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
          state = { version: 1, runId, attempts: 0, events: {} };
        else return 'CONFLICT';
      }
      if (state.version !== 1 || state.runId !== runId || !Number.isSafeInteger(state.attempts) ||
        state.attempts < 0 || state.attempts > MAX_ATTEMPTS ||
        typeof state.events !== 'object' || !state.events || Array.isArray(state.events) ||
        Object.keys(state.events).length > MAX_UNIQUE_EVENTS ||
        Object.entries(state.events).some(([storedKey, row]) =>
          !/^[0-9a-f]{1,64}$/.test(storedKey) || typeof row?.body !== 'string' ||
          row.hash !== createHash('sha256').update(row.body).digest('hex') ||
          !Number.isSafeInteger(row.attempts) || row.attempts < 1) ||
        Object.values(state.events).reduce((sum, row) => sum + row.attempts, 0) !== state.attempts)
        return 'CONFLICT';
      const previous = state.events[key];
      const hash = createHash('sha256').update(body).digest('hex');
      if (previous && (previous.body !== body || previous.hash !== hash ||
        !Number.isSafeInteger(previous.attempts) || previous.attempts < 1)) return 'CONFLICT';
      if (!previous) {
        let parsed: Record<string, unknown> | null = null;
        try { parsed = object(JSON.parse(body) as unknown); } catch { /* Fail closed. */ }
        if (!parsed || parsed.idempotency_key !== key) return 'CONFLICT';
        try {
          if (encodeAppEvent(parsed as unknown as AppEvent).body !== body) return 'CONFLICT';
        } catch { return 'CONFLICT'; }
        const occurred = instant(parsed?.timestamp);
        if (!Number.isSafeInteger(nowMs) || occurred === null ||
          occurred > nowMs || nowMs - occurred > 60_000) return 'STALE_NEW';
      }
      if (state.attempts >= MAX_ATTEMPTS || (!previous && Object.keys(state.events).length >= MAX_UNIQUE_EVENTS)) return 'LIMIT';
      state.events[key] = { body, hash, attempts: (previous?.attempts ?? 0) + 1 };
      state.attempts++;
      const temp = `${this.path}.${randomUUID()}.tmp`;
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temp, this.path);
      const dir = await open(dirname(this.path), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
      return 'RESERVED';
    } finally { await lock.close(); await rm(`${this.path}.lock`, { force: true }); }
  }
}
export type EventSendResult =
  | { kind: 'DRY_RUN' | 'GUARD_REJECTED' | 'ATTEMPT_LIMIT' | 'JOURNAL_CONFLICT' |
      'AUTH_ERROR' | 'VALIDATION_ERROR' | 'CONFLICT' | 'RATE_LIMITED' | 'SERVER_ERROR' |
      'UNKNOWN_RESPONSE' | 'UNSUPPORTED_ENDPOINT' | 'TIMEOUT' | 'UNAVAILABLE' |
      'UNSAFE_REDIRECT' | 'OVERSIZE_RESPONSE'; status?: number }
  | { kind: 'RECEIVED'; status: 202; replay: boolean | null; requestId: string | null }
  | { kind: 'RATE_LIMITED'; status: 429; retryAfterMs: number };

/** Test transport only. A provider receipt does not mean billing processing succeeded. */
export class AppEventsClient {
  private readonly ports: BasePorts & { manifest?: LiveManifest; partner?: PartnerClient; journal?: FileRunJournal };
  constructor(ports: BasePorts & { manifest?: LiveManifest; partner?: PartnerClient; journal?: FileRunJournal }) {
    if (!validId(ports.appId, 'App') || !validId(ports.shopId, 'Shop') ||
      ports.shopId !== DESIGNATED_SHOP_ID ||
      ports.appId.length > 128 || ports.shopId.length > 128 || !validTimeout(ports.timeoutMs)) throw new Error('Invalid App Events configuration');
    // One fixed journal limits normal-run attempts while it remains intact. Temporary journals are
    // usable only by Node's isolated synthetic test runner.
    if (ports.manifest && ports.journal && ports.journal.path !== RUN_JOURNAL_PATH &&
      process.env.NODE_TEST_CONTEXT !== 'child-v8') throw new Error('Noncanonical live journal');
    this.ports = ports;
  }
  private allowed(event: AppEvent, activeResponse: unknown, observedAt: string): boolean {
    const p = this.ports, m = p.manifest;
    const now = instant(p.now());
    if (!m || !p.journal || !p.partner || !now || m.mode !== 'LIVE_ZERO_PRICE_TEST' ||
      m.appId !== p.appId || m.shopId !== p.shopId || m.shopId !== event.shop_id ||
      m.meterHandle !== event.event_handle || m.meterHandle !== 'customized_order_paid' ||
      m.planHandle === m.meterHandle ||
      m.zeroPrice !== true || m.appGidVerified !== true ||
      m.meterVerified !== true || m.installationVerified !== true ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(m.runId) || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.planHandle)) return false;
    const observed = instant(observedAt), approved = instant(m.approvedAt);
    const from = instant(m.cycleFrom), until = instant(m.cycleUntil), at = instant(event.timestamp);
    const baseline = instant(m.observedAt);
    if (baseline === null || observed === null || observed < baseline || approved === null || from === null || until === null || at === null ||
      observed > now || now - observed > 60_000 || now - baseline > 600_000 || approved > now ||
      from > now || now >= until || at < from || at >= until || at > now + 300_000) return false;
    const subscription = object(object(activeResponse)?.data)?.activeSubscription;
    const active = object(subscription), app = object(active?.app), shop = object(active?.shop);
    const cycle = object(active?.currentBillingCycle);
    if (!active || 'errors' in (object(activeResponse) ?? {}) ||
      app?.id !== p.appId || shop?.id !== p.shopId ||
      active.billingPeriod !== 'EVERY_30_DAYS' || active.cancelAtEndOfCycle !== false ||
      active.trialEndsAt !== null || active.pendingUpdate !== null ||
      canonicalInstant(cycle?.startTime) !== m.cycleFrom ||
      canonicalInstant(cycle?.endTime) !== m.cycleUntil ||
      !Array.isArray(active.items) || active.items.length !== 2) return false;
    const items = active.items.map(object);
    const flats = items.filter(item => item?.handle === m.planHandle &&
      object(item.price)?.__typename === 'FlatRatePrice');
    const meters = items.filter(item => item?.handle === m.meterHandle &&
      object(item.price)?.__typename === 'TieredPrice');
    if (flats.length !== 1 || meters.length !== 1) return false;
    const flat = flats[0], meter = meters[0];
    const flatPrice = object(flat?.price), meterPrice = object(meter?.price);
    if (flat?.handle !== m.planHandle || flatPrice?.__typename !== 'FlatRatePrice' ||
      flatPrice.active !== true || !zero(flatPrice.amount) ||
      meter?.handle !== m.meterHandle || meterPrice?.__typename !== 'TieredPrice' ||
      meterPrice.active !== true || meterPrice.tiersMode !== 'GRADUATED' ||
      flatPrice.currency !== meterPrice.currency || typeof flatPrice.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(flatPrice.currency) || !Array.isArray(meterPrice.tiers) ||
      meterPrice.tiers.length !== 2) return false;
    const usage = object(meter?.usage), usageCost = object(usage?.cost);
    if (!usage || !Number.isSafeInteger(usage.quantity) || Number(usage.quantity) < 0 ||
      !usageCost || !zero(usageCost.amount) || usageCost.currencyCode !== flatPrice.currency)
      return false;
    const [first, second] = meterPrice.tiers.map(object);
    return !!first && !!second && Number.isSafeInteger(first.upTo) && Number(first.upTo) >= 1 &&
      second.upTo === null && [first.amount, first.amountPerUnit, second.amount,
        second.amountPerUnit].every(zero);
  }
  private staticAllowed(event: AppEvent): boolean {
    const p = this.ports, m = p.manifest;
    return !!m && !!p.partner && !!p.journal && m.mode === 'LIVE_ZERO_PRICE_TEST' &&
      m.appId === p.appId && m.shopId === p.shopId && event.shop_id === p.shopId &&
      event.event_handle === 'customized_order_paid' && m.meterHandle === event.event_handle &&
      m.zeroPrice === true && m.appGidVerified === true &&
      m.meterVerified === true && m.installationVerified === true;
  }
  async send(event: AppEvent): Promise<EventSendResult> {
    if (!this.ports.manifest) return { kind: 'DRY_RUN' };
    let body: string;
    try {
      const encoded = encodeAppEvent(event);
      if (encoded.url !== EVENT_URL || encoded.method !== 'POST') return { kind: 'GUARD_REJECTED' };
      body = encoded.body;
    } catch { return { kind: 'GUARD_REJECTED' }; }
    if (Buffer.byteLength(body) > 4096 || !this.staticAllowed(event)) return { kind: 'GUARD_REJECTED' };
    const observation = await this.ports.partner!.readLiveEnvelope(event.shop_id);
    if (observation.kind !== 'ACTIVE_ENVELOPE' ||
      !this.allowed(event, observation.body, observation.observedAt))
      return { kind: 'GUARD_REJECTED' };
    let credential: Token;
    try { credential = await this.ports.credentials.appEvents(); } catch { return { kind: 'AUTH_ERROR' }; }
    const token = tokenValue(credential, Date.parse(this.ports.now()));
    if (!token) return { kind: 'AUTH_ERROR' };
    const reserved = await this.ports.journal!.reserve(this.ports.manifest.runId,
      event.idempotency_key, body, Date.parse(this.ports.now()))
      .catch(() => 'CONFLICT' as const);
    if (reserved !== 'RESERVED') return { kind: reserved === 'LIMIT' ? 'ATTEMPT_LIMIT' :
      reserved === 'STALE_NEW' ? 'GUARD_REJECTED' : 'JOURNAL_CONFLICT' };
    // The file fsync can delay a send. Re-read the effective contract after it,
    // and refuse a stale token or an observation that ages before the POST.
    const finalObservation = await this.ports.partner!.readLiveEnvelope(event.shop_id);
    if (finalObservation.kind !== 'ACTIVE_ENVELOPE' ||
      !this.allowed(event, finalObservation.body, finalObservation.observedAt) ||
      !tokenValue(credential, Date.parse(this.ports.now()))) return { kind: 'GUARD_REJECTED' };
    const result = await boundedFetch(this.ports.fetch, EVENT_URL, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body },
      this.ports.timeoutMs);
    if (result.kind !== 'HTTP') return { kind: result.kind === 'AUTH_REQUIRED' ? 'AUTH_ERROR' :
      result.kind === 'MISMATCH' ? 'GUARD_REJECTED' : result.kind };
    if (result.status === 404 || result.status === 410)
      return { kind: 'UNSUPPORTED_ENDPOINT', status: result.status };
    const classified = classifyAppEventResponse(result.status, result.body,
      result.headers.get('Retry-After') ?? undefined, Date.parse(this.ports.now()));
    if (classified.kind === 'RATE_LIMITED')
      return classified.retryAfterMs === undefined ? { kind: 'RATE_LIMITED', status: 429 } :
        { kind: 'RATE_LIMITED', status: 429, retryAfterMs: classified.retryAfterMs };
    if (classified.kind === 'RECEIVED') {
      const replayHeader = result.headers.get('Idempotent-Replay');
      const rawRequestId = result.headers.get('X-Request-ID');
      const requestId = rawRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(rawRequestId)
        ? rawRequestId : null;
      return { kind: 'RECEIVED', status: 202,
        replay: replayHeader === 'true' ? true : replayHeader === 'false' ? false : null,
        requestId };
    }
    return { kind: classified.kind, status: result.status };
  }
}
