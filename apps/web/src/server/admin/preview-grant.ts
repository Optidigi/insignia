import type { OnlineStaffGrant, VerifiedStaffIdentity } from '@insignia/shopify';

/** Diagnostic preview only: coalesce the SAME verified, still-live ID token.
 * A new token always exchanges again. No lease survives ID-token expiry or a
 * failed current-installation check. Never persist a token or a staff grant. */
export function createPreviewGrantCache(
  exchange: (token: string, identity: VerifiedStaffIdentity) => Promise<OnlineStaffGrant>,
  now = Date.now,
) {
  let entry: { token: string; identity: VerifiedStaffIdentity; promise: Promise<OnlineStaffGrant> } | undefined;
  return {
    clear() {
      entry = undefined;
    },
    async acquire(token: string, identity: VerifiedStaffIdentity) {
      const time = now();
      if (identity.expiresAtMs <= time || identity.expiresAtMs > time + 90_000)
        throw new Error('Preview identity lease invalid');
      if (
        !entry ||
        entry.token !== token ||
        entry.identity.shop !== identity.shop ||
        entry.identity.staffId !== identity.staffId ||
        entry.identity.sessionId !== identity.sessionId ||
        entry.identity.expiresAtMs !== identity.expiresAtMs
      ) {
        const current = { token, identity, promise: exchange(token, identity) };
        entry = current;
        current.promise.catch(() => {
          if (entry === current) entry = undefined;
        });
      }
      const grant = await entry.promise;
      if (
        grant.expiresAtMs <= now() + 30_000 ||
        grant.shop !== identity.shop ||
        grant.staffId !== identity.staffId ||
        identity.expiresAtMs <= now()
      ) {
        entry = undefined;
        throw new Error('Preview grant invalid');
      }
      return grant;
    },
  };
}
