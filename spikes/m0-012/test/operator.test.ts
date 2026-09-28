import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeRun, executeAttempt, attestBilling } from '../src/operator.ts';
import { RunRegister } from '../src/register.ts';

const actual = JSON.parse(await readFile(new URL('../evidence/baseline/partner-active-after-approval.json', import.meta.url), 'utf8'));
const CLOCK = '2026-09-28T17:15:00.000Z';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'insignia-operator-'));
  const calls = { partner: 0, auth: 0, event: 0, bodies: [] as string[] };
  let alteredRead = 0;
  const ports = {
    root, sourceHash: 'a'.repeat(64), partnerToken: 'synthetic-partner-only',
    clientSecret: 'synthetic-app-secret', now: () => CLOCK,
    partnerFetch: (async (_url: URL | RequestInfo, options?: RequestInit) => {
      calls.partner++;
      assert.equal((options?.headers as Record<string,string>)['X-Shopify-Access-Token'],
        'synthetic-partner-only');
      const copy = structuredClone(actual.body);
      if (calls.partner === alteredRead)
        copy.data.activeSubscription.items[1].price.tiers[0].amountPerUnit = '0.01';
      return new Response(JSON.stringify(copy), { status: 200 });
    }) as typeof fetch,
    tokenFetch: (async (url: URL | RequestInfo, options?: RequestInit) => {
      if (String(url).includes('/auth/')) {
        calls.auth++;
        return new Response(JSON.stringify({ access_token: 'syntheticBearer',
          token_type: 'Bearer' }), { status: 200 });
      }
      calls.event++;
      assert.equal((options?.headers as Record<string,string>).Authorization,
        'Bearer syntheticBearer');
      calls.bodies.push(String(options?.body));
      return new Response(JSON.stringify({ success: true }), { status: 202 });
    }) as typeof fetch,
  };
  return { root, calls, ports, setAlteredRead(n: number) { alteredRead = n; } };
}
async function cleanup(root: string) {
  await rm(root, { recursive: true, force: true });
  await rm(`${root}.receipt.json`, { force: true });
}

test('one real-profile synthetic attempt requires fresh reads on both sides of acquisition', async () => {
  const f = await fixture();
  try {
    assert.equal((await initializeRun(f.ports)).kind, 'INITIALIZED');
    const result = await executeAttempt('E1', f.ports);
    assert.equal(result.kind, 'ATTEMPT');
    assert.deepEqual({ partner: f.calls.partner, auth: f.calls.auth, event: f.calls.event },
      { partner: 3, auth: 1, event: 1 });
    if (result.kind === 'ATTEMPT') {
      assert.equal(result.outcome.kind, 'HTTP');
      if (result.outcome.kind === 'HTTP') assert.equal(result.outcome.responseSuccess, true);
      assert.equal(result.preQuantity, 0);
      assert.equal(result.afterTokenObservedAt, CLOCK);
    }
    const state = await new RunRegister(f.root).inspect();
    assert.equal(state.kind, 'READY');
    if (state.kind === 'READY') {
      assert.equal(state.state.tokenReservations, 1);
      assert.equal(state.state.postReservations, 1);
      assert.equal(Object.values(state.state.events)[0]?.attempts[0]?.state, 'DONE');
    }
  } finally { await cleanup(f.root); }
});

test('changed final contract prevents event request and consumes acquisition safely', async () => {
  const f = await fixture();
  try {
    assert.equal((await initializeRun(f.ports)).kind, 'INITIALIZED');
    f.setAlteredRead(3); // initial baseline is read #1, pre-send #2, post-token #3
    const result = await executeAttempt('E1', f.ports);
    assert.equal(result.kind, 'ATTEMPT');
    if (result.kind === 'ATTEMPT') assert.equal(result.outcome.kind, 'GUARD_REJECTED');
    assert.equal(f.calls.auth, 1);
    assert.equal(f.calls.event, 0);
    const state = await new RunRegister(f.root).inspect();
    assert.equal(state.kind, 'READY');
    if (state.kind === 'READY') {
      assert.equal(state.state.tokenReservations, 1);
      assert.equal(state.state.postReservations, 0);
    }
    assert.deepEqual(await executeAttempt('E1', f.ports),
      { kind: 'STOP', reason: 'UNRESOLVED_ATTEMPT' });
  } finally { await cleanup(f.root); }
});

test('post-acquisition wrong identity, nonzero terms and read errors never submit', async () => {
  for (const mutate of [
    (x:any) => { x.data.activeSubscription.shop.id = 'gid://shopify/Shop/1'; },
    (x:any) => { x.data.activeSubscription.items[0].price.amount = '0.01'; },
    (x:any) => { x.errors = [{ message: 'synthetic error' }]; },
  ]) {
    const f = await fixture();
    try {
      assert.equal((await initializeRun(f.ports)).kind, 'INITIALIZED');
      const original = f.ports.partnerFetch;
      f.ports.partnerFetch = (async (url: URL | RequestInfo, options?: RequestInit) => {
        const response = await original(url, options);
        if (f.calls.partner !== 3) return response;
        const body = await response.json(); mutate(body);
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
      const result = await executeAttempt('E1', f.ports);
      assert.equal(result.kind, 'ATTEMPT');
      if (result.kind === 'ATTEMPT') assert.equal(result.outcome.kind, 'GUARD_REJECTED');
      assert.equal(f.calls.event, 0);
    } finally { await cleanup(f.root); }
  }
});

test('native billing evidence gates exact replay and later distinct events', async () => {
  const f = await fixture();
  try {
    let quantity = 0;
    const original = f.ports.partnerFetch;
    f.ports.partnerFetch = (async (url: URL | RequestInfo, options?: RequestInit) => {
      const response = await original(url, options);
      const body = await response.json();
      body.data.activeSubscription.items[1].usage.quantity = quantity;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    assert.equal((await initializeRun(f.ports)).kind, 'INITIALIZED');
    assert.equal((await executeAttempt('E1', f.ports)).kind, 'ATTEMPT');
    assert.deepEqual(await executeAttempt('E1', f.ports),
      { kind: 'STOP', reason: 'BILLING_PROCESSING_NOT_PROVEN' });
    assert.equal(f.calls.event, 1);
    quantity = 1;
    const log = 'https://dev.shopify.com/dashboard/200969036/apps/429028933633/logs/123';
    assert.equal((await attestBilling('E1', 'processed', log, f.ports)).kind, 'ATTESTED');
    assert.equal((await executeAttempt('E1', f.ports)).kind, 'ATTEMPT');
    assert.equal(f.calls.bodies[0], f.calls.bodies[1]);
    assert.deepEqual(await executeAttempt('E2', f.ports),
      { kind: 'STOP', reason: 'BILLING_PROCESSING_NOT_PROVEN' });
    assert.equal((await attestBilling('E1', 'replay', null, f.ports)).kind, 'ATTESTED');
    assert.equal((await executeAttempt('E2', f.ports)).kind, 'ATTEMPT');
    assert.deepEqual(await executeAttempt('E3', f.ports),
      { kind: 'STOP', reason: 'BILLING_PROCESSING_NOT_PROVEN' });
    quantity = 2;
    assert.equal((await attestBilling('E2', 'processed', log, f.ports)).kind, 'ATTESTED');
    assert.equal((await executeAttempt('E3', f.ports)).kind, 'ATTEMPT');
    quantity = 3;
    assert.equal((await attestBilling('E3', 'processed', log, f.ports)).kind, 'ATTESTED');
    assert.equal(f.calls.auth, 4);
    assert.equal(f.calls.event, 4);
    assert.equal((await new RunRegister(f.root).inspect()).kind, 'READY');
  } finally { await cleanup(f.root); }
});
