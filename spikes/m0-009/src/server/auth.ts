/** Authenticated use-case boundary. Shopify SDK and secrets live in shopify-adapter.ts only. */
export interface VerifiedIdentity {
  shop: string;
  staffId: string;
  sessionId: string;
  expiresAtMs: number;
}
export interface OnlineGrant {
  shop: string;
  staffId: string;
  accessToken: string;
  expiresAtMs: number;
  appScopes: string[];
  userScopes: string[];
}
export interface InstallationRead {
  shop: string;
  shopId: string;
  installationId: string;
  grantedScopes: string[];
}
export interface AuthPort {
  verify(token: string): Promise<VerifiedIdentity>;
  exchangeOnline(token: string, identity: VerifiedIdentity): Promise<OnlineGrant>;
  readInstallation(grant: OnlineGrant): Promise<InstallationRead>;
}
export interface AuthConfig {
  allowedShops: ReadonlySet<string>;
  expectedInstallationId: string;
  appOrigin: string;
  now: () => number;
  observe?: ((event: AuthObservation) => void) | undefined;
}
/** Correlates a browser action after successful staff/installation authorization. */
export interface AuthObservation {
  traceId: string;
  route: string;
  shopId: string;
  installationId: string;
  canEdit: boolean;
}
export interface AuthContext {
  shop: string;
  staffId: string;
  shopId: string;
  installationId: string;
  grantedScopes: string[];
  canEdit: boolean;
}
export type AuthResult = { ok: true; context: AuthContext } | { ok: false; response: Response };
/** The verified ID token expired before its online exchange completed. */
export class IdentityRefreshRequired extends Error {}
interface Cached { grant: OnlineGrant; installation: InstallationRead; untilMs: number }

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const MAX_BEARER = 8192;
const EDIT_SCOPE = 'write_products'; // local synthetic edit policy; no Shopify product mutation

function safeResponse(status: number, message: string, retry = false): Response {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Vary': 'Authorization, Origin',
    'X-Content-Type-Options': 'nosniff'
  });
  if (retry) headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
  return new Response(message, { status, headers });
}

export class AuthService {
  private readonly cache = new Map<string, Cached>();
  private readonly flights = new Map<string, Promise<Cached>>();
  constructor(private readonly port: AuthPort, private readonly config: AuthConfig) {}

  async authenticate(request: Request, requireEdit = false): Promise<AuthResult> {
    const header = request.headers.get('Authorization') ?? '';
    const match = /^Bearer ([^\s]+)$/.exec(header);
    if (!match || match[1]!.length > MAX_BEARER)
      return { ok: false, response: safeResponse(401, 'Authentication required', true) };
    let identity: VerifiedIdentity;
    try { identity = await this.port.verify(match[1]!); }
    catch { return { ok: false, response: safeResponse(401, 'Authentication required', true) }; }
    const now = this.config.now();
    if (!SHOP.test(identity.shop) || !this.config.allowedShops.has(identity.shop) ||
        !identity.staffId || !identity.sessionId || !Number.isFinite(identity.expiresAtMs) ||
        identity.expiresAtMs <= now)
      return { ok: false, response: safeResponse(401, 'Authentication required', true) };

    // Route selection is not a tenant source. A supplied conflicting shop is rejected.
    const selected = new URL(request.url).searchParams.get('shop');
    if (selected !== null && selected !== identity.shop)
      return { ok: false, response: safeResponse(403, 'Shop mismatch') };

    let cached: Cached;
    try { cached = await this.online(match[1]!, identity, now); }
    catch (error) {
      if (error instanceof IdentityRefreshRequired)
        return { ok: false, response: safeResponse(401, 'Authentication required', true) };
      return { ok: false, response: safeResponse(503, 'Authentication temporarily unavailable') };
    }
    const { grant, installation } = cached;
    if (grant.shop !== identity.shop || grant.staffId !== identity.staffId ||
        !grant.accessToken || !Number.isFinite(grant.expiresAtMs) || grant.expiresAtMs <= now ||
        installation.shop !== identity.shop || installation.installationId !== this.config.expectedInstallationId ||
        !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(installation.shopId))
      return { ok: false, response: safeResponse(403, 'Installation mismatch') };

    const canEdit = grant.appScopes.includes(EDIT_SCOPE) &&
      grant.userScopes.includes(EDIT_SCOPE) && installation.grantedScopes.includes(EDIT_SCOPE);
    if (requireEdit && !canEdit)
      return { ok: false, response: safeResponse(403, 'Edit permission required') };
    const traceId = request.headers.get('X-Insignia-Trace');
    if (traceId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(traceId)) {
      try { this.config.observe?.({
        traceId, route: new URL(request.url).pathname,
        shopId: installation.shopId, installationId: installation.installationId, canEdit
      }); } catch { /* Observation cannot change an authorization decision. */ }
    }
    return { ok: true, context: {
      shop: identity.shop, staffId: identity.staffId, shopId: installation.shopId,
      installationId: installation.installationId,
      grantedScopes: [...installation.grantedScopes], canEdit
    } };
  }

  expectedOrigin(): string { return this.config.appOrigin; }

  private async online(token: string, identity: VerifiedIdentity, now: number): Promise<Cached> {
    const key = JSON.stringify([identity.shop, identity.staffId, identity.sessionId]);
    const prior = this.cache.get(key);
    if (prior && prior.untilMs > now) return prior;
    const pending = this.flights.get(key);
    if (pending) return pending;
    const flight = (async () => {
      const grant = await this.port.exchangeOnline(token, identity);
      const installation = await this.port.readInstallation(grant);
      const entry = { grant, installation, untilMs: Math.min(grant.expiresAtMs - 5_000, now + 300_000) };
      if (entry.untilMs > now) this.cache.set(key, entry);
      return entry;
    })();
    this.flights.set(key, flight);
    try { return await flight; }
    finally { this.flights.delete(key); }
  }
}
