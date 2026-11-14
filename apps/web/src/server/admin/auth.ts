import type { AdminAuthenticationStage, AdminProviderDiagnosticCode } from '@insignia/observability';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor } from './contracts.js';

export interface VerifiedAdminIdentity {
  shop: string;
  staffId: string;
  sessionId: string;
  expiresAtMs: number;
}
export interface OnlineAdminGrant {
  /** True only from the verified online associated_user response. */
  accountOwner?: boolean;
  shop: string;
  staffId: string;
  expiresAtMs: number;
  appScopes: string[];
  userScopes: string[];
}
export interface AdminInstallation {
  shop: string;
  shopId: string;
  installationId: string;
  trustedInstallationId: string;
  tenantShopId: string;
  installationGeneration: string;
  active: boolean;
  grantedScopes: string[];
  /** Shop timezone from the same provider observation. */
  ianaTimezone?: string;
}
export interface AdminIdentityPort<G extends OnlineAdminGrant = OnlineAdminGrant> {
  /** Shopify SDK adapter verifies JWT signature, audience, issuer and expiry. */
  verifySessionToken(token: string): Promise<VerifiedAdminIdentity>;
  /** Online exchange must bind the grant's staff and shop to that identity. */
  exchangeOnlineGrant(token: string, identity: VerifiedAdminIdentity): Promise<G>;
  /** Read current provider and durable installation state. */
  readInstallation(grant: G): Promise<AdminInstallation>;
  /** Durable fence for a reused observation: true only while the shop's current
   * database installation (active, generation, external installation id, tenant)
   * still equals it. Without this port nothing is reused. */
  confirmInstallation?(installation: AdminInstallation): Promise<boolean>;
}

/** Durable reconciliation exposes only its fixed failing stage, never database messages. */
export class AdminInstallationReconciliationError extends Error {
  readonly stage:
    | 'TENANT_READ_FAILED'
    | 'CURRENT_INSTALLATION_READ_FAILED'
    | 'TENANT_NOT_FOUND_OR_SHOP_ID_MISMATCH'
    | 'INSTALLATION_BOOTSTRAP_IDENTITY_MISMATCH'
    | 'INSTALLATION_BOOTSTRAP_STALE_STATE'
    | 'INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED'
    | 'INSTALLATION_BOOTSTRAP_WRITE_FAILED';
  constructor(stage: AdminInstallationReconciliationError['stage']) {
    super('Current installation unavailable');
    this.name = 'AdminInstallationReconciliationError';
    this.stage = stage;
  }
}
/** Shopify was throttling or degraded during authentication; the request can be retried. */
export class AdminAuthenticationBusyError extends Error {
  /** Structural marker: separately bundled server modules cannot rely on class identity. */
  readonly transient = true;
  readonly authentication = true;
  constructor() {
    super('Shopify is busy');
    this.name = 'AdminAuthenticationBusyError';
  }
}

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SHOP_ID = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;
const READ = ['read_products', 'write_products'];

/** A verified installation observation is reused for at most this long, and every
 * reuse is fenced against the durable installation. Long enough for one screen's
 * burst of requests (and its follow-ups) to share one Shopify read; short enough
 * that a scope change granted in Shopify appears within half a minute. */
export const ADMIN_INSTALLATION_REUSE_MS = 30_000;
/** Online grants are reused only while at least this much lifetime remains, the
 * same margin publication and Shopify reads already require of a grant. */
export const ADMIN_GRANT_REUSE_MARGIN_MS = 30_000;

type Pending<T> = { value?: T; promise: Promise<T> };
/** Process-local reuse of verified authentication facts. Bounded; oldest entries are evicted first. */
export function createAdminAuthenticationCache<G extends OnlineAdminGrant = OnlineAdminGrant>(
  options: { maxGrants?: number; maxInstallations?: number } = {},
) {
  const maxGrants = options.maxGrants ?? 1000;
  const maxInstallations = options.maxInstallations ?? 500;
  const grants = new Map<string, { grant: G }>();
  const installations = new Map<string, { installation: AdminInstallation; observedAtMs: number }>();
  const pendingGrants = new Map<string, Pending<G>>();
  const pendingInstallations = new Map<string, Pending<AdminInstallation>>();
  function bounded<V>(map: Map<string, V>, key: string, value: V, limit: number) {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value as string);
  }
  return {
    grants,
    installations,
    pendingGrants,
    pendingInstallations,
    rememberGrant(key: string, grant: G) {
      bounded(grants, key, { grant }, maxGrants);
    },
    rememberInstallation(shop: string, installation: AdminInstallation, observedAtMs: number) {
      bounded(installations, shop, { installation, observedAtMs }, maxInstallations);
    },
    /** A changed installation revokes every reused grant for the shop as well. */
    forgetShop(shop: string) {
      installations.delete(shop);
      for (const key of grants.keys()) if (key.startsWith(`${shop}\n`)) grants.delete(key);
    },
    size() {
      return { grants: grants.size, installations: installations.size };
    },
  };
}
export type AdminAuthenticationCache<G extends OnlineAdminGrant = OnlineAdminGrant> = ReturnType<
  typeof createAdminAuthenticationCache<G>
>;
export type AdminAuthenticationDiagnostic = (
  stage: AdminAuthenticationStage,
  detail?: { providerCode?: AdminProviderDiagnosticCode },
) => void;
export type AdminAuthentication<G extends OnlineAdminGrant> = {
  actor: AdminActor;
  grant: G;
  installation: AdminInstallation;
};

/** Single flight per key: concurrent callers share one provider call; failures are not kept. */
async function shared<T>(pending: Map<string, Pending<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing.promise;
  const entry: Pending<T> = {
    promise: load().finally(() => {
      if (pending.get(key) === entry) pending.delete(key);
    }),
  };
  pending.set(key, entry);
  return entry.promise;
}

/** Every request verifies its session token (signature, audience, expiry, not-before).
 * With a cache, a verified online grant is reused for the same shop, staff and
 * session until shortly before its expiry, and an installation observation for
 * ADMIN_INSTALLATION_REUSE_MS, fenced against the durable installation on every
 * reuse. `fresh` (staff-sensitive actions) bypasses both. Provider or database
 * outages throw so HTTP responds 503 (409 BUSY when Shopify is throttling);
 * invalid identity is null and responds 401. */
export function createAdminGrantAuthenticator<G extends OnlineAdminGrant>(
  port: AdminIdentityPort<G>,
  now: () => number = Date.now,
  diagnostic: AdminAuthenticationDiagnostic = () => {},
  cache?: AdminAuthenticationCache<G>,
) {
  function unavailable(error: unknown): never {
    if (error instanceof AdminOnlineIdentityError && error.transient) throw new AdminAuthenticationBusyError();
    throw new Error('Authentication unavailable');
  }
  return async (request: Request, options: { fresh?: boolean } = {}): Promise<AdminAuthentication<G> | null> => {
    const authorization = request.headers.get('Authorization');
    const match = /^Bearer ([^\s]{1,8192})$/.exec(authorization ?? '');
    if (!match) {
      diagnostic(authorization === null ? 'BEARER_MISSING' : 'BEARER_MALFORMED');
      return null;
    }
    let identity: VerifiedAdminIdentity;
    try {
      identity = await port.verifySessionToken(match[1]!);
    } catch (error) {
      diagnostic(
        error instanceof AdminOnlineIdentityError &&
          (error.stage === 'SESSION_IDENTITY_REJECTED' || error.stage.startsWith('SESSION_TOKEN_'))
          ? error.stage
          : 'SESSION_TOKEN_REJECTED',
      );
      return null;
    }
    const current = now();
    if (
      !SHOP.test(identity.shop) ||
      !identity.staffId ||
      !identity.sessionId ||
      !Number.isFinite(identity.expiresAtMs) ||
      identity.expiresAtMs <= current
    ) {
      diagnostic('SESSION_IDENTITY_REJECTED');
      return null;
    }
    const reuse = !!cache && !!port.confirmInstallation && !options.fresh;
    let installation: AdminInstallation | undefined;
    if (reuse) {
      const cached = cache.installations.get(identity.shop);
      if (cached && current - cached.observedAtMs < ADMIN_INSTALLATION_REUSE_MS && current >= cached.observedAtMs) {
        const confirmed = await port.confirmInstallation!(cached.installation).catch(() => false);
        if (confirmed && cache.installations.get(identity.shop) === cached) installation = cached.installation;
        else cache.forgetShop(identity.shop);
      } else if (cached) cache.installations.delete(identity.shop);
    }
    const grantKey = `${identity.shop}\n${identity.staffId}\n${identity.sessionId}`;
    let grant: G | undefined;
    if (reuse) {
      const cached = cache.grants.get(grantKey)?.grant;
      if (cached && cached.expiresAtMs - ADMIN_GRANT_REUSE_MARGIN_MS > current) grant = cached;
      else if (cached) cache.grants.delete(grantKey);
    }
    const reusedGrant = grant !== undefined;
    if (!grant) {
      try {
        const exchange = () => port.exchangeOnlineGrant(match[1]!, identity);
        grant = reuse ? await shared(cache.pendingGrants, grantKey, exchange) : await exchange();
      } catch (error) {
        diagnostic(
          error instanceof AdminOnlineIdentityError ? error.stage : 'ONLINE_EXCHANGE_FAILED',
          error instanceof AdminOnlineIdentityError && error.providerCode
            ? { providerCode: error.providerCode }
            : undefined,
        );
        if (error instanceof AdminOnlineIdentityError && !error.transient) throw error;
        unavailable(error);
      }
    }
    if (
      grant.shop !== identity.shop ||
      grant.staffId !== identity.staffId ||
      !Number.isFinite(grant.expiresAtMs) ||
      grant.expiresAtMs <= current ||
      !Array.isArray(grant.appScopes) ||
      !Array.isArray(grant.userScopes)
    ) {
      diagnostic('ONLINE_GRANT_MISMATCH');
      return null;
    }
    diagnostic(reusedGrant ? 'ONLINE_GRANT_REUSED_SUCCEEDED' : 'ONLINE_EXCHANGE_SUCCEEDED');
    const reusedInstallation = installation !== undefined;
    if (!installation) {
      try {
        const read = () => port.readInstallation(grant!);
        installation = reuse ? await shared(cache.pendingInstallations, identity.shop, read) : await read();
      } catch (error) {
        diagnostic(
          error instanceof AdminOnlineIdentityError || error instanceof AdminInstallationReconciliationError
            ? error.stage
            : 'INSTALLATION_PROVIDER_READ_FAILED',
          error instanceof AdminOnlineIdentityError && error.providerCode
            ? { providerCode: error.providerCode }
            : undefined,
        );
        unavailable(error);
      }
    } else diagnostic('INSTALLATION_OBSERVATION_REUSED_SUCCEEDED');
    if (
      installation.shop !== identity.shop ||
      !SHOP_ID.test(installation.shopId) ||
      !Array.isArray(installation.grantedScopes)
    ) {
      diagnostic('INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH');
      return null;
    }
    if (
      !installation.active ||
      !installation.tenantShopId ||
      !/^[1-9][0-9]*$/.test(installation.installationGeneration)
    ) {
      diagnostic('CURRENT_INSTALLATION_MISSING_OR_INACTIVE');
      return null;
    }
    if (!installation.installationId || installation.installationId !== installation.trustedInstallationId) {
      diagnostic('CURRENT_INSTALLATION_ID_MISMATCH');
      return null;
    }
    diagnostic('TENANT_RECONCILIATION_SUCCEEDED');
    if (cache) {
      // Only checked facts are kept; a fresh request refreshes them for later reuse.
      if (!reusedInstallation) cache.rememberInstallation(identity.shop, installation, current);
      if (!reusedGrant) cache.rememberGrant(grantKey, grant);
    }
    const canRead = [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
      READ.some((scope) => scopes.includes(scope)),
    );
    const canEdit = [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
      scopes.includes('write_products'),
    );
    diagnostic('AUTHENTICATION_SUCCEEDED');
    return {
      grant,
      installation,
      actor: {
        shop: identity.shop,
        shopId: installation.shopId,
        installationId: installation.installationId,
        tenantShopId: installation.tenantShopId,
        installationGeneration: installation.installationGeneration,
        staffId: identity.staffId,
        sessionId: identity.sessionId,
        expiresAtMs: Math.min(identity.expiresAtMs, grant.expiresAtMs),
        canRead,
        canEdit,
        canReadArtwork: grant.accountOwner === true && canRead,
        canUploadArtwork: grant.accountOwner === true && canEdit,
        canReadOrders:
          grant.accountOwner === true &&
          [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
            scopes.includes('read_orders'),
          ),
      },
    };
  };
}

/** Actor-only form of createAdminGrantAuthenticator. */
export function createAdminAuthenticator<G extends OnlineAdminGrant>(
  port: AdminIdentityPort<G>,
  now: () => number = Date.now,
  diagnostic: AdminAuthenticationDiagnostic = () => {},
  cache?: AdminAuthenticationCache<G>,
) {
  const authenticate = createAdminGrantAuthenticator(port, now, diagnostic, cache);
  return async (request: Request, options: { fresh?: boolean } = {}): Promise<AdminActor | null> =>
    (await authenticate(request, options))?.actor ?? null;
}
