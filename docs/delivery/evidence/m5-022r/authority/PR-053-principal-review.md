# PR #53 — external principal review

**Verdict: CHANGES_REQUESTED at the exact reviewed head.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #53
- Base / effective merge base: `e132c108a2108aea830ac2a5229b410f93a61a7d`
- Reviewed head: `cfd43482d2b8e8f30bd21d91bf00e95d0663a3e0`
- Reviewed tree: `e587a7c5c652ae286631d1d711fd8a58e73f5cbd`
- PR: open, unmerged, mergeable
- Current main at review: exact base
- Final-head CI: 11/11 naturally applicable workflows SUCCESS, all attempt 1
- Fresh completed-change GPT-6.1-sol/high reviews: CLEAR / CLEAR
- Native GitHub reviews: none

PR #52 normal merge `e132c108a2108aea830ac2a5229b410f93a61a7d` has verified ordered parents `db4265228b901a99cd4e3602ee0c387065080cc6`, `39c77ee73f7534e01a47853968eec8c139d917c6` and tree `315cc4cf18c3c1eef0cb0d8fa3c542fc5170bed5`.

## Accepted implementation

The M5-022 source correction is accepted in architecture and behavior:

- refreshable Shopify token-exchange failure is kept distinct;
- only the refresh-required case maps to HTTP 401 plus `X-Shopify-Retry-Invalid-Session-Request: 1`;
- generic provider/exchange/database failures remain 503;
- browser retry is bounded to one fresh App Bridge ID-token attempt;
- safe bounded auth-stage diagnostics do not expose tokens/secrets/raw provider bodies/staff identity;
- current installation and tenant reconciliation remains fail closed;
- trusted activation readiness uses existing application contracts rather than browser/env release authority;
- trusted release evidence is scoped to shop/install/app/version/build;
- runtime trusted-release access is read-only;
- expected Function build and Function ownership observations remain independently checked;
- merchant-local day uses authenticated/preloaded IANA timezone synchronously;
- 30-second observation freshness remains exact and is not restamped;
- missing evidence/Function mismatch remains WAITING_RELEASE with zero activation mutation;
- v1/v2/v3 availability semantics remain unchanged.

Offline qualification is strong: full root PASS; PostgreSQL18 173/173; PG-backed web 75/75; stress100/100; renderer negative control; migration rehearsal; 100k plans; 11/11 final-head CI; CLEAR/CLEAR reviews.

## Production diagnosis accepted

Read-only production diagnosis truthfully proves:
- current production image unchanged;
- PostgreSQL18.6 reachable;
- exact `insignia-rewrite-dev.myshopify.com` tenant rows = 0;
- current durable installation rows = 0;
- trusted-release relation absent;
- commercial/Partner configuration keys absent;
- no production provisioning/deploy/Search/fixture occurred;
- temporary VPS access revoked.

This does not prove the historical Search failure's first throwing stage.

## Material change-introduced defect

`packages/database/migrations/20261008000100_m5_trusted_release.sql` creates explicitly append-only trusted release authority. UPDATE/DELETE/TRUNCATE are blocked.

But the current down migration unconditionally drops the trusted-release table and guard function. That destroys all trusted release history when a down migration is attempted after records exist.

This conflicts with the append-only trust model, with the proposal's requirement that production rollback preserve trusted evidence, and with the existing Availability-v3 precedent whose down migration refuses to proceed while v3 evidence exists.

### Required correction

Before destructive down operations, fail closed if any trusted release record exists.

Required semantics:
- empty table => down may proceed for local/disposable rollback;
- any row => down raises, and table/records/triggers/function remain intact;
- no delete/truncate bypass;
- production rollback remains web/runtime rollback, not evidence deletion.

Add PostgreSQL regression:
1. apply migration16;
2. insert one valid trusted record;
3. attempt down;
4. require failure;
5. prove exact record survives;
6. prove rewrite guards still reject UPDATE/DELETE/TRUNCATE.

Also retain empty-table down/up rehearsal.

Because PR #53 is unmerged and migration16 is not production-applied, fix the existing migration on this SAME PR.

## Principal adjudication — tenant absence reveals a lifecycle gap

The app uses Shopify managed installation + embedded token exchange. There is no legacy install callback that can be assumed to seed M3 state.

Current production authentication validates the ID token, exchanges an online staff grant, reads exact Shopify `currentAppInstallation`, then assumes a durable M3 tenant/current installation already exists.

The repository has `createShop()` and `startInstallation()`, but the production app does not currently wire a permanent first-install bootstrap into this managed-install/token-exchange path.

Therefore zero tenant rows are not merely test data. One-off SQL seeding of the dev store would hide a public-app lifecycle defect.

### Successor requirement

Amend the provisioning proposal to explicitly reject raw/ad-hoc tenant seeding.

A successor must implement reusable first-authenticated-session bootstrap that:
- begins only after verified ID token + matching online staff grant + successful exact `currentAppInstallation` read;
- uses provider shop ID/domain and current AppInstallation ID as authority;
- transactionally establishes app-owned internal shop identity + generation through reviewed tenant repositories;
- is concurrency-safe and idempotent;
- never trusts browser/body/query IDs for tenant identity;
- rejects existing tenant identity mismatch;
- handles reinstall through reviewed generation transition (`startInstallation`) only when exact provider identity proves a new installation;
- never overwrites an existing generation just to make auth pass.

No guessed Shopify IDs.

The successor must also evaluate the existing expiring-offline credential lifecycle. Shopify token exchange supports offline tokens for background work; if worker/background paths require the M3 offline credential, bootstrap must obtain and persist the expiring offline pair through the existing encrypted credential lifecycle, not a second token store.

## Commercial configuration boundary

Commercial plan values/features remain owner-controlled. Do not invent plan handles, usage handles, policy IDs, included usage, feature grants, Partner credentials or subscription state.

Authentication/bootstrap/readiness provisioning can proceed independently. Real publish eligibility must use the owner's actual Shopify commercial configuration or a separately approved dev-only test entitlement. Production paid values remain deferred until owner choice.

## Disposition

Do not merge PR #53 at this head.

Correct migration down safety and regressions on the SAME PR. Update the provisioning proposal with the permanent first-install/bootstrap adjudication.

Do not perform production provisioning, deployment, Search, fixtures, Shopify release/version/scope changes, or M6/M7 work during this correction.

Return SAME PR #53 for principal rereview.
