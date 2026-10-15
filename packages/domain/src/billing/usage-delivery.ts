/** Normalized backend evidence, not arbitrary provider JSON. RECEIPT requires a separately
 * validated202 response; no transport response proves billing processing or payment. */
export type UsageDeliveryOutcome =
  | { readonly kind: 'NOT_DISPATCHED' }
  | { readonly kind: 'RECEIPT'; readonly httpStatus: 202 }
  | { readonly kind: 'HTTP'; readonly httpStatus: number }
  | { readonly kind: 'UNKNOWN' };

export type UsageDeliveryDisposition =
  | { readonly state: 'PENDING'; readonly reason: 'NOT_DISPATCHED' }
  | { readonly state: 'TRANSPORT_ACCEPTED'; readonly reason: 'RECEIVED'; readonly httpStatus: 202 }
  | {
      readonly state: 'RECONCILIATION_REQUIRED';
      readonly reason:
        | 'OUTCOME_UNRECORDED'
        | 'UNKNOWN_OUTCOME'
        | 'HTTP_REJECTED'
        | 'PROCESSING'
        | 'UNVERIFIED_RESPONSE';
      readonly httpStatus?: number;
    };

/** A null outcome is a durable pre-dispatch marker, never proof that nothing was sent. */
export function classifyUsageDeliveryOutcome(outcome: UsageDeliveryOutcome | null): UsageDeliveryDisposition {
  if (outcome === null) return { state: 'RECONCILIATION_REQUIRED', reason: 'OUTCOME_UNRECORDED' };
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome))
    throw new Error('USAGE_DELIVERY_OUTCOME_INVALID');
  const hasStatus = outcome.kind === 'HTTP' || outcome.kind === 'RECEIPT';
  if (
    Object.keys(outcome).sort().join(',') !== (hasStatus ? 'httpStatus,kind' : 'kind') ||
    (hasStatus && (!Number.isInteger(outcome.httpStatus) || outcome.httpStatus < 100 || outcome.httpStatus > 599))
  )
    throw new Error('USAGE_DELIVERY_OUTCOME_INVALID');
  if (outcome.kind === 'NOT_DISPATCHED') return { state: 'PENDING', reason: 'NOT_DISPATCHED' };
  if (outcome?.kind === 'RECEIPT' && outcome.httpStatus === 202)
    return { state: 'TRANSPORT_ACCEPTED', reason: 'RECEIVED', httpStatus: 202 };
  if (outcome?.kind === 'UNKNOWN') return { state: 'RECONCILIATION_REQUIRED', reason: 'UNKNOWN_OUTCOME' };
  if (outcome?.kind === 'HTTP')
    return {
      state: 'RECONCILIATION_REQUIRED',
      reason:
        outcome.httpStatus === 409
          ? 'PROCESSING'
          : [400, 401, 403, 429].includes(outcome.httpStatus)
            ? 'HTTP_REJECTED'
            : 'UNVERIFIED_RESPONSE',
      httpStatus: outcome.httpStatus,
    };
  throw new Error('USAGE_DELIVERY_OUTCOME_INVALID');
}
