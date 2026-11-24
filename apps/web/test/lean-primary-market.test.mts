import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActiveQuoteTenant } from '@insignia/application';
import type { PrimaryMarketSnapshot } from '@insignia/shopify';
import {
  createLeanPrimaryMarketAdmission,
  EUROZONE_COUNTRIES,
  type EurQualification,
  parseEurNetherlandsQualification,
  parseEurQualification,
} from '../src/server/buyer/lean-primary-market.ts';

const generation = '11111111-1111-4111-8111-111111111111';
const authority = {
  shopId: 'tenant',
  shopifyShopId: '123',
  installationGeneration: '1',
  authorizationGeneration: generation,
  authorizationEpoch: 1,
};
const tenant: ActiveQuoteTenant = {
  shopId: 'tenant',
  shopifyShopGid: 'gid://shopify/Shop/123',
  installationGeneration: '1',
  authorizationGeneration: generation,
  authorizationEpoch: 1,
};
const expectedRelease = { activeVersionRef: '12345', functionsSourceCommit: 'a'.repeat(40) };
const profile = {
  ...expectedRelease,
  version: 'eur-nl-qualification-v1',
  shopId: 'tenant',
  shopifyShopGid: tenant.shopifyShopGid,
  installationGeneration: '1',
  authorizationGeneration: generation,
  authorizationEpoch: 1,
  primaryMarketGid: 'gid://shopify/Market/42',
  qualifiedAt: '2026-11-05T10:00:00Z',
  evidenceRef: 'qualification/eur-nl-reviewed-candidate',
};
const target = { tenant, currency: 'EUR', shopCurrency: 'EUR', country: 'NL', marketId: '42' };
const snapshot: PrimaryMarketSnapshot = {
  shopId: 'tenant',
  installationGeneration: '1',
  shopifyShopId: '123',
  shopCurrency: 'EUR',
  primaryMarketId: 'gid://shopify/Market/42',
  countryCodes: ['NL'],
  sourceApiVersion: '2026-07',
  observedAt: '2026-11-05T11:00:00Z',
  freshUntil: '2026-11-05T11:05:00Z',
};
const setup = (
  observed = snapshot,
  qualification: EurQualification | null = parseEurNetherlandsQualification(JSON.stringify(profile)),
) =>
  createLeanPrimaryMarketAdmission({
    scope: { shopId: 'tenant', installationGeneration: '1' },
    active: async () => authority,
    observe: async () => observed,
    clock: () => new Date('2026-11-05T11:01:00Z'),
    eurQualification: qualification,
    expectedRelease,
  });
test('real admission helper enables only qualified same-shop EUR/NL and keeps EUR default-off', async () => {
  assert.equal(parseEurNetherlandsQualification(undefined), null);
  await assert.rejects(() => setup(snapshot, null).assertSupported(target), /qualification/);
  await setup().assertSupported(target);
  await assert.rejects(
    () =>
      setup(
        snapshot,
        parseEurNetherlandsQualification(JSON.stringify({ ...profile, activeVersionRef: '99999' })),
      ).assertSupported(target),
    /qualification/,
  );
  await assert.rejects(
    () =>
      setup(
        snapshot,
        parseEurNetherlandsQualification(JSON.stringify({ ...profile, functionsSourceCommit: 'b'.repeat(40) })),
      ).assertSupported(target),
    /qualification/,
  );
  await assert.rejects(() => setup().assertSupported({ ...target, shopCurrency: 'USD' }), /context/);
  await assert.rejects(() => setup().assertSupported({ ...target, country: 'BE' }), /qualification/);
  await assert.rejects(() => setup().assertSupported({ ...target, currency: 'GBP', shopCurrency: 'GBP' }), /context/);
});
test('qualified EUR cannot bypass independently read shop, Market, country, currency or freshness', async () => {
  for (const change of [
    { shopId: 'other' },
    { shopifyShopId: '999' },
    { installationGeneration: '2' },
    { shopCurrency: 'USD' },
    { countryCodes: ['BE'] },
    { observedAt: 'invalid' },
    { freshUntil: '2026-11-05T11:01:00Z' },
  ])
    await assert.rejects(() => setup({ ...snapshot, ...change }).assertSupported(target), /context/);
});
test('tenant authority is rechecked after provider IO and old profiles cannot authorize a new epoch', async () => {
  let reads = 0;
  const port = createLeanPrimaryMarketAdmission({
    scope: { shopId: 'tenant', installationGeneration: '1' },
    active: async () => (++reads === 1 ? authority : { ...authority, authorizationEpoch: 2 }),
    observe: async () => snapshot,
    clock: () => new Date('2026-11-05T11:01:00Z'),
    eurQualification: parseEurNetherlandsQualification(JSON.stringify(profile)),
    expectedRelease,
  });
  await assert.rejects(() => port.assertSupported(target), /authority/);
  await assert.rejects(
    () => setup().assertSupported({ ...target, tenant: { ...tenant, authorizationEpoch: 2 } }),
    /qualification/,
  );
  assert.throws(() => parseEurNetherlandsQualification('true'), /profile/);
  assert.throws(
    () => parseEurNetherlandsQualification(JSON.stringify({ ...profile, unexpected: 'enabled' })),
    /profile/,
  );
});
test('the existing USD path retains independent primary-Market admission without an EUR profile', async () => {
  await setup({ ...snapshot, shopCurrency: 'USD', countryCodes: ['US'] }, null).assertSupported({
    ...target,
    currency: 'USD',
    shopCurrency: 'USD',
    country: 'US',
  });
});
test('a country or currency the shop does not sell in is an unsupported market; drifted evidence is not (#336)', async () => {
  const unsupported = { name: 'BuyerRejectedError', code: 'UNSUPPORTED_MARKET' };
  await assert.rejects(() => setup(snapshot, null).assertSupported(target), unsupported);
  await assert.rejects(() => setup().assertSupported({ ...target, country: 'BE' }), unsupported);
  await assert.rejects(() => setup().assertSupported({ ...target, currency: 'GBP', shopCurrency: 'GBP' }), unsupported);
  await assert.rejects(() => setup({ ...snapshot, countryCodes: ['BE'] }).assertSupported(target), unsupported);
  const drifted = (error: unknown) => !(error instanceof Error && error.name === 'BuyerRejectedError');
  await assert.rejects(
    () =>
      setup(
        snapshot,
        parseEurNetherlandsQualification(JSON.stringify({ ...profile, activeVersionRef: '99999' })),
      ).assertSupported(target),
    drifted,
  );
  await assert.rejects(
    () => setup({ ...snapshot, freshUntil: '2026-11-05T11:01:00Z' }).assertSupported(target),
    drifted,
  );
});
test('EUR at a shop the qualification profile does not cover is an unsupported market; epoch or release drift is not', async () => {
  const unsupported = { name: 'BuyerRejectedError', code: 'UNSUPPORTED_MARKET' };
  const withProfile = (change: Record<string, unknown>) =>
    setup(snapshot, parseEurNetherlandsQualification(JSON.stringify({ ...profile, ...change })));
  await assert.rejects(() => withProfile({ shopId: 'another-tenant' }).assertSupported(target), unsupported);
  await assert.rejects(
    () => withProfile({ shopifyShopGid: 'gid://shopify/Shop/999' }).assertSupported(target),
    unsupported,
  );
  const drifted = (error: unknown) => error instanceof Error && error.name !== 'BuyerRejectedError';
  await assert.rejects(() => withProfile({ authorizationEpoch: 2 }).assertSupported(target), drifted);
  await assert.rejects(() => withProfile({ functionsSourceCommit: 'b'.repeat(40) }).assertSupported(target), drifted);
  await assert.rejects(
    () => withProfile({ primaryMarketGid: 'gid://shopify/Market/99' }).assertSupported(target),
    drifted,
  );
});

test('legacy EUR distinguishes a secondary storefront Market from drift in the qualified primary Market', async () => {
  await assert.rejects(() => setup().assertSupported({ ...target, marketId: '99' }), {
    name: 'BuyerRejectedError',
    code: 'UNSUPPORTED_MARKET',
  });
  await assert.rejects(
    () => setup({ ...snapshot, primaryMarketId: 'gid://shopify/Market/99' }).assertSupported(target),
    /EUR Netherlands qualification unavailable/,
  );
});

// Release-level EUR qualification (owner decision D4, 16 Nov 2026): any EUR shop, eurozone buyers.
const v2 = {
  ...expectedRelease,
  version: 'eur-qualification-v2',
  countries: [...EUROZONE_COUNTRIES],
  qualifiedAt: '2026-11-05T10:00:00Z',
  evidenceRef: 'qualification/eur-release-reviewed',
};
const setupV2 = (observed = snapshot, change: Record<string, unknown> = {}) =>
  setup(observed, parseEurQualification(JSON.stringify({ ...v2, ...change })));
const unsupportedMarket = { name: 'BuyerRejectedError', code: 'UNSUPPORTED_MARKET' };
const outage = (error: unknown) => error instanceof Error && error.name !== 'BuyerRejectedError';

test('v2 parsing is exact: known keys, two-letter uppercase countries, non-empty, no duplicates', () => {
  assert.equal(parseEurQualification(undefined), null);
  assert.equal(parseEurQualification(''), null);
  const parsed = parseEurQualification(JSON.stringify(v2));
  assert.equal(parsed?.version, 'eur-qualification-v2');
  assert.deepEqual(parsed && 'countries' in parsed ? [...parsed.countries] : [], [...EUROZONE_COUNTRIES]);
  for (const change of [
    { countries: [] },
    { countries: ['nl'] },
    { countries: ['NLD'] },
    { countries: ['NL', 'NL'] },
    { countries: 'NL' },
    { countries: [1] },
    { activeVersionRef: 'x' },
    { functionsSourceCommit: 'abc' },
    { qualifiedAt: '2026-11-05' },
    { evidenceRef: '' },
    { unexpected: true },
  ])
    assert.throws(() => parseEurQualification(JSON.stringify({ ...v2, ...change })), /profile/, JSON.stringify(change));
  const { countries: _countries, ...withoutCountries } = v2;
  assert.throws(() => parseEurQualification(JSON.stringify(withoutCountries)), /profile/);
  // v1 still parses unchanged through the same entry point.
  assert.deepEqual(
    parseEurQualification(JSON.stringify(profile)),
    parseEurNetherlandsQualification(JSON.stringify(profile)),
  );
});

test('v2 admits any EUR shop to qualified eurozone buyers, with no shop binding', async () => {
  await setupV2().assertSupported(target);
  await setupV2({ ...snapshot, countryCodes: ['DE', 'NL'] }).assertSupported({ ...target, country: 'DE' });
  // The profile names no shop: another EUR shop is admitted by its own tenant authority and Market reads.
  const other = {
    shopId: 'other',
    shopifyShopId: '456',
    installationGeneration: '3',
    authorizationGeneration: generation,
    authorizationEpoch: 0,
  };
  await createLeanPrimaryMarketAdmission({
    scope: { shopId: 'other', installationGeneration: '3' },
    active: async () => other,
    observe: async () => ({
      ...snapshot,
      shopId: 'other',
      installationGeneration: '3',
      shopifyShopId: '456',
      countryCodes: ['FR'],
    }),
    clock: () => new Date('2026-11-05T11:01:00Z'),
    eurQualification: parseEurQualification(JSON.stringify(v2)),
    expectedRelease,
  }).assertSupported({
    ...target,
    country: 'FR',
    tenant: {
      shopId: 'other',
      shopifyShopGid: 'gid://shopify/Shop/456',
      installationGeneration: '3',
      authorizationGeneration: generation,
      authorizationEpoch: 0,
    },
  });
});

test('v2 refuses buyers outside its countries or the shop primary Market, and non-EUR shops', async () => {
  await assert.rejects(() => setupV2().assertSupported({ ...target, country: 'US' }), unsupportedMarket);
  await assert.rejects(
    () => setupV2(snapshot, { countries: ['NL'] }).assertSupported({ ...target, country: 'DE' }),
    unsupportedMarket,
  );
  // A listed country outside the shop's own primary Market is still unsupported.
  await assert.rejects(() => setupV2().assertSupported({ ...target, country: 'DE' }), unsupportedMarket);
  await assert.rejects(() => setupV2().assertSupported({ ...target, shopCurrency: 'USD' }), unsupportedMarket);
  await assert.rejects(
    () => setupV2().assertSupported({ ...target, currency: 'GBP', shopCurrency: 'GBP' }),
    unsupportedMarket,
  );
});

test('v2 bound to another release is an outage, not a refusal; independent reads still apply', async () => {
  await assert.rejects(() => setupV2(snapshot, { activeVersionRef: '99999' }).assertSupported(target), outage);
  await assert.rejects(
    () => setupV2(snapshot, { functionsSourceCommit: 'b'.repeat(40) }).assertSupported(target),
    outage,
  );
  await assert.rejects(
    () => setupV2(snapshot, { qualifiedAt: '2026-11-06T10:00:00Z' }).assertSupported(target),
    outage,
  );
  for (const change of [
    { shopCurrency: 'USD' },
    { primaryMarketId: 'gid://shopify/Market/99' },
    { freshUntil: '2026-11-05T11:01:00Z' },
  ])
    await assert.rejects(() => setupV2({ ...snapshot, ...change }).assertSupported(target), /context/);
});

test('a storefront Market other than the shop primary Market is unsupported with the same currency', async () => {
  const primary = { ...snapshot, shopCurrency: 'USD', countryCodes: ['PH', 'US'] };
  const buyer = { ...target, currency: 'USD', shopCurrency: 'USD', country: 'US' };
  await setup(primary, null).assertSupported(buyer);
  await assert.rejects(() => setup(primary, null).assertSupported({ ...buyer, marketId: '99' }), unsupportedMarket);
});

test('the USD path is unchanged under a v2 profile', async () => {
  await setupV2({ ...snapshot, shopCurrency: 'USD', countryCodes: ['US'] }).assertSupported({
    ...target,
    currency: 'USD',
    shopCurrency: 'USD',
    country: 'US',
  });
});

/** The refusal log names the failed check and the two Market IDs the check compared (numeric, when known). */
const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as { market?: unknown }).market;
  }
  return assert.fail('expected a refusal');
};
test('every UNSUPPORTED_MARKET refusal names its check and only the Market IDs it knows', async () => {
  const v2setup = (observed = snapshot, change: Record<string, unknown> = {}) => setupV2(observed, change);
  assert.deepEqual(await refusal(() => setup().assertSupported({ ...target, currency: 'GBP', shopCurrency: 'GBP' })), {
    reason: 'CURRENCY_UNSUPPORTED',
    storefrontMarketId: '42',
  });
  assert.deepEqual(await refusal(() => setup().assertSupported({ ...target, shopCurrency: 'USD' })), {
    reason: 'CURRENCY_MISMATCH',
    storefrontMarketId: '42',
  });
  assert.deepEqual(await refusal(() => v2setup().assertSupported({ ...target, country: 'US' })), {
    reason: 'EUR_COUNTRY_NOT_QUALIFIED',
    storefrontMarketId: '42',
  });
  assert.deepEqual(await refusal(() => setup(snapshot, null).assertSupported(target)), {
    reason: 'EUR_PROFILE_UNAVAILABLE',
    storefrontMarketId: '42',
  });
  assert.deepEqual(await refusal(() => setup().assertSupported({ ...target, marketId: '99' })), {
    reason: 'MARKET_NOT_PRIMARY',
    storefrontMarketId: '99',
    primaryMarketId: '42',
  });
  assert.deepEqual(await refusal(() => v2setup({ ...snapshot, countryCodes: ['BE'] }).assertSupported(target)), {
    reason: 'COUNTRY_NOT_IN_PRIMARY_MARKET',
    storefrontMarketId: '42',
    primaryMarketId: '42',
  });
  // An unparseable primary Market GID is absent, never an empty string or a partial value.
  const unknown = await refusal(() =>
    v2setup({ ...snapshot, primaryMarketId: 'not-a-gid' }).assertSupported({ ...target, marketId: '99' }),
  );
  assert.deepEqual(unknown, { reason: 'MARKET_NOT_PRIMARY', storefrontMarketId: '99' });
});
