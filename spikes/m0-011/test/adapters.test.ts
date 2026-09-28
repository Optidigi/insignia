import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerClient, AppEventsClient, AppEventsTokenClient, FileRunJournal, type LiveManifest } from '../src/index.ts';
import type { AppEvent } from '../../m0-010/src/index.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const appId = 'gid://shopify/App/202';
const shopId = 'gid://shopify/Shop/78935261342';
const now = '2026-09-28T12:00:00.000Z';
const event: AppEvent = { shop_id: shopId, event_handle: 'customized_order_paid', timestamp: now,
  idempotency_key: 'a'.repeat(64), attributes: { value: 1 } };
const bodyFor = (key: string) => JSON.stringify({ ...event, idempotency_key: key });
const nowMs = Date.parse(now);
const live: LiveManifest = { mode: 'LIVE_ZERO_PRICE_TEST', appId, shopId, meterHandle: 'customized_order_paid',
  planHandle: 'private_test', runId: 'run-1', approvedAt: now, observedAt: now,
  cycleFrom: '2026-09-20T00:00:00.000Z', cycleUntil: '2026-10-20T00:00:00.000Z',
  zeroPrice: true, appGidVerified: true, meterVerified: true, installationVerified: true };
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
  assert.equal((calls[0]?.init as RequestInit).redirect, 'manual');
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
    assert.deepEqual(await client.send(event), { kind: 'RECEIVED', status: 202, replay: null, requestId: null });
    assert.equal(calls[0]?.url, 'https://api.shopify.com/app/2026-07/events');
    assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${eventToken}`);
    assert.equal(calls[0]?.init.redirect, 'manual');
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), event);
    const persisted = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8'));
    assert.equal(persisted.attempts, 1);
    assert.equal(persisted.events[event.idempotency_key].body, JSON.stringify(event));
    const resumed = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      fetch: async (_url, init) => { calls.push({ url: '', init: init! }); return response({ success: true }, 202, { 'Idempotent-Replay': 'true' }); },
      journal: new FileRunJournal(join(dir, 'journal.json')), manifest: live, partner: partnerFor(active) });
    assert.deepEqual(await resumed.send(event), { kind: 'RECEIVED', status: 202, replay: true, requestId: null });
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
    assert.equal((await new AppEventsClient({ ...deps, manifest: { ...live, appGidVerified: false as true }, partner: partnerFor(active) }).send(event)).kind, 'GUARD_REJECTED');
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
    assert.deepEqual(await client.send(event), { kind: 'UNKNOWN_RESPONSE', status: 202 });
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
    assert.deepEqual(await unsupported.send(event), { kind: 'UNSUPPORTED_ENDPOINT', status: 404 });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('journal refuses changed identity, fourth unique event and seventh attempt after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const path = join(dir, 'journal.json');
    const journal = new FileRunJournal(path);
    assert.equal(await journal.reserve('run-1', 'a', bodyFor('a'), nowMs), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'a', bodyFor('a').replace('12:00:00', '12:00:01'), nowMs), 'CONFLICT');
    assert.equal(await new FileRunJournal(path).reserve('other-run', 'a', bodyFor('a'), nowMs), 'CONFLICT');
    assert.equal(await journal.reserve('run-1', 'b', bodyFor('b'), nowMs), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'c', bodyFor('c'), nowMs), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'd', bodyFor('d'), nowMs), 'LIMIT');
    for (let i = 0; i < 3; i++) assert.equal(await new FileRunJournal(path).reserve('run-1', 'a', bodyFor('a'), nowMs), 'RESERVED');
    assert.equal(await journal.reserve('run-1', 'a', bodyFor('a'), nowMs), 'LIMIT');
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
    assert.deepEqual(await client.send(event), { kind: 'CONFLICT', status: 409 });
    assert.deepEqual(await client.send(event), { kind: 'RATE_LIMITED', status: 429, retryAfterMs: 7000 });
    assert.deepEqual(await client.send(event), { kind: 'SERVER_ERROR', status: 503 });
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
  assert.equal(calls[0]?.init.redirect, 'manual');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    client_id: 'fixture-client', client_secret: 'fixture-secret', grant_type: 'client_credentials' });
  body = { access_token: eventToken, scope: 'read_global_api_app_events', expires_in: 3599 };
  assert.equal(await client.getToken(), null);
  body = { access_token: eventToken, scope: 'write_global_api_app_events', expires_in: 1 };
  assert.equal(await client.getToken(), null);
});

test('App Events token receipt preserves absent metadata without exposing an unusable bearer', async () => {
  let body: unknown = { access_token: eventToken, token_type: 'Bearer' };
  const client = new AppEventsTokenClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret', now: () => now,
    fetch: async () => response(body) });
  assert.deepEqual(await client.acquire(), {
    kind: 'ISSUED_INCOMPLETE', tokenType: 'Bearer', scope: null, expiresInSeconds: null,
    missing: ['scope', 'expires_in'] });
  assert.equal(await client.getToken(), null);

  body = { access_token: eventToken, token_type: 'Bearer', scope: 'write_global_api_app_events' };
  assert.deepEqual(await client.acquire(), {
    kind: 'ISSUED_INCOMPLETE', tokenType: 'Bearer', scope: 'write_global_api_app_events',
    expiresInSeconds: null, missing: ['expires_in'] });
  body = { access_token: eventToken, token_type: 'Bearer', expires_in: 3599 };
  assert.deepEqual(await client.acquire(), {
    kind: 'ISSUED_INCOMPLETE', tokenType: 'Bearer', scope: null,
    expiresInSeconds: 3599, missing: ['scope'] });
  assert.equal(await client.getToken(), null);
});

test('App Events token metadata contradictions are rejected and complete metadata remains usable', async () => {
  let body: unknown = { access_token: eventToken, token_type: 'Bearer',
    scope: 'read_global_api_app_events', expires_in: 3599 };
  const client = new AppEventsTokenClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret', now: () => now,
    fetch: async () => response(body) });
  assert.deepEqual(await client.acquire(), { kind: 'REJECTED' });
  body = { access_token: eventToken, token_type: 'mac', scope: 'write_global_api_app_events', expires_in: 3599 };
  assert.deepEqual(await client.acquire(), { kind: 'REJECTED' });
  body = { access_token: eventToken, token_type: 'Bearer', scope: 'write_global_api_app_events', expires_in: '3599' };
  assert.deepEqual(await client.acquire(), { kind: 'REJECTED' });
  body = { access_token: eventToken, token_type: 'Bearer', scope: 'write_global_api_app_events', expires_in: 3599 };
  assert.deepEqual(await client.acquire(), {
    kind: 'READY', token: { value: eventToken, expiresAt: '2026-09-28T12:59:59.000Z' } });
});

test('internally consistent but undesignated shop identity is refused before any read or send', () => {
  const otherShop = 'gid://shopify/Shop/999';
  assert.throws(() => new PartnerClient({ appId, shopId: otherShop, organizationId: '12345',
    credentials: credentials(), fetch: async () => response(active), now: () => now }));
  assert.throws(() => new AppEventsClient({ appId, shopId: otherShop,
    credentials: credentials(), fetch: async () => response({ success: true }, 202), now: () => now,
    manifest: { ...live, shopId: otherShop } }));
});

test('price changing while a credential is acquired blocks the final event POST', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    let current = structuredClone(active);
    let eventPosts = 0;
    const partner = new PartnerClient({ appId, shopId, organizationId: '12345',
      credentials: credentials(), now: () => now, fetch: async () => response(current) });
    const client = new AppEventsClient({ appId, shopId, partner, manifest: live,
      journal: new FileRunJournal(join(dir, 'journal.json')), now: () => now,
      credentials: { partner: async () => partnerToken, appEvents: async () => {
        current = structuredClone(active);
        current.data.activeSubscription.items[1]!.price.tiers![1]!.amountPerUnit = '0.01';
        return eventToken;
      } },
      fetch: async () => { eventPosts++; return response({ success: true }, 202); } });
    assert.deepEqual(await client.send(event), { kind: 'GUARD_REJECTED' });
    assert.equal(eventPosts, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('new backdated event is rejected; an identical reserved event can replay later', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    let clock = '2026-09-28T11:59:30.000Z';
    let posts = 0;
    const manifest = { ...live, approvedAt: clock, observedAt: clock };
    const partner = new PartnerClient({ appId, shopId, organizationId: '12345',
      credentials: credentials(), now: () => clock, fetch: async () => response(active) });
    const client = new AppEventsClient({ appId, shopId, manifest, partner,
      journal: new FileRunJournal(join(dir, 'journal.json')), now: () => clock,
      credentials: credentials(), fetch: async () => { posts++; return response({ success: true }, 202); } });
    const timely = { ...event, timestamp: clock };
    assert.equal((await client.send(timely)).kind, 'RECEIVED');
    clock = '2026-09-28T12:00:50.000Z';
    assert.equal((await client.send(timely)).kind, 'RECEIVED');
    assert.equal(posts, 2);
    const oldNew = { ...event, idempotency_key: 'b'.repeat(64), timestamp: '2026-09-28T11:59:30.000Z' };
    assert.deepEqual(await client.send(oldNew), { kind: 'GUARD_REJECTED' });
    assert.equal(posts, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('202 exposes only allowlisted receipt metadata and never invents replay evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const client = new AppEventsClient({ appId, shopId, credentials: credentials(), now: () => now,
      partner: partnerFor(active), manifest: live, journal: new FileRunJournal(join(dir, 'journal.json')),
      fetch: async () => response({ success: true, error: eventToken }, 202,
        { 'X-Request-ID': 'request_123', 'X-Secret-Token': eventToken }) });
    assert.deepEqual(await client.send(event),
      { kind: 'RECEIVED', status: 202, replay: null, requestId: 'request_123' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a normal process refuses an alternate live journal path', () => {
  const moduleUrl = new URL('../src/index.ts', import.meta.url).href;
  const script = `import { AppEventsClient, FileRunJournal } from ${JSON.stringify(moduleUrl)};
    new AppEventsClient({ appId: ${JSON.stringify(appId)}, shopId: ${JSON.stringify(shopId)},
      credentials: { partner: async () => 'fixture', appEvents: async () => 'fixture' },
      fetch: globalThis.fetch, now: () => ${JSON.stringify(now)},
      manifest: ${JSON.stringify(live)}, journal: new FileRunJournal('/tmp/noncanonical-insignia-journal') });`;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script],
    { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Noncanonical live journal/);
});

test('deleting a journal resets its local counter and therefore needs operator-wide accounting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011-'));
  try {
    const path = join(dir, 'journal.json');
    const journal = new FileRunJournal(path);
    assert.equal(await journal.reserve('run-1', 'a', bodyFor('a'), nowMs), 'RESERVED');
    await rm(path);
    assert.equal(await new FileRunJournal(path).reserve('run-2', 'b', bodyFor('b'), nowMs), 'RESERVED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
