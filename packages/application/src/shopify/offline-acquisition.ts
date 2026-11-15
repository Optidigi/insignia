import { type ExpiringOfflineTokenPair, validateExpiringOfflineTokenPair } from './offline-credentials.js';
export type OfflineAcquisitionIdentity = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
  externalInstallationId: string;
};
type Attempt = { shopId: string; installationGeneration: string; attemptId: string };
export interface OfflineAcquisitionPort {
  reserveAcquisition(
    input: OfflineAcquisitionIdentity & { claimLeaseMs: number },
  ): Promise<
    | { kind: 'reserved'; attemptId: string; shopDomain: string }
    | { kind: 'existing' | 'busy' | 'unresolved' | 'inactive' }
  >;
  dispatchAcquisition(input: Attempt): Promise<boolean>;
  completeAcquisition(input: Attempt & { pair: ExpiringOfflineTokenPair }): Promise<'installed' | 'stale' | 'inactive'>;
  rejectAcquisition(input: Attempt): Promise<boolean>;
  /**
   * The exchange ended without a known outcome: end its in-flight lease now so later requests report it as
   * unresolved at once instead of waiting as for an exchange still running. The attempt stays dispatched.
   */
  settleUnresolved(input: Attempt): Promise<void>;
}
/** Only a proved no-effect exchange rejection releases the durable dispatch fence. */
export class OfflineAcquisitionRejectedError extends Error {
  constructor() {
    super('Offline exchange rejected');
    this.name = 'OfflineAcquisitionRejectedError';
  }
}
export async function bootstrapExpiringOfflineCredentials(input: {
  credentials: OfflineAcquisitionPort;
  identity: OfflineAcquisitionIdentity;
  exchange(shopDomain: string): Promise<ExpiringOfflineTokenPair>;
  now?: () => Date;
}): Promise<'installed' | 'existing' | 'busy' | 'unresolved' | 'inactive' | 'rejected'> {
  const reservation = await input.credentials.reserveAcquisition({ ...input.identity, claimLeaseMs: 30000 });
  if (reservation.kind !== 'reserved') return reservation.kind;
  const attempt = {
    shopId: input.identity.shopId,
    installationGeneration: input.identity.installationGeneration,
    attemptId: reservation.attemptId,
  };
  if (!(await input.credentials.dispatchAcquisition(attempt))) return 'inactive';
  let pair: ExpiringOfflineTokenPair;
  try {
    pair = await input.exchange(reservation.shopDomain);
  } catch (error) {
    if (error instanceof OfflineAcquisitionRejectedError && (await input.credentials.rejectAcquisition(attempt)))
      return 'rejected';
    return unresolved(input.credentials, attempt);
  }
  try {
    validateExpiringOfflineTokenPair(pair, (input.now ?? (() => new Date()))());
    const result = await input.credentials.completeAcquisition({ ...attempt, pair });
    return result === 'installed' ? 'installed' : 'inactive';
  } catch {
    // A malformed success or lost persistence acknowledgment cannot justify another issuance.
    return unresolved(input.credentials, attempt);
  }
}
async function unresolved(credentials: OfflineAcquisitionPort, attempt: Attempt): Promise<'unresolved'> {
  try {
    await credentials.settleUnresolved(attempt);
  } catch {
    /* The lease then lapses by itself; either way no second issuance is reserved. */
  }
  return 'unresolved';
}
