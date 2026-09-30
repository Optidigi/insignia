import { type AuthorizationSigner, type Header, issueWholeQuote, type Member } from './whole-quote.ts';
export type Admission =
  | {
      status: 'ADMIT';
      bounds: { totalCartLines: number; transformOutputUpperBytes: number; customizedQuantity: number };
    }
  | {
      status: 'REJECT';
      reason:
        | 'INVALID_PROJECTION'
        | 'INCOMPLETE_CUSTOMIZED_SUBSET'
        | 'BUCKET_COUNT'
        | 'CART_LINES'
        | 'PHYSICAL_QUANTITY'
        | 'TRANSFORM_OUTPUT'
        | 'INVALID_SUBSET';
    };
const maxOperation = {
  lineExpand: {
    cartLineId: `gid://shopify/CartLine/${'9'.repeat(36)}`,
    expandedCartItems: [
      {
        merchandiseId: `gid://shopify/ProductVariant/${'9'.repeat(20)}`,
        quantity: 1,
        attributes: [{ key: '_insignia_member_v2', value: 'A'.repeat(30) }],
        price: { adjustment: { fixedPricePerUnit: { amount: '9'.repeat(21) } } },
      },
    ],
  },
};
const wrapperBytes = Buffer.byteLength('{"operations":[]}');
const operationBytes = Buffer.byteLength(JSON.stringify(maxOperation));
export function transformOutputUpperBytes(buckets: number): number {
  if (!Number.isSafeInteger(buckets) || buckets < 0 || buckets > 65535) throw new Error('invalid buckets');
  return wrapperBytes + buckets * operationBytes + Math.max(0, buckets - 1);
}
/** Projection values are availability hints; signed economics come only from full server allocation. */
export function admitCandidate(
  members: readonly Member[],
  projection: { ordinaryLineHint: number; unresolvedManagedLineHint?: number },
): Admission {
  if (
    !Number.isSafeInteger(projection.ordinaryLineHint) ||
    projection.ordinaryLineHint < 0 ||
    !Number.isSafeInteger(projection.unresolvedManagedLineHint ?? 0) ||
    (projection.unresolvedManagedLineHint ?? 0) < 0
  )
    return { status: 'REJECT', reason: 'INVALID_PROJECTION' };
  if ((projection.unresolvedManagedLineHint ?? 0) > 0)
    return { status: 'REJECT', reason: 'INCOMPLETE_CUSTOMIZED_SUBSET' };
  if (members.length === 0 || members.length > 32) return { status: 'REJECT', reason: 'BUCKET_COUNT' };
  if (members.length + projection.ordinaryLineHint > 200) return { status: 'REJECT', reason: 'CART_LINES' };
  let quantity = 0;
  for (const [i, m] of members.entries()) {
    if (m.index !== i || !Number.isSafeInteger(m.quantity) || m.quantity <= 0)
      return { status: 'REJECT', reason: 'INVALID_SUBSET' };
    quantity += m.quantity;
    if (quantity > 10000) return { status: 'REJECT', reason: 'PHYSICAL_QUANTITY' };
  }
  const outputBytes = transformOutputUpperBytes(members.length);
  if (outputBytes > 16000) return { status: 'REJECT', reason: 'TRANSFORM_OUTPUT' };
  return {
    status: 'ADMIT',
    bounds: {
      totalCartLines: members.length + projection.ordinaryLineHint,
      transformOutputUpperBytes: outputBytes,
      customizedQuantity: quantity,
    },
  };
}

/** Server entry: full quote admission precedes any signer call. */
export async function issueAdmittedQuote(
  header: Header,
  members: readonly Member[],
  issuanceDay: number,
  signer: AuthorizationSigner,
  projection: { ordinaryLineHint: number; unresolvedManagedLineHint?: number },
) {
  const admission = admitCandidate(members, projection);
  if (admission.status === 'REJECT') return admission;
  return {
    status: 'ADMIT' as const,
    bounds: admission.bounds,
    issued: await issueWholeQuote(header, members, issuanceDay, signer),
  };
}
