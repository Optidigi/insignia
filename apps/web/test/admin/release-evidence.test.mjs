import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServerActivationReadiness } from '../../src/server/admin/release-evidence.ts';

test('server activation composition cannot promote a diagnostic observation without trusted release source', async () => {
  const scope = { shopId: 'shop-test', installationGeneration: '1', appClientId: 'test-client' };
  const observations = {
    expectedBuild: { read: async () => null },
    observeFunctions: async () => null,
    observeProjection: async () => ({ projection: {}, observedAt: '2026-10-01T00:00:00Z' }),
    currentDay: async () => 20727,
  };
  const configured = createServerActivationReadiness(observations);
  assert.equal(await configured.trustedEvidence.read(scope), null);
  assert.equal(configured.expectedBuild, observations.expectedBuild);
  assert.equal(configured.observeFunctions, observations.observeFunctions);
  const malformed = createServerActivationReadiness(observations, {
    read: async () => ({ evidenceKind: 'DEV_PREVIEW_OBSERVED' }),
  });
  await assert.rejects(malformed.trustedEvidence.read(scope), /malformed/);
});

test('selected M8 release coordinates activation and authenticated demand collection without manufacturing evidence', async () => {
  const { createBoundProductionActivationReadiness, createDemandDrivenReleaseReader } = await import(
    '../../src/server/admin/release-evidence.ts'
  );
  const scope = { shopId: 'shop-test', installationGeneration: '1', appClientId: 'test-client' };
  const reads = [],
    collected = [];
  const records = {
    read: async (request) => {
      reads.push(request);
      return null;
    },
  };
  const releaseProfile = 'm8-read-orders-617057f';
  const now = new Date('2026-10-13T17:00:00Z');
  const activation = createBoundProductionActivationReadiness({
    scope,
    ianaTimezone: 'UTC',
    records,
    observeFunctions: async () => {
      throw new Error('No Functions evidence');
    },
    now: () => now,
    releaseProfile,
  });
  assert.equal(await activation.expectedBuild.read(scope), null);
  assert.equal(reads[0].expectedActiveAppVersionRef, '1165513097217');
  const reader = createDemandDrivenReleaseReader({
    records,
    binding: {
      ...scope,
      authorizationGeneration: '22222222-2222-4222-8222-222222222222',
      authorizationEpoch: 0,
      externalInstallationId: 'gid://shopify/AppInstallation/321',
    },
    collector: {
      collect: async (request) => {
        collected.push(request);
        return { requestId: request.requestId, recordId: null, state: 'WAITING' };
      },
    },
    isCurrent: async () => {},
    deadline: () => now.getTime() + 30000,
    now: () => now,
    releaseProfile,
  });
  assert.equal(await reader.read({ scope, expectedActiveAppVersionRef: '1165513097217', now }), null);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].expectedActiveAppVersionRef, '1165513097217');
  assert.equal(await reader.read({ scope, expectedActiveAppVersionRef: '1163229200385', now }), null);
  assert.equal(collected.length, 1);
});
