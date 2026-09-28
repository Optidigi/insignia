import { allocateGroups, type AcceptedGroup, type Allocation } from '../../m0-004/ts/allocation.ts';
import { issueAllocatedQuote, type Header } from '../../m0-005/ts/whole-quote.ts';
import type { KeyObject } from 'node:crypto';

/** Experimental source-bound profile supplied by server code, never by a buyer. */
export interface CapacityProfile {
  id: string;
  maxCustomizedBuckets: number;
  maxCartLines: number;
  maxPhysicalQuantity: number;
  maxTransformInputBytes: number;
  maxValidationInputBytes: number;
  maxTransformOutputBytes: number;
}

/** A trusted, current whole-cart projection; any cart edit invalidates this decision. */
export interface CartProjection {
  ordinaryLines: number;
  unresolvedManagedLines: number;
  transformInputUpperBytes: number;
  validationInputUpperBytes: number;
}

export type RejectionReason = 'INVALID_PROFILE' | 'INVALID_PROJECTION' | 'INVALID_QUOTE'
  | 'INCOMPLETE_CUSTOMIZED_SUBSET' | 'BUCKET_COUNT' | 'CART_LINES'
  | 'PHYSICAL_QUANTITY' | 'TRANSFORM_INPUT' | 'VALIDATION_INPUT' | 'TRANSFORM_OUTPUT';
export type Admission =
  | { status: 'REJECT'; reason: RejectionReason }
  | { status: 'ADMIT'; allocation: Allocation; bounds: {
      totalCartLines: number; transformOutputUpperBytes: number;
      transformInputUpperBytes: number; validationInputUpperBytes: number;
    } };

const MAX_VARIANT_GID_DIGITS = 20; // u64 numeric suffix; actual Function input enforces this width.
const MAX_CART_LINE_SUFFIX_CHARS = 36; // UUID-shaped CartLine IDs occur in the pinned runner.
const MAX_AMOUNT_CHARS = 21; // u64 minor units at 0–3 supported exponent, including decimal point.
const MEMBER_CHARS = 30; // unchanged v2 22-byte member record, unpadded base64url.
const MAX_FUNCTION_LINES = 200;
// These cannot exceed the guards compiled into both local M0-013 Functions.
const MAX_FUNCTION_BUCKETS = 32;
const MAX_FUNCTION_PHYSICAL_QUANTITY = 10_000;
const PLATFORM_INPUT_BYTES = 128_000;
const FUNCTION_OUTPUT_BYTES = 16_000;

const maxOperation = {
  lineExpand: {
    cartLineId: `gid://shopify/CartLine/${'9'.repeat(MAX_CART_LINE_SUFFIX_CHARS)}`,
    expandedCartItems: [{
      merchandiseId: `gid://shopify/ProductVariant/${'9'.repeat(MAX_VARIANT_GID_DIGITS)}`,
      quantity: 1,
      attributes: [{ key: '_insignia_member_v2', value: 'A'.repeat(MEMBER_CHARS) }],
      price: { adjustment: { fixedPricePerUnit: { amount: '9'.repeat(MAX_AMOUNT_CHARS) } } },
    }],
  },
};
const wrapperBytes = Buffer.byteLength('{"operations":[]}');
const operationBytes = Buffer.byteLength(JSON.stringify(maxOperation));

/** Upper bound for compact JSON containing all authorized child properties. */
export function transformOutputUpperBytes(buckets: number): number {
  if (!Number.isSafeInteger(buckets) || buckets < 0 || buckets > 0xffff) throw new Error('invalid bucket count');
  return wrapperBytes + buckets * operationBytes + Math.max(0, buckets - 1);
}

function validProfile(p: CapacityProfile): boolean {
  return typeof p.id === 'string' && p.id.length > 0 &&
    Number.isSafeInteger(p.maxCustomizedBuckets) && p.maxCustomizedBuckets >= 1 &&
    p.maxCustomizedBuckets <= MAX_FUNCTION_BUCKETS &&
    Number.isSafeInteger(p.maxCartLines) && p.maxCartLines >= 1 && p.maxCartLines <= MAX_FUNCTION_LINES &&
    Number.isSafeInteger(p.maxPhysicalQuantity) && p.maxPhysicalQuantity >= 1 &&
    p.maxPhysicalQuantity <= MAX_FUNCTION_PHYSICAL_QUANTITY &&
    Number.isSafeInteger(p.maxTransformInputBytes) && p.maxTransformInputBytes >= 1 &&
    p.maxTransformInputBytes <= PLATFORM_INPUT_BYTES &&
    Number.isSafeInteger(p.maxValidationInputBytes) && p.maxValidationInputBytes >= 1 &&
    p.maxValidationInputBytes <= PLATFORM_INPUT_BYTES &&
    Number.isSafeInteger(p.maxTransformOutputBytes) && p.maxTransformOutputBytes >= 1 &&
    p.maxTransformOutputBytes <= FUNCTION_OUTPUT_BYTES;
}

function nonnegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function decideAdmission(groups: readonly AcceptedGroup[], cart: CartProjection,
  profile: CapacityProfile): Admission {
  if (!validProfile(profile)) return { status: 'REJECT', reason: 'INVALID_PROFILE' };
  if (![cart.ordinaryLines, cart.unresolvedManagedLines,
    cart.transformInputUpperBytes, cart.validationInputUpperBytes].every(nonnegative)) {
    return { status: 'REJECT', reason: 'INVALID_PROJECTION' };
  }
  if (cart.unresolvedManagedLines !== 0) {
    return { status: 'REJECT', reason: 'INCOMPLETE_CUSTOMIZED_SUBSET' };
  }
  let allocation: Allocation;
  try { allocation = allocateGroups(groups); }
  catch { return { status: 'REJECT', reason: 'INVALID_QUOTE' }; }
  const bucketCount = allocation.buckets.length;
  if (bucketCount > profile.maxCustomizedBuckets) return { status: 'REJECT', reason: 'BUCKET_COUNT' };
  const totalCartLines = bucketCount + cart.ordinaryLines;
  if (totalCartLines > profile.maxCartLines) return { status: 'REJECT', reason: 'CART_LINES' };
  if (allocation.totalQuantity > profile.maxPhysicalQuantity) {
    return { status: 'REJECT', reason: 'PHYSICAL_QUANTITY' };
  }
  if (cart.transformInputUpperBytes > profile.maxTransformInputBytes) {
    return { status: 'REJECT', reason: 'TRANSFORM_INPUT' };
  }
  if (cart.validationInputUpperBytes > profile.maxValidationInputBytes) {
    return { status: 'REJECT', reason: 'VALIDATION_INPUT' };
  }
  const outputBytes = transformOutputUpperBytes(bucketCount);
  if (outputBytes > profile.maxTransformOutputBytes) {
    return { status: 'REJECT', reason: 'TRANSFORM_OUTPUT' };
  }
  return { status: 'ADMIT', allocation, bounds: { totalCartLines,
    transformOutputUpperBytes: outputBytes,
    transformInputUpperBytes: cart.transformInputUpperBytes,
    validationInputUpperBytes: cart.validationInputUpperBytes } };
}

/** The only signing entry in this prototype; a rejected proposal never reaches Ed25519. */
export function issueAdmittedQuote(groups: readonly AcceptedGroup[],
  context: Omit<Header, 'count' | 'totalQuantity' | 'totalMinor'>,
  key: KeyObject, issuanceDay: number, cart: CartProjection, profile: CapacityProfile) {
  const decision = decideAdmission(groups, cart, profile);
  if (decision.status === 'REJECT') return decision;
  return { status: 'ADMIT' as const, allocation: decision.allocation, bounds: decision.bounds,
    issued: issueAllocatedQuote(groups, context, key, issuanceDay) };
}
