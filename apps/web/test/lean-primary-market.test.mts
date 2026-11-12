import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActiveQuoteTenant } from '@insignia/application';
import type { PrimaryMarketSnapshot } from '@insignia/shopify';
import {
  createLeanPrimaryMarketAdmission,
  parseEurNetherlandsQualification,
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
const setup = (observed = snapshot, qualification = parseEurNetherlandsQualification(JSON.stringify(profile))) =>
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
    { primaryMarketId: 'gid://shopify/Market/99' },
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
