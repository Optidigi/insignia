# Expiring offline credential bridge — 14 October 2026

Research against local main `0fbcae18445b225781d8c1eadd60d7787fe07f58`, installed Shopify API SDK `15.0.0`, and official Shopify documentation accessed today. No provider request, credential issuance, browser interaction, deployment or setting change was performed by this research task. The lead reports that the deployed buyer catalog rejects in approximately 55 ms with `Buyer catalog credential unavailable`, and the exact active tenant/generation has no persisted offline credential. That observation is supplied native evidence, not independently reproduced here.

## Supported acquisition and configuration

The direct embedded-app flow exchanges an App Bridge ID token at the shop OAuth endpoint. Its offline request includes `expiring=1`; the template's `expiringOfflineAccessTokens` option is a runtime library configuration. The direct-flow instructions require no dashboard toggle or new provider app version. **Inference:** implement the bridge in existing server code under the existing installation/scopes; no app-wide release or scope addition is indicated by this contract. This does not prove that the exact installation will accept the request. [Official migration instructions](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens#apps-using-token-exchange-directly).

The actual pinned SDK accepts:

```ts
api.auth.tokenExchange({
  shop: verifiedIdentity.shop,
  sessionToken,
  requestedTokenType: RequestedTokenType.OfflineAccessToken,
  expiring: true,
});
```

Local source: `node_modules/.pnpm/@shopify+shopify-api@15.0.0/node_modules/@shopify/shopify-api/lib/auth/oauth/token-exchange.ts` (SHA256 `dac56d2f3c2d7b3d0cf4083aca7e6642ef785689d29d6b9d16502f36d77db491`). It validates the session token and sends one JSON POST containing `expiring: '1'`. No retries are implemented in this function or its `fetchRequestFactory`. `create-session.ts` (SHA256 `96416c6594e9ede187ed2443c4e03ab840f6ef52c040ea2f7298629d3531b626`) maps response access/refresh lifetimes into `Session.expires` and `Session.refreshTokenExpires`, alongside both tokens. Validate every required field; SDK session construction alone does not establish a valid expiring pair. These are local inspected source facts, not an assertion about current upstream main.

`packages/shopify/src/admin-online-identity.ts` currently requests only `OnlineAccessToken`. Preserve that separate staff permission path. An offline token must not substitute for staff-sensitive merchant authorization. Shopify's standalone implementation explicitly separates those permissions. [Embedded authentication guide](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node).

## Lifecycle and ambiguous outcomes

Shopify documents one current expiring offline token per app/store; acquiring another retires older pairs' refresh authority. Acquisition must not race refresh. Current nominal access/refresh lifetimes are one hour/90 days, but persist returned values. Refresh rotates both credentials. The presented refresh token remains recoverable until a newer refresh token is used, another acquisition retires it, its original expiry, or the documented 30-day cap. Thus repeated acquisition on every merchant request is unsuitable. [Access token lifecycle](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens#refresh-rotation-and-revocation).

For refresh, Shopify explicitly supports retrying transient timeout/network/5xx/429 outcomes with the same held refresh token. Terminal `401 invalid_request` requires reauthentication. An invalid ID token's definite `400` rejection can use a fresh App Bridge token. These are different from initial acquisition losing its response: the researched pages do not promise recovery of the same initial ID-token-exchange pair. Stop an ambiguous acquisition, retain its dispatch state, and reconcile before another acquisition; do not silently reuse refresh's recovery guarantee. [Refresh and error contract](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node#refresh-an-expiring-offline-token).

The seven-day same-pair recovery promise concerns **migration from an existing non-expiring offline token**, which is absent here; it is not initial acquisition recovery. [Migration response recovery](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens#recover-a-lost-migration-response).

## Smallest supportable correction

Connect an authenticated merchant bootstrap to existing application credential lifecycle rather than storing a manual token file or caching staff credentials for buyers. Derive shop/staff from verified App Bridge claims, confirm the exact existing app/installation and current tenant generation/authentication epoch, then acquire only when credentials are missing or require reauthorization. Reuse an already usable pair or existing refresh path otherwise.

`packages/application/src/shopify/offline-credentials.ts` already validates and installs expiring pairs, and refreshes through a bounded durable claim. `packages/database/src/repositories/shop-credentials.ts` already encrypts both values atomically, checks active installation generation, and CAS-checks refresh claims. However its `install()` **does not reserve acquisition before external I/O** and can overwrite/reset an existing refresh claim. A new bridge needs durable acquisition exclusion coordinated with that refresh lane, including the missing-row case; a process-local mutex alone does not protect multiple web/worker processes. Recheck generation/authentication epoch before committing; stale results must not become usable credentials.

Validate returned offline identity, finite future expirations, nonempty pair, and required granted scopes; read the actual installation with the acquired credential before making it available, without widening scopes. Keep bodies/tokens out of diagnostics, bounded transport deadlines, and redirect rejection. Reserve/dispatch/result state must distinguish rejection from unresolved issuance. Tests should span verified merchant request → one exchange → encrypted atomic persistence → buyer credential acquisition, plus concurrent bootstrap/refresh, stale generation, permission separation, malformed/expired pair and lost-response recovery handling. Independent identity/concurrency/security review is required before native qualification.

This bridge is already consistent with implementation-plan authentication requirements (lines 409–411), not a new product decision. Native acceptance still requires one real verified issuance/persistence and buyer catalog success, followed by lifecycle/recovery evidence. It does not qualify native checkout creator/enforcement or enable purchase admission.
