/**
 * #466 part A: the owner-run operator command for an `OPERATOR_HOLD` publication hold. Pure
 * findings and the inspection digest only (design-466 §9). The database triggers and the operator
 * claim function remain the authority; B's restore and finalize run unchanged.
 */
import type { ActivationStateKind } from './activation.js';
import { activationDigest } from './activation.js';
import { availabilitySnapshotIdentityDigest } from './availability-recovery.js';
import {
  type AnyAvailabilityHold,
  availabilityV3HeldSafe,
  availabilityV3OwnedHeld,
  type ProductAvailabilitySnapshotV3,
  sameAvailabilityV3,
} from './availability-v3.js';

/** An inspection is accepted by `restore` for this long after it was taken (database clock). */
export const OPERATOR_INSPECT_MAX_AGE_MS = 600_000;

/** Bounded reason codes. Where a code matches B's flag or skip reason it means the same fact. */
export type OperatorHoldReason =
  | 'not_operator_hold'
  | 'hold_not_owned'
  | 'restoration_started'
  | 'fields_written'
  | 'superseded'
  | 'installation_changed'
  | 'credential_unavailable'
  | 'observation_unavailable'
  | 'product_changed'
  | 'fields_unavailable'
  | 'registration_changed'
  | 'policy_changed';

/** Stored facts of one held operation (design §2.3 P1, E3, E4, E6), read from committed rows. */
export type OperatorHoldFacts = Readonly<{
  shopId: string;
  configId: string;
  operationId: string;
  kind: ActivationStateKind;
  activationVersion: string;
  hold: AnyAvailabilityHold | null;
  evidenceDigest: string | null;
  resolutionDigest: string | null;
  phase: string;
  status: string;
  operationSequence: string;
  configSequence: string;
  /** The operation's installation is the shop's current one and it is active (E4). */
  installationCurrent: boolean;
  priorRegistrationDigest: string | null;
  priorPolicyDigest: string | null;
}>;
export type OperatorLiveField =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'present'; compareDigest: string }>
  | Readonly<{ kind: 'unavailable' }>;
/** Live Shopify reads with the shop's offline token; null when no usable token was available. */
export type OperatorHoldLive = Readonly<{
  product: Readonly<{ kind: 'read'; snapshot: ProductAvailabilitySnapshotV3 }> | Readonly<{ kind: 'unavailable' }>;
  registration: OperatorLiveField;
  policy: OperatorLiveField;
}> | null;

const fieldDigest = (field: OperatorLiveField) => (field.kind === 'present' ? field.compareDigest : null);

/** The live product equals the owned `held` snapshot exactly (B's E8), in the snapshot's own scope. */
export function operatorProductHeld(hold: AnyAvailabilityHold | null, live: OperatorHoldLive): boolean {
  if (hold?.version !== 'm5-availability-hold-v3' || !hold.held || live?.product.kind !== 'read') return false;
  const current = live.product.snapshot;
  return sameAvailabilityV3(hold.held, current) && availabilityV3HeldSafe(current, hold.before);
}

/**
 * Why `restore` would refuse; empty means safe to restore. Safe only for an `OPERATOR_HOLD` with an
 * owned held receipt and no restoration yet, at committed phase `prepared` of the current requested
 * operation of the current installation, whose live product equals the held snapshot exactly and
 * whose live registration and policy equal their pre-publish digests.
 */
export function operatorRestoreReasons(facts: OperatorHoldFacts, live: OperatorHoldLive): OperatorHoldReason[] {
  const reasons: OperatorHoldReason[] = [];
  const hold = facts.hold;
  if (facts.kind !== 'OPERATOR_HOLD') reasons.push('not_operator_hold');
  if (
    hold?.version !== 'm5-availability-hold-v3' ||
    hold.operationId !== facts.operationId ||
    facts.evidenceDigest !== null ||
    facts.resolutionDigest !== null ||
    !availabilityV3OwnedHeld(hold)
  )
    reasons.push('hold_not_owned');
  else if (hold.restorationClaim || hold.restorationReceipt || Object.hasOwn(hold, 'abandonmentClaim'))
    reasons.push('restoration_started');
  if (facts.phase !== 'prepared') reasons.push('fields_written');
  if (facts.status !== 'requested' || facts.operationSequence !== facts.configSequence) reasons.push('superseded');
  if (!facts.installationCurrent) reasons.push('installation_changed');
  if (!live) {
    reasons.push('credential_unavailable');
    return reasons;
  }
  if (live.product.kind !== 'read') reasons.push('observation_unavailable');
  else if (!operatorProductHeld(hold, live)) reasons.push('product_changed');
  if (live.registration.kind === 'unavailable' || live.policy.kind === 'unavailable')
    reasons.push('fields_unavailable');
  else {
    if (fieldDigest(live.registration) !== facts.priorRegistrationDigest) reasons.push('registration_changed');
    if (fieldDigest(live.policy) !== facts.priorPolicyDigest) reasons.push('policy_changed');
  }
  return reasons;
}

/**
 * The inspection token: `<inspectedAt epoch ms>.<digest>`. The digest binds the operation, the
 * activation version, the hold, the installation, the live product (identity, not read time), the
 * live field digests and the inspection time, so `restore` recomputes it from fresh reads and the
 * time cannot be changed without breaking it. The claim stores the digest part.
 */
export function operatorInspectToken(input: {
  facts: OperatorHoldFacts;
  installationGeneration: string;
  product: ProductAvailabilitySnapshotV3;
  registrationDigest: string | null;
  policyDigest: string | null;
  inspectedAt: Date;
}): { token: string; digest: string } {
  const inspectedAt = input.inspectedAt.getTime();
  if (!Number.isSafeInteger(inspectedAt) || inspectedAt <= 0) throw new Error('Invalid inspection time');
  const digest = activationDigest({
    version: 'm5-publication-hold-inspect-v1',
    shopId: input.facts.shopId,
    configId: input.facts.configId,
    operationId: input.facts.operationId,
    activationVersion: input.facts.activationVersion,
    holdDigest: activationDigest(input.facts.hold),
    installationGeneration: input.installationGeneration,
    product: availabilitySnapshotIdentityDigest(input.product),
    registration: input.registrationDigest,
    policy: input.policyDigest,
    inspectedAt,
  });
  return { token: `${inspectedAt}.${digest}`, digest };
}

export function parseOperatorInspectToken(token: string): { inspectedAt: Date; digest: string } | null {
  const match = /^([1-9][0-9]{0,15})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const at = Number(match[1]);
  return Number.isSafeInteger(at) ? { inspectedAt: new Date(at), digest: match[2]! } : null;
}

export const operatorLiveFieldDigest = fieldDigest;
