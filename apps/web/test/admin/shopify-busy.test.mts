import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContextualPricingError, PartnerSubscriptionError, ShopifyAdminUnavailableError } from '@insignia/shopify';
import { shopifyBusy } from '../../src/server/admin/http.ts';

// The buyer API answers a throttled Partner subscription read as BUSY (spec §8.3). Admin routes keep
// their own decision: a Partner error's transience must not silently turn an admin 503 into 409 BUSY.
test('admin BUSY covers Admin API reads but not Partner subscription errors', () => {
  assert.equal(shopifyBusy(new ShopifyAdminUnavailableError('synthetic')), true);
  assert.equal(shopifyBusy(new ContextualPricingError('throttled')), true);
  for (const kind of ['rate_limited', 'provider_unavailable', 'network_or_timeout', 'provider_error'] as const)
    assert.equal(shopifyBusy(new PartnerSubscriptionError(kind)), false, kind);
});
