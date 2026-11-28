import type { AdminAuthenticationStage, AdminProviderDiagnosticCode } from '@insignia/observability';
import { AdminOnlineIdentityError, INSTALLATION_READ_BUDGET_MS, MIN_INSTALLATION_ATTEMPT_MS } from '@insignia/shopify';
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
  /** Read current provider and durable installation state. Provider reads stay within
   * `budgetMs`, the remaining installation read budget of the request. */
  readInstallation(grant: G, budgetMs?: number): Promise<AdminInstallation>;
  /** Durable fence for a reused observation: true only while the shop's current
   * database installation (active, generation, external installation id, tenant)
   * still equals it. Without this port nothing is reused. */
  confirmInstallation?(installation: AdminInstallation): Promise<boolean>;
}

/** Durable reconciliation exposes only its fixed failing stage (and, for a Shopify call, its
 * bounded provider code), never database or provider messages. */
export class AdminInstallationReconciliationError extends Error {
  readonly stage:
    | 'TENANT_READ_FAILED'
    | 'CURRENT_INSTALLATION_READ_FAILED'
    | 'TENANT_NOT_FOUND_OR_SHOP_ID_MISMATCH'
    | 'INSTALLATION_BOOTSTRAP_IDENTITY_MISMATCH'
    | 'INSTALLATION_BOOTSTRAP_STALE_STATE'
    | 'INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED'
    | 'INSTALLATION_BOOTSTRAP_WRITE_FAILED'
    | 'UNINSTALL_ENROLLMENT_FAILED';
  readonly providerCode?: AdminProviderDiagnosticCode;
  constructor(
    stage: AdminInstallationReconciliationError['stage'],
    detail: { providerCode?: AdminProviderDiagnosticCode } = {},
  ) {
    super('Current installation unavailable');
    this.name = 'AdminInstallationReconciliationError';
    this.stage = stage;
    if (detail.providerCode) this.providerCode = detail.providerCode;
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
/** Owner decision (14 Nov 2026): a remembered online grant is reused for at most five
 * minutes, so staff permission changes in Shopify apply within that time even on
 * non-sensitive actions. */
export const ADMIN_GRANT_REUSE_MAX_MS = 5 * 60_000;
/** A publication write needs its online staff grant to outlast it by this much (production.ts
 * `grant()`), so a publish's authority ends this long before the grant does. */
export const PUBLICATION_GRANT_MARGIN_MS = 30_000;

/** Options of one authentication. */
export interface AdminAuthenticationOptions {
  /** Staff-sensitive: exchange again and reuse no remembered grant or installation. */
  fresh?: boolean;
  /** Editor read recovery. Verify the exact existing installation without reconciling it. */
  recoverFrom?: AdminActor;
  /** Owner decision (25 Nov 2026), publish only: with `fresh`, the actor's authority
   * (`expiresAtMs`) runs until this time instead of ending with the App Bridge session token.
   * The token must still be valid when the request authenticates, and the authority never
   * outlasts the online staff grant (less PUBLICATION_GRANT_MARGIN_MS) its writes use. */
  authorityUntilMs?: number;
}

/** The actor's authority deadline. By default it ends with the session token or the online grant,
 * whichever comes first; a fresh publish request may instead run to `authorityUntilMs` (its accepted
 * time plus 60 s), still bounded by the online grant its Shopify writes use. */
export function adminAuthorityExpiry(
  identityExpiresAtMs: number,
  grantExpiresAtMs: number,
  options: AdminAuthenticationOptions = {},
): number {
  return options.fresh && options.authorityUntilMs !== undefined
    ? Math.min(options.authorityUntilMs, grantExpiresAtMs - PUBLICATION_GRANT_MARGIN_MS)
    : Math.min(identityExpiresAtMs, grantExpiresAtMs);
}

type Pending<T> = { value?: T; promise: Promise<T> };
/** Process-local reuse of verified authentication facts. Bounded; oldest entries are evicted first. */
export function createAdminAuthenticationCache<G extends OnlineAdminGrant = OnlineAdminGrant>(
  options: { maxGrants?: number; maxInstallations?: number } = {},
) {
  const maxGrants = options.maxGrants ?? 1000;
  const maxInstallations = options.maxInstallations ?? 500;
  const grants = new Map<string, { grant: G; rememberedAtMs: number }>();
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
    rememberGrant(key: string, grant: G, rememberedAtMs: number) {
      bounded(grants, key, { grant, rememberedAtMs }, maxGrants);
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

/** Starts a provider call and publishes it under `key` for later callers to join. */
function start<T>(pending: Map<string, Pending<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const entry: Pending<T> = {
    promise: load().finally(() => {
      if (pending.get(key) === entry) pending.delete(key);
    }),
  };
  pending.set(key, entry);
  return entry.promise;
}
/** Single flight per key: concurrent callers share one provider call; failures are not kept.
 * `joined` tells a caller that the call was started by another request. */
function share<T>(
  pending: Map<string, Pending<T>>,
  key: string,
  load: () => Promise<T>,
): { promise: Promise<T>; joined: boolean } {
  const existing = pending.get(key);
  if (existing) return { promise: existing.promise, joined: true };
  return { promise: start(pending, key, load), joined: false };
}
/** Shopify was throttling or degraded; the same request can succeed later. Uninstall
 * enrollment is idempotent and precedes the request's effect, so its 429/5xx is too. */
function transientFailure(error: unknown): boolean {
  return (
    (error instanceof AdminOnlineIdentityError && error.transient) ||
    (error instanceof AdminInstallationReconciliationError &&
      error.stage === 'UNINSTALL_ENROLLMENT_FAILED' &&
      (error.providerCode === 'HTTP_429' || error.providerCode === 'HTTP_5XX'))
  );
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
    if (transientFailure(error)) throw new AdminAuthenticationBusyError();
    throw new Error('Authentication unavailable');
  }
  return async (
    request: Request,
    options: AdminAuthenticationOptions = {},
    rejectedOnlineGrant?: G,
  ): Promise<AdminAuthentication<G> | null> => {
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
    const recovery = options.recoverFrom;
    if (
      recovery &&
      (!rejectedOnlineGrant ||
        identity.shop !== recovery.shop ||
        identity.staffId !== recovery.staffId ||
        identity.sessionId !== recovery.sessionId)
    )
      return null;
    const reuse = !!cache && !!port.confirmInstallation && !options.fresh;
    let installation: AdminInstallation | undefined;
    if (reuse && !recovery) {
      const cached = cache.installations.get(identity.shop);
      if (cached && current - cached.observedAtMs < ADMIN_INSTALLATION_REUSE_MS && current >= cached.observedAtMs) {
        const confirmed = await port.confirmInstallation!(cached.installation).catch(() => false);
        if (confirmed && cache.installations.get(identity.shop) === cached) installation = cached.installation;
        else cache.forgetShop(identity.shop);
      } else if (cached) cache.installations.delete(identity.shop);
    }
    const grantKey = `${identity.shop}\n${identity.staffId}\n${identity.sessionId}`;
    const reusable = (cached: { grant: G; rememberedAtMs: number }, at: number) =>
      cached.grant.expiresAtMs - ADMIN_GRANT_REUSE_MARGIN_MS > at &&
      at >= cached.rememberedAtMs &&
      at - cached.rememberedAtMs < ADMIN_GRANT_REUSE_MAX_MS;
    let grant: G | undefined;
    if (reuse) {
      const cached = cache.grants.get(grantKey);
      // An entry past its reuse limits stays until replaced, so a newer exchange
      // is published to it at once (#480); forgetShop alone deletes grants.
      if (
        cached &&
        reusable(cached, current) &&
        (!recovery || (cached.grant !== rejectedOnlineGrant && !cache.pendingGrants.has(grantKey)))
      )
        grant = cached.grant;
    }
    let reusedGrant = grant !== undefined;
    async function exchangeGrant(): Promise<G> {
      try {
        // A new online exchange for a staff session revokes that session's previous online
        // token (observed in production, #480). A verified result therefore replaces a
        // remembered grant for the same shop, staff and session before the shared exchange
        // settles, so a caller never finds the exchange finished but its grant unpublished.
        // New entries still wait for every check below.
        const exchange = async () => {
          const exchanged = await port.exchangeOnlineGrant(match![1]!, identity);
          if (cache?.grants.has(grantKey) && grantMatches(exchanged)) cache.rememberGrant(grantKey, exchanged, current);
          return exchanged;
        };
        // A fresh request always starts its own exchange, but publishes it per session so a
        // concurrent replacement joins it rather than revoking its token with another.
        if (!cache) return await exchange();
        return reuse
          ? await share(cache.pendingGrants, grantKey, exchange).promise
          : await start(cache.pendingGrants, grantKey, exchange);
      } catch (error) {
        diagnostic(
          error instanceof AdminOnlineIdentityError ? error.stage : 'ONLINE_EXCHANGE_FAILED',
          error instanceof AdminOnlineIdentityError && error.providerCode
            ? { providerCode: error.providerCode }
            : undefined,
        );
        if (error instanceof AdminOnlineIdentityError && !error.transient) throw error;
        return unavailable(error);
      }
    }
    const grantMatches = (candidate: G) =>
      candidate.shop === identity.shop &&
      candidate.staffId === identity.staffId &&
      Number.isFinite(candidate.expiresAtMs) &&
      candidate.expiresAtMs > current &&
      Array.isArray(candidate.appScopes) &&
      Array.isArray(candidate.userScopes);
    if (!grant) grant = await exchangeGrant();
    if (!grantMatches(grant)) {
      diagnostic('ONLINE_GRANT_MISMATCH');
      return null;
    }
    diagnostic(reusedGrant ? 'ONLINE_GRANT_REUSED_SUCCEEDED' : 'ONLINE_EXCHANGE_SUCCEEDED');
    const reusedInstallation = installation !== undefined;
    if (!installation) {
      // At most three reads: the first, one retry with its own grant for a waiter that joined
      // another request's failed read, and one with a newer grant for a rejected reused one.
      // Every read gets the remaining budget; no retry starts without a minimum attempt left.
      const readsStartedAt = now();
      const remainingBudget = () => INSTALLATION_READ_BUDGET_MS - (now() - readsStartedAt);
      let refreshed = false;
      for (let attempt = 1; !installation && attempt <= (recovery ? 1 : 3); attempt++) {
        let joined = false;
        try {
          const budgetMs = remainingBudget();
          const read = () => port.readInstallation(grant!, budgetMs);
          if (reuse && !recovery && attempt === 1) {
            const pending = share(cache.pendingInstallations, identity.shop, read);
            joined = pending.joined;
            installation = await pending.promise;
          } else installation = await read();
        } catch (error) {
          const known =
            error instanceof AdminOnlineIdentityError || error instanceof AdminInstallationReconciliationError;
          diagnostic(
            known ? error.stage : 'INSTALLATION_PROVIDER_READ_FAILED',
            known && error.providerCode ? { providerCode: error.providerCode } : undefined,
          );
          const transient = transientFailure(error);
          // A reused grant may have been revoked in Shopify (a newer exchange for the same
          // staff session, uninstall, reinstall, logout). It gets one replacement: the newer
          // grant another request already exchanged for this session, else one fresh
          // exchange shared per session. Exchanging again when a newer grant exists would
          // revoke that request's token in turn. A waiter that joined another request's
          // failed read (possibly another staff member's grant) first retries once with its
          // own grant; only its own rejection leads to a replacement.
          const rejectedGrant =
            reusedGrant &&
            !joined &&
            !transient &&
            (error instanceof AdminOnlineIdentityError ||
              (error instanceof AdminInstallationReconciliationError && error.providerCode === 'HTTP_401'));
          if (
            recovery ||
            transient ||
            !(rejectedGrant ? !refreshed : joined) ||
            remainingBudget() < MIN_INSTALLATION_ATTEMPT_MS
          )
            unavailable(error);
          if (rejectedGrant) {
            refreshed = true;
            const newer = cache?.grants.get(grantKey);
            if (newer && newer.grant !== grant && reusable(newer, now()) && grantMatches(newer.grant)) {
              grant = newer.grant;
              diagnostic('ONLINE_GRANT_REUSED_SUCCEEDED');
            } else {
              grant = await exchangeGrant();
              reusedGrant = false;
              if (!grantMatches(grant)) {
                diagnostic('ONLINE_GRANT_MISMATCH');
                return null;
              }
              diagnostic('ONLINE_EXCHANGE_SUCCEEDED');
            }
          }
        }
      }
      if (!installation) unavailable(new Error('Installation read returned no result'));
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
    if (
      recovery &&
      (installation.shopId !== recovery.shopId ||
        installation.tenantShopId !== recovery.tenantShopId ||
        installation.installationId !== recovery.installationId ||
        installation.installationGeneration !== recovery.installationGeneration)
    )
      return null;
    diagnostic('TENANT_RECONCILIATION_SUCCEEDED');
    if (cache) {
      // Only checked facts are kept; a fresh request refreshes them for later reuse.
      if (!reusedInstallation) cache.rememberInstallation(identity.shop, installation, current);
      if (!reusedGrant) cache.rememberGrant(grantKey, grant, current);
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
        expiresAtMs: adminAuthorityExpiry(identity.expiresAtMs, grant.expiresAtMs, options),
        sessionTokenExpiresAtMs: identity.expiresAtMs,
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
  return async (request: Request, options: AdminAuthenticationOptions = {}): Promise<AdminActor | null> =>
    (await authenticate(request, options))?.actor ?? null;
}
