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
  AvailabilityHold as AvailabilityHoldV1,
  AvailabilityScope,
  ProductAvailabilitySnapshot as ProductAvailabilitySnapshotV1,
} from './availability.js';
import {
  type AvailabilityHoldV2,
  isAvailabilityV2,
  type ProductAvailabilitySnapshotV2,
  sameAvailabilityV2,
  validAvailabilityV2,
} from './availability-v2.js';
import type {
  AnyAvailabilityHold as AvailabilityHold,
  ProductAvailabilityHoldV3Port as ProductAvailabilityHoldPort,
  AnyProductAvailabilitySnapshot as ProductAvailabilitySnapshot,
} from './availability-v3.js';
import {
  type AvailabilityHoldV3,
  availabilityV3AcknowledgementQualified,
  availabilityV3HeldSafe,
  availabilityV3OwnedHeld,
  availabilityV3Qualified,
  isAvailabilityV3,
  type ProductAvailabilitySnapshotV3,
  sameAvailabilityV3,
  validAvailabilityV3,
} from './availability-v3.js';
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
export type ActivationEvidenceV1 = ActivationIdentity &
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
    hold: AvailabilityHoldV1 | null;
    holdObservation: ProductAvailabilitySnapshotV1 | null;
    createdAt: string;
    projectionObservedAt: string;
  }>;
export type ActivationEvidenceV2 = Omit<
  ActivationEvidenceV1,
  'version' | 'decisionVersion' | 'hold' | 'holdObservation'
> &
  Readonly<{
    version: 'm5-activation-evidence-v2';
    decisionVersion: 2;
    hold: AvailabilityHoldV2 | null;
    holdObservation: ProductAvailabilitySnapshotV2 | null;
  }>;
export type ActivationEvidenceV3 = Omit<
  ActivationEvidenceV1,
  'version' | 'decisionVersion' | 'hold' | 'holdObservation'
> &
  Readonly<{
    version: 'm5-activation-evidence-v3';
    decisionVersion: 3;
    hold: AvailabilityHoldV3 | null;
    holdObservation: ProductAvailabilitySnapshotV3 | null;
  }>;
export type ActivationEvidence = ActivationEvidenceV1 | ActivationEvidenceV2 | ActivationEvidenceV3;
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
function snapshotShape(snapshot: ProductAvailabilitySnapshot | null): snapshot is ProductAvailabilitySnapshot {
  if (!snapshot) return false;
  if (isAvailabilityV3(snapshot)) return validAvailabilityV3(snapshot);
  if (isAvailabilityV2(snapshot)) return validAvailabilityV2(snapshot);
  return Boolean(
    snapshot &&
      ['available', 'unavailable', 'archived', 'unlisted'].includes(snapshot.state) &&
      typeof snapshot.providerVersion === 'string' &&
      snapshot.providerVersion.length > 0 &&
      snapshot.providerVersion.length <= 256 &&
      typeof snapshot.visibilityDigest === 'string' &&
      /^[a-f0-9]{64}$/.test(snapshot.visibilityDigest) &&
      typeof snapshot.observedAt === 'string',
  );
}
function exactSnapshot(a: ProductAvailabilitySnapshot, b: ProductAvailabilitySnapshot): boolean {
  if (isAvailabilityV3(a) || isAvailabilityV3(b))
    return isAvailabilityV3(a) && isAvailabilityV3(b) && sameAvailabilityV3(a, b);
  if (isAvailabilityV2(a) || isAvailabilityV2(b))
    return isAvailabilityV2(a) && isAvailabilityV2(b) && sameAvailabilityV2(a, b);
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
    const calendarStartedAt = now();
    if (!Number.isFinite(calendarStartedAt.getTime())) throw new Error('Invalid activation decision clock');
    let decisionAt = calendarStartedAt;
    let acceptedDay: number | undefined;
    let settled = false;
    // Calendar work is synchronous but can consume the remaining freshness
    // budget. Settle a day and instant together, without provider I/O or mutation retry.
    // Three bounded samples tolerate a clock tick; unstable preparation denies.
    for (let sample = 0; sample < 3; sample++) {
      const day = input.readiness.currentDay(c, decisionAt);
      if (acceptedDay !== undefined && day !== acceptedDay)
        throw new Error('Merchant day changed during activation decision');
      acceptedDay = day;
      if (input.readiness.currentDay(c, decisionAt) !== acceptedDay)
        throw new Error('Merchant day changed during activation decision');
      const completedAt = now();
      if (
        !Number.isFinite(completedAt.getTime()) ||
        completedAt.getTime() < decisionAt.getTime() ||
        completedAt.getTime() - calendarStartedAt.getTime() > input.maxObservationAgeMs
      )
        throw new Error('Activation calendar calculation exceeded decision budget');
      if (completedAt.getTime() === decisionAt.getTime()) {
        settled = true;
        break;
      }
      decisionAt = completedAt;
    }
    if (!settled || acceptedDay === undefined) throw new Error('Activation calendar calculation did not settle');
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
    if (hold.version !== 'm5-availability-hold-v3') {
      await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
      return null;
    }
    if ((hold.held === null && hold.before.state !== 'unavailable') || (hold.held && !availabilityV3OwnedHeld(hold))) {
      await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
      return null;
    }
    const observed = await input.availability.observe(c.availabilityScope, hold);
    if (
      observed.kind !== 'HELD' ||
      !observed.hold.held ||
      !exactSnapshot(observed.current, observed.hold.held) ||
      activationDigest(observed.hold.before) !== activationDigest(hold.before) ||
      observed.hold.operationId !== c.operationId ||
      observed.hold.version !== 'm5-availability-hold-v3' ||
      !isAvailabilityV3(observed.current) ||
      !availabilityV3HeldSafe(observed.current, hold.before) ||
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
          if (
            c.state.hold &&
            c.state.hold.version !== 'm5-availability-hold-v3' &&
            !['RESTORED', 'RESOLVED'].includes(c.state.kind)
          ) {
            await session.save({ ...c.state, kind: 'OPERATOR_HOLD' });
            return result('OPERATOR_HOLD', c);
          }
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
              if (c.state.hold?.version !== 'm5-availability-hold-v3') throw new Error('V3 restoration hold required');
              await session.save({
                ...c.state,
                kind: 'RESTORATION_CLAIMED',
                hold: {
                  ...c.state.hold,
                  restorationClaim: {
                    version: 'm5-availability-restoration-claim-v3',
                    scope: c.availabilityScope,
                    productId: c.productId,
                    operationId: c.operationId,
                    restoreReserved: true,
                    compensationReserved: true,
                  },
                },
              });
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
          if (!snapshotShape(before) || !isAvailabilityV3(before) || !availabilityV3Qualified(before))
            throw new Error('Hold snapshot malformed or future intent unqualified');
          if (
            before.productId !== c.productId ||
            activationDigest(before.scope) !== activationDigest(c.availabilityScope)
          )
            throw new Error('Hold scope mismatch');
          fresh(before.observedAt, now(), input.maxObservationAgeMs);
          await session.save({
            ...c.state,
            kind: 'HOLD_INTENT',
            hold: { version: 'm5-availability-hold-v3', operationId: c.operationId, before, held: null },
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
            let lastDecision = decisionReady(
              c,
              restorationArtifact,
              restorationProjection,
              observation.current,
            ).getTime();
            const beforeSend = () => {
              try {
                const at = decisionReady(c, restorationArtifact, restorationProjection, observation.current).getTime();
                if (at < lastDecision) return false;
                lastDecision = at;
                return true;
              } catch {
                return false;
              }
            };
            const restored = await input.availability.restore(
              c.availabilityScope,
              c.state.hold,
              observation.current,
              beforeSend,
            );
            if (c.state.hold.version === 'm5-availability-hold-v3') {
              if (
                (restored.acknowledgement && restored.acknowledgement.version !== 'm5-availability-mutation-ack-v3') ||
                (restored.current && !isAvailabilityV3(restored.current))
              )
                throw new Error('V3 restoration returned legacy evidence');
              await session.save({
                ...session.candidate.state,
                hold: {
                  ...c.state.hold,
                  restorationReceipt: {
                    version: 'm5-availability-restoration-receipt-v3',
                    kind: restored.kind,
                    acknowledgement: restored.acknowledgement ?? null,
                    current: restored.current as ProductAvailabilitySnapshotV3 | null,
                    ...('compensation' in restored && restored.compensation
                      ? { compensation: restored.compensation }
                      : {}),
                  },
                },
              });
            }
            if (restored.kind === 'RESTORATION_PENDING' || restored.kind === 'NOT_DISPATCHED')
              return result('ACTIVATED_RESTORATION_PENDING', c);
            const valid =
              restored.kind === 'RESTORED' &&
              snapshotShape(restored.current) &&
              restored.current.productId === c.productId &&
              activationDigest(restored.current.scope) === activationDigest(c.availabilityScope) &&
              restored.current.state === c.state.hold.before.state &&
              isAvailabilityV3(restored.current) &&
              isAvailabilityV3(c.state.hold.before) &&
              sameAvailabilityV3(restored.current, c.state.hold.before) &&
              (c.state.hold.before.state === 'unavailable' ||
                (availabilityV3AcknowledgementQualified(restored.acknowledgement) &&
                  restored.acknowledgement.productId === c.productId &&
                  restored.acknowledgement.state === c.state.hold.before.state &&
                  activationDigest(restored.acknowledgement.scope) === activationDigest(c.availabilityScope)));
            if (valid && restored.current) fresh(restored.current.observedAt, now(), input.maxObservationAgeMs);
            await session.save({ ...session.candidate.state, kind: valid ? 'RESTORED' : 'OPERATOR_HOLD' });
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
                const acknowledgement = observed.kind === 'CONFLICT' ? observed.acknowledgement : undefined;
                await session.save({
                  ...c.state,
                  kind: 'OPERATOR_HOLD',
                  hold:
                    c.state.hold.version === 'm5-availability-hold-v3' &&
                    acknowledgement?.version === 'm5-availability-mutation-ack-v3'
                      ? { ...c.state.hold, acquisitionAcknowledgement: acknowledgement }
                      : c.state.hold,
                });
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
          if (
            admission !== 'SAME_MODE' &&
            (session.candidate.state.hold?.version !== 'm5-availability-hold-v3' ||
              !holdObservation ||
              !isAvailabilityV3(holdObservation))
          )
            throw new Error('V3 activation hold binding missing');
          const evidence: ActivationEvidenceV3 = {
            ...identity,
            version: 'm5-activation-evidence-v3',
            decisionVersion: 3,
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
            hold: admission === 'SAME_MODE' ? null : (session.candidate.state.hold as AvailabilityHoldV3),
            holdObservation: holdObservation as ProductAvailabilitySnapshotV3 | null,
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
