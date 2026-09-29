/** A validated pair still has to be encrypted and generation-checked by the durable port. */
export type ExpiringOfflineTokenPair = {
  schemaVersion: 'm3-offline-credential-v1';
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  scopes: string | null;
};

export type CredentialClaim = {
  kind: 'claimed';
  shopDomain: string;
  claimId: string;
  credentialVersion: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

export type CredentialAcquire =
  | { kind: 'usable'; accessToken: string; accessExpiresAt: Date }
  | CredentialClaim
  | { kind: 'busy' | 'reauth_required' | 'inactive' | 'missing' };

export interface OfflineCredentialLifecyclePort {
  /** Must reject stale/deactivated generations and persist both encrypted values atomically. */
  install(input: { shopId: string; installationGeneration: string; pair: ExpiringOfflineTokenPair }): Promise<void>;
  /** DB time decides safe validity and the bounded claim lease; no transaction spans transport I/O. */
  acquire(input: {
    shopId: string;
    installationGeneration: string;
    minimumRemainingMs: number;
    claimLeaseMs: number;
  }): Promise<CredentialAcquire>;
  /** Must CAS generation, version and claim; atomically store both new encrypted values. */
  replaceClaim(input: {
    shopId: string;
    installationGeneration: string;
    claimId: string;
    credentialVersion: string;
    pair: ExpiringOfflineTokenPair;
  }): Promise<'replaced' | 'stale' | 'inactive'>;
  releaseClaim(input: { shopId: string; installationGeneration: string; claimId: string }): Promise<void>;
  markReauthRequired(input: {
    shopId: string;
    installationGeneration: string;
    claimId: string;
    credentialVersion: string;
  }): Promise<'marked' | 'stale' | 'inactive'>;
}

export interface OfflineRefreshTransport {
  refresh(input: { shopDomain: string; refreshToken: string }): Promise<ExpiringOfflineTokenPair>;
}

export type RefreshWorkflowResult =
  | { kind: 'usable' | 'refreshed'; accessToken: string; accessExpiresAt: Date }
  | { kind: 'busy' | 'reauth_required' | 'inactive' | 'missing' | 'stale' }
  | { kind: 'retryable' | 'blocked'; failure: string };

export class InvalidOfflineCredentialError extends Error {
  constructor() {
    super('Invalid expiring offline credential pair');
    this.name = 'InvalidOfflineCredentialError';
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function credential(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !hasControlCharacters(value);
}

export function validateExpiringOfflineTokenPair(pair: ExpiringOfflineTokenPair, now: Date): void {
  if (!pair) throw new InvalidOfflineCredentialError();
  if (
    pair.schemaVersion !== 'm3-offline-credential-v1' ||
    !credential(pair.accessToken) ||
    !credential(pair.refreshToken) ||
    !(pair.accessExpiresAt instanceof Date) ||
    !(pair.refreshExpiresAt instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(pair.accessExpiresAt.getTime()) ||
    !Number.isFinite(pair.refreshExpiresAt.getTime()) ||
    pair.accessExpiresAt <= now ||
    pair.refreshExpiresAt <= now ||
    (pair.scopes !== null &&
      (typeof pair.scopes !== 'string' || pair.scopes.length > 4096 || hasControlCharacters(pair.scopes)))
  ) {
    throw new InvalidOfflineCredentialError();
  }
}

function validGeneration(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

export async function installExpiringOfflineCredentials(
  credentials: OfflineCredentialLifecyclePort,
  input: { shopId: string; installationGeneration: string; pair: ExpiringOfflineTokenPair },
  now = new Date(),
): Promise<void> {
  if (!input.shopId || !validGeneration(input.installationGeneration)) throw new InvalidOfflineCredentialError();
  validateExpiringOfflineTokenPair(input.pair, now);
  await credentials.install(input);
}

function refreshFailureKind(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('kind' in error)) return null;
  const kind = error.kind;
  return typeof kind === 'string' ? kind : null;
}

export async function refreshExpiringOfflineCredentials(
  credentials: OfflineCredentialLifecyclePort,
  transport: OfflineRefreshTransport,
  input: {
    shopId: string;
    installationGeneration: string;
    minimumRemainingMs: number;
    claimLeaseMs: number;
  },
  now: () => Date = () => new Date(),
): Promise<RefreshWorkflowResult> {
  if (
    !input.shopId ||
    !validGeneration(input.installationGeneration) ||
    !Number.isInteger(input.minimumRemainingMs) ||
    input.minimumRemainingMs < 0 ||
    !Number.isInteger(input.claimLeaseMs) ||
    input.claimLeaseMs < 1000 ||
    input.claimLeaseMs > 30 * 60 * 1000
  ) {
    throw new TypeError('Invalid refresh target or lease');
  }
  const acquired = await credentials.acquire(input);
  if (acquired.kind === 'usable') return acquired;
  if (acquired.kind !== 'claimed') return acquired;
  const claim = {
    shopId: input.shopId,
    installationGeneration: input.installationGeneration,
    claimId: acquired.claimId,
    credentialVersion: acquired.credentialVersion,
  };
  if (
    !credential(acquired.refreshToken) ||
    !Number.isFinite(acquired.refreshExpiresAt.getTime()) ||
    acquired.refreshExpiresAt <= now()
  ) {
    const marked = await credentials.markReauthRequired(claim);
    return marked === 'marked' ? { kind: 'reauth_required' } : { kind: 'stale' };
  }

  let pair: ExpiringOfflineTokenPair;
  try {
    pair = await transport.refresh({ shopDomain: acquired.shopDomain, refreshToken: acquired.refreshToken });
    validateExpiringOfflineTokenPair(pair, now());
  } catch (error) {
    const failure = refreshFailureKind(error);
    if (failure === 'terminal_invalid_refresh') {
      const marked = await credentials.markReauthRequired(claim);
      return marked === 'marked' ? { kind: 'reauth_required' } : { kind: 'stale' };
    }
    await credentials.releaseClaim(claim);
    if (failure === 'network_or_timeout' || failure === 'rate_limited' || failure === 'server_failure') {
      return { kind: 'retryable', failure };
    }
    if (error instanceof InvalidOfflineCredentialError) return { kind: 'blocked', failure: 'malformed_response' };
    if (failure === 'malformed_response' || failure === 'unexpected_status' || failure === 'invalid_request') {
      return { kind: 'blocked', failure };
    }
    throw error;
  }
  const replacement = await credentials.replaceClaim({ ...claim, pair });
  if (replacement !== 'replaced') return { kind: 'stale' };
  return { kind: 'refreshed', accessToken: pair.accessToken, accessExpiresAt: pair.accessExpiresAt };
}
