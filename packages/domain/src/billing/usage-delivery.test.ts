import { describe, expect, it } from 'vitest';
import { classifyUsageDeliveryOutcome } from './usage-delivery.js';

describe('usage delivery evidence', () => {
  it('holds a persisted dispatch marker without a response and never treats a raw202 as validated receipt', () => {
    expect(classifyUsageDeliveryOutcome(null)).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'OUTCOME_UNRECORDED',
    });
    expect(classifyUsageDeliveryOutcome({ kind: 'HTTP', httpStatus: 202 })).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'UNVERIFIED_RESPONSE',
      httpStatus: 202,
    });
  });
  it('separates a validated202 receipt from proof of no dispatch, without any billed state', () => {
    expect(classifyUsageDeliveryOutcome({ kind: 'RECEIPT', httpStatus: 202 })).toEqual({
      state: 'TRANSPORT_ACCEPTED',
      reason: 'RECEIVED',
      httpStatus: 202,
    });
    expect(classifyUsageDeliveryOutcome({ kind: 'NOT_DISPATCHED' })).toEqual({
      state: 'PENDING',
      reason: 'NOT_DISPATCHED',
    });
  });
  it('holds unknown, processing, rejected and server-error attempts without permitting automatic dispatch', () => {
    expect(classifyUsageDeliveryOutcome({ kind: 'UNKNOWN' })).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'UNKNOWN_OUTCOME',
    });
    expect(classifyUsageDeliveryOutcome({ kind: 'HTTP', httpStatus: 409 })).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'PROCESSING',
      httpStatus: 409,
    });
    expect(classifyUsageDeliveryOutcome({ kind: 'HTTP', httpStatus: 400 })).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'HTTP_REJECTED',
      httpStatus: 400,
    });
    expect(classifyUsageDeliveryOutcome({ kind: 'HTTP', httpStatus: 429 })).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'HTTP_REJECTED',
      httpStatus: 429,
    });
    expect(classifyUsageDeliveryOutcome({ kind: 'HTTP', httpStatus: 503 })).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      reason: 'UNVERIFIED_RESPONSE',
      httpStatus: 503,
    });
  });

  it('rejects malformed or payload-bearing evidence before it can be persisted', () => {
    for (const input of [
      undefined,
      [],
      {},
      { kind: 'BILLED' },
      { kind: 'UNKNOWN', payload: 'private' },
      { kind: 'NOT_DISPATCHED', httpStatus: 202 },
      { kind: 'RECEIPT', httpStatus: 200 },
      { kind: 'HTTP', httpStatus: '202' },
      { kind: 'HTTP', httpStatus: 99 },
      { kind: 'HTTP', httpStatus: 600 },
      { kind: 'HTTP', httpStatus: 202.5 },
      { kind: 'HTTP', httpStatus: NaN },
      { kind: 'HTTP', httpStatus: 202, body: 'private' },
    ])
      expect(() => classifyUsageDeliveryOutcome(input as never)).toThrow('USAGE_DELIVERY_OUTCOME_INVALID');
  });
});
