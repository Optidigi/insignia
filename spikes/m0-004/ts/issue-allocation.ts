import { type KeyObject } from 'node:crypto';
import { issueToken, type Claims } from './authorization.ts';
import { type Allocation, type AllocatedBucket } from './allocation.ts';

export type QuoteContext = Omit<Claims,
  'lineIndex' | 'lineCount' | 'variantId' | 'quantity' | 'unitMinor' | 'totalQuantity' | 'totalMinor'>;

export interface IssuedBucket {
  bucket: AllocatedBucket;
  claims: Claims;
  token: string;
}

/** Assign quote-global indexes only after deterministic allocation is complete. */
export function issueAllocatedQuote(
  allocation: Allocation, context: QuoteContext, key: KeyObject, issuanceDay: number,
): IssuedBucket[] {
  if (allocation.buckets.length === 0 || allocation.buckets.length > 0xffff) {
    throw new Error('invalid allocated bucket count');
  }
  return allocation.buckets.map((bucket, lineIndex) => {
    const claims: Claims = {
      ...context,
      lineIndex, lineCount: allocation.buckets.length,
      variantId: bucket.variantId, quantity: bucket.quantity, unitMinor: bucket.unitMinor,
      totalQuantity: allocation.totalQuantity, totalMinor: allocation.totalMinor,
    };
    return { bucket, claims, token: issueToken(claims, key, issuanceDay) };
  });
}
