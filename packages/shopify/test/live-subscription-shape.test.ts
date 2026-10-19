import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createActiveSubscriptionClient } from '../src/active-subscription.js';
import { jsonRecord, record, string } from './fixture-assertions.js';

const fixtureRoot = new URL('../fixtures/partner-subscription/', import.meta.url);

describe('designated read-only Partner response shape', () => {
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
