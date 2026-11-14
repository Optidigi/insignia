/**
 * #466 part B: automatic release of an abandoned publication hold. Pure decisions only; the
 * database triggers are the authority (design-466 §3.1, §3.2) and tests compare the two tables.
 */
import { type ActivationStateKind, activationDigest, restorationSettled } from './activation.js';
import type { AvailabilityScope } from './availability.js';
import {
  type AnyAvailabilityHold,
  type AnyAvailabilityObservation,
  type AvailabilityHoldV3,
  type AvailabilityRestorationClaimV3,
  type AvailabilityRestorationReceiptV3,
  availabilityV3OwnedHeld,
  isAvailabilityV3,
  sameAvailabilityV3,
} from './availability-v3.js';

export const ABANDON_AFTER_DEFAULT_MS = 600_000;
export const ABANDON_AFTER_MIN_MS = 300_000;
export const ABANDON_AFTER_MAX_MS = 86_400_000;
export const RELEASE_WAIT_FLAG_DEFAULT_MS = 86_400_000;
export const ABANDON_CLAIM_STALE_DEFAULT_MS = 120_000;

export type AbandonmentAuthority = 'PROVED_NOT_DISPATCHED' | 'SETTLED_BY_TRUSTED_OPERATOR';
export type PublicationAbandonmentClaim = Readonly<{
  version: 'm5-publication-abandonment-claim-v1';
  operationId: string;
  scope: AvailabilityScope;
  productId: string;
  authority: AbandonmentAuthority;
  quietSince: string;
  claimedAt: string;
  commandKey?: string;
  inspectDigest?: string;
}>;
export type AbandonedHold = AvailabilityHoldV3 & Readonly<{ abandonmentClaim?: PublicationAbandonmentClaim }>;

/** Bounded reason codes; they go to the warn log and the audit detail, never to authority. */
export type AbandonmentFlagReason =
  | 'fields_written'
  | 'release_wait_after_writes'
  | 'acquisition_unsettled'
  | 'hold_not_owned'
  | 'product_changed'
  | 'claim_fenced'
  | 'claim_unsettled'
  | 'restore_ambiguous'
  | 'restore_conflict';
export type AbandonmentSkipReason =
  | 'not_candidate'
  | 'superseded'
  | 'not_quiet'
  | 'observation_unavailable'
  | 'observation_empty';

/** Facts read under the six-row lock (design §2.3). Times come from the database clock. */
export type AbandonmentCandidate = Readonly<{
  operationId: string;
  kind: ActivationStateKind;
  hold: AnyAvailabilityHold | null;
  evidenceDigest: string | null;
  resolutionDigest: string | null;
  phase: string;
  status: string;
  operationSequence: string;
  configSequence: string;
  installationCurrent: boolean;
  /** greatest(operation requested_at, progress updated_at, activation updated_at) */
  quietSince: Date;
  now: Date;
}>;
export type AbandonmentObservation = AnyAvailabilityObservation | Readonly<{ kind: 'UNAVAILABLE' }>;
export type AbandonmentDecision =
  | Readonly<{
      kind: 'CLAIM';
      abandonmentClaim: PublicationAbandonmentClaim;
      restorationClaim: AvailabilityRestorationClaimV3;
    }>
  | Readonly<{ kind: 'FLAG'; reasons: readonly AbandonmentFlagReason[] }>
  | Readonly<{ kind: 'SKIP'; reason: AbandonmentSkipReason }>
  /** Every fact but E8 holds: observe the product (read only) under the lock, then decide again. */
  | Readonly<{ kind: 'OBSERVE' }>;

const ownedHold = (hold: AnyAvailabilityHold | null, operationId: string): hold is AvailabilityHoldV3 =>
  hold?.version === 'm5-availability-hold-v3' &&
  hold.operationId === operationId &&
  availabilityV3OwnedHeld(hold) &&
  hold.restorationClaim === undefined &&
  hold.restorationReceipt === undefined &&
  !Object.hasOwn(hold, 'abandonmentClaim');

/** Design §2.3 and the "not eligible" table. `observation` is undefined until E8 was read. */
export function decideAbandonment(input: {
  candidate: AbandonmentCandidate;
  observation?: AbandonmentObservation;
  abandonAfterMs: number;
  releaseWaitFlagMs: number;
}): AbandonmentDecision {
  const c = input.candidate;
  if (!['HELD', 'WAITING_RELEASE', 'ACQUISITION_PENDING'].includes(c.kind) || !c.hold)
    return { kind: 'SKIP', reason: 'not_candidate' };
  // Installation changed or operation superseded: the existing activation fence records OPERATOR_HOLD.
  if (c.status !== 'requested' || c.operationSequence !== c.configSequence || !c.installationCurrent)
    return { kind: 'SKIP', reason: 'superseded' };
  const bound = c.kind === 'WAITING_RELEASE' ? input.releaseWaitFlagMs : input.abandonAfterMs;
  if (c.now.getTime() - c.quietSince.getTime() < bound) return { kind: 'SKIP', reason: 'not_quiet' };
  if (c.kind === 'ACQUISITION_PENDING') return { kind: 'FLAG', reasons: ['acquisition_unsettled'] };
  if (c.kind === 'WAITING_RELEASE') return { kind: 'FLAG', reasons: ['release_wait_after_writes'] };
  if (c.evidenceDigest !== null || c.resolutionDigest !== null) return { kind: 'SKIP', reason: 'not_candidate' };
  if (c.phase !== 'prepared') return { kind: 'FLAG', reasons: ['fields_written'] };
  if (!ownedHold(c.hold, c.operationId)) return { kind: 'FLAG', reasons: ['hold_not_owned'] };
  const observation = input.observation;
  if (!observation) return { kind: 'OBSERVE' };
  if (observation.kind === 'UNAVAILABLE') return { kind: 'SKIP', reason: 'observation_unavailable' };
  // credential_inactive, query_cost_exceeded and similar observed nothing.
  if (observation.current === null) return { kind: 'SKIP', reason: 'observation_empty' };
  const held = c.hold.held!;
  if (
    observation.kind !== 'HELD' ||
    !isAvailabilityV3(observation.current) ||
    !sameAvailabilityV3(observation.current, held) ||
    observation.current.state !== 'unavailable'
  )
    return { kind: 'FLAG', reasons: ['product_changed'] };
  const scope = c.hold.before.scope;
  return {
    kind: 'CLAIM',
    abandonmentClaim: {
      version: 'm5-publication-abandonment-claim-v1',
      operationId: c.operationId,
      scope,
      productId: c.hold.before.productId,
      authority: 'PROVED_NOT_DISPATCHED',
      quietSince: c.quietSince.toISOString(),
      claimedAt: c.now.toISOString(),
    },
    restorationClaim: {
      version: 'm5-availability-restoration-claim-v3',
      operationId: c.operationId,
      scope,
      productId: c.hold.before.productId,
      restoreReserved: true,
      compensationReserved: true,
    },
  };
}

/** A NOT_DISPATCHED receipt not yet consumed into the claim: T2 may rearm once (§4.5). */
export function abandonmentRearmable(hold: AvailabilityHoldV3): boolean {
  const receipt = hold.restorationReceipt;
  return Boolean(
    receipt?.kind === 'NOT_DISPATCHED' &&
      receipt.acknowledgement === null &&
      receipt.compensation === undefined &&
      hold.restorationClaim &&
      hold.restorationClaim.settledNoDispatchReceiptDigest !== activationDigest(receipt),
  );
}

/**
 * Design §4.5. After T2 stores a receipt, or on a later pass, decides the claim's next kind:
 * RESTORED (qualified, exact original) ends the hold; an unconsumed NOT_DISPATCHED stays claimed
 * for one rearm; anything else is ambiguous or conflicting and goes to the operator. A claim with
 * no receipt, or with a consumed NOT_DISPATCHED and nothing newer, stays claimed until it is
 * stale (a crash may have dispatched), then goes to the operator.
 */
export function settleAbandonmentReceipt(input: {
  hold: AvailabilityHoldV3;
  receipt: AvailabilityRestorationReceiptV3 | undefined;
  claimUpdatedAt: Date;
  now: Date;
  staleMs: number;
}): 'ABANDON_RESTORED' | 'OPERATOR_HOLD' | 'ABANDON_CLAIMED' {
  const { hold, receipt } = input;
  const stale = input.now.getTime() - input.claimUpdatedAt.getTime() >= input.staleMs;
  if (!receipt) return stale ? 'OPERATOR_HOLD' : 'ABANDON_CLAIMED';
  if (receipt.kind === 'RESTORED')
    return restorationSettled(hold, receipt, hold.before.productId, hold.before.scope)
      ? 'ABANDON_RESTORED'
      : 'OPERATOR_HOLD';
  if (receipt.kind === 'NOT_DISPATCHED' && receipt.acknowledgement === null && receipt.compensation === undefined)
    return abandonmentRearmable({ ...hold, restorationReceipt: receipt }) || !stale
      ? 'ABANDON_CLAIMED'
      : 'OPERATOR_HOLD';
  return 'OPERATOR_HOLD';
}

/** The activated path shares the stale rule (§4.4): RESTORATION_CLAIMED with no receipt, or a
 * consumed NOT_DISPATCHED with nothing newer, past the bound goes to the operator. */
export function restorationClaimStale(input: {
  hold: AvailabilityHoldV3;
  claimUpdatedAt: Date;
  now: Date;
  staleMs: number;
}): boolean {
  if (input.now.getTime() - input.claimUpdatedAt.getTime() < input.staleMs || !input.hold.restorationClaim)
    return false;
  const receipt = input.hold.restorationReceipt;
  if (!receipt) return true;
  return receipt.kind === 'NOT_DISPATCHED' && !abandonmentRearmable(input.hold);
}

/** Flag reason for a settled non-RESTORED receipt. */
export function abandonmentReceiptReason(receipt: AvailabilityRestorationReceiptV3): AbandonmentFlagReason {
  return receipt.kind === 'RESTORATION_PENDING' ? 'restore_ambiguous' : 'restore_conflict';
}

/** Startup validation of the worker bounds (design §6). A value outside its range is an error. */
export function parseAbandonmentConfig(env: Record<string, string | undefined>): {
  mode: 'off' | 'flag' | 'restore';
  abandonAfterMs: number;
  releaseWaitFlagMs: number;
  claimStaleMs: number;
} {
  const mode = env.INSIGNIA_PUBLICATION_ABANDONMENT ?? 'off';
  if (mode !== 'off' && mode !== 'flag' && mode !== 'restore')
    throw new Error('INSIGNIA_PUBLICATION_ABANDONMENT must be off, flag or restore');
  const bounded = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${name} must be an integer between ${min} and ${max} milliseconds`);
    return value;
  };
  return {
    mode,
    abandonAfterMs: bounded(
      'INSIGNIA_PUBLICATION_ABANDON_AFTER_MS',
      ABANDON_AFTER_DEFAULT_MS,
      ABANDON_AFTER_MIN_MS,
      ABANDON_AFTER_MAX_MS,
    ),
    releaseWaitFlagMs: bounded(
      'INSIGNIA_PUBLICATION_RELEASE_WAIT_FLAG_MS',
      RELEASE_WAIT_FLAG_DEFAULT_MS,
      ABANDON_AFTER_MIN_MS,
      7 * ABANDON_AFTER_MAX_MS,
    ),
    // Above the 8 s adapter budget plus lock waits.
    claimStaleMs: bounded('ABANDON_CLAIM_STALE_MS', ABANDON_CLAIM_STALE_DEFAULT_MS, 30_000, 3_600_000),
  };
}
