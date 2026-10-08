import type { AdminAuthenticationStage } from '@insignia/observability';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor } from './contracts.js';

export interface VerifiedAdminIdentity {
  shop: string;
  staffId: string;
  sessionId: string;
  expiresAtMs: number;
}
export interface OnlineAdminGrant {
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
}
export interface AdminIdentityPort {
  /** Shopify SDK adapter verifies JWT signature, audience, issuer and expiry. */
  verifySessionToken(token: string): Promise<VerifiedAdminIdentity>;
  /** Online exchange must bind the grant's staff and shop to that identity. */
  exchangeOnlineGrant(token: string, identity: VerifiedAdminIdentity): Promise<OnlineAdminGrant>;
  /** Read current provider and durable installation state; no stale grant cache. */
  readInstallation(grant: OnlineAdminGrant): Promise<AdminInstallation>;
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

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SHOP_ID = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;
const READ = ['read_products', 'write_products'];

/** One verified token, online staff grant and installation observation per call.
 * Provider or database outages throw so HTTP responds 503; invalid identity is
 * null and responds 401. No process cache can survive reinstall/deactivation. */
export function createAdminAuthenticator(
  port: AdminIdentityPort,
  now: () => number = Date.now,
  diagnostic: (stage: AdminAuthenticationStage) => void = () => {},
) {
  return async (request: Request): Promise<AdminActor | null> => {
    const match = /^Bearer ([^\s]{1,8192})$/.exec(request.headers.get('Authorization') ?? '');
    if (!match) return null;
    let identity: VerifiedAdminIdentity;
    try {
      identity = await port.verifySessionToken(match[1]!);
    } catch {
      return null;
    }
    const current = now();
    if (
      !SHOP.test(identity.shop) ||
      !identity.staffId ||
      !identity.sessionId ||
      !Number.isFinite(identity.expiresAtMs) ||
      identity.expiresAtMs <= current
    )
      return null;
    let grant: OnlineAdminGrant;
    try {
      grant = await port.exchangeOnlineGrant(match[1]!, identity);
    } catch (error) {
      diagnostic(error instanceof AdminOnlineIdentityError ? error.stage : 'ONLINE_EXCHANGE_FAILED');
      if (error instanceof AdminOnlineIdentityError) throw error;
      throw new Error('Authentication unavailable');
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
    diagnostic('ONLINE_EXCHANGE_SUCCEEDED');
    let installation: AdminInstallation;
    try {
      installation = await port.readInstallation(grant);
    } catch (error) {
      diagnostic(
        error instanceof AdminOnlineIdentityError || error instanceof AdminInstallationReconciliationError
          ? error.stage
          : 'INSTALLATION_PROVIDER_READ_FAILED',
      );
      throw new Error('Authentication unavailable');
    }
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
    const canRead = [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
      READ.some((scope) => scopes.includes(scope)),
    );
    const canEdit = [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
      scopes.includes('write_products'),
    );
    diagnostic('AUTHENTICATION_SUCCEEDED');
    return {
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
    };
  };
}
