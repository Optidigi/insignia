import { REF_ATTRIBUTE, REF_V3_CHARS } from './line-v3.ts';
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
        attributes: [{ key: REF_ATTRIBUTE, value: 'A'.repeat(REF_V3_CHARS) }],
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
/**
 * Engineering bounds checked before signing. Quantity is not signed in v3; the accepted quantities are
 * still bounded here and the Functions bound the cart's actual quantities independently.
 * Projection values are availability hints; signed economics come only from full server allocation.
 */
export function admitCandidate(
  lines: readonly { index: number; quantity: number }[],
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
  if (lines.length === 0 || lines.length > 32) return { status: 'REJECT', reason: 'BUCKET_COUNT' };
  if (lines.length + projection.ordinaryLineHint > 200) return { status: 'REJECT', reason: 'CART_LINES' };
  let quantity = 0;
  for (const [i, m] of lines.entries()) {
    if (m.index !== i || !Number.isSafeInteger(m.quantity) || m.quantity <= 0)
      return { status: 'REJECT', reason: 'INVALID_SUBSET' };
    quantity += m.quantity;
    if (quantity > 10000) return { status: 'REJECT', reason: 'PHYSICAL_QUANTITY' };
  }
  const outputBytes = transformOutputUpperBytes(lines.length);
  if (outputBytes > 16000) return { status: 'REJECT', reason: 'TRANSFORM_OUTPUT' };
  return {
    status: 'ADMIT',
    bounds: {
      totalCartLines: lines.length + projection.ordinaryLineHint,
      transformOutputUpperBytes: outputBytes,
      customizedQuantity: quantity,
    },
  };
}
