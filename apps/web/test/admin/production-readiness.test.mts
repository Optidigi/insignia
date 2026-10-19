import type { ExpectedFunctionBuild } from '@insignia/application';
import { calendarCandidate } from './support/fixtures.mts';

type DemandInput = Parameters<typeof readiness.createDemandDrivenReleaseReader>[0];
type Stored = Awaited<ReturnType<DemandInput['records']['read']>>;

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as readiness from '../../src/server/admin/release-evidence.ts';
import { required } from './support/fixtures.mts';

const scope = { shopId: 'shop-test', installationGeneration: '1', appClientId: 'test-client' };
const at = new Date('2026-10-08T12:00:00Z');
const build: ExpectedFunctionBuild & { appVersionRef: string; devPreviewRef: null } = {
  schemaVersion: 1,
  ...scope,
  sourceCommit: 'a'.repeat(40),
  appVersionRef: '1163229200385',
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
const record: NonNullable<Stored>['record'] = {
  version: 'm5-trusted-release-v1',
  recordId: 'operator-record',
  activeAppVersionRef: '1163229200385',
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
        assert.equal(input.expectedActiveAppVersionRef, '1163229200385');
        assert.equal(input.now, at);
        return {
          record,
          expectedBuild: build,
          activeVersionEvidenceSha256: 'f'.repeat(64),
          evidenceDigest: 'e'.repeat(64),
        };
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
  assert.equal(composed.currentDay(calendarCandidate(scope), new Date('2026-10-08T04:00:00Z')), 20733);
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
  assert.throws(() => composed.currentDay(calendarCandidate(scope), at), /Trusted merchant calendar unavailable/);
});

test('delayed publication collects independently and consumes only its correlated fresh database record', async () => {
  let stored: Stored = null;
  let calls = 0;
  const current = new Date('2026-10-08T12:10:00Z');
  const freshRecord = {
    ...record,
    recordId: 'new-operator-record',
    attestation: { ...record.attestation, observedAt: current.toISOString(), expiresAt: '2026-10-08T12:10:30Z' },
  };
  const records = readiness.createDemandDrivenReleaseReader({
    records: { read: async () => stored },
    now: () => current,
    binding: {
      ...scope,
      authorizationGeneration: 'test-auth',
      authorizationEpoch: 0,
      externalInstallationId: 'installation-9',
    },
    isCurrent: async () => {},
    deadline: () => current.getTime() + 60_000,
    collector: {
      async collect(request) {
        calls++;
        assert.equal(request.expectedActiveAppVersionRef, '1163229200385');
        assert.equal(request.binding.authorizationGeneration, 'test-auth');
        stored = {
          record: freshRecord,
          expectedBuild: build,
          activeVersionEvidenceSha256: 'f'.repeat(64),
          evidenceDigest: 'e'.repeat(64),
        };
        return { requestId: request.requestId, recordId: freshRecord.recordId, state: 'COMPLETE' };
      },
    },
  });
  const read = { scope, expectedActiveAppVersionRef: '1163229200385', now: current };
  assert.deepEqual(await records.read(read), stored);
  assert.equal(calls, 1);
  assert.deepEqual(await records.read(read), stored);
  assert.equal(calls, 1);
});

test('concurrent publication coalesces collection and refuses expired or unrelated completion', async () => {
  const inFlight: NonNullable<DemandInput['inFlight']> = new Map();
  let release: (() => void) | undefined;
  let calls = 0;
  const current = new Date('2026-10-08T12:10:00Z');
  const base: DemandInput = {
    records: { read: async () => null },
    now: () => current,
    binding: {
      ...scope,
      authorizationGeneration: 'test-auth',
      authorizationEpoch: 0,
      externalInstallationId: 'installation-9',
    },
    isCurrent: async () => {},
    deadline: () => current.getTime() + 60_000,
    inFlight,
    collector: {
      collect: async (request) => {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { requestId: request.requestId, recordId: 'unrelated', state: 'COMPLETE' };
      },
    },
  };
  const read = { scope, expectedActiveAppVersionRef: '1163229200385', now: current };
  const a = readiness.createDemandDrivenReleaseReader(base).read(read);
  const b = readiness.createDemandDrivenReleaseReader(base).read(read);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  required(release)();
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
  const expired = readiness.createDemandDrivenReleaseReader({ ...base, deadline: () => current.getTime() });
  await assert.rejects(expired.read(read), /identity expired/);
  assert.equal(calls, 1);
});
