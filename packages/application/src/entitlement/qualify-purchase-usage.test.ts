import { type PaidOrderUsageQualification, qualifyPaidOrderUsage } from '@insignia/domain';
import { describe, expect, it, vi } from 'vitest';
import { createPurchaseUsageQualifier, type PurchaseUsageLedgerRecord } from './qualify-purchase-usage.js';
import type { CurrentCycleUsageHistoryInput } from './usage-history.js';

const scope = { shopId: 'tenant-1', installationGeneration: '1' };
const purchaseId = '15a78278-f08b-4ee6-a07e-452a118896de';
const policy = { id: 'qualified-billing', version: 'v1' };
const held: PaidOrderUsageQualification = { kind: 'UNRESOLVED', reason: 'HISTORY_UNVERIFIED', units: 0 };
const row = (decision: PaidOrderUsageQualification): PurchaseUsageLedgerRecord => ({ ...scope, purchaseId, decision });
function source(): CurrentCycleUsageHistoryInput {
  return {
    installation: {
      tenantShopId: scope.shopId,
      generation: '1',
      appId: 'gid://shopify/App/11',
      providerShopId: 'gid://shopify/Shop/22',
      activatedAt: '2026-10-11T00:00:00.000Z',
      deactivatedAt: null,
    },
    binding: {
      appId: 'gid://shopify/App/11',
      shopId: 'gid://shopify/Shop/22',
      planHandle: 'qualified-plan',
      usageHandle: 'meter',
      policy,
    },
    current: {
      schemaVersion: 'm4-active-subscription-v1',
      sourceApiVersion: '2026-07',
      appId: 'gid://shopify/App/11',
      shopId: 'gid://shopify/Shop/22',
      tenantShopId: scope.shopId,
      installationGeneration: '1',
      observedAt: '2026-10-15T12:01:00.000Z',
      active: true,
      billingPeriod: 'EVERY_30_DAYS',
      trialEndsAt: null,
      pendingUpdate: null,
      cancelAtEndOfCycle: false,
      currentBillingCycle: { startTime: '2026-10-01T00:00:00.000Z', endTime: '2026-10-31T00:00:00.000Z' },
      items: [
        { handle: 'qualified-plan', price: { kind: 'flat', active: true }, usage: null },
        { handle: 'meter', price: { kind: 'tiered', active: true }, usage: { quantity: '0' } },
      ],
    },
    range: {
      sourceApiVersion: '2026-07',
      appId: 'gid://shopify/App/11',
      shopId: 'gid://shopify/Shop/22',
      from: '2026-09-30T00:00:00.000Z',
      through: '2026-10-15T12:01:01.000Z',
      observedAt: '2026-10-15T12:01:02.000Z',
      pagesRead: 1,
      pagination: 'EXHAUSTED',
      nextCursor: null,
      trustedEntitlementIntervals: false,
      events: [
        {
          id: 'gid://partners/SubscriptionStatus/one',
          cursor: 'one',
          occurredAt: '2026-10-01T00:00:00.000Z',
          eventType: 'SUBSCRIPTION_CREATED',
          state: 'CREATED',
          cancelEffectiveOn: null,
          plan: { handle: 'qualified-plan', billingPeriod: 'EVERY_30_DAYS', trialDays: 14, trialDaysRemaining: 0 },
        },
      ],
    },
  };
}

describe('purchase usage qualification composition', () => {
  it('does not read source for test, unpaid, incomplete or existing terminal decisions', async () => {
    const decisions: PaidOrderUsageQualification[] = [
      { kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 },
      { kind: 'PENDING_PAYMENT', units: 0 },
      { kind: 'UNRESOLVED', reason: 'CUSTOMIZATION_UNVERIFIED', units: 0 },
      { kind: 'UNRESOLVED', reason: 'TEST_STATUS_UNKNOWN', units: 0 },
      { kind: 'WAIVED_TRIAL', units: 0, ...scope, orderId: 'order-1', occurredAt: '2026-10-15T12:00:00.000Z' },
    ];
    for (const decision of decisions) {
      const record = vi.fn().mockResolvedValue(row(decision)),
        loadCurrentCycleInput = vi.fn();
      const result = await createPurchaseUsageQualifier({ ledger: { record }, loadCurrentCycleInput }).qualify(scope, {
        purchaseId,
      });
      expect(result).toEqual({ kind: 'RECORDED', record: row(decision) });
      expect(record).toHaveBeenCalledExactlyOnceWith(scope, {
        purchaseId,
        policy: null,
        history: { kind: 'UNVERIFIED' },
      });
      expect(loadCurrentCycleInput).not.toHaveBeenCalled();
    }
  });
  it('normalizes verified source and records against ledger-owned immutable purchase facts', async () => {
    const record = vi.fn(async (_scope, input) =>
      row(
        qualifyPaidOrderUsage({
          purchase: {
            ...scope,
            orderId: 'immutable-order',
            isTest: false,
            hasVerifiedCustomization: true,
            firstPaidAt: '2026-10-15T12:00:00.000Z',
          },
          policy: input.policy,
          history: input.history,
        }),
      ),
    );
    const loadCurrentCycleInput = vi.fn().mockResolvedValue(source());
    const result = await createPurchaseUsageQualifier({ ledger: { record }, loadCurrentCycleInput }).qualify(scope, {
      purchaseId,
    });
    expect(result.record.decision).toMatchObject({
      kind: 'ELIGIBLE',
      units: 1,
      orderId: 'immutable-order',
      occurredAt: '2026-10-15T12:00:00.000Z',
    });
    expect(loadCurrentCycleInput).toHaveBeenCalledExactlyOnceWith(scope);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1]?.[1]).toMatchObject({
      purchaseId,
      policy,
      history: { kind: 'TRUSTED', shopId: scope.shopId, installationGeneration: '1' },
    });
  });
  it('records missing qualified policy as null with unverified history, without creating a sentinel', async () => {
    const observed = source();
    observed.binding = null;
    const record = vi.fn().mockResolvedValue(row(held));
    const result = await createPurchaseUsageQualifier({
      ledger: { record },
      loadCurrentCycleInput: async () => observed,
    }).qualify(scope, { purchaseId });
    expect(result).toEqual({ kind: 'RECORDED', record: row(held) });
    expect(record).toHaveBeenNthCalledWith(2, scope, { purchaseId, policy: null, history: { kind: 'UNVERIFIED' } });
  });
  it('sanitizes source failures and does not retry or overwrite the unresolved preflight', async () => {
    const record = vi.fn().mockResolvedValue(row(held)),
      loadCurrentCycleInput = vi.fn().mockRejectedValue(new Error('private-token-and-provider-body'));
    const result = await createPurchaseUsageQualifier({ ledger: { record }, loadCurrentCycleInput }).qualify(scope, {
      purchaseId,
    });
    expect(result).toEqual({ kind: 'SOURCE_UNAVAILABLE', record: row(held) });
    expect(record).toHaveBeenCalledTimes(1);
    expect(loadCurrentCycleInput).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
  it('rejects foreign source tenant/generation before the final ledger call', async () => {
    for (const field of ['tenantShopId', 'generation'] as const) {
      const observed = source();
      observed.installation[field] = 'other';
      const record = vi.fn().mockResolvedValue(row(held));
      expect(
        await createPurchaseUsageQualifier({ ledger: { record }, loadCurrentCycleInput: async () => observed }).qualify(
          scope,
          { purchaseId },
        ),
      ).toEqual({ kind: 'SCOPE_MISMATCH', record: row(held) });
      expect(record).toHaveBeenCalledTimes(1);
    }
  });
  it('holds trusted paid/trial history with a null expected policy while preserving earlier exclusions', () => {
    const purchase = {
      ...scope,
      orderId: 'immutable-order',
      isTest: false,
      hasVerifiedCustomization: true,
      firstPaidAt: '2026-10-15T12:00:00.000Z',
    };
    const interval = { startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z' };
    for (const segment of [
      { kind: 'PAID', ...interval, cycle: interval, cycleId: 'cycle', policy },
      { kind: 'TRIAL', ...interval, trial: interval, policy },
    ] as const) {
      expect(
        qualifyPaidOrderUsage({ purchase, policy: null, history: { kind: 'TRUSTED', ...scope, windows: [segment] } }),
      ).toMatchObject({ kind: 'UNRESOLVED', reason: 'POLICY_MISMATCH', units: 0 });
    }
    expect(
      qualifyPaidOrderUsage({ purchase: { ...purchase, isTest: true }, policy: null, history: { kind: 'UNVERIFIED' } }),
    ).toEqual({ kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 });
  });

  it('pins purchase and scope before awaiting and isolates source callback mutations', async () => {
    const callerScope = { ...scope },
      callerInput = { purchaseId };
    const record = vi
      .fn()
      .mockImplementationOnce(async () => {
        callerScope.shopId = 'foreign';
        callerInput.purchaseId = 'foreign-purchase';
        return row(held);
      })
      .mockResolvedValue(row(held));
    const loadCurrentCycleInput = vi.fn(async (received) => {
      received.shopId = 'another';
      return source();
    });
    const result = await createPurchaseUsageQualifier({ ledger: { record }, loadCurrentCycleInput }).qualify(
      callerScope,
      callerInput,
    );
    expect(result).toEqual({ kind: 'RECORDED', record: row(held) });
    expect(record).toHaveBeenNthCalledWith(2, scope, expect.objectContaining({ purchaseId }));
  });
  it('rejects an inconsistent ledger identity without exposing that record or reading source', async () => {
    const record = vi.fn().mockResolvedValue({ ...row(held), purchaseId: 'foreign-purchase' }),
      loadCurrentCycleInput = vi.fn();
    await expect(
      createPurchaseUsageQualifier({ ledger: { record }, loadCurrentCycleInput }).qualify(scope, { purchaseId }),
    ).rejects.toThrow('Usage ledger identity mismatch');
    expect(loadCurrentCycleInput).not.toHaveBeenCalled();
  });
});
