import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createActiveSubscriptionClient } from '../src/active-subscription.js';

const evidenceRoot = new URL('../../../docs/delivery/evidence/m4-001/', import.meta.url);

describe('designated read-only Partner response shape', () => {
  it('normalizes the sanitized live shape without treating price.active false as cancellation', async () => {
    const fixture = readFileSync(new URL('sanitized-live-partner-fixture.json', evidenceRoot), 'utf8');
    const expected = JSON.parse(readFileSync(new URL('normalized-live-partner-snapshot.json', evidenceRoot), 'utf8'));
    const client = createActiveSubscriptionClient({
      transport: { query: async () => fixture },
      now: () => new Date(expected.normalized.observedAt),
    });
    const actual = await client.read({ appId: expected.normalized.appId, shopId: expected.normalized.shopId });
    expect(actual).toEqual(expected.normalized);
    expect(actual.active).toBe(true);
    expect(actual.items.every((item) => item.price.active === false)).toBe(true);
    expect(actual.items.find((item) => item.price.kind === 'tiered')?.usage?.quantity).toBe('3.0');
  });
});
