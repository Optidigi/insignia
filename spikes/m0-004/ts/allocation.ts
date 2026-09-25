import { decimalU64 } from './authorization.ts';

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffffffffn;

export interface AcceptedVariant {
  variantId: string;
  quantity: number;
  acceptedBaseUnitMinor: string;
}

export interface AcceptedGroup {
  groupId: string;
  setupMinor: string;
  variants: readonly AcceptedVariant[];
}

export interface AllocatedBucket {
  groupId: string;
  variantId: string;
  quantity: number;
  unitMinor: string;
}

export interface Allocation {
  totalQuantity: number;
  totalMinor: string;
  buckets: AllocatedBucket[];
}

function exponentValue(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3) {
    throw new Error('unsupported mathematical exponent');
  }
  return 10n ** BigInt(exponent);
}

export function parseMinor(lexical: string, exponent: number): bigint {
  const scale = exponentValue(exponent);
  if (typeof lexical !== 'string' || !/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(lexical)) {
    throw new Error('invalid nonnegative lexical decimal');
  }
  const [whole, fraction = ''] = lexical.split('.');
  if (whole === undefined) throw new Error('missing whole decimal part');
  const kept = fraction.slice(0, exponent);
  if (/[1-9]/.test(fraction.slice(exponent))) throw new Error('fraction exceeds currency exponent');
  const amount = BigInt(whole) * scale + BigInt(kept.padEnd(exponent, '0') || '0');
  if (amount > U64_MAX) throw new Error('minor amount overflows u64');
  return amount;
}

export function formatMinor(amount: bigint, exponent: number): string {
  const scale = exponentValue(exponent);
  if (typeof amount !== 'bigint' || amount < 0n || amount > U64_MAX) throw new Error('minor amount out of u64 range');
  if (exponent === 0) return amount.toString();
  return `${amount / scale}.${(amount % scale).toString().padStart(exponent, '0')}`;
}

function pushBucket(out: AllocatedBucket[], groupId: string, variantId: string, quantity: bigint, unitMinor: bigint): void {
  if (quantity === 0n) return;
  if (quantity > U32_MAX || unitMinor > U64_MAX) throw new Error('allocated bucket exceeds protocol range');
  const last = out[out.length - 1];
  if (last?.groupId === groupId && last.variantId === variantId && last.unitMinor === unitMinor.toString()) {
    const combined = BigInt(last.quantity) + quantity;
    if (combined > U32_MAX) throw new Error('coalesced bucket quantity overflows u32');
    last.quantity = Number(combined);
  } else {
    out.push({ groupId, variantId, quantity: Number(quantity), unitMinor: unitMinor.toString() });
  }
}

export function allocateGroups(groups: readonly AcceptedGroup[]): Allocation {
  if (groups.length === 0) throw new Error('no accepted groups');
  const buckets: AllocatedBucket[] = [];
  const seenGroups = new Set<string>();
  let quoteQuantity = 0n;
  let quoteMinor = 0n;

  for (const group of groups) {
    if (!group.groupId || seenGroups.has(group.groupId)) throw new Error('missing/duplicate group identity');
    seenGroups.add(group.groupId);
    if (group.variants.length === 0) throw new Error('empty accepted group');
    const setup = decimalU64(group.setupMinor, 'setupMinor');
    const sorted = [...group.variants].sort((a, b) => {
      const ai = decimalU64(a.variantId, 'variantId');
      const bi = decimalU64(b.variantId, 'variantId');
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
    const seenVariants = new Set<string>();
    let groupQuantity = 0n;
    for (const variant of sorted) {
      const canonicalId = decimalU64(variant.variantId, 'variantId').toString();
      if (seenVariants.has(canonicalId)) throw new Error('duplicate variant within group');
      seenVariants.add(canonicalId);
      if (!Number.isSafeInteger(variant.quantity) || variant.quantity <= 0 || variant.quantity > Number(U32_MAX)) {
        throw new Error('invalid variant quantity');
      }
      decimalU64(variant.acceptedBaseUnitMinor, 'acceptedBaseUnitMinor');
      groupQuantity += BigInt(variant.quantity);
    }
    if (groupQuantity > U32_MAX) throw new Error('group quantity overflows u32');
    const baseSetup = setup / groupQuantity;
    let extras = setup % groupQuantity;
    let groupMinor = 0n;
    for (const variant of sorted) {
      const q = BigInt(variant.quantity);
      const baseUnit = decimalU64(variant.acceptedBaseUnitMinor, 'acceptedBaseUnitMinor');
      const ordinaryUnit = baseUnit + baseSetup;
      const extraCount = extras < q ? extras : q;
      const ordinaryCount = q - extraCount;
      pushBucket(buckets, group.groupId, variant.variantId, extraCount, ordinaryUnit + 1n);
      pushBucket(buckets, group.groupId, variant.variantId, ordinaryCount, ordinaryUnit);
      groupMinor += q * baseUnit + q * baseSetup + extraCount;
      extras -= extraCount;
    }
    if (extras !== 0n || groupMinor !== sorted.reduce((sum, variant) => sum + BigInt(variant.quantity) * decimalU64(variant.acceptedBaseUnitMinor, 'acceptedBaseUnitMinor'), 0n) + setup) {
      throw new Error('setup conservation failure');
    }
    quoteQuantity += groupQuantity;
    quoteMinor += groupMinor;
    if (quoteQuantity > U32_MAX || quoteMinor > U64_MAX) throw new Error('quote exceeds protocol range');
  }
  if (buckets.length > 0xffff) throw new Error('bucket count exceeds u16');
  return { totalQuantity: Number(quoteQuantity), totalMinor: quoteMinor.toString(), buckets };
}
