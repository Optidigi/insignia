import { type KeyObject } from 'node:crypto';
import { decodeAndVerifyToken, decimalU64, type Claims } from './authorization.ts';

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffffffff;

/** This is an explicit trusted harness input, not a Shopify Function input claim. */
export interface ExpectedContext {
  generationHex: string;
  epoch: number;
  currency: string;
  country: string;
  marketId: string;
  allowNoMarket: boolean;
  shopLocalDay: number;
  maxBuckets: number;
  maxPhysicalQuantity: number;
  keys: ReadonlyMap<number, KeyObject>;
}

/** A target adapter must obtain each observed field independently of the token. */
export interface PhysicalLine {
  variantId: string;
  quantity: number;
  observedUnitMinor?: string | undefined;
  token?: string | undefined;
  marked: boolean;
  requiresAuthorization: boolean;
  hasSellingPlan: boolean;
}

export interface SetDecision {
  accepted: true;
  bucketCount: number;
  totalQuantity: number;
  totalMinor: string;
}

function bounded(value: number, ceiling: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) throw new Error(`${name}: invalid integer`);
}

function sameSet(a: Claims, b: Claims): boolean {
  return a.keyId === b.keyId && a.quoteHex === b.quoteHex && a.setHex === b.setHex &&
    a.generationHex === b.generationHex && a.epoch === b.epoch &&
    a.lineCount === b.lineCount && a.currency === b.currency &&
    a.exponent === b.exponent && a.country === b.country &&
    a.marketId === b.marketId && a.validThroughDay === b.validThroughDay &&
    a.totalQuantity === b.totalQuantity && a.totalMinor === b.totalMinor;
}

export function verifySet(lines: readonly PhysicalLine[], expected: ExpectedContext): SetDecision {
  bounded(expected.epoch, U32_MAX, 'expected epoch');
  bounded(expected.shopLocalDay, U32_MAX, 'expected shop-local date');
  bounded(expected.maxBuckets, 0xffff, 'bucket capacity');
  bounded(expected.maxPhysicalQuantity, U32_MAX, 'physical quantity capacity');
  if (!/^[0-9a-f]{32}$/.test(expected.generationHex) ||
      !/^[A-Z]{3}$/.test(expected.currency) || !/^[A-Z]{2}$/.test(expected.country)) {
    throw new Error('invalid trusted context');
  }
  decimalU64(expected.marketId, 'expected market ID');
  if (expected.marketId === '0' && !expected.allowNoMarket) throw new Error('no-market context is not enabled');

  let first: Claims | undefined;
  let quantity = 0n;
  let amount = 0n;
  const seen = new Set<number>();
  for (const line of lines) {
    decimalU64(line.variantId, 'observed variant ID');
    bounded(line.quantity, U32_MAX, 'observed quantity');
    if (line.quantity === 0) throw new Error('zero physical line quantity');
    if (line.token === undefined) {
      if (line.requiresAuthorization || line.marked) throw new Error('required or marked product has no authorization');
      continue;
    }
    if (!line.marked) throw new Error('token on an unmarked line');
    if (line.hasSellingPlan) throw new Error('authorized customization has selling plan');
    if (line.observedUnitMinor === undefined) throw new Error('independent observed price unavailable');
    const observedPrice = decimalU64(line.observedUnitMinor, 'independent observed unit price');
    const claim = decodeAndVerifyToken(line.token, expected.keys);
    if (claim.generationHex !== expected.generationHex || claim.epoch !== expected.epoch ||
        claim.currency !== expected.currency || claim.country !== expected.country ||
        claim.marketId !== expected.marketId || claim.validThroughDay < expected.shopLocalDay) {
      throw new Error('authorization disagrees with trusted current context');
    }
    if (claim.lineCount > expected.maxBuckets || seen.has(claim.lineIndex)) {
      throw new Error('bucket count/capacity or duplicate index');
    }
    if (claim.variantId !== line.variantId || claim.quantity !== line.quantity ||
        claim.unitMinor !== observedPrice.toString()) {
      throw new Error('observed physical line differs from signed bucket');
    }
    if (first && !sameSet(first, claim)) throw new Error('mixed quote, set or common claims');
    first ??= claim;
    seen.add(claim.lineIndex);
    quantity += BigInt(line.quantity);
    amount += BigInt(line.quantity) * observedPrice;
    if (quantity > BigInt(expected.maxPhysicalQuantity) || quantity > BigInt(U32_MAX) || amount > U64_MAX) {
      throw new Error('physical quantity or money capacity exceeded');
    }
  }
  if (first) {
    if (seen.size !== first.lineCount || quantity !== BigInt(first.totalQuantity) ||
        amount !== decimalU64(first.totalMinor, 'signed total')) {
      throw new Error('incomplete or economically inconsistent set');
    }
    for (let index = 0; index < first.lineCount; index++) {
      if (!seen.has(index)) throw new Error('missing bucket index');
    }
  }
  return { accepted: true, bucketCount: seen.size, totalQuantity: Number(quantity), totalMinor: amount.toString() };
}

/** Resolve an instant into a shop-local Gregorian day ordinal, independent of 23/25-hour days. */
export function shopLocalDayOrdinal(instant: string, timeZone: string): number {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('invalid instant');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const field = (type: string): number => {
    const value = parts.find(part => part.type === type)?.value;
    if (!value || !/^[0-9]+$/.test(value)) throw new Error(`missing local ${type}`);
    return Number(value);
  };
  const year = field('year');
  const month = field('month');
  const day = field('day');
  const ordinal = Date.UTC(year, month - 1, day) / 86_400_000;
  bounded(ordinal, U32_MAX, 'shop-local date');
  return ordinal;
}
