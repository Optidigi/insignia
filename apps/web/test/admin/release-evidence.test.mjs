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
