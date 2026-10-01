import { createHash } from 'node:crypto';
import {
  assertProductionFunctionArtifactReady,
  type ExpectedFunctionBuildPort,
  type FunctionArtifactScope,
  type FunctionObjectObservation,
  parseFunctionArtifactAttestation,
  type TrustedFunctionArtifactEvidencePort,
} from '../keys/artifact-attestation.js';
import type { KeyScope } from '../keys/crypto.js';
import { type PublicConfig, requireIssuanceReady } from '../keys/public-config.js';
import type { FunctionPresence } from '../keys/readiness.js';
import type {
  AvailabilityHold,
  AvailabilityScope,
  ProductAvailabilityHoldPort,
  ProductAvailabilitySnapshot,
} from './availability.js';
import type { ProductPolicyMode } from './projection.js';

export type AdmissionClass = 'FIRST_PUBLICATION' | 'MODE_CHANGE' | 'SAME_MODE';
export function classifyPublicationAdmission(input: {
  prior: { mode: ProductPolicyMode; installationGeneration: string } | null;
  proposed: { mode: ProductPolicyMode; installationGeneration: string };
  phase: string;
}): AdmissionClass {
  if (
    ![
      'prepared',
      'shop-config-written',
      'pending-written',
      'policy-written',
      'ready-written',
      'activation-pending',
      'active',
    ].includes(input.phase)
  )
    throw new Error('Publication is not eligible for admission');
  for (const revision of [input.prior, input.proposed]) {
    if (
      revision &&
      (!/^[1-9][0-9]*$/.test(revision.installationGeneration) || !['required', 'optional'].includes(revision.mode))
    )
      throw new Error('Invalid admission revision');
  }
  if (!input.prior || input.prior.installationGeneration !== input.proposed.installationGeneration)
    return 'FIRST_PUBLICATION';
  return input.prior.mode === input.proposed.mode ? 'SAME_MODE' : 'MODE_CHANGE';
}

export type ActivationIdentity = Readonly<{ shopId: string; configId: string; operationId: string }>;
export type ActivationStateKind =
  | 'WAITING_RELEASE'
  | 'WAITING_HOLD'
  | 'HOLD_INTENT'
  | 'ACQUISITION_PENDING'
  | 'HELD'
  | 'RESTORATION_PENDING'
  | 'RESTORATION_CLAIMED'
  | 'RESTORED'
  | 'RESOLVED'
  | 'OPERATOR_HOLD';
export type ActivationState = Readonly<{
  kind: ActivationStateKind;
  hold: AvailabilityHold | null;
  evidenceDigest: string | null;
}>;
export type ActivationCandidate = ActivationIdentity &
  Readonly<{
    revisionId: string;
    revisionHash: string;
    operationSequence: string;
    scope: KeyScope;
    availabilityScope: AvailabilityScope;
    productId: string;
    mode: ProductPolicyMode;
    prior: { mode: ProductPolicyMode; installationGeneration: string } | null;
    phase: string;
    status: string;
    desiredProjection: unknown;
    desiredProjectionDigest: string;
    observedProjectionDigest: string | null;
    publicConfig: PublicConfig;
    selectedKeyId: number;
    state: ActivationState;
  }>;
export type ActivationEvidence = ActivationIdentity &
  Readonly<{
    version: 'm5-activation-evidence-v1';
    decisionVersion: 1;
    revisionId: string;
    revisionHash: string;
    operationSequence: string;
    installationGeneration: string;
    authorizationGeneration: string;
    authorizationEpoch: number;
    selectedKeyId: number;
    desiredProjectionDigest: string;
    observedProjectionDigest: string;
    artifactEvidenceDigest: string;
    artifactEvidenceRef: string;
    functionObservationDigest: string;
    functionObservation: FunctionObjectObservation;
    functionPresence: { transform: 'present'; validation: 'present' };
    admissionClass: AdmissionClass;
    hold: AvailabilityHold | null;
    holdObservation: ProductAvailabilitySnapshot | null;
    createdAt: string;
    projectionObservedAt: string;
  }>;
/** Server composition supplies trusted deployment provenance. Never construct from request bodies or unsigned env JSON. */
export type ActivationReadinessPort = Readonly<{
  expectedBuild: ExpectedFunctionBuildPort;
  trustedEvidence: TrustedFunctionArtifactEvidencePort;
  /** Ownership reconciliation must include active deployments, enabled validation and blockOnFailure flags. */
  observeFunctions(scope: FunctionArtifactScope): Promise<{
    transform: FunctionPresence;
    validation: FunctionPresence;
    observation: FunctionObjectObservation | null;
  }>;
  observeProjection(candidate: ActivationCandidate): Promise<{ projection: unknown; observedAt: string }>;
  /** Synchronous merchant-local day from preloaded trusted context; no awaited IO at the decision boundary. */
  currentDay(candidate: ActivationCandidate, now: Date): number;
}>;
/** Internal persistence seam. The database facade exposes only the coordinator, never these sessions. */
export interface ActivationSession {
  readonly candidate: ActivationCandidate;
  save(state: ActivationState): Promise<void>;
  commit(evidence: ActivationEvidence): Promise<string>;
}
export interface ActivationStore {
  /** Locks shop, installation, config, operation and key scope through the last observation and commit. */
  locked<T>(identity: ActivationIdentity, action: (session: ActivationSession) => Promise<T>): Promise<T>;
}
export type ActivationResult = Readonly<{
  kind:
    | 'WAITING_RELEASE'
    | 'WAITING_HOLD'
    | 'HELD'
    | 'PUBLICATION_PENDING'
    | 'ACTIVATED_RESTORATION_PENDING'
    | 'ACTIVE'
    | 'OPERATOR_HOLD';
  evidenceDigest: string | null;
}>;
export class ActivationFenceError extends Error {}

/** Stable, JSON-only digest; rejects credentials/classes/accessors instead of serializing them implicitly. */
export function activationDigest(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(part: unknown): string {
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return JSON.stringify(part);
    if (typeof part === 'number' && Number.isFinite(part)) return JSON.stringify(part);
    if (typeof part !== 'object' || ancestors.has(part)) throw new Error('Invalid activation evidence JSON');
    ancestors.add(part);
    try {
      if (Array.isArray(part)) {
        if (Reflect.ownKeys(part).length !== part.length + 1) throw new Error('Invalid evidence array fields');
        const values: string[] = [];
        for (let i = 0; i < part.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(part, i);
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Evidence array accessor or hole');
          values.push(encode(descriptor.value));
        }
        return `[${values.join(',')}]`;
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(part))) throw new Error('Nonplain evidence');
      const keys = Object.keys(part).sort();
      if (keys.length !== Reflect.ownKeys(part).length) throw new Error('Invalid evidence fields');
      return `{${keys
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(part, key);
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Evidence accessor');
          return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
        })
        .join(',')}}`;
    } finally {
      ancestors.delete(part);
    }
  }
  return createHash('sha256').update(encode(value)).digest('hex');
}
function snapshotShape(snapshot: ProductAvailabilitySnapshot): boolean {
  return Boolean(
    snapshot &&
      ['available', 'unavailable', 'archived'].includes(snapshot.state) &&
      typeof snapshot.providerVersion === 'string' &&
      snapshot.providerVersion.length > 0 &&
      snapshot.providerVersion.length <= 256 &&
      typeof snapshot.visibilityDigest === 'string' &&
      /^[a-f0-9]{64}$/.test(snapshot.visibilityDigest) &&
      typeof snapshot.observedAt === 'string',
  );
}
function exactSnapshot(a: ProductAvailabilitySnapshot, b: ProductAvailabilitySnapshot): boolean {
  return (
    snapshotShape(a) &&
    snapshotShape(b) &&
    a.productId === b.productId &&
    activationDigest(a.scope) === activationDigest(b.scope) &&
    a.state === b.state &&
    a.providerVersion === b.providerVersion &&
    a.visibilityDigest === b.visibilityDigest
  );
}
function fresh(observedAt: string, now: Date, age: number): void {
  const time = Date.parse(observedAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(time) || time > now.getTime() || now.getTime() - time > age)
    throw new Error('Stale activation observation');
}

/** Bounded retry entry point. Intent commits precede every availability mutation; recovery always observes first. */
export function createPublicationActivation(input: {
  store: ActivationStore;
  availability: ProductAvailabilityHoldPort;
  readiness: ActivationReadinessPort;
  now?: () => Date;
  maxObservationAgeMs: number;
}) {
  if (!Number.isFinite(input.maxObservationAgeMs) || input.maxObservationAgeMs < 0)
    throw new Error('Invalid freshness budget');
  const now = input.now ?? (() => new Date());
  const result = (kind: ActivationResult['kind'], candidate: ActivationCandidate): ActivationResult => ({
    kind,
    evidenceDigest: candidate.state.evidenceDigest,
  });
  async function release(candidate: ActivationCandidate) {
    const scope: FunctionArtifactScope = {
      shopId: candidate.shopId,
      installationGeneration: candidate.scope.installationGeneration,
      appClientId: candidate.availabilityScope.appClientId,
    };
    const expectedBuild = await input.readiness.expectedBuild.read(scope);
    const attestation = await input.readiness.trustedEvidence.read(scope);
    const functions = await input.readiness.observeFunctions(scope);
    if (functions.transform !== 'present' || functions.validation !== 'present')
      throw new Error('Active Function deployments not ready');
    const observation = functions.observation;
    assertProductionFunctionArtifactReady({
      scope,
      expectedBuild,
      attestation,
      observation,
      now: now(),
      maxObservationAgeMs: input.maxObservationAgeMs,
    });
    return {
      expectedBuild,
      attestation: parseFunctionArtifactAttestation(attestation),
      observation: structuredClone(observation) as FunctionObjectObservation,
    };
  }
  function decisionReady(
    c: ActivationCandidate,
    artifact: Awaited<ReturnType<typeof release>>,
    remote: { projection: unknown; observedAt: string },
    hold: ProductAvailabilitySnapshot | null,
  ) {
    const decisionAt = now();
    const acceptedDay = input.readiness.currentDay(c, decisionAt);
    // The calendar calculation is synchronous and uses this exact instant.
    // Reject an over-budget/reversed clock during that calculation rather than
    // silently treating a slow callback as fresh evidence.
    const calendarEndedAt = now();
    if (
      !Number.isFinite(calendarEndedAt.getTime()) ||
      calendarEndedAt.getTime() < decisionAt.getTime() ||
      calendarEndedAt.getTime() - decisionAt.getTime() > input.maxObservationAgeMs
    )
      throw new Error('Activation calendar calculation exceeded decision budget');
    if (input.readiness.currentDay(c, calendarEndedAt) !== acceptedDay)
      throw new Error('Merchant day changed during activation decision');
    requireIssuanceReady({ config: c.publicConfig, keyId: c.selectedKeyId, acceptedDay });
    // No awaited operation after this complete synchronous revalidation before commit/dispatch.
    assertProductionFunctionArtifactReady({
      scope: {
        shopId: c.shopId,
        installationGeneration: c.scope.installationGeneration,
        appClientId: c.availabilityScope.appClientId,
      },
      expectedBuild: artifact.expectedBuild,
      attestation: artifact.attestation,
      observation: artifact.observation,
      now: decisionAt,
      maxObservationAgeMs: input.maxObservationAgeMs,
    });
    fresh(remote.observedAt, decisionAt, input.maxObservationAgeMs);
    if (hold) fresh(hold.observedAt, decisionAt, input.maxObservationAgeMs);
    return decisionAt;
  }
  async function held(session: ActivationSession): Promise<ProductAvailabilitySnapshot | null> {
    const c = session.candidate;
    const hold = c.state.hold;
    if (!hold) return null;
    const observed = await input.availability.observe(c.availabilityScope, hold);
    if (
      observed.kind !== 'HELD' ||
      !observed.hold.held ||
      !exactSnapshot(observed.current, observed.hold.held) ||
      activationDigest(observed.hold.before) !== activationDigest(hold.before) ||
      observed.hold.operationId !== c.operationId ||
      observed.hold.version !== 'm5-availability-hold-v1' ||
      observed.current.state !== 'unavailable' ||
      observed.current.productId !== c.productId ||
      activationDigest(observed.current.scope) !== activationDigest(c.availabilityScope) ||
      (hold.held !== null && !exactSnapshot(hold.held, observed.current))
    ) {
      await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
      return null;
    }
    fresh(observed.current.observedAt, now(), input.maxObservationAgeMs);
    await session.save({ ...c.state, kind: 'HELD', hold: { ...hold, held: hold.held ?? observed.hold.held } });
    return observed.current;
  }
  const coordinator = {
    async advance(identity: ActivationIdentity): Promise<ActivationResult> {
      try {
        // A fresh token exists only for this invocation, after durable acquisition intent commits.
        let dispatchAcquisition = false;
        let dispatchRestoration = false;
        let resumeAfterConcurrentActivation = false;
        const prepared = await input.store.locked(identity, async (session): Promise<ActivationResult | null> => {
          const c = session.candidate;
          if (c.state.kind === 'OPERATOR_HOLD') return result('OPERATOR_HOLD', c);
          if (c.status === 'activated') {
            if (c.state.kind === 'RESTORATION_PENDING') {
              try {
                await release(c);
              } catch {
                return result('ACTIVATED_RESTORATION_PENDING', c);
              }
              // Commit a one-use claim before any restore can be dispatched.
              // No later invocation can reconstruct this local capability from
              // unchanged readback or a timeout: the earlier write may be in flight.
              await session.save({ ...c.state, kind: 'RESTORATION_CLAIMED' });
              dispatchRestoration = true;
            }
            return null;
          }
          const admission = classifyPublicationAdmission({
            prior: c.prior,
            proposed: { mode: c.mode, installationGeneration: c.scope.installationGeneration },
            phase: c.phase,
          });
          if (admission === 'SAME_MODE') return null;
          if (c.state.kind === 'HOLD_INTENT') {
            await session.save({ ...c.state, kind: 'ACQUISITION_PENDING' });
            dispatchAcquisition = true;
            return null;
          }
          if (c.state.hold) return null;
          try {
            await release(c);
          } catch {
            await session.save({ ...c.state, kind: 'WAITING_RELEASE' });
            return result('WAITING_RELEASE', c);
          }
          const before = structuredClone(await input.availability.snapshot(c.availabilityScope, c.productId));
          if (!snapshotShape(before)) throw new Error('Hold snapshot malformed');
          if (
            before.productId !== c.productId ||
            activationDigest(before.scope) !== activationDigest(c.availabilityScope)
          )
            throw new Error('Hold scope mismatch');
          fresh(before.observedAt, now(), input.maxObservationAgeMs);
          await session.save({
            ...c.state,
            kind: 'HOLD_INTENT',
            hold: { version: 'm5-availability-hold-v1', operationId: c.operationId, before, held: null },
          });
          return result('WAITING_HOLD', c);
        });
        if (prepared) return prepared;
        const outcome = await input.store.locked(identity, async (session): Promise<ActivationResult> => {
          let c = session.candidate;
          if (c.state.kind === 'OPERATOR_HOLD') return result('OPERATOR_HOLD', c);
          if (c.status === 'activated') {
            if (!c.state.evidenceDigest) throw new Error('Activated publication lacks immutable evidence');
            if (c.state.kind === 'RESTORED') return result('ACTIVE', c);
            // Another invocation may have committed activation between our two
            // transactions. We did not acquire its restoration claim.
            if (c.state.kind === 'RESTORATION_PENDING') {
              resumeAfterConcurrentActivation = true;
              return result('ACTIVATED_RESTORATION_PENDING', c);
            }
            if (!c.state.hold?.held || c.state.kind !== 'RESTORATION_CLAIMED')
              throw new Error('Missing restoration intent');
            if (!dispatchRestoration) {
              const observed = await input.availability.observe(c.availabilityScope, c.state.hold);
              if (observed.kind === 'HELD' && exactSnapshot(observed.current, c.state.hold.held)) {
                fresh(observed.current.observedAt, now(), input.maxObservationAgeMs);
                return result('ACTIVATED_RESTORATION_PENDING', c);
              }
              await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
              return result('OPERATOR_HOLD', c);
            }
            let restorationArtifact: Awaited<ReturnType<typeof release>>;
            try {
              restorationArtifact = await release(c);
            } catch {
              return result('ACTIVATED_RESTORATION_PENDING', c);
            }
            let restorationProjection: { projection: unknown; observedAt: string };
            try {
              const remote = await input.readiness.observeProjection(c);
              restorationProjection = remote;
              fresh(remote.observedAt, now(), input.maxObservationAgeMs);
              if (activationDigest(remote.projection) !== c.desiredProjectionDigest)
                throw new Error('Restoration policy drift');
              requireIssuanceReady({
                config: c.publicConfig,
                keyId: c.selectedKeyId,
                acceptedDay: input.readiness.currentDay(c, now()),
              });
            } catch {
              await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
              return result('OPERATOR_HOLD', c);
            }
            // A restore response may have been lost. Never overwrite a changed remote snapshot.
            const observation = await input.availability.observe(c.availabilityScope, c.state.hold);
            if (observation.kind !== 'HELD' || !exactSnapshot(observation.current, c.state.hold.held)) {
              await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
              return result('OPERATOR_HOLD', c);
            }
            fresh(observation.current.observedAt, now(), input.maxObservationAgeMs);
            decisionReady(c, restorationArtifact, restorationProjection, observation.current);
            const restored = await input.availability.restore(c.availabilityScope, c.state.hold, observation.current);
            if (restored.kind === 'RESTORATION_PENDING') return result('ACTIVATED_RESTORATION_PENDING', c);
            const valid =
              restored.kind === 'RESTORED' &&
              snapshotShape(restored.current) &&
              restored.current.productId === c.productId &&
              activationDigest(restored.current.scope) === activationDigest(c.availabilityScope) &&
              restored.current.state === c.state.hold.before.state &&
              restored.current.visibilityDigest === c.state.hold.before.visibilityDigest;
            if (valid && restored.current) fresh(restored.current.observedAt, now(), input.maxObservationAgeMs);
            await session.save({ ...c.state, kind: valid ? 'RESTORED' : 'OPERATOR_HOLD' });
            return result(valid ? 'ACTIVE' : 'OPERATOR_HOLD', c);
          }
          const admission = classifyPublicationAdmission({
            prior: c.prior,
            proposed: { mode: c.mode, installationGeneration: c.scope.installationGeneration },
            phase: c.phase,
          });
          let holdObservation: ProductAvailabilitySnapshot | null = null;
          if (admission !== 'SAME_MODE') {
            if (!c.state.hold) return result('WAITING_HOLD', c);
            if (dispatchAcquisition && c.state.kind === 'ACQUISITION_PENDING') {
              const observed = await input.availability.acquire(c.availabilityScope, c.state.hold);
              if (
                observed.kind === 'HELD' &&
                observed.hold.version === c.state.hold.version &&
                observed.hold.operationId === c.operationId &&
                activationDigest(observed.hold.before) === activationDigest(c.state.hold.before)
              ) {
                await session.save({ ...c.state, kind: 'HELD', hold: observed.hold });
              } else {
                await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
                return result('OPERATOR_HOLD', c);
              }
            }
            holdObservation = await held(session);
            if (!holdObservation) return result('OPERATOR_HOLD', c);
            c = session.candidate;
          }
          if (c.phase !== 'activation-pending' || c.status !== 'observed')
            return result(admission === 'SAME_MODE' ? 'PUBLICATION_PENDING' : 'HELD', c);
          let artifact: Awaited<ReturnType<typeof release>>;
          try {
            artifact = await release(c);
          } catch {
            await session.save({ ...c.state, kind: 'WAITING_RELEASE' });
            return result('WAITING_RELEASE', c);
          }
          const at = now();
          requireIssuanceReady({
            config: c.publicConfig,
            keyId: c.selectedKeyId,
            acceptedDay: input.readiness.currentDay(c, at),
          });
          let remote: { projection: unknown; observedAt: string };
          try {
            remote = await input.readiness.observeProjection(c);
          } catch {
            await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
            return result('OPERATOR_HOLD', c);
          }
          fresh(remote.observedAt, now(), input.maxObservationAgeMs);
          const digest = activationDigest(remote.projection);
          if (
            digest !== c.desiredProjectionDigest ||
            digest !== c.observedProjectionDigest ||
            activationDigest(c.desiredProjection) !== digest
          ) {
            await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
            return result('OPERATOR_HOLD', c);
          }
          // Hold and Functions are reobserved after the potentially slow projection read, immediately before commit.
          if (admission !== 'SAME_MODE') {
            holdObservation = await held(session);
            if (!holdObservation) return result('OPERATOR_HOLD', c);
          }
          try {
            artifact = await release(c);
          } catch {
            await session.save({
              ...session.candidate.state,
              kind: 'WAITING_RELEASE',
            });
            return result('WAITING_RELEASE', session.candidate);
          }
          fresh(remote.observedAt, now(), input.maxObservationAgeMs);
          if (holdObservation) fresh(holdObservation.observedAt, now(), input.maxObservationAgeMs);
          requireIssuanceReady({
            config: c.publicConfig,
            keyId: c.selectedKeyId,
            acceptedDay: input.readiness.currentDay(c, now()),
          });
          const decisionAt = decisionReady(c, artifact, remote, holdObservation);
          const evidence: ActivationEvidence = {
            ...identity,
            version: 'm5-activation-evidence-v1',
            decisionVersion: 1,
            revisionId: c.revisionId,
            revisionHash: c.revisionHash,
            operationSequence: c.operationSequence,
            installationGeneration: c.scope.installationGeneration,
            authorizationGeneration: c.scope.authorizationGeneration,
            authorizationEpoch: c.scope.authorizationEpoch,
            selectedKeyId: c.selectedKeyId,
            desiredProjectionDigest: c.desiredProjectionDigest,
            observedProjectionDigest: digest,
            artifactEvidenceDigest: activationDigest(artifact.attestation),
            artifactEvidenceRef: artifact.attestation.appVersionRef as string,
            functionObservationDigest: activationDigest(artifact.observation),
            functionObservation: artifact.observation,
            functionPresence: { transform: 'present', validation: 'present' },
            admissionClass: admission,
            hold: admission === 'SAME_MODE' ? null : session.candidate.state.hold,
            holdObservation,
            createdAt: decisionAt.toISOString(),
            projectionObservedAt: remote.observedAt,
          };
          const evidenceDigest = await session.commit(evidence);
          return { kind: evidence.hold ? 'ACTIVATED_RESTORATION_PENDING' : 'ACTIVE', evidenceDigest };
        });
        // Only restart preparation for an undispatched intent committed by a
        // concurrent activation. Claimed/ambiguous writes never enter this path.
        return resumeAfterConcurrentActivation ? coordinator.advance(identity) : outcome;
      } catch (error) {
        if (error instanceof ActivationFenceError) return { kind: 'OPERATOR_HOLD', evidenceDigest: null };
        throw error;
      }
    },
  };
  return coordinator;
}
