import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { REAL_ACTIVE_QUERY, readExactPartnerContract } from '../src/partner.ts';

const envelope = JSON.parse(readFileSync(new URL('../evidence/baseline/partner-active-after-approval.json', import.meta.url), 'utf8'));
function ports(body: unknown = envelope.body, status = 200) {
  const calls: Array<{url:string; options:RequestInit}> = [];
  return { calls, input: { token: 'synthetic-partner-token',
    cycleFrom: '2026-09-28T16:53:01Z', cycleUntil: '2026-10-28T16:53:01Z',
    now: () => '2026-09-28T17:00:00Z',
    fetch: (async (url: URL | RequestInfo, options: RequestInit = {}) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch } };
}

test('fixed Partner 2026-07 query preserves two-item real profile and returns sanitized contract', async () => {
  const { calls, input } = ports();
  const result = await readExactPartnerContract(input);
  assert.equal(result.kind, 'READ');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://partners.shopify.com/4697030/api/2026-07/graphql.json');
  assert.equal(calls[0]?.options.redirect, 'manual');
  assert.equal(calls[0]?.options.headers &&
    (calls[0].options.headers as Record<string,string>)['X-Shopify-Access-Token'], input.token);
  const request = JSON.parse(String(calls[0]?.options.body));
  assert.equal(request.query, REAL_ACTIVE_QUERY);
  assert.deepEqual(request.variables, { appId: 'gid://shopify/App/429028933633',
    shopId: 'gid://shopify/Shop/105501393179' });
  assert.match(request.query, /description discount \{ __typename \}/);
  if (result.kind === 'READ') {
    assert.equal(result.contract.plan.catalogPriceActive, false);
    assert.equal(result.contract.meter.tier.amountPerUnit, '0.0');
    assert.equal(result.contract.usage.kind, 'OBSERVED');
    assert.equal(JSON.stringify(result).includes(input.token), false);
  }
});

test('fresh Partner read rejects null, GraphQL error, financial change and authentication denial', async () => {
  for (const mutation of [
    (x:any) => { x.data.activeSubscription = null; },
    (x:any) => { x.errors = [{ message: 'forbidden' }]; },
    (x:any) => { x.data.activeSubscription.items[1].price.tiers[0].amountPerUnit = '0.01'; },
    (x:any) => { x.data.activeSubscription.currentBillingCycle.endTime = '2026-11-01T00:00:00Z'; },
  ]) {
    const body = structuredClone(envelope.body); mutation(body);
    assert.equal((await readExactPartnerContract(ports(body).input)).kind, 'REJECTED');
  }
  const denied = await readExactPartnerContract(ports(envelope.body, 403).input);
  assert.deepEqual(denied, { kind: 'REJECTED', reason: 'AUTH', status: 403 });
});
