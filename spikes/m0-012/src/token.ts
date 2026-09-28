/** Opt-in, immediate-use App Events credential boundary for the M0-012 prototype. */
const AUTH_URL = 'https://api.shopify.com/auth/access_token';
const EVENT_URL = 'https://api.shopify.com/app/2026-07/events';
const CLIENT_ID = '1443cf6d03d39edae7c101a943c5c684';
const SHOP_ID = 'gid://shopify/Shop/105501393179';
const METER = 'customized_order_paid';
const MAX_TOKEN_BODY = 16 * 1024;
const MAX_EVENT_BODY = 4096;
const REQUEST_TIMEOUT_MS = 10_000;
const USE_WINDOW_MS = 30_000;

export type TokenMetadata = { scope: 'WRITE_PRESENT' | 'UNKNOWN'; expiry: 'PRESENT' | 'UNKNOWN' };
export type ImmediateSendResult =
  | { kind: 'HTTP'; status: number; tokenMetadata: TokenMetadata;
      replay: boolean | null; requestId: string | null }
  | { kind: 'TOKEN_REJECTED' | 'GUARD_REJECTED' | 'USE_DEADLINE' |
      'TIMEOUT' | 'UNAVAILABLE' | 'UNSAFE_REDIRECT' | 'OVERSIZE_RESPONSE'; status?: number };

export interface ImmediateUsePorts {
  clientId: string;
  clientSecret: string;
  eventUrl: string;
  eventBody: string;
  /** Fresh Partner verification after issuance. It receives no bearer. */
  verifyAfterAcquire(): Promise<boolean>;
  /** Synthetic test seam. Production callers omit this to use Node's TLS-verified fetch. */
  fetch?: typeof fetch;
  /** Synthetic test seam. Must be monotonic. */
  monotonicNow?: () => number;
  timeoutMs?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validEvent(body: string): boolean {
  if (Buffer.byteLength(body) > MAX_EVENT_BODY) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return false; }
  const event = record(parsed);
  const attributes = record(event?.attributes);
  return !!event && Object.keys(event).sort().join(',') ===
    'attributes,event_handle,idempotency_key,shop_id,timestamp' &&
    event.shop_id === SHOP_ID && event.event_handle === METER &&
    typeof event.idempotency_key === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(event.idempotency_key) &&
    typeof event.timestamp === 'string' &&
    !Number.isNaN(Date.parse(event.timestamp)) &&
    !!attributes && Object.keys(attributes).length === 1 && attributes.value === 1;
}

function remaining(now: () => number, deadline: number): number {
  return Math.floor(deadline - now());
}

async function timed<T>(operation: Promise<T>, controller: AbortController,
  now: () => number, deadline: number): Promise<T> {
  const ms = remaining(now, deadline);
  if (ms <= 0) { controller.abort(); throw new Error('deadline'); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function unsafeRedirect(response: Response, url: string): boolean {
  return response.redirected || response.status >= 300 && response.status < 400 ||
    !!response.url && response.url !== url;
}

async function boundedJson(response: Response, controller: AbortController,
  now: () => number, deadline: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_TOKEN_BODY))
    throw new Error('oversize');
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await timed(reader.read(), controller, now, deadline);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_TOKEN_BODY) throw new Error('oversize');
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('invalid-json'); }
}

function metadataAndToken(body: unknown):
  { token: string; metadata: TokenMetadata; expiresIn: number | null } | null {
  const data = record(body);
  if (!data || 'error' in data || 'expires_at' in data || 'expiresAt' in data ||
    typeof data.access_token !== 'string' ||
    data.access_token.length > 8192 || !/^[A-Za-z0-9\-._~+/]+=*$/.test(data.access_token) ||
    typeof data.token_type !== 'string' || !/^Bearer$/i.test(data.token_type)) return null;
  let scope: TokenMetadata['scope'] = 'UNKNOWN';
  if ('scope' in data) {
    if (typeof data.scope !== 'string' ||
      !data.scope.split(/\s+/).includes('write_global_api_app_events')) return null;
    scope = 'WRITE_PRESENT';
  }
  let expiry: TokenMetadata['expiry'] = 'UNKNOWN';
  let expiresIn: number | null = null;
  if ('expires_in' in data) {
    if (!Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0 ||
      Number(data.expires_in) > 3600) return null;
    expiresIn = Number(data.expires_in);
    expiry = 'PRESENT';
  }
  return { token: data.access_token, metadata: { scope, expiry }, expiresIn };
}

function safeHeader(value: string | null): string | null {
  return value !== null && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

/** Acquires directly, verifies fresh terms, then consumes the bearer for at most one POST. */
export async function sendWithImmediateUseToken(ports: ImmediateUsePorts): Promise<ImmediateSendResult> {
  if (ports.clientId !== CLIENT_ID || !ports.clientSecret ||
    ports.clientSecret.length > 4096 || ports.eventUrl !== EVENT_URL ||
    !validEvent(ports.eventBody) ||
    ports.timeoutMs !== undefined && (!Number.isSafeInteger(ports.timeoutMs) ||
      ports.timeoutMs < 1 || ports.timeoutMs > REQUEST_TIMEOUT_MS) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return { kind: 'GUARD_REJECTED' };

  const fetcher = ports.fetch ?? fetch;
  const now = ports.monotonicNow ?? (() => performance.now());
  const start = now();
  if (!Number.isFinite(start)) return { kind: 'GUARD_REJECTED' };
  const useDeadline = start + USE_WINDOW_MS;
  const timeout = ports.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const authBody = JSON.stringify({ client_id: ports.clientId,
    client_secret: ports.clientSecret, grant_type: 'client_credentials' });
  if (Buffer.byteLength(authBody) > 8192) return { kind: 'GUARD_REJECTED' };

  const authController = new AbortController();
  let auth: Response;
  try {
    auth = await timed(fetcher(AUTH_URL, { method: 'POST', redirect: 'manual',
      signal: authController.signal, headers: { 'Content-Type': 'application/json' },
      body: authBody }), authController, now, Math.min(useDeadline, start + timeout));
  } catch { return { kind: authController.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE' }; }
  if (unsafeRedirect(auth, AUTH_URL)) return { kind: 'UNSAFE_REDIRECT' };
  if (auth.status !== 200) return { kind: 'TOKEN_REJECTED', status: auth.status };

  let authPayload: unknown;
  try { authPayload = await boundedJson(auth, authController, now,
    Math.min(useDeadline, start + timeout)); }
  catch (error) {
    if (error instanceof Error && error.message === 'oversize') return { kind: 'OVERSIZE_RESPONSE' };
    return { kind: authController.signal.aborted ? 'TIMEOUT' : 'TOKEN_REJECTED' };
  }
  const acquired = metadataAndToken(authPayload);
  if (!acquired) return { kind: 'TOKEN_REJECTED' };
  const deadline = acquired.expiresIn === null ? useDeadline :
    Math.min(useDeadline, start + acquired.expiresIn * 1000);
  if (remaining(now, deadline) <= 0) return { kind: 'USE_DEADLINE' };

  const verifyController = new AbortController();
  let verified: boolean;
  try { verified = await timed(ports.verifyAfterAcquire(), verifyController, now, deadline); }
  catch { return { kind: remaining(now, deadline) <= 0 ? 'USE_DEADLINE' : 'GUARD_REJECTED' }; }
  if (verified !== true) return { kind: 'GUARD_REJECTED' };
  if (remaining(now, deadline) <= 0) return { kind: 'USE_DEADLINE' };

  const eventController = new AbortController();
  let eventResponse: Response;
  try {
    eventResponse = await timed(fetcher(ports.eventUrl, { method: 'POST', redirect: 'manual',
      signal: eventController.signal, headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${acquired.token}` }, body: ports.eventBody }),
    eventController, now, Math.min(deadline, now() + timeout));
  } catch { return { kind: eventController.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE' }; }
  if (unsafeRedirect(eventResponse, ports.eventUrl)) return { kind: 'UNSAFE_REDIRECT' };
  const replayHeader = eventResponse.headers.get('Idempotent-Replay');
  const replay = replayHeader === 'true' ? true : replayHeader === 'false' ? false : null;
  return { kind: 'HTTP', status: eventResponse.status, tokenMetadata: acquired.metadata,
    replay, requestId: safeHeader(eventResponse.headers.get('X-Request-ID')) };
}
