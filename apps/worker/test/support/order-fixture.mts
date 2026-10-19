import type { VerifiedOrder } from '@insignia/application';

/** Complete independent-read DTO for scenarios that exercise only the explicitly overridden boundary. */
export function orderFixture(overrides: Partial<VerifiedOrder>): VerifiedOrder {
  return {
    shopId: 'synthetic',
    installationGeneration: '1',
    orderId: 'gid://shopify/Order/1',
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
    observedAt: '2026-10-13T00:01:00Z',
    currency: 'EUR',
    country: null,
    marketId: null,
    contextVerified: false,
    totalPriceMinor: '0',
    test: false,
    edited: false,
    sourceApiVersion: '2026-07',
    complete: true,
    financialStatus: 'PENDING',
    cancelledAt: null,
    lines: [],
    transactions: [],
    refunds: [],
    ...overrides,
  };
}
