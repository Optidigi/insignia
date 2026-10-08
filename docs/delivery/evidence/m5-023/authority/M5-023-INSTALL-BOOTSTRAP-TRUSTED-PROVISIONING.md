# M5-023 — managed-install bootstrap + trusted production provisioning + auth qualification

## Goal

Make the already-released Insignia app capable of establishing its own durable installation state under Shopify managed installation, provision the already-reviewed trusted-release infrastructure, deploy the corrected web runtime, and prove real authenticated Search.

This slice must solve public-app lifecycle correctness, not seed one dev store.

If authentication and trusted readiness pass, continue native G7 only until a legitimate commercial-entitlement boundary is reached.

No Shopify app version/release/scope change is authorized.

## Entry

Begin only after owner-authorized NORMAL merge of PR #53 at:
- base `e132c108a2108aea830ac2a5229b410f93a61a7d`
- head `e5d93a42ec06090b53f63088bcdb03c29d4a6a16`
- tree `33f3e69107dce64018e9504609510206b22e37ae`

Verify actual normal-merge ordered parents/tree and begin from fetched remote main.

Use actual GPT-6.1-sol/high and repository-pinned TDD/diagnosing-bugs/code-review/handoff skills.

## Immutable platform identity

Canonical:
- `Insignia`
- origin/APP_URL `https://insignia-app.optidigi.nl`
- embedded App Home `https://insignia-app.optidigi.nl/admin/products`

Active:
- `1158986629121 / m5-019r-9b94149272d1`

Rollback:
- `1153019904001 / insignia-3`

Never release:
- `1158837927937 / m5-019-a9717e1265ef`

No app release/version creation/rollback/scope mutation.

## 1. Permanent first-authenticated-session bootstrap

### Contract

The public production path must support a genuinely new Shopify-managed installation with no prior Insignia DB rows.

Provider authority sequence:

1. verify App Bridge ID token;
2. obtain matching online staff access grant;
3. read exact provider:
   - canonical myshopify domain;
   - Shopify Shop GID;
   - current AppInstallation GID;
   - granted scopes;
   - IANA timezone;
4. reconcile/ensure durable Insignia tenant/install state;
5. only then construct the authenticated actor.

Browser/body/query shop/install IDs are never tenant authority.

### New install

When provider identity is valid and no tenant exists:
- generate a new app-owned internal shop ID;
- transactionally call reviewed tenant lifecycle to create exactly one shop and generation 1;
- bind exact provider Shopify shop ID;
- bind exact current AppInstallation GID;
- commit atomically.

Do not use raw SQL seed scripts for tenant/domain identity.

### Concurrency

Two first authenticated requests for the same provider shop must converge to one durable tenant/current generation.

Required behavior:
- serialize on an appropriate durable/provider identity lock or equivalent unique-key/CAS mechanism;
- a uniqueness race must re-read the winner and compare every authoritative identity field;
- never treat uniqueness failure alone as success.

### Existing install

For an existing durable tenant:
- exact provider shop GID/domain must match;
- current durable external AppInstallation must match provider current installation => reuse current generation;
- mismatched shop identity => fail closed.

### Reinstall

If exact provider identity proves a different current AppInstallation for the same canonical shop:
- treat as possible reinstall;
- transactionally re-read/fence current generation;
- call the reviewed `startInstallation()` lifecycle exactly once;
- bind the new external AppInstallation to the new generation;
- stale concurrent sessions cannot reverse or revive the older generation.

Do not interpret a transient provider mismatch as permission to advance generation. Require exact current provider observation and durable revalidation.

### Uninstall interaction

Preserve existing uninstall/webhook deactivation semantics. A later first session after true reinstall may start a new generation only when provider current installation is exact and durable prior state is inactive/older.

## 2. Expiring offline access lifecycle

Current Shopify public-app contract requires expiring offline access for persistent/background GraphQL Admin API work.

Inventory actual Insignia consumers:
- worker/webhook/background consumers;
- storefront/App Proxy server flows planned/implemented;
- any activation/reconciliation task that survives a staff session.

Do not replace staff-sensitive admin authorization with offline credentials.

If background consumers require offline access, implement bootstrap through the **existing** M3 lifecycle:

- exchange the verified ID token for an expiring offline token pair using the pinned Shopify SDK/provider contract;
- validate access/refresh token expiries and scopes;
- no database transaction spans provider exchange;
- revalidate exact current tenant/generation before persistence;
- atomically store through existing encrypted `core.credentials` repository;
- generation/version/claim fences remain authoritative;
- concurrent bootstrap must not overwrite a newer pair;
- do not exchange offline credentials on every authenticated request once a usable current pair exists;
- use existing single-flight refresh lifecycle.

No second credential store.
No token logging/evidence.
No offline-token substitution for staff permissions.

If source inspection proves M5 admin/G7 itself has no background credential dependency, offline credential implementation may be independently staged, but the successor must state exactly which later runtime requires it and why public-app installation remains safe meanwhile. Do not silently ignore the lifecycle.

## 3. Tests for bootstrap

Before production provisioning, TDD at least:

- zero durable tenant + exact provider install => generation1 created;
- repeat exact provider install => same shop/generation;
- N concurrent first sessions => exactly one durable shop/current generation;
- losing uniqueness transaction re-reads and exact-compares;
- wrong provider shop ID/domain => fail;
- existing external installation match => reuse;
- independently proven new external AppInstallation => generation advances exactly once;
- concurrent reinstall => one generation transition;
- stale old-install request after reinstall => fail;
- no browser-request identity can alter provider-derived identity;
- failed online exchange => no bootstrap;
- failed provider installation read => no bootstrap;
- transaction failure => no partial tenant;
- optional offline-pair acquisition/persistence obeys generation/credential fences;
- no tokens/secrets in diagnostics.

## 4. Pre-production gate

Before renewed infrastructure/provider authority:
- complete source/tests;
- full root;
- PostgreSQL18;
- concurrency stress;
- relevant browser/auth tests;
- all natural CI;
- fresh GPT-6.1-sol/high Spec/security CLEAR;
- freeze exact source/build/config.

No production source patch after live bootstrap begins.

## 5. Renewed restricted production access

Renew VPS access only through owner-authorized restricted temporary access with exact host fingerprint.

Apply no broad production mutation before taking a fresh backup/rollback receipt appropriate to the affected DB/schema/web deployment.

Record commands/results without secret values.

Revoke temporary access at the end of the slice.

## 6. Production schema/role provisioning

Apply reviewed migration:
`20261008000100_m5_trusted_release.sql`

through the appropriate schema/operator credential.

Require:
- relation/trigger/index existence;
- populated down guard contract remains;
- dedicated release operator credential can append only as required;
- web runtime credential can SELECT trusted release rows;
- web runtime cannot INSERT/UPDATE/DELETE/TRUNCATE;
- runtime cannot CREATE in public schema;
- runtime cannot obtain operator/owner role via membership.

Do not insert trusted evidence yet unless exact tenant/generation is established.

## 7. Deploy corrected web runtime

Deploy the exact frozen corrected M5-023 web runtime at the existing canonical host.

No Shopify app release/version change.

Verify:
- exact image/package/source hashes;
- canonical host health;
- API safe unauthenticated behavior;
- restart/rollback;
- existing root/legacy apps unaffected.

## 8. Owner Search: bootstrap/auth qualification

Owner uses normal authenticated Shopify browser:

1. open designated `insignia-rewrite-dev`;
2. open Insignia;
3. click Search once.

No human-verification bypass.

Server evidence must show the actual path:

- ID token verification;
- online grant exchange or exactly one refresh-required retry;
- provider current installation read;
- bootstrap/reconciliation outcome;
- final authentication success/failure.

### PASS_AUTH

Require:
- exact durable tenant now exists;
- exact provider Shop ID/domain matches;
- current generation active;
- exact external AppInstallation ID matches;
- staff canRead/canEdit is derived from current scopes;
- Search successfully reads products;
- no retry loop;
- no unresolved bootstrap write.

If frozen build fails:
- capture safe stage;
- STOP;
- no patch-and-continue;
- no fixture.

## 9. Trusted release record

Only after exact tenant/generation exists.

Create a fresh supported observation proving Active:
`1158986629121`

and exact current reviewed Function/build identities.

Within the existing 30-second authority window:
- append one exact-scope `m5-trusted-release-v1` record using operator credential;
- include exact expected build;
- bind shop/generation/app client/current Active;
- keep accepted Function artifact hashes/identity;
- record evidence receipt SHA/digest;
- runtime read must immediately qualify it;
- never restamp it.

A record that ages out is expected to stop qualifying. Do not relax freshness.

For the later actual publish/activation in this same slice, make a **new fresh observation + append** immediately before activation if the earlier record is stale. This is allowed only as the same operator evidence mechanism, not by editing/replacing old records.

## 10. Function/signing/public-config readiness

After auth:
- observe exact current Function ownership/presence;
- prove reviewed transform/validation identities;
- qualify trusted merchant timezone/day;
- verify signing/public-config prerequisites;
- no Function provisioning mutation unless independently observed missing and separately authorized.

If missing provider resource/enablement is detected: STOP with exact blocker.

## 11. Commercial entitlement boundary

Do not invent commercial configuration.

M5-023 may continue beyond Search only if one of these is true:

A. owner supplies the actual production/dev Shopify App Pricing plan+usage handles, policy IDs, feature grants, included usage and required Partner credentials; or

B. owner explicitly authorizes an isolated dev-only test entitlement path whose data cannot affect production merchant eligibility and is clearly not production commercial configuration.

Absent A or B:
- classify `BLOCKED_OWNER_COMMERCIAL_CONFIGURATION`;
- do not create the disposable publication fixture;
- return for owner/principal decision.

Final production plan prices/values remain owner decisions.

## 12. If legitimate commercial eligibility is available

Complete remaining native G7 and at most:
- one disposable Shopify product;
- one ProductConfig.

Prove:
configure → preview → save → durable readback → stale conflict → publish → immutable revision/request/outbox → fresh trusted release evidence → FIRST_PUBLICATION v3 → truthful pending → activation → effective revision → idempotent replay → refresh/reopen.

If every provider write settles exactly, archive disposable product once and verify ARCHIVED/effectively unpublished.

No M7 cart work.

## 13. Exit

Possible outcomes:

### `M5_G7_PASS`
Requires complete legitimate commercial eligibility plus real merchant-flow/v3 activation and cleanup.

### `BLOCKED_OWNER_COMMERCIAL_CONFIGURATION`
Authentication/bootstrap/trusted technical readiness passes, but no legitimate owner-backed entitlement is configured. This is acceptable evidence and should isolate the final M5 owner decision.

### other exact technical blocker
Return exact safe stage/resource and stop.

## Hard boundaries

No Shopify app release/version/rollback.
No scope mutation.
No guessed IDs.
No raw tenant seed.
No fabricated commercial values/subscription.
No CAPTCHA bypass.
No M6/M7.
No merchant rollout.
No reopening availability discovery.

## Handoff

Return one integrated PR/evidence candidate with:
- PR53 merge receipt;
- bootstrap implementation/tests;
- production migration/role receipt;
- corrected web deployment;
- owner Search/auth evidence;
- exact tenant/install state;
- trusted release evidence;
- Function/signing readiness;
- commercial classification;
- if allowed, G7/fixture/v3/cleanup;
- full accounting;
- fresh reviews;
- final CI;
- explicit outcome.

Stop for principal review.
