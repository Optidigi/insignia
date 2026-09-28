import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendWithImmediateUseToken } from '../src/token.ts';

const AUTH_URL = 'https://api.shopify.com/auth/access_token';
const EVENT_URL = 'https://api.shopify.com/app/2026-07/events';
const CLIENT_ID = '1443cf6d03d39edae7c101a943c5c684';
const SECRET = 'synthetic-secret';
const BODY = JSON.stringify({ shop_id: 'gid://shopify/Shop/105501393179',
  event_handle: 'customized_order_paid', timestamp: '2026-09-28T12:00:00.000Z',
  idempotency_key: 'synthetic-key-1', attributes: { value: 1 } });
const bearer = 'synthetic-bearer';

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

test('trusted direct acquisition sends once with a private bearer and unknown missing metadata', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return calls.length === 1
      ? response({ access_token: bearer, token_type: 'Bearer' })
      : response({ accepted: true }, 202);
  };
  let verified = 0;
  const result = await sendWithImmediateUseToken({ clientId: CLIENT_ID, clientSecret: SECRET,
    eventUrl: EVENT_URL, eventBody: BODY, fetch: fetcher,
    verifyAfterAcquire: async () => { verified++; return true; },
    beforeEventDispatch: async () => true });
  assert.deepEqual(result, { kind: 'HTTP', status: 202,
    tokenMetadata: { scope: 'UNKNOWN', expiry: 'UNKNOWN' }, replay: null, requestId: null });
  assert.equal(verified, 1);
  assert.deepEqual(calls.map(x => x.url), [AUTH_URL, EVENT_URL]);
  assert.equal(calls[0]?.init.redirect, 'manual');
  assert.equal(calls[1]?.init.redirect, 'manual');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { client_id: CLIENT_ID,
    client_secret: SECRET, grant_type: 'client_credentials' });
  assert.equal((calls[1]?.init.headers as Record<string, string>).Authorization, `Bearer ${bearer}`);
  assert.equal(calls[1]?.init.body, BODY);
  assert.equal(JSON.stringify(result).includes(bearer), false);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('invalid identity, route and event cannot acquire a token', async () => {
  let calls = 0;
  const base = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, verifyAfterAcquire: async () => true,
    beforeEventDispatch: async () => true,
    fetch: (async () => { calls++; throw new Error('unexpected fetch'); }) as typeof fetch };
  for (const override of [
    { clientId: 'another-app' },
    { eventUrl: 'https://api.shopify.com/app/unstable/events' },
    { eventUrl: 'http://api.shopify.com/app/2026-07/events' },
    { eventBody: BODY.replace('customized_order_paid', 'other_event') },
    { eventBody: BODY.replace('"value":1', '"value":2') },
  ]) {
    assert.deepEqual(await sendWithImmediateUseToken({ ...base, ...override }),
      { kind: 'GUARD_REJECTED' });
  }
  assert.equal(calls, 0);
});

test('explicit Bearer is required and contradictory supplied metadata rejects before event send', async () => {
  const invalid = [
    { access_token: bearer },
    { access_token: bearer, token_type: 'MAC' },
    { access_token: bearer, token_type: 'Bearer', scope: 'read_global_api_app_events' },
    { access_token: bearer, token_type: 'Bearer', expires_in: '3600' },
    { access_token: bearer, token_type: 'Bearer', expires_in: 0 },
    { access_token: bearer, token_type: 'Bearer', expires_in: 3601 },
    { access_token: bearer, token_type: 'Bearer', expires_at: '2026-09-28T13:00:00Z' },
    { access_token: bearer, token_type: 'Bearer', error: 'invalid_grant' },
    { access_token: 'has whitespace', token_type: 'Bearer' },
  ];
  for (const tokenBody of invalid) {
    let calls = 0;
    let verified = 0;
    const result = await sendWithImmediateUseToken({ clientId: CLIENT_ID, clientSecret: SECRET,
      eventUrl: EVENT_URL, eventBody: BODY,
      verifyAfterAcquire: async () => { verified++; return true; },
      beforeEventDispatch: async () => true,
      fetch: async () => { calls++; return response(tokenBody); } });
    assert.deepEqual(result, { kind: 'TOKEN_REJECTED' });
    assert.equal(calls, 1);
    assert.equal(verified, 0);
  }
});

test('supplied scope and expiry are retained only as presence and a shorter expiry stops use', async () => {
  let tick = 100;
  let calls = 0;
  const base = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, monotonicNow: () => tick, beforeEventDispatch: async () => true,
    fetch: (async () => { calls++; return calls % 2 === 1
      ? response({ access_token: bearer, token_type: 'Bearer',
        scope: 'write_global_api_app_events', expires_in: 1 })
      : response({}, 202); }) as typeof fetch };
  const first = await sendWithImmediateUseToken({ ...base, verifyAfterAcquire: async () => true });
  assert.deepEqual(first, { kind: 'HTTP', status: 202,
    tokenMetadata: { scope: 'WRITE_PRESENT', expiry: 'PRESENT' },
    replay: null, requestId: null });
  const second = await sendWithImmediateUseToken({ ...base,
    verifyAfterAcquire: async () => { tick += 1000; return true; } });
  assert.deepEqual(second, { kind: 'USE_DEADLINE' });
  assert.equal(calls, 3);
});

test('30 second monotonic use deadline and failed fresh verification prevent event POST', async () => {
  let tick = 500;
  let calls = 0;
  const base = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, monotonicNow: () => tick, beforeEventDispatch: async () => true,
    fetch: (async () => { calls++; return response({ access_token: bearer,
      token_type: 'Bearer' }); }) as typeof fetch };
  assert.deepEqual(await sendWithImmediateUseToken({ ...base,
    verifyAfterAcquire: async () => false }), { kind: 'GUARD_REJECTED' });
  assert.deepEqual(await sendWithImmediateUseToken({ ...base,
    verifyAfterAcquire: async () => { tick += 30_000; return true; } }),
  { kind: 'USE_DEADLINE' });
  assert.equal(calls, 2);
});

test('each call acquires anew and each bearer reaches at most one event request', async () => {
  const sequence: string[] = [];
  let bearerNumber = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === AUTH_URL) {
      bearerNumber++;
      sequence.push('auth');
      return response({ access_token: `bearer-${bearerNumber}`, token_type: 'Bearer' });
    }
    sequence.push(String((init?.headers as Record<string, string>).Authorization));
    return response({}, 202);
  };
  const args = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, fetch: fetcher, verifyAfterAcquire: async () => true,
    beforeEventDispatch: async () => true };
  assert.equal((await sendWithImmediateUseToken(args)).kind, 'HTTP');
  assert.equal((await sendWithImmediateUseToken(args)).kind, 'HTTP');
  assert.deepEqual(sequence, ['auth', 'Bearer bearer-1', 'auth', 'Bearer bearer-2']);
});

test('auth redirect, oversized body and transport failures never dispatch an event', async () => {
  let calls = 0;
  const base = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, verifyAfterAcquire: async () => true,
    beforeEventDispatch: async () => true };
  assert.deepEqual(await sendWithImmediateUseToken({ ...base,
    fetch: async () => { calls++; return new Response(null, { status: 302,
      headers: { Location: 'https://elsewhere.invalid' } }); } }), { kind: 'UNSAFE_REDIRECT' });
  assert.deepEqual(await sendWithImmediateUseToken({ ...base,
    fetch: async () => { calls++; return new Response('{}', {
      headers: { 'Content-Length': '16385' } }); } }), { kind: 'OVERSIZE_RESPONSE' });
  assert.deepEqual(await sendWithImmediateUseToken({ ...base,
    fetch: async () => { calls++; throw new Error('offline'); } }), { kind: 'UNAVAILABLE' });
  assert.equal(calls, 3);
});

test('stalled token acquisition aborts and does not start verification or event POST', async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  let verified = false;
  const result = await sendWithImmediateUseToken({ clientId: CLIENT_ID,
    clientSecret: SECRET, eventUrl: EVENT_URL, eventBody: BODY, timeoutMs: 5,
    verifyAfterAcquire: async () => { verified = true; return true; },
    beforeEventDispatch: async () => true,
    fetch: async (_url, init) => { calls++; signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); } });
  assert.deepEqual(result, { kind: 'TIMEOUT' });
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(verified, false);
});

test('event redirect, failure status and stalled POST are sanitized after one attempt', async () => {
  const base = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, verifyAfterAcquire: async () => true,
    beforeEventDispatch: async () => true };
  for (const [eventResponse, expected] of [
    [new Response(null, { status: 307, headers: { Location: 'https://elsewhere.invalid' } }),
      { kind: 'UNSAFE_REDIRECT' }],
    [response({ error: 'synthetic-secret' }, 403),
      { kind: 'HTTP', status: 403, tokenMetadata: { scope: 'UNKNOWN', expiry: 'UNKNOWN' },
        replay: null, requestId: null }],
  ] as const) {
    let calls = 0;
    assert.deepEqual(await sendWithImmediateUseToken({ ...base,
      fetch: async () => { calls++; return calls === 1
        ? response({ access_token: bearer, token_type: 'Bearer' }) : eventResponse; } }), expected);
    assert.equal(calls, 2);
  }
  let calls = 0;
  const stalled = await sendWithImmediateUseToken({ ...base, timeoutMs: 5,
    fetch: async () => { calls++; return calls === 1
      ? response({ access_token: bearer, token_type: 'Bearer' })
      : new Promise<Response>(() => undefined); } });
  assert.deepEqual(stalled, { kind: 'TIMEOUT' });
  assert.equal(calls, 2);
});

test('durable pre-dispatch barrier runs after fresh verification and blocks failed dispatch', async () => {
  const order: string[] = [];
  const base = { clientId: CLIENT_ID, clientSecret: SECRET, eventUrl: EVENT_URL,
    eventBody: BODY, verifyAfterAcquire: async () => { order.push('verify'); return true; },
    beforeEventDispatch: async () => { order.push('barrier'); return true; },
    fetch: (async (url: string | URL | Request) => {
      order.push(String(url) === AUTH_URL ? 'auth' : 'event');
      return String(url) === AUTH_URL
        ? response({ access_token: bearer, token_type: 'Bearer' }) : response({}, 202);
    }) as typeof fetch };
  const denied = await sendWithImmediateUseToken({ ...base,
    beforeEventDispatch: async () => { order.push('barrier'); return false; } });
  assert.deepEqual(denied, { kind: 'GUARD_REJECTED' });
  assert.deepEqual(order, ['auth', 'verify', 'barrier']);
  order.length = 0;
  const failed = await sendWithImmediateUseToken({ ...base,
    beforeEventDispatch: async () => { order.push('barrier'); throw Error('disk failure'); } });
  assert.deepEqual(failed, { kind: 'GUARD_REJECTED' });
  assert.deepEqual(order, ['auth', 'verify', 'barrier']);
  order.length = 0;
  const sent = await sendWithImmediateUseToken({ ...base,
    beforeEventDispatch: async (...args: unknown[]) => {
      assert.equal(args.length, 0);
      order.push('barrier');
      return true;
    } });
  assert.equal(sent.kind, 'HTTP');
  assert.deepEqual(order, ['auth', 'verify', 'barrier', 'event']);
});
