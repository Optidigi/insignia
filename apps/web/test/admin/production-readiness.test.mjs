import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as readiness from '../../src/server/admin/release-evidence.ts';

const scope = { shopId: 'shop-test', installationGeneration: '1', appClientId: 'test-client' };
const at = new Date('2026-10-08T12:00:00Z');
const build = {
  schemaVersion: 1,
  ...scope,
  sourceCommit: 'a'.repeat(40),
  appVersionRef: '1162611916801',
  devPreviewRef: null,
  transform: {
    functionId: 'transform-id',
    handle: 'insignia-experimental-v2-transform',
    apiType: 'cart_transform',
    apiVersion: '2026-07',
    inputQuerySha256: 'b'.repeat(64),
    wasmSha256: 'c'.repeat(64),
  },
  validation: {
    functionId: 'validation-id',
    handle: 'insignia-experimental-v2-validation',
    apiType: 'cart_checkout_validation',
    apiVersion: '2026-07',
    inputQuerySha256: 'd'.repeat(64),
    wasmSha256: 'e'.repeat(64),
  },
};
const record = {
  version: 'm5-trusted-release-v1',
  recordId: 'operator-record',
  activeAppVersionRef: '1162611916801',
  attestation: {
    ...build,
    evidenceKind: 'RELEASE_BOUND',
    observedAt: at.toISOString(),
    expiresAt: '2026-10-08T12:00:30Z',
  },
};
test('production readiness composes trusted record, independent expected build, current Function read and preloaded day', async () => {
  let functionReads = 0;
  const composed = readiness.createBoundProductionActivationReadiness({
    scope,
    ianaTimezone: 'America/Los_Angeles',
    now: () => at,
    records: {
      read: async (input) => {
        assert.deepEqual(input.scope, scope);
        assert.equal(input.expectedActiveAppVersionRef, '1162611916801');
        assert.equal(input.now, at);
        return { record, expectedBuild: build };
      },
    },
    observeFunctions: async (actualScope, expected) => {
      assert.deepEqual(actualScope, scope);
      assert.deepEqual(expected, build);
      functionReads++;
      return { transform: 'present', validation: 'present', observation: null };
    },
  });
  assert.deepEqual(await composed.expectedBuild.read(scope), build);
  assert.deepEqual(await composed.trustedEvidence.read(scope), record.attestation);
  assert.equal((await composed.observeFunctions(scope)).transform, 'present');
  assert.equal(functionReads, 1);
  assert.equal(
    composed.currentDay(
      {
        shopId: scope.shopId,
        scope: { installationGeneration: '1' },
        availabilityScope: { appClientId: scope.appClientId },
      },
      new Date('2026-10-08T04:00:00Z'),
    ),
    20733,
  );
  assert.equal(await composed.expectedBuild.read({ ...scope, installationGeneration: '2' }), null);
  assert.equal(await composed.trustedEvidence.read({ ...scope, shopId: 'other-shop' }), null);
});
test('missing release evidence never synthesizes a build, queries Functions or falls back to UTC', async () => {
  const composed = readiness.createBoundProductionActivationReadiness({
    scope,
    ianaTimezone: null,
    records: { read: async () => null },
    observeFunctions: async () => {
      assert.fail('untrusted Functions query');
    },
  });
  assert.equal(await composed.expectedBuild.read(scope), null);
  assert.equal(await composed.trustedEvidence.read(scope), null);
  assert.deepEqual(await composed.observeFunctions(scope), {
    transform: 'unknown',
    validation: 'unknown',
    observation: null,
  });
  assert.throws(() => composed.currentDay(scope, at), /Trusted merchant calendar unavailable/);
});
