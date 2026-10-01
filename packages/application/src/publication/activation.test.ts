import { describe, expect, it } from 'vitest';
import { classifyPublicationAdmission } from './activation.js';

describe('publication admission', () => {
  it('requires a hold for first publication including after reinstall', () => {
    expect(
      classifyPublicationAdmission({
        prior: null,
        proposed: { mode: 'optional', installationGeneration: '2' },
        phase: 'prepared',
      }),
    ).toBe('FIRST_PUBLICATION');
    expect(
      classifyPublicationAdmission({
        prior: { mode: 'required', installationGeneration: '1' },
        proposed: { mode: 'required', installationGeneration: '2' },
        phase: 'activation-pending',
      }),
    ).toBe('FIRST_PUBLICATION');
  });
});

import { publicKeyFromSeed } from '../keys/crypto.js';
import { buildPublicConfig } from '../keys/public-config.js';
import {
  type ActivationCandidate,
  type ActivationEvidence,
  ActivationFenceError,
  type ActivationSession,
  type ActivationState,
  activationDigest,
  createPublicationActivation,
} from './activation.js';
import type { AvailabilityScope, ProductAvailabilityHoldPort, ProductAvailabilitySnapshot } from './availability.js';

const now = new Date('2026-10-01T12:00:00.000Z');
function fixture(priorMode: 'required' | 'optional' | null = null, mode: 'required' | 'optional' = 'required') {
  const scope = {
    shopId: 'synthetic-shop',
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 0,
  };
  const availabilityScope: AvailabilityScope = {
    shopId: scope.shopId,
    installationGeneration: '1',
    shopifyShopId: 'gid://shopify/Shop/1',
    appClientId: 'synthetic-app',
  };
  let candidate: ActivationCandidate = {
    shopId: scope.shopId,
    configId: 'config',
    operationId: 'operation',
    revisionId: 'revision',
    revisionHash: 'a'.repeat(64),
    operationSequence: '1',
    scope,
    availabilityScope,
    productId: 'gid://shopify/Product/42',
    mode,
    prior: priorMode ? { mode: priorMode, installationGeneration: '1' } : null,
    phase: 'activation-pending',
    status: 'observed',
    desiredProjection: { synthetic: true },
    desiredProjectionDigest: activationDigest({ synthetic: true }),
    observedProjectionDigest: activationDigest({ synthetic: true }),
    publicConfig: buildPublicConfig({
      scope,
      keys: [
        {
          id: 7,
          publicKey: publicKeyFromSeed(new Uint8Array(32).fill(42)),
          state: 'active',
          firstDay: 20000,
          lastDay: 30000,
        },
      ],
    }),
    selectedKeyId: 7,
    state: { kind: 'WAITING_RELEASE', hold: null, evidenceDigest: null },
  };
  let evidence: ActivationEvidence | null = null;
  let stateAtAcquisition: ActivationState | null = null;
  let stateAtRestore: ActivationState | null = null;
  let crashBeforeAcquire = false;
  let crashAcquire = false;
  let crashRestore = false;
  let failCommit = false;
  let fenced = false;
  let acquisitions = 0;
  let restores = 0;
  let current: ProductAvailabilitySnapshot = {
    scope: availabilityScope,
    productId: candidate.productId,
    state: 'available',
    providerVersion: 'original',
    visibilityDigest: 'b'.repeat(64),
    observedAt: now.toISOString(),
  };
  const availability: ProductAvailabilityHoldPort = {
    snapshot: async () => current,
    acquire: async (_scope, hold) => {
      if (crashBeforeAcquire) {
        crashBeforeAcquire = false;
        throw new Error('crash before provider dispatch');
      }
      stateAtAcquisition = structuredClone(candidate.state);
      acquisitions++;
      current = { ...current, state: 'unavailable', providerVersion: 'owned-hold' };
      if (crashAcquire) {
        crashAcquire = false;
        throw new Error('lost acquisition response');
      }
      return { kind: 'HELD', current, hold: { ...hold, held: current } };
    },
    observe: async (_scope, hold) =>
      current.state === 'unavailable' && current.providerVersion === 'owned-hold'
        ? { kind: 'HELD', current, hold: { ...hold, held: current } }
        : { kind: 'CONFLICT', current },
    restore: async (_scope, hold) => {
      stateAtRestore = structuredClone(candidate.state);
      restores++;
      current = { ...hold.before, providerVersion: 'restored' };
      if (crashRestore) {
        crashRestore = false;
        throw new Error('lost restoration response');
      }
      return { kind: 'RESTORED', current };
    },
  };
  const artifactScope = { shopId: scope.shopId, installationGeneration: '1', appClientId: 'synthetic-app' };
  const transform = {
    functionId: 'transform',
    handle: 'transform',
    apiType: 'cart_transform' as const,
    apiVersion: '2026-07',
    inputQuerySha256: 'c'.repeat(64),
    wasmSha256: 'd'.repeat(64),
  };
  const validation = {
    ...transform,
    functionId: 'validation',
    handle: 'validation',
    apiType: 'cart_checkout_validation' as const,
  };
  // Injected synthetic premise only. This test never writes a production release record.
  const build = {
    ...artifactScope,
    schemaVersion: 1 as const,
    sourceCommit: 'e'.repeat(40),
    appVersionRef: 'synthetic-release',
    devPreviewRef: null,
    transform,
    validation,
  };
  let attestation: unknown = {
    ...build,
    evidenceKind: 'RELEASE_BOUND',
    observedAt: now.toISOString(),
    expiresAt: '2026-10-02T12:00:00.000Z',
  };
  const { wasmSha256: _t, ...transformObject } = transform;
  const { wasmSha256: _v, ...validationObject } = validation;
  let observation = {
    ...artifactScope,
    observedAt: now.toISOString(),
    transform: transformObject,
    validation: validationObject,
  };
  let projection: unknown = candidate.desiredProjection;
  let functionReads = 0;
  let missingDeployment = false;
  let driftOnFinal = false;
  let rollsDay = false;
  let dayReads = 0;
  const store = {
    locked: async <T>(_identity: unknown, action: (session: ActivationSession) => Promise<T>) => {
      if (fenced) throw new ActivationFenceError('reinstall/epoch/supersession');
      const before = structuredClone(candidate);
      const previousEvidence = evidence;
      try {
        return await action({
          get candidate() {
            return candidate;
          },
          save: async (state) => {
            candidate = { ...candidate, state };
          },
          commit: async (value) => {
            evidence = value;
            if (failCommit) throw new Error('crash between evidence and activation');
            const digest = activationDigest(value);
            candidate = {
              ...candidate,
              phase: 'active',
              status: 'activated',
              state: {
                ...candidate.state,
                kind: value.hold ? 'RESTORATION_PENDING' : 'RESTORED',
                evidenceDigest: digest,
              },
            };
            return digest;
          },
        });
      } catch (error) {
        candidate = before;
        evidence = previousEvidence;
        throw error;
      }
    },
  };
  const restart = () =>
    createPublicationActivation({
      store,
      availability,
      now: () => now,
      maxObservationAgeMs: 1000,
      readiness: {
        expectedBuild: { read: async () => build },
        trustedEvidence: { read: async () => attestation },
        observeFunctions: async () => {
          functionReads++;
          return {
            transform: 'present',
            validation: missingDeployment ? 'missing' : 'present',
            observation: driftOnFinal && functionReads >= 2 ? { ...observation, validation: null } : observation,
          };
        },
        observeProjection: async () => ({ projection, observedAt: now.toISOString() }),
        currentDay: async () => (rollsDay && dayReads++ > 0 ? 20728 : 20727),
      },
    });
  const advance = () => restart().advance({ shopId: scope.shopId, configId: 'config', operationId: 'operation' });
  return {
    advance,
    get candidate() {
      return candidate;
    },
    get evidence() {
      return evidence;
    },
    get current() {
      return current;
    },
    get acquisitions() {
      return acquisitions;
    },
    get restores() {
      return restores;
    },
    get stateAtAcquisition() {
      return stateAtAcquisition;
    },
    get stateAtRestore() {
      return stateAtRestore;
    },
    set phase(phase: string) {
      candidate = { ...candidate, phase };
    },
    mismatchArtifact: (field: 'sourceCommit' | 'appVersionRef' | 'inputQuerySha256' | 'wasmSha256') => {
      const value = attestation as Record<string, unknown>;
      attestation =
        field === 'sourceCommit' || field === 'appVersionRef'
          ? { ...value, [field]: field === 'sourceCommit' ? 'f'.repeat(40) : 'synthetic-other-release' }
          : { ...value, transform: { ...build.transform, [field]: 'f'.repeat(64) } };
    },
    nonproductionEvidence: (kind: 'SOURCE_ONLY' | 'DEV_PREVIEW_OBSERVED') => {
      attestation = {
        ...build,
        appVersionRef: null,
        devPreviewRef: kind === 'DEV_PREVIEW_OBSERVED' ? 'synthetic-preview' : null,
        evidenceKind: kind,
        observedAt: now.toISOString(),
        expiresAt: '2026-10-02T12:00:00.000Z',
      };
    },
    set attestation(value: unknown) {
      attestation = value;
    },
    set staleObservation(value: boolean) {
      if (value) observation = { ...observation, observedAt: '2026-10-01T11:00:00.000Z' };
    },
    set projection(value: unknown) {
      projection = value;
    },
    set missingDeployment(value: boolean) {
      missingDeployment = value;
    },
    set driftOnFinal(value: boolean) {
      driftOnFinal = value;
    },
    set crashBeforeAcquire(value: boolean) {
      crashBeforeAcquire = value;
    },
    set crashAcquire(value: boolean) {
      crashAcquire = value;
    },
    set crashRestore(value: boolean) {
      crashRestore = value;
    },
    set failCommit(value: boolean) {
      failCommit = value;
    },
    set fenced(value: boolean) {
      fenced = value;
    },
    invalidSnapshot: () => {
      current = { ...current, visibilityDigest: '' };
    },
    drift: () => {
      current = { ...current, providerVersion: 'merchant-change' };
    },
    rollDay: () => {
      rollsDay = true;
      candidate = {
        ...candidate,
        publicConfig: {
          ...candidate.publicConfig,
          keys: candidate.publicConfig.keys.map((key) => ({ ...key, lastDay: 20729 })),
        },
      };
    },
    expireKey: () => {
      candidate = {
        ...candidate,
        publicConfig: {
          ...candidate.publicConfig,
          keys: candidate.publicConfig.keys.map((key) => ({ ...key, lastDay: 20727 })),
        },
      };
    },
  };
}

describe('production activation coordinator with injected synthetic boundary fixtures', () => {
  it.each([
    ['required', 'optional'],
    ['optional', 'required'],
  ] as const)('holds on %s to %s', (priorMode, mode) => {
    expect(
      classifyPublicationAdmission({
        prior: { mode: priorMode, installationGeneration: '1' },
        proposed: { mode, installationGeneration: '1' },
        phase: 'activation-pending',
      }),
    ).toBe('MODE_CHANGE');
  });
  it('rejects noncurrent/conflicted operation input to the classifier', () => {
    expect(() =>
      classifyPublicationAdmission({
        prior: null,
        proposed: { mode: 'required', installationGeneration: '1' },
        phase: 'operator-hold',
      }),
    ).toThrow();
  });
  it('activates the exact same-mode revision once without touching availability', async () => {
    const f = fixture('required');
    expect((await f.advance()).kind).toBe('ACTIVE');
    const original = f.evidence;
    expect((await f.advance()).kind).toBe('ACTIVE');
    expect(f.evidence).toBe(original);
    expect(f.acquisitions).toBe(0);
    expect(f.restores).toBe(0);
    expect(f.evidence).toMatchObject({
      admissionClass: 'SAME_MODE',
      hold: null,
      selectedKeyId: 7,
      operationSequence: '1',
    });
  });
  it('persists acquisition intent and restoration pending before dispatch and restores only after activation', async () => {
    const f = fixture();
    expect((await f.advance()).kind).toBe('WAITING_HOLD');
    expect(f.acquisitions).toBe(0);
    expect((await f.advance()).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect(f.stateAtAcquisition).toMatchObject({ kind: 'ACQUISITION_PENDING', hold: { held: null } });
    expect(f.evidence).toMatchObject({ admissionClass: 'FIRST_PUBLICATION', hold: { held: { state: 'unavailable' } } });
    expect(f.restores).toBe(0);
    expect((await f.advance()).kind).toBe('ACTIVE');
    expect(f.stateAtRestore).toMatchObject({ kind: 'RESTORATION_PENDING', evidenceDigest: expect.any(String) });
    expect(f.current.state).toBe('available');
  });
  it.each([null, { evidenceKind: 'SOURCE_ONLY' }, { evidenceKind: 'DEV_PREVIEW_OBSERVED' }])(
    'missing/nonproduction artifact never acquires or activates (%j)',
    async (artifact) => {
      const f = fixture();
      f.attestation = artifact;
      expect((await f.advance()).kind).toBe('WAITING_RELEASE');
      expect(f.evidence).toBeNull();
      expect(f.acquisitions).toBe(0);
    },
  );
  it('stale Function observation blocks the no-hold path', async () => {
    const f = fixture('required');
    f.staleObservation = true;
    expect((await f.advance()).kind).toBe('WAITING_RELEASE');
    expect(f.evidence).toBeNull();
  });
  it('Function drift on the final check blocks commit', async () => {
    const f = fixture('required');
    f.driftOnFinal = true;
    expect((await f.advance()).kind).toBe('WAITING_RELEASE');
    expect(f.evidence).toBeNull();
  });
  it('a selected key outside the complete offer validity window blocks commit', async () => {
    const f = fixture('required');
    f.expireKey();
    await expect(f.advance()).rejects.toThrow('Signing key is not issuance ready');
    expect(f.evidence).toBeNull();
  });
  it('crash before hold preserves availability', async () => {
    const f = fixture();
    f.fenced = true;
    expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
    expect(f.acquisitions).toBe(0);
    expect(f.current.state).toBe('available');
  });
  it('lost hold response recovers by observation without acquiring twice', async () => {
    const f = fixture();
    await f.advance();
    f.crashAcquire = true;
    await expect(f.advance()).rejects.toThrow('lost acquisition response');
    expect(f.candidate.state.kind).toBe('ACQUISITION_PENDING');
    expect(f.current.state).toBe('unavailable');
    expect((await f.advance()).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect(f.acquisitions).toBe(1);
  });
  it('crash after hold before publication preserves the owned hold for restart', async () => {
    const f = fixture();
    f.phase = 'prepared';
    await f.advance();
    expect((await f.advance()).kind).toBe('HELD');
    expect(f.evidence).toBeNull();
    f.phase = 'activation-pending';
    expect((await f.advance()).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect(f.acquisitions).toBe(1);
  });
  it('crash between evidence insertion and effective activation rolls both back', async () => {
    const f = fixture('required');
    f.failCommit = true;
    await expect(f.advance()).rejects.toThrow('crash between evidence and activation');
    expect(f.evidence).toBeNull();
    expect(f.candidate.status).toBe('observed');
    f.failCommit = false;
    expect((await f.advance()).kind).toBe('ACTIVE');
  });
  it('crash after commit resumes restoration without rewriting historical evidence', async () => {
    const f = fixture();
    await f.advance();
    await f.advance();
    const evidence = f.evidence;
    expect((await f.advance()).kind).toBe('ACTIVE');
    expect(f.evidence).toBe(evidence);
    expect(f.acquisitions).toBe(1);
  });
  it('lost restore response never replays over an unowned remote state', async () => {
    const f = fixture();
    await f.advance();
    await f.advance();
    f.crashRestore = true;
    await expect(f.advance()).rejects.toThrow('lost restoration response');
    expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(1);
    expect(f.evidence).not.toBeNull();
  });
  it.each(['before activation', 'after activation'])(
    'merchant changes while held become operator hold (%s)',
    async (boundary) => {
      const f = fixture();
      if (boundary === 'before activation') f.phase = 'prepared';
      await f.advance();
      await f.advance();
      f.drift();
      if (boundary === 'before activation') f.phase = 'activation-pending';
      expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
      expect(f.restores).toBe(0);
      expect(f.candidate.state.kind).toBe('OPERATOR_HOLD');
    },
  );
  it.each(['reinstall', 'epoch change', 'supersession'])(
    'fences %s while held without provider restoration',
    async () => {
      const f = fixture();
      await f.advance();
      await f.advance();
      f.fenced = true;
      expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
      expect(f.restores).toBe(0);
    },
  );
  it('remote policy drift while held blocks activation and restoration', async () => {
    const f = fixture();
    f.phase = 'prepared';
    await f.advance();
    await f.advance();
    f.phase = 'activation-pending';
    f.projection = { synthetic: 'drift' };
    expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
    expect(f.evidence).toBeNull();
    expect(f.restores).toBe(0);
  });
});

it('rechecks selected key validity when the merchant day changes during final observations', async () => {
  const f = fixture('required');
  f.rollDay();
  await expect(f.advance()).rejects.toThrow('Signing key is not issuance ready');
  expect(f.evidence).toBeNull();
});

it('keeps availability held if remote policy drifts after activation commit before restoration', async () => {
  const f = fixture();
  await f.advance();
  await f.advance();
  f.projection = { synthetic: 'post-commit-drift' };
  expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
  expect(f.restores).toBe(0);
  expect(f.evidence).not.toBeNull();
});

it('existing Function objects cannot stand in for enabled deployments with blockOnFailure', async () => {
  const f = fixture('required');
  f.missingDeployment = true;
  expect((await f.advance()).kind).toBe('WAITING_RELEASE');
  expect(f.evidence).toBeNull();
});

it('missing availability version/visibility evidence never becomes an owned hold', async () => {
  const f = fixture();
  f.invalidSnapshot();
  await expect(f.advance()).rejects.toThrow('Hold snapshot malformed');
  expect(f.acquisitions).toBe(0);
});

it('an acquisition intent with unknown dispatch outcome is observed and never blindly resent', async () => {
  const f = fixture();
  await f.advance();
  f.crashBeforeAcquire = true;
  await expect(f.advance()).rejects.toThrow('crash before provider dispatch');
  expect(f.candidate.state.kind).toBe('ACQUISITION_PENDING');
  expect((await f.advance()).kind).toBe('OPERATOR_HOLD');
  expect(f.acquisitions).toBe(0);
});

it.each(['SOURCE_ONLY', 'DEV_PREVIEW_OBSERVED'] as const)(
  'well-formed %s evidence cannot activate production',
  async (kind) => {
    const f = fixture();
    f.nonproductionEvidence(kind);
    expect((await f.advance()).kind).toBe('WAITING_RELEASE');
    expect(f.evidence).toBeNull();
    expect(f.acquisitions).toBe(0);
  },
);

it.each(['sourceCommit', 'appVersionRef', 'inputQuerySha256', 'wasmSha256'] as const)(
  'mismatched release %s blocks activation',
  async (field) => {
    const f = fixture('required');
    f.mismatchArtifact(field);
    expect((await f.advance()).kind).toBe('WAITING_RELEASE');
    expect(f.evidence).toBeNull();
  },
);

it('evidence array accessors and hidden extras are rejected without invoking code', () => {
  let invoked = false;
  const value = [1];
  Object.defineProperty(value, '0', {
    enumerable: true,
    get: () => {
      invoked = true;
      return 1;
    },
  });
  expect(() => activationDigest(value)).toThrow();
  expect(invoked).toBe(false);
  const extra = [1];
  Object.defineProperty(extra, 'hidden', { value: 'ignored' });
  expect(() => activationDigest(extra)).toThrow();
  expect(activationDigest([1, { b: true, a: null }])).toBe(activationDigest([1, { a: null, b: true }]));
});
