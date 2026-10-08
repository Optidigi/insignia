# M5-022 — authentication + trusted readiness + G7 closure

## Goal

Close the two actual remaining M5 blockers without another Shopify app release/version cycle:

1. real owner-browser Search returns `Authentication unavailable`;
2. production activation readiness is still deliberately unwired/fail-closed.

Correct both through the existing architecture, redeploy only the web runtime, and if the frozen corrected build succeeds continue directly through real G7 plus one disposable merchant-flow qualification.

## Entry

Begin only after NORMAL merge of PR #52 at:
- base `db4265228b901a99cd4e3602ee0c387065080cc6`
- head `39c77ee73f7534e01a47853968eec8c139d917c6`
- tree `315cc4cf18c3c1eef0cb0d8fa3c542fc5170bed5`

Verify ordered merge parents/tree and start from fetched remote main.

Canonical state remains:
- Insignia
- `https://insignia-app.optidigi.nl`
- App Home `/admin/products`
- Active `1158986629121 / m5-019r-9b94149272d1`
- rollback `1153019904001 / insignia-3`
- `1158837927937` NEVER_RELEASE.

No Shopify app release, rollback, version creation, scope change or Function-version deployment in this slice.

## A — authentication contract

TDD the exact behavior:

- missing/invalid Bearer => 401;
- locally invalid/expired ID token => 401;
- refreshable online token-exchange rejection remains a distinct typed outcome;
- refreshable exchange => HTTP 401 plus `X-Shopify-Retry-Invalid-Session-Request: 1`;
- browser requests a fresh App Bridge `idToken()` and retries at most once;
- second 401 stops;
- 403 does not retry;
- generic 503 does not retry.

Do not map every exchange/provider error to 401.

Current frontend already performs one new-token retry on 401; preserve/bind this behavior.

### Safe stage diagnostics

Add bounded structured diagnostics that distinguish at least:

- `ONLINE_EXCHANGE_REFRESH_REQUIRED`
- `ONLINE_EXCHANGE_FAILED`
- `ONLINE_GRANT_MISMATCH`
- `INSTALLATION_PROVIDER_READ_FAILED`
- `INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH`
- `TENANT_NOT_FOUND_OR_SHOP_ID_MISMATCH`
- `CURRENT_INSTALLATION_MISSING_OR_INACTIVE`
- `CURRENT_INSTALLATION_ID_MISMATCH`

Session-token validation remains ordinary 401 and need not become a server-error stage.

Browser errors remain generic/safe.

Never log:
- ID/Bearer token;
- Admin access token;
- client secret;
- raw provider response body;
- auth query values;
- staff identity unless irreversibly pseudonymized and genuinely required.

Prefer enum + random correlation ID + bounded status class + timestamp.

## B — trusted activation readiness

Use the existing contracts:
- `ActivationReadinessPort`
- `createServerActivationReadiness`
- `TrustedReleaseRecordSource`
- existing Function build/artifact attestation types.

Do not weaken readiness. Browser input and unsigned env JSON are never release authority.

### B1 trusted release source

Preferred shape:
- append-only application-owned PostgreSQL trusted-release relation;
- populated only by a dedicated operator/release credential;
- normal runtime gets SELECT-only access to this relation;
- bind shop, installation generation, app client, active app version, exact Function artifact attestation, immutable record ID/evidence digest;
- replacement appends a new record, never mutates old evidence.

Populate the canonical record only from already-accepted release evidence plus exact supported Active-version observation.

If repository constraints demonstrate an immutable root-owned deployment record is materially stronger/simpler, it is acceptable only with equivalent source authentication, immutability and active-version binding. Never fall back to unsigned environment JSON.

### B2 expected build

Supply `expectedBuild` from the same trusted release/deployment artifact set, binding the reviewed transform/validation query/Wasm/config identities.

### B3 Function observation

Use the existing Function ownership/reconciliation adapter in the authenticated current shop/install scope.

Do not auto-provision/enable Functions. Missing required provisioning is a STOP with exact proposal.

### B4 trusted merchant-local day

Activation requires synchronous trusted merchant-local day.

Prefer the current authenticated provider `shop.ianaTimezone` value:
- include/read it in the current authenticated shop/install observation;
- validate as an IANA zone;
- preload it into the actor/readiness closure;
- `currentDay` performs no awaited IO.

Do not use browser timezone.

Add deterministic DST/date-boundary tests.

If an existing stronger trusted timezone source already exists, use it and document that choice.

## C — read-only current production diagnosis

Before deploying changed source, use only bounded read-only infrastructure diagnostics.

Verify without exposing values:
- current web container/image identity;
- expected env-key presence, never values;
- DB connectivity;
- exact durable tenant row for `insignia-rewrite-dev`;
- current admin installation row/generation/active state;
- external installation ID presence;
- no obvious shop-domain/shop-ID mismatch.

No DML/provisioning.

If VPS access is no longer authorized, STOP for owner-authorized temporary restricted access; no bypass.

## D — implement, review, freeze, web redeploy

Implement A+B.

Minimum regressions:
- all auth cases above;
- Shopify exchange 400/InvalidJwt refresh path;
- timeout/5xx remains 503;
- installation/provider/tenant mismatch classifications;
- no secret/token leakage;
- trusted release source binding and immutability;
- runtime cannot write trusted records;
- stale/wrong Active version rejected;
- missing trusted record => WAITING_RELEASE and zero activation mutation;
- Function mismatch => fail closed;
- merchant timezone/DST vectors;
- real production composition receives trusted inputs when present;
- missing inputs preserve fail-closed behavior;
- v1/v2/v3 availability semantics unchanged.

Run full root, PostgreSQL18, admin/browser/publication/activation tests, naturally applicable workflows, stress/renderer, style/secrets/boundaries.

Two fresh GPT-6.1-sol/high full-source reviews must be CLEAR.

Freeze source/build/config.

Deploy ONLY the reviewed web runtime to `https://insignia-app.optidigi.nl`.

No Shopify app version operation.

If renewed server access is necessary, use only an owner-authorized temporary restricted key with host-key verification and revoke it afterward.

## E — one owner-assisted Search observation

After deployment, owner uses normal Shopify browser and clicks Search once.

No human-check bypass.

If Search succeeds:
- prove online token exchange succeeded;
- current installation read succeeded;
- tenant/current-install reconciliation succeeded;
- actor permissions are correct;
- no retry loop.

If exactly one refresh-required response occurs and the fresh-ID-token retry succeeds:
- prove one refresh classification;
- one retry;
- subsequent success;
- no second retry.

Then continue to F.

If Search still fails:
- use the safe stage classification to identify the exact failing boundary;
- STOP;
- do not patch-and-continue after this frozen-build live observation;
- create no fixture.

## F — trusted readiness live qualification

After authentication succeeds, before fixture, prove:
- exact trusted release record for shop/install/current Active;
- expected Function build;
- current Function ownership/presence observation;
- trusted merchant timezone/day;
- signing/public-config/readiness premises;
- commercial/entitlement premise required by the M5 admin test path.

If additional provisioning/resource mutation is required, STOP with exact proposal. Do not improvise.

## G — finish real G7 + one disposable merchant flow

Only after F passes.

Owner operates the normal browser; local agent records server/database/provider evidence.

Complete remaining native G7 criteria.

Authorize at most:
- one disposable Shopify product;
- one ProductConfig.

Prove:
configure → preview → save → durable readback → two-tab stale conflict → ordinary recovery → publish request → immutable revision/request/outbox → FIRST_PUBLICATION v3 → truthful pending/non-effective state → committed activation → idempotent replay → refresh/reopen exact effective revision.

Existing accepted automated tests may satisfy destructive/impractical negative criteria when native behavior does not contradict them.

Do not start M7 cart work.

## H — cleanup

If every provider write is exactly settled:
- archive disposable product exactly once;
- exact readback => ARCHIVED/effectively unpublished.

If settlement is ambiguous: no cleanup mutation; return operator blocker.

## M5 exit

M5/G7 PASS requires:
- authenticated Search works;
- trusted readiness is wired and qualified;
- real embedded native core passes;
- one real configure/preview/save/publish/v3 activation completes;
- truthful requested/effective state;
- safe cleanup;
- no unresolved provider write;
- Active Shopify version remains `1158986629121`;
- no app version/release change;
- frozen live source/build unchanged;
- final CLEAR/CLEAR reviews;
- final CI green.

If PASS, return one integrated PR and stop for principal approval to close M5/start M6.

## Hard boundaries

No Shopify app release.
No rollback.
No app version creation.
No scope change.
No CAPTCHA/human-verification bypass.
No M6/M7 implementation.
No merchant rollout.
No availability-discovery reopening.
No production DML/provisioning mutation unless separately authorized after an exact blocker.

Return one integrated PR with explicit `M5/G7 PASS` or exact remaining blocker and stop for principal review.
