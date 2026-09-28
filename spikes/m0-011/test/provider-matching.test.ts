import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppEventsClient, FileRunJournal, PartnerClient, type LiveManifest } from '../src/index.ts';
import type { AppEvent } from '../../m0-010/src/index.ts';

const appId = 'gid://shopify/App/202';
const shopId = 'gid://shopify/Shop/78935261342';
const now = '2026-09-28T12:00:00.000Z';
const manifest: LiveManifest = {
  mode: 'LIVE_ZERO_PRICE_TEST', appId, shopId, meterHandle: 'customized_order_paid',
  planHandle: 'private_test', runId: 'm0-011r-synthetic', approvedAt: now, observedAt: now,
  cycleFrom: '2026-09-20T00:00:00.000Z', cycleUntil: '2026-10-20T00:00:00.000Z',
  zeroPrice: true, appGidVerified: true, meterVerified: true, installationVerified: true
};
const event: AppEvent = {
  shop_id: shopId, event_handle: 'customized_order_paid', timestamp: now,
  idempotency_key: 'a'.repeat(64), attributes: { value: 1 }
};
const canonical = { data: { activeSubscription: {
  app: { id: appId }, shop: { id: shopId, myshopifyDomain: 'fixture.myshopify.com' },
  billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: false, trialEndsAt: null,
  currentBillingCycle: { startTime: manifest.cycleFrom, endTime: manifest.cycleUntil },
  pendingUpdate: null,
  items: [
    { handle: 'private_test', price: { __typename: 'FlatRatePrice', active: true,
      currency: 'USD', amount: '0.00' } },
    { handle: 'customized_order_paid', price: { __typename: 'TieredPrice', active: true,
      currency: 'USD', tiersMode: 'GRADUATED', tiers: [
        { upTo: 1, amountPerUnit: '0.00', amount: '0.00' },
        { upTo: null, amountPerUnit: '0.00', amount: '0.00' }
      ] }, usage: { quantity: 0, cost: { amount: '0.00', currencyCode: 'USD' } } }
  ]
} } };
type Envelope = typeof canonical;
type Change = (response: Envelope) => void;
const unchanged: Change = () => {};
const seconds: Change = response => {
  const cycle = response.data.activeSubscription.currentBillingCycle;
  cycle.startTime = cycle.startTime.replace('.000Z', 'Z');
  cycle.endTime = cycle.endTime.replace('.000Z', 'Z');
};
const offset: Change = response => {
  response.data.activeSubscription.currentBillingCycle = {
    startTime: '2026-09-20T02:00:00+02:00', endTime: '2026-10-20T02:00:00+02:00'
  };
};
const reversed: Change = response => { response.data.activeSubscription.items.reverse(); };

async function throughClients(first: Change, final: Change) {
  const dir = await mkdtemp(join(tmpdir(), 'insignia-m0-011r-'));
  const path = join(dir, 'journal.json');
  const firstBody = structuredClone(canonical);
  const finalBody = structuredClone(canonical);
  first(firstBody); final(finalBody);
  let partnerReads = 0;
  const posts: Array<{ url: string; body: string }> = [];
  const credentials = { partner: async () => 'synthetic-partner',
    appEvents: async () => 'synthetic-events' };
  try {
    const partner = new PartnerClient({ appId, shopId, organizationId: '12345',
      credentials, now: () => now,
      fetch: async () => new Response(JSON.stringify(partnerReads++ === 0 ? firstBody : finalBody),
        { status: 200 }) });
    const client = new AppEventsClient({ appId, shopId, credentials, now: () => now,
      manifest, partner, journal: new FileRunJournal(path),
      fetch: async (url, init) => {
        posts.push({ url: String(url), body: String(init?.body) });
        return new Response('{"success":true}', { status: 202 });
      } });
    const result = await client.send(event);
    let attempts = 0;
    try { attempts = JSON.parse(await readFile(path, 'utf8')).attempts as number; }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    return { result, partnerReads, posts, attempts };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('equivalent cycle spellings and reversed flat/meter items reach one unchanged synthetic POST on both reads', async () => {
  const cases: Array<[string, Change, Change]> = [
    ['canonical control', unchanged, unchanged],
    ['seconds on first read', seconds, unchanged],
    ['offset on final read', unchanged, offset],
    ['reversed items on first read', reversed, unchanged],
    ['reversed items on final read', unchanged, reversed],
    ['offset/reversed first and seconds/reversed final',
      response => { offset(response); reversed(response); },
      response => { seconds(response); reversed(response); }]
  ];
  for (const [name, first, final] of cases) {
    const observed = await throughClients(first, final);
    assert.deepEqual(observed.result,
      { kind: 'RECEIVED', status: 202, replay: null, requestId: null }, name);
    assert.equal(observed.partnerReads, 2, name);
    assert.deepEqual(observed.posts, [
      { url: 'https://api.shopify.com/app/2026-07/events', body: JSON.stringify(event) }
    ], name);
    assert.equal(observed.attempts, 1, name);
  }
});

test('changed dates, economics, item identities and transitions reject on either Partner read', async () => {
  const cases: Array<[string, Change, Change, number, number]> = [
    ['one millisecond later start on first read', response => {
      response.data.activeSubscription.currentBillingCycle.startTime = '2026-09-20T00:00:00.001Z';
    }, unchanged, 1, 0],
    ['one millisecond later end on final read', unchanged, response => {
      response.data.activeSubscription.currentBillingCycle.endTime = '2026-10-20T00:00:00.001Z';
    }, 2, 1],
    ['invalid offset date on final read', unchanged, response => {
      response.data.activeSubscription.currentBillingCycle.startTime = '2026-09-20T25:00:00+02:00';
    }, 2, 1],
    ['missing cycle on first read', response => {
      response.data.activeSubscription.currentBillingCycle = null as never;
    }, unchanged, 1, 0],
    ['wrong app on final read', unchanged, response => {
      response.data.activeSubscription.app.id = 'gid://shopify/App/999';
    }, 2, 1],
    ['wrong shop on first read', response => {
      response.data.activeSubscription.shop.id = 'gid://shopify/Shop/999';
    }, unchanged, 1, 0],
    ['nonzero recurring amount on final read', unchanged, response => {
      response.data.activeSubscription.items[0]!.price.amount = '0.01';
    }, 2, 1],
    ['nonzero graduated tier on first read', response => {
      response.data.activeSubscription.items[1]!.price.tiers![1]!.amountPerUnit = '0.01';
    }, unchanged, 1, 0],
    ['nonzero first tier flat amount on final read', unchanged, response => {
      response.data.activeSubscription.items[1]!.price.tiers![0]!.amount = '0.01';
    }, 2, 1],
    ['nonzero second tier flat amount on first read', response => {
      response.data.activeSubscription.items[1]!.price.tiers![1]!.amount = '0.01';
    }, unchanged, 1, 0],
    ['wrong flat handle on first read', response => {
      response.data.activeSubscription.items[0]!.handle = 'wrong_plan';
    }, unchanged, 1, 0],
    ['wrong meter handle on final read', unchanged, response => {
      response.data.activeSubscription.items[1]!.handle = 'wrong_meter';
    }, 2, 1],
    ['duplicate flat instead of meter on final read', unchanged, response => {
      response.data.activeSubscription.items[1] = structuredClone(response.data.activeSubscription.items[0]!);
    }, 2, 1],
    ['duplicate meter instead of flat on first read', response => {
      response.data.activeSubscription.items[0] = structuredClone(response.data.activeSubscription.items[1]!);
    }, unchanged, 1, 0],
    ['extra item on final read', unchanged, response => {
      response.data.activeSubscription.items.push(structuredClone(response.data.activeSubscription.items[0]!));
    }, 2, 1],
    ['reversed graduated tiers on final read', unchanged, response => {
      response.data.activeSubscription.items[1]!.price.tiers!.reverse();
    }, 2, 1],
    ['pending update on final read', unchanged, response => {
      response.data.activeSubscription.pendingUpdate = { items: [{ handle: 'next' }] } as never;
    }, 2, 1],
    ['active trial on first read', response => {
      response.data.activeSubscription.trialEndsAt = '2026-10-01T00:00:00Z' as never;
    }, unchanged, 1, 0]
  ];
  for (const [name, first, final, expectedReads, expectedAttempts] of cases) {
    const observed = await throughClients(first, final);
    assert.deepEqual(observed.result, { kind: 'GUARD_REJECTED' }, name);
    assert.equal(observed.partnerReads, expectedReads, name);
    assert.equal(observed.posts.length, 0, name);
    assert.equal(observed.attempts, expectedAttempts, name);
  }
});
