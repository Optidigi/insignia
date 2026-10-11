# Session JWT verification during client-secret rotation

Researched 11 October 2026. Read-only public documentation and source review; no credential, browser, SSH, provider or private-data access. Application source baseline: accepted `2fbb8af`; SDK: installed `@shopify/shopify-api` 15.0.0. This report establishes implementation behavior and public platform facts, not the cause of the owner's native Search failure.

## Documented facts and limits

- Shopify calls the App Bridge session JWT an ID token. Backend validation uses HS256 with the app client secret, plus expiry, not-before, audience and issuer/destination checks. Tokens expire one minute after issuance. App Bridge may return a cached token with less than a minute remaining; fetching a token does not guarantee a full new lifetime. [Shopify ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens).
- **UNKNOWN:** which active client secret Shopify uses to sign a newly issued App Bridge JWT while two secrets coexist; whether selection changes immediately on generation/revocation; any signing-key propagation or cache duration. The reviewed primary documentation does not specify these facts. Waiting one minute addresses the documented token lifetime, but does not establish signing-key selection or propagation.
- Shopify explicitly documents oldest-unrevoked-secret signing for **webhooks** during rotation. This does not establish session-JWT signing behavior. New-secret OAuth and temporary dual-secret webhook verification match the documented transition. [Manage app credentials](https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials).
- Invalid frontend session requests can receive `401` with `X-Shopify-Retry-Invalid-Session-Request`; App Bridge then obtains a fresh ID token and retries once. This refresh mechanism does not promise a change of signing key. [Embedded authentication tutorial](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node).

## Pinned SDK and accepted application behavior

The installed SDK source and its matching first-party release source agree:

- `decodeSessionToken` supplies exactly `config.apiSecretKey` to `jose.jwtVerify`, allows only HS256, applies ten seconds of clock tolerance and checks audience by default. Verification errors become `InvalidJwtError`, whose message includes the JWT; these messages must not be emitted. [SDK 15 decoder](https://raw.githubusercontent.com/Shopify/shopify-app-js/%40shopify%2Fshopify-api%4015.0.0/packages/apps/shopify-api/lib/session/decode-session-token.ts).
- `tokenExchange` invokes that same local decoder before its HTTP request, then sends the same configured secret as OAuth `client_secret`. [SDK 15 token exchange](https://raw.githubusercontent.com/Shopify/shopify-app-js/%40shopify%2Fshopify-api%4015.0.0/packages/apps/shopify-api/lib/auth/oauth/token-exchange.ts).
- This configuration exposes one `apiSecretKey`, with no old-secret/key-list option for these operations. These inspected paths contain no rotation fallback or key discovery. [SDK 15 configuration](https://raw.githubusercontent.com/Shopify/shopify-app-js/%40shopify%2Fshopify-api%4015.0.0/packages/apps/shopify-api/lib/base-types.ts). This is a bounded finding about SDK15, not a claim about all Shopify libraries.

At accepted `2fbb8af`, `packages/shopify/src/admin-online-identity.ts` uses that single secret for `verify` and `exchangeOnline`. If Shopify supplied a JWT signed with another secret, this implementation would reject it locally; **whether this occurred natively remains UNKNOWN**. Successful replacement-secret client credentials and an installation read demonstrate a different grant path, not staff JWT verification or online exchange.

Other concrete early rejection paths at that baseline are a missing/malformed bearer header (`apps/web/src/server/admin/auth.ts`), malformed JWT or disallowed algorithm, expired/not-yet-valid JWT, wrong audience (SDK), and invalid `dest`/`iss`/staff `sub`/session `sid`/expiry shape (adapter). The adapter additionally requires strictly future expiry without the SDK's ten-second grace. Consequently a nearly expired cached token can pass the SDK and fail the adapter. These are source-supported alternatives, not observed native diagnoses. Absence of downstream events cannot distinguish them at that baseline.

## Smallest retirement prerequisites

Shopify requires replacement of every stored access token tied to the old secret before revocation; tokens still pinned to it stop working when revoked. Replacement follows each token's grant: new-secret exchange/client credentials, refresh for expiring offline tokens, or the documented rotation refresh-token flow for non-expiring offline tokens. After revocation, webhook verification uses only the replacement. [Credential retirement procedure](https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials).

For this app, the smallest safe reviewable prerequisite set is:

1. Confirm all exact-app consumers use replacement OAuth and webhook transition verification is ready.
2. Establish the complete exact-app store/token/consumer inventory and replace any credentials tied to the old secret. Observed zero durable credentials in the designated database does not prove there are no other installations, consumers, transient online grants or stored credentials elsewhere. **Complete old-credential coverage is UNKNOWN.**
3. Obtain owner authorization for the concrete old-secret retirement and its assessed effects; retain the coverage caveat if inventory remains incomplete. Revocation cannot be presented as a proven authentication fix or a downtime-free experiment.
4. After authorized retirement, qualify fresh normal embedded authentication and webhook behavior with safe bounded evidence; remove old webhook verification coverage once the transition is qualified.

No exposed-old-secret authentication acceptance, auth weakening or native mutation is proposed or performed here. M5/G7 remain unqualified.
