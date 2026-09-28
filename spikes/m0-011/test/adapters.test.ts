import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerClient, AppEventsClient, AppEventsTokenClient, FileRunJournal, type LiveManifest } from '../src/index.ts';
import type { AppEvent } from '../../m0-010/src/index.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appId = 'gid://shopify/App/202';
const shopId = 'gid://shopify/Shop/101';
const now = '2026-09-28T12:00:00.000Z';
const event: AppEvent = { shop_id: shopId, event_handle: 'customized_order_paid', timestamp: now,
  idempotency_key: 'a'.repeat(64), attributes: { value: 1 } };
const live: LiveManifest = { mode: 'LIVE_ZERO_PRICE_TEST', appId, shopId, meterHandle: 'customized_order_paid',
  planHandle: 'private_test', runId: 'run-1', approvedAt: now, observedAt: now,
  cycleFrom: '2026-09-20T00:00:00.000Z', cycleUntil: '2026-10-20T00:00:00.000Z',
  zeroPrice: true, meterVerified: true, installationVerified: true };
const active = { data: { activeSubscription: { app: { id: appId }, shop: { id: shopId, myshopifyDomain: 'fixture.myshopify.com' },
  billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: false, trialEndsAt: null,
  currentBillingCycle: { startTime: live.cycleFrom, endTime: live.cycleUntil }, pendingUpdate: null,
  items: [
    { handle: 'private_test', price: { __typename: 'FlatRatePrice', active: true, currency: 'USD', amount: '0.00' } },
    { handle: 'customized_order_paid', price: { __typename: 'TieredPrice', active: true, currency: 'USD', tiersMode: 'GRADUATED',
      tiers: [{ upTo: 1, amountPerUnit: '0.00', amount: '0.00' }, { upTo: null, amountPerUnit: '0.00', amount: '0.00' }] },
      usage: { quantity: 0, cost: { amount: '0.00', currencyCode: 'USD' } } }
  ] } } };
const partnerToken = 'partner-private-token';
const eventToken = 'event-private-token';
function credentials() { return { partner: async () => partnerToken, appEvents: async () => eventToken }; }
function partnerFor(body: unknown): PartnerClient {
  return new PartnerClient({ appId, shopId, organizationId: '12345', credentials: credentials(),
    now: () => now, fetch: async () => response(body) });
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), headers ? { status, headers } : { status });
}

test('Partner reads only scoped query with Partner credential and validates provider identity', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new PartnerClient({ appId, shopId, organizationId: '12345', credentials: credentials(),
    fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return response(active); },
    now: () => now });
  const result = await client.readActive(shopId);
  assert.equal(result.kind, 'ACTIVE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://partners.shopify.com/12345/api/2026-07/graphql.json');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['X-Shopify-Access-Token'], partnerToken);
  assert.equal((calls[0]?.init as RequestInit).redirect, 'error');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).variables, { appId, shopId });
  assert.equal(await client.readActive('gid://shopify/Shop/999').then(x => x.kind), 'MISMATCH');
  assert.equal(calls.length, 1);
});

test('Partner historical read paginates within one bounded range and never calls a partial result complete', async () => {
  let page = 0;
  const client = new PartnerClient({ appId, shopId, organizationId: '12345', credentials: credentials(), now: () => now,
    fetch: async (_url, init) => {
      const vars = JSON.parse(String(init?.body)).variables;
      assert.equal(vars.after, page === 0 ? null : 'cursor-1');
      page++;
      return response({ data: { events: { edges: [], pageInfo: { hasNextPage: page === 1, endCursor: page === 1 ? 'cursor-1' : null } } } });
    } });
  const result = await client.readHistory(shopId, '2026-09-01T00:00:00.000Z', now);
  assert.equal(result.kind, 'COMPLETE_PAGES');
  if (result.kind === 'COMPLETE_PAGES') assert.deepEqual(result.events, []);
  assert.equal(page, 2);
});

test('dry run is default and cannot fetch credentials or open the network', async () => {
  let calls = 0;
  const client = new AppEventsClient({ appId, shopId, credentials: { partner: async () => { throw Error('wrong credential'); },
    appEvents: async () => { calls++; throw Error('credential used'); } },
    fetch: async () => { calls++; throw Error('network used'); }, now: () => now });
  assert.deepEqual(await client.send(event), { kind: 'DRY_RUN' });
  assert.equal(calls, 0);
});

test('live send requires exact zero price observation, explicit manifest and durable attempt reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const journal = new FileRunJournal(join(dir, 'journal.json'));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return response({ success: true }, 202); },
      journal, manifest: live, partner: partnerFor(active) });
    assert.deepEqual(await client.send(event), { kind: 'RECEIVED', replay: false });
    assert.equal(calls[0]?.url, 'https://api.shopify.com/app/2026-07/events');
    assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${eventToken}`);
    assert.equal(calls[0]?.init.redirect, 'error');
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), event);
    const persisted = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8'));
    assert.equal(persisted.attempts, 1);
    assert.equal(persisted.events[event.idempotency_key].body, JSON.stringify(event));
    const resumed = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      fetch: async (_url, init) => { calls.push({ url: '', init: init! }); return response({ success: true }, 202, { 'Idempotent-Replay': 'true' }); },
      journal: new FileRunJournal(join(dir, 'journal.json')), manifest: live, partner: partnerFor(active) });
    assert.deepEqual(await resumed.send(event), { kind: 'RECEIVED', replay: true });
    assert.equal(String(calls[1]?.init.body), String(calls[0]?.init.body));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsafe live cases fail closed before fetching an App Events credential', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    let calls = 0;
    const deps = { appId, shopId, credentials: { partner: async () => 'x', appEvents: async () => { calls++; return eventToken; } },
      fetch: async () => { calls++; return response({ success: true }, 202); }, now: () => now,
      journal: new FileRunJournal(join(dir, 'journal.json')) };
    assert.equal((await new AppEventsClient({ ...deps, manifest: live, partner: partnerFor({ data: { activeSubscription: null } }) }).send(event)).kind, 'GUARD_REJECTED');
    assert.equal((await new AppEventsClient({ ...deps, manifest: { ...live, zeroPrice: false as true }, partner: partnerFor(active) }).send(event)).kind, 'GUARD_REJECTED');
    assert.equal((await new AppEventsClient({ ...deps, manifest: live, partner: partnerFor(active) }).send({ ...event, shop_id: 'gid://shopify/Shop/999' })).kind, 'GUARD_REJECTED');
    assert.equal((await new AppEventsClient({ ...deps, manifest: live, partner: partnerFor(active) }).send({ ...event, event_handle: 'wrong' as AppEvent['event_handle'] })).kind, 'GUARD_REJECTED');
    assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bounded HTTP responses, redirect, timeout and malformed 202 are safe classifications without provider body leaks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    let result: Response = response({ success: false, error: eventToken }, 202);
    const client = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      fetch: async () => result, journal: new FileRunJournal(join(dir, 'journal.json')), manifest: live, partner: partnerFor(active) });
    assert.deepEqual(await client.send(event), { kind: 'UNKNOWN_RESPONSE' });
    result = new Response('', { status: 302, headers: { Location: 'https://evil.example/steal' } });
    assert.deepEqual(await client.send(event), { kind: 'UNSAFE_REDIRECT' });
    assert.equal(JSON.stringify(await client.send(event)).includes(eventToken), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsupported endpoint and expired App Events token are classified without changing event identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const journal = new FileRunJournal(join(dir, 'journal.json'));
    let calls = 0;
    const expired = new AppEventsClient({ appId, shopId, credentials: { partner: async () => partnerToken,
      appEvents: async () => ({ value: eventToken, expiresAt: '2026-09-28T12:00:01.000Z' }) },
      fetch: async () => { calls++; return response({ success: true }, 202); }, now: () => now,
      manifest: live, partner: partnerFor(active), journal });
    assert.deepEqual(await expired.send(event), { kind: 'AUTH_ERROR' });
    assert.equal(calls, 0);
    const unsupported = new AppEventsClient({ appId, shopId, credentials: credentials(),
      fetch: async () => { calls++; return response({ error: eventToken }, 404); }, now: () => now,
      manifest: live, partner: partnerFor(active), journal });
    assert.deepEqual(await unsupported.send(event), { kind: 'UNSUPPORTED_ENDPOINT' });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('journal refuses changed identity, fourth unique event and seventh attempt after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const path = join(dir, 'journal.json');
    const journal = new FileRunJournal(path);
    assert.equal(await journal.reserve('run-1', 'a', 'body-A'), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'a', 'body-changed'), 'CONFLICT');
    assert.equal(await new FileRunJournal(path).reserve('other-run', 'a', 'body-A'), 'CONFLICT');
    assert.equal(await journal.reserve('run-1', 'b', 'body-B'), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'c', 'body-C'), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'd', 'body-D'), 'LIMIT');
    for (let i = 0; i < 3; i++) assert.equal(await new FileRunJournal(path).reserve('run-1', 'a', 'body-A'), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'a', 'body-A'), 'LIMIT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('no-charge guard rejects unknown tariff, stale observation, missing cycle and provider errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    let calls = 0;
    const deps = { appId, shopId, credentials: { partner: async () => partnerToken,
      appEvents: async () => { calls++; return eventToken; } },
      fetch: async () => { calls++; return response({ success: true }, 202); }, now: () => now,
      journal: new FileRunJournal(join(dir, 'journal.json')), manifest: live };
    const wrongPrice = structuredClone(active);
    wrongPrice.data.activeSubscription.items[1]!.price.tiers![1]!.amountPerUnit = '0.01';
    const missingCycle = structuredClone(active);
    missingCycle.data.activeSubscription.currentBillingCycle = null as never;
    const cases = [wrongPrice, missingCycle, { ...active, errors: [{ message: eventToken }] }];
    for (const activeResponse of cases)
      assert.deepEqual(await new AppEventsClient({ ...deps, partner: partnerFor(activeResponse) }).send(event), { kind: 'GUARD_REJECTED' });
    assert.deepEqual(await new AppEventsClient({ ...deps, partner: partnerFor(active),
      manifest: { ...live, observedAt: '2026-09-28T11:49:00.000Z' } }).send(event), { kind: 'GUARD_REJECTED' });
    assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Partner access refuses expired credential and oversized response before parsing', async () => {
  let calls = 0;
  const expired = new PartnerClient({ appId, shopId, organizationId: '12345', now: () => now,
    credentials: { partner: async () => ({ value: partnerToken, expiresAt: '2026-09-28T12:00:01.000Z' }), appEvents: async () => eventToken },
    fetch: async () => { calls++; return response(active); } });
  assert.deepEqual(await expired.readActive(shopId), { kind: 'AUTH_REQUIRED' });
  assert.equal(calls, 0);
  const huge = new PartnerClient({ appId, shopId, organizationId: '12345', now: () => now, credentials: credentials(),
    fetch: async () => { calls++; return new Response('x'.repeat(130 * 1024), { status: 200 }); } });
  assert.deepEqual(await huge.readActive(shopId), { kind: 'OVERSIZE_RESPONSE' });
});

test('adapter exposes retry disposition and safe Retry-After without treating 202 as billed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const responses = [response({ error: eventToken }, 409),
      response({ error: eventToken }, 429, { 'Retry-After': '7' }),
      response({ error: eventToken }, 503)];
    const client = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      fetch: async () => responses.shift()!, partner: partnerFor(active),
      journal: new FileRunJournal(join(dir, 'journal.json')), manifest: live });
    assert.deepEqual(await client.send(event), { kind: 'CONFLICT' });
    assert.deepEqual(await client.send(event), { kind: 'RATE_LIMITED', retryAfterMs: 7000 });
    assert.deepEqual(await client.send(event), { kind: 'SERVER_ERROR' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('repeated historical cursor refuses a misleading complete-history claim', async () => {
  let calls = 0;
  const client = new PartnerClient({ appId, shopId, organizationId: '12345', credentials: credentials(), now: () => now,
    fetch: async () => { calls++; return response({ data: { events: { edges: [],
      pageInfo: { hasNextPage: true, endCursor: 'stuck' } } } }); } });
  assert.deepEqual(await client.readHistory(shopId, '2026-09-01T00:00:00.000Z', now), { kind: 'INCOMPLETE' });
  assert.equal(calls, 2);
});

test('request deadline aborts a stalled App Events call without changing the reserved payload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const path = join(dir, 'journal.json');
    const client = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      partner: partnerFor(active), manifest: live, journal: new FileRunJournal(path), timeoutMs: 5,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }) });
    assert.deepEqual(await client.send(event), { kind: 'TIMEOUT' });
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(persisted.events[event.idempotency_key].body, JSON.stringify(event));
    assert.equal(persisted.attempts, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('App Events token exchange uses only fixed auth route and rejects missing scope or expired lease', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let body: unknown = { access_token: eventToken, scope: 'write_global_api_app_events', expires_in: 3599 };
  const client = new AppEventsTokenClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret', now: () => now,
    fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return response(body); } });
  assert.deepEqual(await client.getToken(), { value: eventToken, expiresAt: '2026-09-28T12:59:59.000Z' });
  assert.equal(calls[0]?.url, 'https://api.shopify.com/auth/access_token');
  assert.equal(calls[0]?.init.redirect, 'error');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    client_id: 'fixture-client', client_secret: 'fixture-secret', grant_type: 'client_credentials' });
  body = { access_token: eventToken, scope: 'read_global_api_app_events', expires_in: 3599 };
  assert.equal(await client.getToken(), null);
  body = { access_token: eventToken, scope: 'write_global_api_app_events', expires_in: 1 };
  assert.equal(await client.getToken(), null);
});
