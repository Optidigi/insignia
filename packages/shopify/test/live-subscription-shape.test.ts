import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createActiveSubscriptionClient } from '../src/active-subscription.js';
import { jsonRecord, record, string } from './fixture-assertions.js';

const fixtureRoot = new URL('../fixtures/partner-subscription/', import.meta.url);

describe('designated read-only Partner response shape', () => {
  it('preserves the observed expired-trial/current-cycle transition without inventing trial expiry or payment facts', async () => {
    const fixture = jsonRecord(readFileSync(new URL('expired-trial-current-cycle.json', fixtureRoot), 'utf8'));
    const client = createActiveSubscriptionClient({
      transport: { query: async () => JSON.stringify(fixture.response) },
      now: () => new Date(string(fixture.observedAt)),
    });
    const actual = await client.read({
      appId: 'gid://shopify/App/900000000003',
      shopId: 'gid://shopify/Shop/900000000004',
    });
    expect(actual).toMatchObject({
      observedAt: fixture.observedAt,
      active: true,
      trialEndsAt: '2026-10-31T10:57:49.000Z',
      currentBillingCycle: { startTime: '2026-10-31T10:57:49.000Z', endTime: '2026-11-30T10:57:49.000Z' },
      items: [{ handle: 'insignia-standard-20261015', price: { active: false, amount: '0.0', currency: 'USD' } }],
    });
    expect(actual).not.toHaveProperty('paid');
  });
  it('normalizes the identity-sanitized recorded shape without treating price.active false as cancellation', async () => {
    const fixture = readFileSync(new URL('partner-response.json', fixtureRoot), 'utf8');
    const expected = jsonRecord(readFileSync(new URL('expected-snapshot.json', fixtureRoot), 'utf8'));
    const client = createActiveSubscriptionClient({
      transport: { query: async () => fixture },
      now: () => new Date(string(record(expected.normalized).observedAt)),
    });
    const actual = await client.read({
      appId: string(record(expected.normalized).appId),
      shopId: string(record(expected.normalized).shopId),
    });
    expect(actual).toEqual(expected.normalized);
    expect(actual.active).toBe(true);
    expect(actual.items.every((item) => item.price.active === false)).toBe(true);
    expect(actual.items.find((item) => item.price.kind === 'tiered')?.usage?.quantity).toBe('3.0');
  });
});
