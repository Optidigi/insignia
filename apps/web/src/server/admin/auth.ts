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

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SHOP_ID = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;
const READ = ['read_products', 'write_products'];

/** One verified token, online staff grant and installation observation per call.
 * Provider or database outages throw so HTTP responds 503; invalid identity is
 * null and responds 401. No process cache can survive reinstall/deactivation. */
export function createAdminAuthenticator(port: AdminIdentityPort, now: () => number = Date.now) {
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
    const grant = await port.exchangeOnlineGrant(match[1]!, identity);
    if (
      grant.shop !== identity.shop ||
      grant.staffId !== identity.staffId ||
      !Number.isFinite(grant.expiresAtMs) ||
      grant.expiresAtMs <= current ||
      !Array.isArray(grant.appScopes) ||
      !Array.isArray(grant.userScopes)
    )
      return null;
    const installation = await port.readInstallation(grant);
    if (
      installation.shop !== identity.shop ||
      !SHOP_ID.test(installation.shopId) ||
      !installation.active ||
      !installation.installationId ||
      !installation.tenantShopId ||
      !/^[1-9][0-9]*$/.test(installation.installationGeneration) ||
      installation.installationId !== installation.trustedInstallationId ||
      !Array.isArray(installation.grantedScopes)
    )
      return null;
    const canRead = [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
      READ.some((scope) => scopes.includes(scope)),
    );
    const canEdit = [grant.appScopes, grant.userScopes, installation.grantedScopes].every((scopes) =>
      scopes.includes('write_products'),
    );
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
