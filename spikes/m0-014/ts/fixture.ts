import type { KeyObject } from 'node:crypto';
import type { AcceptedGroup } from '../../m0-004/ts/allocation.ts';
import { CURRENCY_EXPONENT_V1 } from '../../m0-004/ts/authorization.ts';
import { issueAdmittedQuote, type CartProjection, type CapacityProfile } from '../../m0-013/ts/admission.ts';

/** Operator-verified presentment and fixture IDs. Never populate from buyer input. */
export interface FixtureContext {
  appGid: string;
  shopGid: string;
  installationGid: string;
  storeDomain: string;
  smallVariantGid: string;
  largeVariantGid: string;
  currency: string;
  country: string;
  marketId: string;
  shopLocalDate: string;
  keyId: number;
  generationHex: string;
  epoch: number;
  quoteHex: string;
  setHex: string;
}

export interface FixtureProjection extends CartProjection {
  /** Trusted readback of physical plain units, independent of line count. */
  ordinaryPhysicalQuantity: number;
  /** Trusted current fixture variant unit price in currency minor units. */
  ordinaryUnitMinor: string;
}

export type FixtureCase = 'small' | 'stress10' | 'stress32' | 'stress33';

// This is the M0-013 local candidate profile, not an adopted merchant cap.
export const M0_014_PROFILE: CapacityProfile = Object.freeze({
  id: 'm0-014-public-app-evaluation-32', maxCustomizedBuckets: 32,
  maxCartLines: 200, maxPhysicalQuantity: 10_000,
  maxTransformInputBytes: 128_000, maxValidationInputBytes: 128_000,
  maxTransformOutputBytes: 16_000,
});

const APP = 'gid://shopify/App/429028933633';
const SHOP = 'gid://shopify/Shop/105501393179';
const INSTALLATION = 'gid://shopify/AppInstallation/1054356963611';
const STORE = 'insignia-rewrite-dev.myshopify.com';
const VARIANT = /^gid:\/\/shopify\/ProductVariant\/([1-9][0-9]{0,19})$/;

function contextDay(c: FixtureContext): number {
  if (c.appGid !== APP || c.shopGid !== SHOP || c.installationGid !== INSTALLATION ||
      c.storeDomain !== STORE) throw new Error('fixture target mismatch');
  if (CURRENCY_EXPONENT_V1[c.currency] !== 2) {
    throw new Error('fixture requires an independently observed two-decimal currency');
  }
  if (!/^[A-Z]{2}$/.test(c.country) || !/^(0|[1-9][0-9]*)$/.test(c.marketId)) {
    throw new Error('missing presentment context');
  }
  const small = VARIANT.exec(c.smallVariantGid), large = VARIANT.exec(c.largeVariantGid);
  if (!small || !large || small[1] === large[1]) throw new Error('real distinct numeric fixture variants required');
  if (!/^20\d\d-\d\d-\d\d$/.test(c.shopLocalDate) ||
      new Date(`${c.shopLocalDate}T00:00:00Z`).toISOString().slice(0, 10) !== c.shopLocalDate) {
    throw new Error('invalid shop-local date');
  }
  const day = Math.floor(Date.parse(`${c.shopLocalDate}T00:00:00Z`) / 86_400_000);
  if (day < 0 || day > 0xffff_fffd) throw new Error('shop-local date out of protocol range');
  if (!Number.isSafeInteger(c.keyId) || c.keyId < 1 || c.keyId > 0xffff ||
      !Number.isSafeInteger(c.epoch) || c.epoch < 0 || c.epoch > 0xffff_ffff ||
      ![c.generationHex, c.quoteHex, c.setHex].every(x => /^[0-9a-f]{32}$/.test(x))) {
    throw new Error('invalid public authorization context');
  }
  return day;
}

function groupsFor(kind: FixtureCase, c: FixtureContext): AcceptedGroup[] {
  const smallId = VARIANT.exec(c.smallVariantGid)![1]!;
  const largeId = VARIANT.exec(c.largeVariantGid)![1]!;
  if (kind === 'small') return [{
    groupId: 'm0-014-small-customized', setupMinor: '100',
    variants: [{ variantId: smallId, quantity: 3, acceptedBaseUnitMinor: '3000' }],
  }];
  const count = kind === 'stress10' ? 10 : kind === 'stress32' ? 32 : 33;
  return Array.from({ length: count }, (_, index) => ({
    groupId: `m0-014-large-customized-${index + 1}`,
    setupMinor: '0',
    variants: [{ variantId: largeId, quantity: 1, acceptedBaseUnitMinor: '3000' }],
  }));
}

/** A fixture-only seam: the caller must source cart byte estimates from current trusted reads. */
export function issueFixtureQuote(kind: FixtureCase, context: FixtureContext,
  projection: FixtureProjection, privateKey: KeyObject) {
  const day = contextDay(context);
  if (!Number.isSafeInteger(projection.ordinaryPhysicalQuantity) ||
      projection.ordinaryPhysicalQuantity < projection.ordinaryLines ||
      projection.ordinaryUnitMinor !== '2000') {
    throw new Error('ordinary fixture quantity/20.00 price readback missing');
  }
  const groups = groupsFor(kind, context);
  const decision = issueAdmittedQuote(groups, {
    keyId: context.keyId, generationHex: context.generationHex, epoch: context.epoch,
    quoteHex: context.quoteHex, setHex: context.setHex,
    currency: context.currency, exponent: 2, country: context.country,
    marketId: context.marketId, validThroughDay: day + 2,
  }, privateKey, day, projection, M0_014_PROFILE);
  if (decision.status === 'REJECT') return decision;
  const expectedOrdinaryMinor = (BigInt(projection.ordinaryPhysicalQuantity) *
    BigInt(projection.ordinaryUnitMinor)).toString();
  const expectedBasketMinor = (BigInt(decision.allocation.totalMinor) +
    BigInt(expectedOrdinaryMinor)).toString();
  return { ...decision, expectedOrdinaryMinor, expectedBasketMinor };
}
