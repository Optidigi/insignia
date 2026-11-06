import type { QuoteAuthorityPorts } from '@insignia/application';
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
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

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
  eurQualification: EurNetherlandsQualification | null;
  expectedRelease: { activeVersionRef: string; functionsSourceCommit: string };
}): NonNullable<QuoteAuthorityPorts['leanContext']> {
  return {
    async assertSupported(target) {
      if (target.shopCurrency !== target.currency || !['USD', 'EUR'].includes(target.currency))
        throw new Error('Lean primary-Market context unavailable');
      const profile = input.eurQualification;
      const now = () => +input.clock();
      if (
        target.currency === 'EUR' &&
        (!profile ||
          profile.activeVersionRef !== input.expectedRelease.activeVersionRef ||
          profile.functionsSourceCommit !== input.expectedRelease.functionsSourceCommit ||
          target.country !== 'NL' ||
          profile.shopId !== target.tenant.shopId ||
          profile.shopifyShopGid !== target.tenant.shopifyShopGid ||
          profile.installationGeneration !== target.tenant.installationGeneration ||
          profile.authorizationGeneration !== target.tenant.authorizationGeneration ||
          profile.authorizationEpoch !== target.tenant.authorizationEpoch ||
          profile.primaryMarketGid !== `gid://shopify/Market/${target.marketId}` ||
          Date.parse(profile.qualifiedAt) > now())
      )
        throw new Error('EUR Netherlands qualification unavailable');
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
        !observed.countryCodes.includes(target.country) ||
        !Number.isFinite(at) ||
        !Number.isFinite(observedAt) ||
        !Number.isFinite(freshUntil) ||
        freshUntil <= observedAt ||
        freshUntil - observedAt > PRIMARY_MARKET_FRESHNESS_MS ||
        at < observedAt ||
        at >= freshUntil
      )
        throw new Error('Lean primary-Market context unavailable');
    },
  };
}
