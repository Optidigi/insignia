import assert from 'node:assert/strict';
import { createServerActivationReadiness } from '../../../src/server/admin/release-evidence.ts';

// TEST ONLY: injected synthetic premises, never a production release record or provider call.
export function createSyntheticActivation({ core, appId, remote, shopId, shopifyShopId, productId }) {
  const now = () => new Date('2026-10-01T12:00:00.000Z');
  const appClientId = 'a'.repeat(32);
  const scope = { shopId, installationGeneration: '1', appClientId };
  const availabilityScope = { ...scope, shopifyShopId: `gid://shopify/Shop/${shopifyShopId}` };
  const object = (kind) => ({
    functionId: `gid://shopify/ShopifyFunction/${kind === 'transform' ? '1' : '2'}`,
    handle: `synthetic-${kind}`,
    apiType: kind === 'transform' ? 'cart_transform' : 'cart_checkout_validation',
    apiVersion: '2026-07',
    inputQuerySha256: 'b'.repeat(64),
    wasmSha256: 'c'.repeat(64),
  });
  const build = {
    ...scope,
    schemaVersion: 1,
    sourceCommit: 'd'.repeat(40),
    appVersionRef: 'synthetic-release',
    devPreviewRef: null,
    transform: object('transform'),
    validation: object('validation'),
  };
  const strip = ({ wasmSha256: _wasmSha256, ...rest }) => rest;
  const readiness = createServerActivationReadiness(
    {
      expectedBuild: {
        async read(supplied) {
          assert.deepEqual(supplied, scope);
          return build;
        },
      },
      async observeFunctions(supplied) {
        assert.deepEqual(supplied, scope);
        return {
          transform: 'present',
          validation: 'present',
          observation: {
            ...scope,
            observedAt: now().toISOString(),
            transform: strip(build.transform),
            validation: strip(build.validation),
          },
        };
      },
      currentDay: () => 20727,
    },
    {
      async read(supplied) {
        assert.deepEqual(supplied, scope);
        return {
          version: 'm5-trusted-release-v1',
          recordId: 'synthetic-release-1',
          activeAppVersionRef: build.appVersionRef,
          attestation: {
            ...build,
            evidenceKind: 'RELEASE_BOUND',
            observedAt: now().toISOString(),
            expiresAt: '2026-10-02T00:00:00Z',
          },
        };
      },
    },
  );
  let current = {
    scope: availabilityScope,
    productId,
    state: 'available',
    providerVersion: 'synthetic-before',
    visibilityDigest: 'e'.repeat(64),
    observedAt: now().toISOString(),
  };
  const availability = {
    async snapshot(supplied, suppliedProduct) {
      assert.deepEqual(supplied, availabilityScope);
      assert.equal(suppliedProduct, productId);
      return structuredClone(current);
    },
    async acquire(supplied, hold) {
      assert.deepEqual(supplied, availabilityScope);
      assert.deepEqual(hold.before, current);
      assert.equal(hold.held, null);
      current = { ...current, state: 'unavailable', providerVersion: 'synthetic-held' };
      return { kind: 'HELD', hold: { ...hold, held: structuredClone(current) }, current: structuredClone(current) };
    },
    async observe(supplied, hold) {
      assert.deepEqual(supplied, availabilityScope);
      assert.deepEqual(hold.held, current);
      return { kind: 'HELD', hold, current: structuredClone(current) };
    },
    async restore() {
      throw new Error('This synthetic publication fixture stops before activation/restoration');
    },
  };
  return core.productionActivations.create({
    appId,
    appClientId,
    remote,
    availability,
    readiness,
    now,
    maxObservationAgeMs: 1000,
  });
}
