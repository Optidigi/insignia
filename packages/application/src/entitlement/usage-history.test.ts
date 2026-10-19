import { qualifyPaidOrderUsage } from '@insignia/domain';
import { describe, expect, it } from 'vitest';
import { type CurrentCycleUsageHistoryInput, normalizeCurrentCycleUsageHistory } from './usage-history.js';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Invalid test fixture');
  return value;
}
function fixture(): CurrentCycleUsageHistoryInput {
  return {
    installation: {
      tenantShopId: 'tenant-1',
      providerShopId: 'gid://shopify/Shop/22',
      appId: 'gid://shopify/App/11',
      generation: '1',
      activatedAt: '2026-10-11T10:00:00.000Z',
      deactivatedAt: null,
    },
    binding: {
      appId: 'gid://shopify/App/11',
      shopId: 'gid://shopify/Shop/22',
      planHandle: 'qualified-plan',
      usageHandle: 'qualified-meter',
      policy: { id: 'billing-policy', version: 'v1' },
    },
    current: {
      schemaVersion: 'm4-active-subscription-v1',
      sourceApiVersion: '2026-07',
      appId: 'gid://shopify/App/11',
      shopId: 'gid://shopify/Shop/22',
      tenantShopId: 'tenant-1',
      installationGeneration: '1',
      observedAt: '2026-10-15T15:00:00.000Z',
      active: true,
      billingPeriod: 'EVERY_30_DAYS',
      cancelAtEndOfCycle: false,
      trialEndsAt: null,
      pendingUpdate: null,
      currentBillingCycle: { startTime: '2026-09-28T16:53:01.000Z', endTime: '2026-10-28T16:53:01.000Z' },
      items: [
        { handle: 'qualified-plan', price: { kind: 'flat', active: true }, usage: null },
        { handle: 'qualified-meter', price: { kind: 'tiered', active: true }, usage: { quantity: '3' } },
      ],
    },
    range: {
      sourceApiVersion: '2026-07',
      appId: 'gid://shopify/App/11',
      shopId: 'gid://shopify/Shop/22',
      from: '2026-09-27T00:00:00.000Z',
      through: '2026-10-15T15:00:01.000Z',
      observedAt: '2026-10-15T15:00:02.000Z',
      pagesRead: 1,
      pagination: 'EXHAUSTED',
      nextCursor: null,
      trustedEntitlementIntervals: false,
      events: [
        {
          id: 'gid://partners/SubscriptionStatus/created',
          cursor: 'cursor-1',
          occurredAt: '2026-09-28T16:53:02.000Z',
          eventType: 'SUBSCRIPTION_CREATED',
          state: 'CREATED',
          cancelEffectiveOn: null,
          plan: { handle: 'qualified-plan', billingPeriod: 'EVERY_30_DAYS', trialDays: 0, trialDaysRemaining: 0 },
        },
      ],
    },
  };
}
function qualify(input: CurrentCycleUsageHistoryInput, at = '2026-10-12T12:00:00.000Z') {
  const result = normalizeCurrentCycleUsageHistory(input);
  return qualifyPaidOrderUsage({
    purchase: {
      shopId: 'tenant-1',
      installationGeneration: '1',
      orderId: 'order-123',
      isTest: false,
      hasVerifiedCustomization: true,
      firstPaidAt: at,
    },
    policy: { id: 'billing-policy', version: 'v1' },
    history: result.history,
  });
}
describe('same-current-cycle historical usage qualification', () => {
  it('qualifies a delayed first-paid purchase within complete scoped cycle coverage as one unit', () => {
    const input = fixture();
    required(required(input.range.events[0]).plan).trialDays = 14;
    required(required(input.range.events[0]).plan).trialDaysRemaining = 0;
    expect(qualify(input)).toMatchObject({ kind: 'ELIGIBLE', units: 1, occurredAt: '2026-10-12T12:00:00.000Z' });
  });
  it('never promotes the native development plan without a qualified billing binding', () => {
    const input = fixture();
    input.binding = null;
    required(input.current.items[0]).handle = 'insignia-dev-zero-20260928';
    required(required(input.range.events[0]).plan).handle = 'insignia-dev-zero-20260928';
    expect(normalizeCurrentCycleUsageHistory(input)).toEqual({
      kind: 'UNRESOLVED',
      reason: 'UNRECOGNIZED_POLICY',
      history: { kind: 'UNVERIFIED' },
    });
    expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
  });
  it('rejects cross-tenant, provider, application, generation and binding scope substitutions', () => {
    const changes: ((input: CurrentCycleUsageHistoryInput) => void)[] = [
      (i) => {
        i.current.tenantShopId = 'other';
      },
      (i) => {
        i.current.installationGeneration = '2';
      },
      (i) => {
        i.current.appId = 'gid://shopify/App/99';
      },
      (i) => {
        i.current.shopId = 'gid://shopify/Shop/99';
      },
      (i) => {
        i.range.appId = 'gid://shopify/App/99';
      },
      (i) => {
        i.range.shopId = 'gid://shopify/Shop/99';
      },
      (i) => {
        required(i.binding).appId = 'gid://shopify/App/99';
      },
      (i) => {
        required(i.binding).shopId = 'gid://shopify/Shop/99';
      },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(normalizeCurrentCycleUsageHistory(input)).toMatchObject({ kind: 'UNRESOLVED', reason: 'SCOPE_MISMATCH' });
    }
  });
  it('requires exhausted range coverage containing CREATED through the current observation', () => {
    const changes: ((input: CurrentCycleUsageHistoryInput) => void)[] = [
      (i) => {
        i.range.pagination = 'PAGE_LIMIT';
        i.range.nextCursor = 'more';
      },
      (i) => {
        i.range.through = '2026-10-15T14:59:59.000Z';
      },
      (i) => {
        i.range.from = '2026-09-29T00:00:00.000Z';
      },
      (i) => {
        i.range.events = [];
      },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
    }
  });

  it('preserves the one-second cycle/creation gap and half-open observation boundary', () => {
    const input = fixture();
    input.installation.activatedAt = '2026-09-27T00:00:00.000Z';
    expect(qualify(input, '2026-09-28T16:53:01.999Z')).toMatchObject({
      kind: 'UNRESOLVED',
      reason: 'HISTORY_GAP',
      units: 0,
    });
    expect(qualify(input, '2026-09-28T16:53:02.000Z')).toMatchObject({ kind: 'ELIGIBLE', units: 1 });
    expect(qualify(input, '2026-10-15T14:59:59.999Z')).toMatchObject({ kind: 'ELIGIBLE', units: 1 });
    expect(qualify(input, '2026-10-15T15:00:00.000Z')).toMatchObject({
      kind: 'UNRESOLVED',
      reason: 'HISTORY_GAP',
      units: 0,
    });
    expect(qualify(input, '2026-10-28T16:53:01.000Z')).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
  });
  it('never covers pre-installation facts or a deactivated installation', () => {
    const input = fixture();
    expect(qualify(input, '2026-10-11T09:59:59.999Z')).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
    expect(qualify(input, '2026-10-11T10:00:00.000Z')).toMatchObject({ kind: 'ELIGIBLE', units: 1 });
    input.installation.deactivatedAt = '2026-10-13T10:00:00.000Z';
    expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
  });
  it('keeps stable cycle identity across later observations without extending an earlier result', () => {
    const input = fixture(),
      before = normalizeCurrentCycleUsageHistory(input);
    input.current.observedAt = '2026-10-15T15:00:00.500Z';
    const after = normalizeCurrentCycleUsageHistory(input);
    expect(before.kind).toBe('NORMALIZED');
    expect(after.kind).toBe('NORMALIZED');
    if (before.kind === 'NORMALIZED' && after.kind === 'NORMALIZED') {
      expect(before.history.windows[0]).toMatchObject({
        cycleId: 'partner-2026-07:11:22:2026-09-28T16:53:01.000Z/2026-10-28T16:53:01.000Z',
        endsAt: '2026-10-15T15:00:00.000Z',
      });
      expect(after.history.windows[0]).toMatchObject({
        cycleId: 'partner-2026-07:11:22:2026-09-28T16:53:01.000Z/2026-10-28T16:53:01.000Z',
        endsAt: '2026-10-15T15:00:00.500Z',
      });
    }
  });
  it('holds trial, pending, inactive, scheduled and non-monthly snapshots', () => {
    const changes: ((input: CurrentCycleUsageHistoryInput) => void)[] = [
      (i) => {
        i.current.trialEndsAt = '2026-10-16T00:00:00.000Z';
        i.current.currentBillingCycle = null;
      },
      (i) => {
        i.current.pendingUpdate = { billingPeriod: 'EVERY_30_DAYS', itemHandles: ['next'] };
      },
      (i) => {
        i.current.cancelAtEndOfCycle = true;
      },
      (i) => {
        i.current.active = false;
      },
      (i) => {
        i.current.billingPeriod = 'ANNUAL';
      },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
    }
  });
  it('holds every extra transition, duplicate event, unknown state and malformed trial counts', () => {
    const changes: ((input: CurrentCycleUsageHistoryInput) => void)[] = [
      (i) => {
        i.range.events = [
          ...i.range.events,
          {
            ...required(i.range.events[0]),
            id: 'gid://partners/SubscriptionStatus/update',
            cursor: 'cursor-2',
            occurredAt: '2026-10-12T00:00:00.000Z',
            eventType: 'SUBSCRIPTION_UPDATED',
            state: 'UPDATED',
          },
        ];
      },
      (i) => {
        i.range.events = [...i.range.events, required(i.range.events[0])];
      },
      (i) => {
        required(i.range.events[0]).state = 'ACTIVE';
      },
      (i) => {
        required(i.range.events[0]).eventType = 'SUBSCRIPTION_UNFROZEN';
      },
      (i) => {
        required(required(i.range.events[0]).plan).trialDays = -1;
      },
      (i) => {
        required(required(i.range.events[0]).plan).trialDaysRemaining = 0.5;
      },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
    }
  });
  it('requires matching complete plan and usage policy identities', () => {
    const changes: ((input: CurrentCycleUsageHistoryInput) => void)[] = [
      (i) => {
        required(required(i.range.events[0]).plan).handle = 'other';
      },
      (i) => {
        required(required(i.range.events[0]).plan).billingPeriod = 'ANNUAL';
      },
      (i) => {
        required(i.current.items[1]).handle = 'other';
      },
      (i) => {
        i.current.items.push(required(i.current.items[0]));
      },
      (i) => {
        required(i.binding).policy = { id: 'billing-policy', version: '' };
      },
      (i) => {
        required(i.binding).usageHandle = required(i.binding).planHandle;
      },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
    }
  });
  it('fails closed for malformed source timestamps, identities and DTO shapes', () => {
    const changes: ((input: CurrentCycleUsageHistoryInput) => void)[] = [
      (i) => {
        i.installation.generation = '0';
      },
      (i) => {
        i.installation.tenantShopId = 'tenant\n1';
      },
      (i) => {
        i.current.observedAt = '2026-02-30T15:00:00.000Z';
      },
      (i) => {
        i.range.observedAt = '2026-10-15T14:00:00.000Z';
      },
      (i) => {
        required(i.current.currentBillingCycle).endTime = required(i.current.currentBillingCycle).startTime;
      },
      (i) => {
        i.range.pagesRead = 0;
      },
      (i) => {
        required(i.range.events[0]).occurredAt = '2026-10-16T00:00:00.000Z';
      },
      (i) => {
        // Missing provider snapshot is deliberate malformed runtime input.
        i.current = null as never;
      },
      (i) => {
        // Missing history range is deliberate malformed runtime input.
        i.range = null as never;
      },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(() => normalizeCurrentCycleUsageHistory(input)).not.toThrow();
      expect(qualify(input)).toMatchObject({ kind: 'UNRESOLVED', units: 0 });
    }
  });
});
