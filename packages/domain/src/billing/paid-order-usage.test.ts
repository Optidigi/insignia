import { describe, expect, it } from 'vitest';
import { type PaidOrderUsageHistory, qualifyPaidOrderUsage } from './paid-order-usage.js';

const purchase = {
  shopId: 'shop-a',
  installationGeneration: '3',
  orderId: 'order-a',
  isTest: false,
  hasVerifiedCustomization: true,
  firstPaidAt: '2026-10-15T12:00:00.000Z',
} as const;
const policy = { id: 'single-plan', version: '2026-10-10' };
const history = {
  kind: 'TRUSTED',
  shopId: 'shop-a',
  installationGeneration: '3',
  windows: [
    {
      kind: 'PAID',
      startsAt: '2026-10-10T00:00:00.000Z',
      endsAt: '2026-11-09T00:00:00.000Z',
      policy,
      cycleId: 'cycle-a',
      cycle: { startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-11-09T00:00:00.000Z' },
    },
  ],
} as const;

describe('first-paid order usage qualification', () => {
  it('qualifies one non-test customized order into its historical paid cycle', () => {
    expect(qualifyPaidOrderUsage({ purchase, policy, history })).toEqual({
      kind: 'ELIGIBLE',
      units: 1,
      shopId: 'shop-a',
      installationGeneration: '3',
      orderId: 'order-a',
      occurredAt: '2026-10-15T12:00:00.000Z',
      policy,
      cycleId: 'cycle-a',
    });
  });

  it('always excludes test orders without consulting unavailable or malformed history', () => {
    expect(
      qualifyPaidOrderUsage({ purchase: { ...purchase, isTest: true }, policy, history: { kind: 'UNAVAILABLE' } }),
    ).toEqual({ kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 });
    expect(qualifyPaidOrderUsage({ purchase: { ...purchase, isTest: true }, policy, history: null as never })).toEqual({
      kind: 'EXCLUDED',
      reason: 'TEST_ORDER',
      units: 0,
    });
  });

  it('holds unknown test/customization facts and excludes plain orders', () => {
    for (const isTest of [null, undefined, 'false', 0])
      expect(qualifyPaidOrderUsage({ purchase: { ...purchase, isTest: isTest as never }, policy, history })).toEqual({
        kind: 'UNRESOLVED',
        reason: 'TEST_STATUS_UNKNOWN',
        units: 0,
      });
    for (const hasVerifiedCustomization of [null, undefined, 'true', 1])
      expect(
        qualifyPaidOrderUsage({
          purchase: { ...purchase, hasVerifiedCustomization: hasVerifiedCustomization as never },
          policy,
          history,
        }),
      ).toEqual({ kind: 'UNRESOLVED', reason: 'CUSTOMIZATION_UNVERIFIED', units: 0 });
    expect(
      qualifyPaidOrderUsage({ purchase: { ...purchase, hasVerifiedCustomization: false }, policy, history }),
    ).toEqual({ kind: 'EXCLUDED', reason: 'PLAIN_ORDER', units: 0 });
  });

  it('waits for first full payment and refuses malformed immutable occurrence facts', () => {
    expect(qualifyPaidOrderUsage({ purchase: { ...purchase, firstPaidAt: null }, policy, history })).toEqual({
      kind: 'PENDING_PAYMENT',
      units: 0,
    });
    for (const firstPaidAt of [
      '',
      ' 2026-10-15T12:00:00.000Z',
      '2026-10-15',
      '2026-02-30T12:00:00.000Z',
      '2026-10-15T12:00:00',
      undefined,
      0,
    ])
      expect(
        qualifyPaidOrderUsage({ purchase: { ...purchase, firstPaidAt: firstPaidAt as never }, policy, history }),
      ).toEqual({ kind: 'UNRESOLVED', reason: 'INVALID_PURCHASE_FACTS', units: 0 });
    for (const key of ['shopId', 'installationGeneration', 'orderId'] as const)
      expect(qualifyPaidOrderUsage({ purchase: { ...purchase, [key]: '' }, policy, history })).toEqual({
        kind: 'UNRESOLVED',
        reason: 'INVALID_PURCHASE_FACTS',
        units: 0,
      });
  });

  it('keeps unavailable, unverified or wrong-scope history unresolved', () => {
    for (const [candidate, reason] of [
      [{ kind: 'UNAVAILABLE' }, 'HISTORY_UNAVAILABLE'],
      [{ kind: 'UNVERIFIED' }, 'HISTORY_UNVERIFIED'],
      [null, 'HISTORY_UNAVAILABLE'],
      [{ ...history, shopId: 'other-shop' }, 'HISTORY_SCOPE_MISMATCH'],
      [{ ...history, installationGeneration: '4' }, 'HISTORY_SCOPE_MISMATCH'],
    ] as const)
      expect(qualifyPaidOrderUsage({ purchase, policy, history: candidate as PaidOrderUsageHistory })).toEqual({
        kind: 'UNRESOLVED',
        reason,
        units: 0,
      });
  });

  it('waives a historical trial forever and starts paid eligibility exactly at its exclusive end', () => {
    const boundary = '2026-10-15T12:00:00.000Z';
    const trial = {
      kind: 'TRIAL',
      startsAt: '2026-10-01T12:00:00.000Z',
      endsAt: boundary,
      policy,
      trial: { startsAt: '2026-10-01T12:00:00.000Z', endsAt: boundary },
    } as const;
    const paid = {
      ...history.windows[0],
      startsAt: boundary,
      cycle: { startsAt: boundary, endsAt: '2026-11-14T12:00:00.000Z' },
    };
    const delayedHistory = { ...history, windows: [paid, trial] };
    expect(
      qualifyPaidOrderUsage({
        purchase: { ...purchase, firstPaidAt: '2026-10-15T11:59:59.999Z' },
        policy,
        history: delayedHistory,
      }),
    ).toEqual({
      kind: 'WAIVED_TRIAL',
      units: 0,
      shopId: 'shop-a',
      installationGeneration: '3',
      orderId: 'order-a',
      occurredAt: '2026-10-15T11:59:59.999Z',
    });
    expect(qualifyPaidOrderUsage({ purchase, policy, history: delayedHistory })).toMatchObject({
      kind: 'ELIGIBLE',
      units: 1,
      cycleId: 'cycle-a',
      occurredAt: boundary,
    });
  });

  it('distinguishes explicitly proven inactivity from a gap, without retrospective billing on reactivation', () => {
    const inactive = {
      kind: 'INACTIVE',
      startsAt: '2026-10-15T00:00:00.000Z',
      endsAt: '2026-10-16T00:00:00.000Z',
    } as const;
    const laterPaid = { ...history.windows[0], startsAt: '2026-10-16T00:00:00.000Z' };
    expect(
      qualifyPaidOrderUsage({ purchase, policy, history: { ...history, windows: [laterPaid, inactive] } }),
    ).toEqual({
      kind: 'UNBILLABLE_INACTIVE',
      units: 0,
      shopId: 'shop-a',
      installationGeneration: '3',
      orderId: 'order-a',
      occurredAt: '2026-10-15T12:00:00.000Z',
    });
    expect(qualifyPaidOrderUsage({ purchase, policy, history: { ...history, windows: [laterPaid] } })).toEqual({
      kind: 'UNRESOLVED',
      reason: 'HISTORY_GAP',
      units: 0,
    });
    expect(
      qualifyPaidOrderUsage({ purchase: { ...purchase, firstPaidAt: history.windows[0].endsAt }, policy, history }),
    ).toEqual({ kind: 'UNRESOLVED', reason: 'HISTORY_GAP', units: 0 });
  });

  it('rejects overlapping intervals rather than choosing whichever historical plan occurs first', () => {
    const overlap = { ...history.windows[0], cycleId: 'other-cycle' };
    for (const windows of [
      [history.windows[0], overlap],
      [overlap, history.windows[0]],
    ])
      expect(qualifyPaidOrderUsage({ purchase, policy, history: { ...history, windows } })).toEqual({
        kind: 'UNRESOLVED',
        reason: 'HISTORY_OVERLAP',
        units: 0,
      });
  });

  it('requires matching historical policy and an authoritative trial or cycle containing the event', () => {
    for (const mismatch of [
      { ...policy, id: 'other-policy' },
      { ...policy, version: 'future-version' },
    ])
      expect(qualifyPaidOrderUsage({ purchase, policy: mismatch, history })).toEqual({
        kind: 'UNRESOLVED',
        reason: 'POLICY_MISMATCH',
        units: 0,
      });
    const badPaid = {
      ...history.windows[0],
      cycle: { startsAt: '2026-10-16T00:00:00.000Z', endsAt: '2026-11-09T00:00:00.000Z' },
    };
    const badTrial = {
      ...history.windows[0],
      kind: 'TRIAL',
      trial: { startsAt: '2026-10-01T00:00:00.000Z', endsAt: purchase.firstPaidAt },
    } as const;
    for (const window of [badPaid, badTrial])
      expect(qualifyPaidOrderUsage({ purchase, policy, history: { ...history, windows: [window] } })).toEqual({
        kind: 'UNRESOLVED',
        reason: 'PERIOD_MISMATCH',
        units: 0,
      });
  });

  it('fails closed for malformed normalized intervals, policy identities and unbounded history input', () => {
    const malformedWindows = [
      null,
      { ...history.windows[0], startsAt: '2026-10-15' },
      { ...history.windows[0], endsAt: null },
      { ...history.windows[0], endsAt: history.windows[0].startsAt },
      { ...history.windows[0], kind: 'ACTIVE' },
      { ...history.windows[0], cycleId: '' },
      { ...history.windows[0], cycle: null },
      { ...history.windows[0], policy: null },
      { ...history.windows[0], policy: { id: 'single-plan', version: '' } },
    ];
    for (const window of malformedWindows)
      expect(
        qualifyPaidOrderUsage({
          purchase,
          policy,
          history: { ...history, windows: [window] } as PaidOrderUsageHistory,
        }),
      ).toEqual({ kind: 'UNRESOLVED', reason: 'INVALID_HISTORY', units: 0 });
    for (const windows of [null, Array(1025).fill(history.windows[0])])
      expect(
        qualifyPaidOrderUsage({ purchase, policy, history: { ...history, windows } as PaidOrderUsageHistory }),
      ).toEqual({ kind: 'UNRESOLVED', reason: 'INVALID_HISTORY', units: 0 });
    expect(qualifyPaidOrderUsage({ purchase, policy: null as never, history })).toEqual({
      kind: 'UNRESOLVED',
      reason: 'POLICY_MISMATCH',
      units: 0,
    });
    expect(
      qualifyPaidOrderUsage({ purchase, policy, history: { kind: 'CURRENT_ACTIVE_SUBSCRIPTION' } as never }),
    ).toEqual({ kind: 'UNRESOLVED', reason: 'INVALID_HISTORY', units: 0 });
  });

  it('keeps one occurrence per order regardless of garment/group counts or later refunds and cancellations', () => {
    const manyGarments = {
      ...purchase,
      customizedQuantity: 500,
      customizationGroups: 12,
      refunded: true,
      cancelled: true,
    };
    const result = qualifyPaidOrderUsage({ purchase: manyGarments, policy, history });
    expect(result).toMatchObject({
      kind: 'ELIGIBLE',
      units: 1,
      orderId: 'order-a',
      occurredAt: '2026-10-15T12:00:00.000Z',
    });
    expect(
      qualifyPaidOrderUsage({
        purchase: { ...manyGarments, orderId: 'separate-order-reusing-offer' },
        policy,
        history,
      }),
    ).toMatchObject({ kind: 'ELIGIBLE', units: 1, orderId: 'separate-order-reusing-offer' });
    // Repeated qualification is intentionally not durable deduplication or a usage write.
    expect(qualifyPaidOrderUsage({ purchase: manyGarments, policy, history })).toEqual(result);
  });

  it('rejects noncanonical installation generations and control-bearing identifiers', () => {
    for (const installationGeneration of ['0', '03', '-1', '3.0', 'generation-three'])
      expect(
        qualifyPaidOrderUsage({
          purchase: { ...purchase, installationGeneration },
          policy,
          history: { ...history, installationGeneration },
        }),
      ).toEqual({ kind: 'UNRESOLVED', reason: 'INVALID_PURCHASE_FACTS', units: 0 });
    for (const key of ['shopId', 'orderId'] as const)
      expect(qualifyPaidOrderUsage({ purchase: { ...purchase, [key]: 'part\u0000other' }, policy, history })).toEqual({
        kind: 'UNRESOLVED',
        reason: 'INVALID_PURCHASE_FACTS',
        units: 0,
      });
    expect(qualifyPaidOrderUsage({ purchase, policy: { ...policy, id: 'plan\u007fother' }, history })).toEqual({
      kind: 'UNRESOLVED',
      reason: 'POLICY_MISMATCH',
      units: 0,
    });
  });
});
