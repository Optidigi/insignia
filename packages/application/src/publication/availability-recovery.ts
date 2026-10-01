import { type ActivationIdentity, activationDigest } from './activation.js';
import type { AvailabilityHold, AvailabilityScope, ProductAvailabilitySnapshot } from './availability.js';

export type AvailabilityRecoveryRequest = ActivationIdentity & { commandKey: string };
export type AvailabilityRecoveryContext = AvailabilityRecoveryRequest &
  Readonly<{
    currentScope: AvailabilityScope;
    hold: AvailabilityHold;
    observed: ProductAvailabilitySnapshot;
  }>;
/** Server-owned, authenticated operator decision source. A browser value, generic
 * environment JSON or automatic status match is not this authority. No production
 * source is supplied. Operator must establish settlement of all outstanding writes. */
export interface TrustedAvailabilityRecoveryAuthorityPort {
  read(context: AvailabilityRecoveryContext): Promise<unknown | null>;
}
export type AvailabilityRecoveryDecision = AvailabilityRecoveryRequest &
  Readonly<{
    version: 'm5-availability-recovery-decision-v1';
    decisionRef: string;
    actorRef: string;
    currentScopeDigest: string;
    holdDigest: string;
    observedSnapshotDigest: string;
    outstandingWrites: 'SETTLED_BY_TRUSTED_OPERATOR';
    reviewedAt: string;
    expiresAt: string;
  }>;
export type AvailabilityRecoveryResolution = AvailabilityRecoveryRequest &
  Readonly<{
    version: 'm5-availability-resolution-v1';
    outcome: 'ORIGINAL_STATE_OBSERVED';
    currentScope: AvailabilityScope;
    originalHold: AvailabilityHold;
    observed: ProductAvailabilitySnapshot;
    decision: AvailabilityRecoveryDecision;
    activationEvidenceDigest: string | null;
    createdAt: string;
  }>;

/** Provider identity/version/state, deliberately excluding the fresh read timestamp. */
export function availabilitySnapshotIdentityDigest(snapshot: ProductAvailabilitySnapshot): string {
  return activationDigest({
    scope: snapshot.scope,
    productId: snapshot.productId,
    state: snapshot.state,
    providerVersion: snapshot.providerVersion,
    visibilityDigest: snapshot.visibilityDigest,
  });
}

/** Validates a previously reviewed operator decision; never infers approval from
 * current status, zero activity, a timeout, or a missing mutation response. */
export function validateAvailabilityRecoveryDecision(
  value: unknown,
  context: AvailabilityRecoveryContext,
  now: Date,
  maxAgeMs: number,
): AvailabilityRecoveryDecision {
  const invalid = (): never => {
    throw new Error('Trusted availability recovery decision unavailable or mismatched');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  const fields = [
    'version',
    'shopId',
    'configId',
    'operationId',
    'commandKey',
    'decisionRef',
    'actorRef',
    'currentScopeDigest',
    'holdDigest',
    'observedSnapshotDigest',
    'outstandingWrites',
    'reviewedAt',
    'expiresAt',
  ];
  if (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) return invalid();
  if (
    Reflect.ownKeys(record).length !== fields.length ||
    !Reflect.ownKeys(record).every(
      (key) =>
        typeof key === 'string' &&
        fields.includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(record, key) ?? {}, 'value'),
    )
  )
    return invalid();
  if (
    record.version !== 'm5-availability-recovery-decision-v1' ||
    ['shopId', 'configId', 'operationId', 'commandKey'].some(
      (key) => record[key] !== context[key as keyof AvailabilityRecoveryRequest],
    ) ||
    record.outstandingWrites !== 'SETTLED_BY_TRUSTED_OPERATOR' ||
    record.currentScopeDigest !== activationDigest(context.currentScope) ||
    record.holdDigest !== activationDigest(context.hold) ||
    record.observedSnapshotDigest !== availabilitySnapshotIdentityDigest(context.observed) ||
    !['decisionRef', 'actorRef'].every(
      (key) => typeof record[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$/.test(record[key] as string),
    )
  )
    return invalid();
  if (
    !['reviewedAt', 'expiresAt'].every(
      (key) =>
        typeof record[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record[key] as string),
    )
  )
    return invalid();
  const reviewed = Date.parse(record.reviewedAt as string),
    expires = Date.parse(record.expiresAt as string);
  if (
    !Number.isFinite(reviewed) ||
    !Number.isFinite(expires) ||
    new Date(reviewed).toISOString() !== record.reviewedAt ||
    new Date(expires).toISOString() !== record.expiresAt
  )
    return invalid();
  const observed = Date.parse(context.observed.observedAt),
    at = now.getTime();
  if (
    ![reviewed, expires, observed, at, maxAgeMs].every(Number.isFinite) ||
    maxAgeMs < 0 ||
    reviewed > at ||
    observed > at ||
    expires <= at ||
    expires <= reviewed ||
    at - reviewed > maxAgeMs ||
    at - observed > maxAgeMs
  )
    return invalid();
  return structuredClone(record) as unknown as AvailabilityRecoveryDecision;
}

/** Observation-only closure. Does not attribute the remote restoration to this
 * process and never authorizes a write over drift. Current installation scope may
 * differ after reinstall; original product/shop/app identity must remain exact. */
export function assertOriginalAvailabilityObserved(context: AvailabilityRecoveryContext): void {
  const before = context.hold.before,
    current = context.observed,
    scope = context.currentScope;
  if (
    context.hold.version !== 'm5-availability-hold-v1' ||
    context.hold.operationId !== context.operationId ||
    before.scope.shopId !== context.shopId ||
    scope.shopId !== context.shopId ||
    scope.appClientId !== before.scope.appClientId ||
    scope.shopifyShopId !== before.scope.shopifyShopId ||
    current.productId !== before.productId ||
    activationDigest(current.scope) !== activationDigest(scope) ||
    current.state !== before.state ||
    current.visibilityDigest !== before.visibilityDigest ||
    typeof current.providerVersion !== 'string' ||
    current.providerVersion.length === 0 ||
    current.providerVersion.length > 256 ||
    !/^[a-f0-9]{64}$/.test(current.visibilityDigest)
  )
    throw new Error('Original availability not observed; operator hold retained');
}
