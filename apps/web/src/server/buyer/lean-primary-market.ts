import { BuyerRejectedError, type QuoteAuthorityPorts } from '@insignia/application';
import { PRIMARY_MARKET_API_VERSION, PRIMARY_MARKET_FRESHNESS_MS, type PrimaryMarketSnapshot } from '@insignia/shopify';

export type LeanMarketAuthority = {
  shopId: string;
  shopifyShopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
};
export type EurNetherlandsQualification = {
  version: 'eur-nl-qualification-v1';
  activeVersionRef: string;
  functionsSourceCommit: string;
  shopId: string;
  shopifyShopGid: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
  primaryMarketGid: string;
  qualifiedAt: string;
  evidenceRef: string;
};
/**
 * Release-level EUR qualification (owner decision D4, 16 Nov 2026): EUR is sold by any shop whose shop
 * currency is EUR, to buyers in the listed countries, once the exact release (theme/app version and
 * Function source) has been qualified natively. No per-merchant operator step.
 */
export type EurReleaseQualification = {
  version: 'eur-qualification-v2';
  activeVersionRef: string;
  functionsSourceCommit: string;
  countries: readonly string[];
  qualifiedAt: string;
  evidenceRef: string;
};
export type EurQualification = EurNetherlandsQualification | EurReleaseQualification;
/** The euro area as of the owner's launch decision; operators list countries explicitly in the profile. */
export const EUROZONE_COUNTRIES = Object.freeze([
  'AT',
  'BE',
  'HR',
  'CY',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PT',
  'SK',
  'SI',
  'ES',
]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const qualifiedAtValid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

function parseEurReleaseQualification(value: Record<string, unknown>): EurReleaseQualification {
  const keys = ['version', 'activeVersionRef', 'functionsSourceCommit', 'countries', 'qualifiedAt', 'evidenceRef'];
  const countries = value.countries;
  if (
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',') ||
    typeof value.activeVersionRef !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(value.activeVersionRef) ||
    typeof value.functionsSourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.functionsSourceCommit) ||
    !Array.isArray(countries) ||
    !countries.length ||
    countries.length > 60 ||
    countries.some((country) => typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) ||
    new Set(countries).size !== countries.length ||
    !qualifiedAtValid(value.qualifiedAt) ||
    typeof value.evidenceRef !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value.evidenceRef)
  )
    throw new Error('Invalid EUR qualification profile');
  return {
    version: 'eur-qualification-v2',
    activeVersionRef: value.activeVersionRef,
    functionsSourceCommit: value.functionsSourceCommit,
    countries: Object.freeze([...(countries as string[])]),
    qualifiedAt: value.qualifiedAt,
    evidenceRef: value.evidenceRef,
  };
}

/**
 * Operator-owned qualified evidence selector, not a currency-name enable flag. Absent means EUR is disabled.
 * `eur-qualification-v2` (release-level, any EUR shop) is preferred; `eur-nl-qualification-v1` (one shop,
 * Netherlands only) is still accepted unchanged.
 */
export function parseEurQualification(raw: string | undefined): EurQualification | null {
  if (raw === undefined || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid EUR qualification profile');
  }
  if (record(value) && value.version === 'eur-qualification-v2') return parseEurReleaseQualification(value);
  return parseEurNetherlandsQualification(raw);
}

/** Operator-owned qualified evidence selector, not a currency-name enable flag. Absent means EUR is disabled. */
export function parseEurNetherlandsQualification(raw: string | undefined): EurNetherlandsQualification | null {
  if (raw === undefined || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid EUR Netherlands qualification profile');
  }
  const keys = [
    'version',
    'activeVersionRef',
    'functionsSourceCommit',
    'shopId',
    'shopifyShopGid',
    'installationGeneration',
    'authorizationGeneration',
    'authorizationEpoch',
    'primaryMarketGid',
    'qualifiedAt',
    'evidenceRef',
  ];
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',') ||
    value.version !== 'eur-nl-qualification-v1' ||
    typeof value.activeVersionRef !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(value.activeVersionRef) ||
    typeof value.functionsSourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.functionsSourceCommit) ||
    typeof value.shopId !== 'string' ||
    !value.shopId ||
    value.shopId.length > 128 ||
    typeof value.shopifyShopGid !== 'string' ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(value.shopifyShopGid) ||
    typeof value.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,17}$/.test(value.installationGeneration) ||
    typeof value.authorizationGeneration !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.authorizationGeneration) ||
    typeof value.authorizationEpoch !== 'number' ||
    !Number.isSafeInteger(value.authorizationEpoch) ||
    value.authorizationEpoch < 0 ||
    value.authorizationEpoch > 0xffff_ffff ||
    typeof value.primaryMarketGid !== 'string' ||
    !/^gid:\/\/shopify\/Market\/[1-9][0-9]*$/.test(value.primaryMarketGid) ||
    typeof value.qualifiedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.qualifiedAt) ||
    !Number.isFinite(Date.parse(value.qualifiedAt)) ||
    new Date(value.qualifiedAt).toISOString().slice(0, 19) !== value.qualifiedAt.slice(0, 19) ||
    typeof value.evidenceRef !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value.evidenceRef)
  )
    throw new Error('Invalid EUR Netherlands qualification profile');
  return {
    version: value.version,
    activeVersionRef: value.activeVersionRef,
    functionsSourceCommit: value.functionsSourceCommit,
    shopId: value.shopId,
    shopifyShopGid: value.shopifyShopGid,
    installationGeneration: value.installationGeneration,
    authorizationGeneration: value.authorizationGeneration,
    authorizationEpoch: value.authorizationEpoch,
    primaryMarketGid: value.primaryMarketGid,
    qualifiedAt: value.qualifiedAt,
    evidenceRef: value.evidenceRef,
  };
}

/** Reused by the real quote composition; keeps independent primary-Market and tenant checks for both currencies. */
export function createLeanPrimaryMarketAdmission(input: {
  scope: { shopId: string; installationGeneration: string };
  active(): Promise<LeanMarketAuthority>;
  observe(current: LeanMarketAuthority): Promise<PrimaryMarketSnapshot>;
  clock(): Date;
  eurQualification: EurQualification | null;
  expectedRelease: { activeVersionRef: string; functionsSourceCommit: string };
}): NonNullable<QuoteAuthorityPorts['leanContext']> {
  return {
    async assertSupported(target) {
      if (target.shopCurrency !== target.currency || !['USD', 'EUR'].includes(target.currency))
        throw new BuyerRejectedError('UNSUPPORTED_MARKET', 'Lean primary-Market context unavailable');
      const profile = input.eurQualification;
      const now = () => +input.clock();
      if (target.currency === 'EUR' && profile?.version === 'eur-qualification-v2') {
        // Release-level: any shop whose shop currency is EUR (checked above and re-read below), to the
        // qualified countries only. A different release than the one qualified is an outage, not a refusal.
        if (!profile.countries.includes(target.country))
          throw new BuyerRejectedError('UNSUPPORTED_MARKET', 'EUR qualification does not cover this country');
        if (
          profile.activeVersionRef !== input.expectedRelease.activeVersionRef ||
          profile.functionsSourceCommit !== input.expectedRelease.functionsSourceCommit ||
          Date.parse(profile.qualifiedAt) > now()
        )
          throw new Error('EUR qualification unavailable');
      } else {
        // Legacy v1: EUR is sold only to the Netherlands, and only by the one shop the profile covers.
        const v1 = profile?.version === 'eur-nl-qualification-v1' ? profile : null;
        if (
          target.currency === 'EUR' &&
          (!v1 ||
            target.country !== 'NL' ||
            v1.shopId !== target.tenant.shopId ||
            v1.shopifyShopGid !== target.tenant.shopifyShopGid)
        )
          throw new BuyerRejectedError('UNSUPPORTED_MARKET', 'EUR Netherlands qualification unavailable');
        // The covered shop's profile no longer matches its release, installation epoch or Market: an outage.
        if (
          target.currency === 'EUR' &&
          (!v1 ||
            v1.activeVersionRef !== input.expectedRelease.activeVersionRef ||
            v1.functionsSourceCommit !== input.expectedRelease.functionsSourceCommit ||
            v1.installationGeneration !== target.tenant.installationGeneration ||
            v1.authorizationGeneration !== target.tenant.authorizationGeneration ||
            v1.authorizationEpoch !== target.tenant.authorizationEpoch ||
            v1.primaryMarketGid !== `gid://shopify/Market/${target.marketId}` ||
            Date.parse(v1.qualifiedAt) > now())
        )
          throw new Error('EUR Netherlands qualification unavailable');
      }
      const matches = (current: LeanMarketAuthority) =>
        target.tenant.shopId === input.scope.shopId &&
        target.tenant.installationGeneration === input.scope.installationGeneration &&
        current.shopId === input.scope.shopId &&
        current.installationGeneration === input.scope.installationGeneration &&
        target.tenant.shopifyShopGid === `gid://shopify/Shop/${current.shopifyShopId}` &&
        target.tenant.authorizationGeneration === current.authorizationGeneration &&
        target.tenant.authorizationEpoch === current.authorizationEpoch;
      const before = await input.active();
      if (!matches(before)) throw new Error('Buyer Lean context authority changed');
      const observed = await input.observe(before);
      const after = await input.active();
      if (!matches(after)) throw new Error('Buyer Lean context authority changed');
      const observedAt = Date.parse(observed.observedAt),
        freshUntil = Date.parse(observed.freshUntil),
        at = now();
      if (
        observed.sourceApiVersion !== PRIMARY_MARKET_API_VERSION ||
        observed.shopId !== input.scope.shopId ||
        observed.installationGeneration !== input.scope.installationGeneration ||
        observed.shopifyShopId !== before.shopifyShopId ||
        observed.shopCurrency !== target.currency ||
        observed.primaryMarketId !== `gid://shopify/Market/${target.marketId}` ||
        !Number.isFinite(at) ||
        !Number.isFinite(observedAt) ||
        !Number.isFinite(freshUntil) ||
        freshUntil <= observedAt ||
        freshUntil - observedAt > PRIMARY_MARKET_FRESHNESS_MS ||
        at < observedAt ||
        at >= freshUntil
      )
        throw new Error('Lean primary-Market context unavailable');
      // The buyer's country is outside the shop's primary Market.
      if (!observed.countryCodes.includes(target.country))
        throw new BuyerRejectedError('UNSUPPORTED_MARKET', 'Lean primary-Market context unavailable');
    },
  };
}
