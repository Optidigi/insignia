# M5-020 — release canonical candidate + real G7/M5 closure

## Goal

Release exactly the already-created canonical inactive app version, then execute the real designated-development-store embedded-admin qualification necessary to close M5/G7.

No new app version is created.

## Entry

Begin only after normal merge of PR #50 at:
- base `703cfb21a4262675b088cd06289fe08a421ecdd8`
- head `7947d7b13652ef4c2f5ff9761b98b770f83effaf`
- tree `50a85fec74b6699b1f6485d5b9369a1e5bf93faa`

Verify actual merge ordered parents/tree.

## Immutable identities

Canonical:
- name `Insignia`
- origin/APP_URL `https://insignia-app.optidigi.nl`
- App Home `https://insignia-app.optidigi.nl/admin/products`
- app `429028933633`
- client `1443cf6d03d39edae7c101a943c5c684`

Only release candidate:
- ID `1158986629121`
- name `m5-019r-9b94149272d1`

Pre-release Active/rollback:
- `1153019904001 / insignia-3`

Never release:
- `1158837927937 / m5-019-a9717e1265ef`

## Phase A — frozen pre-release gate

Before any release mutation:
1. Verify PR50 merge receipt and accepted hashes.
2. Verify canonical host health/readiness.
3. Perform one bounded supported read proving candidate still inactive, current Active exactly `1153019904001`, superseded version still inactive, and no unexpected newer Active/candidate exists.
4. Verify candidate canonical URL/scopes/API/two Function UIDs.
5. Verify designated installation remains present.
6. Fresh source checks/CI and two CLEAR GPT-6.1-sol/high reviews.
7. Open a fresh durable register with release-attempt ceiling 1.

No fixture yet.

## Phase B — exactly one release

Release only existing version:
`m5-019r-9b94149272d1` / `1158986629121`.

Use the supported pinned Shopify CLI existing-version release path. Do not create/build/deploy another version.

Release attempts: 1.
Version creation attempts: 0.
No retry on ambiguous settlement.

After acknowledgement, require readback:
- `1158986629121` Active;
- `1153019904001` retained as inactive rollback;
- `1158837927937` remains inactive/NEVER_RELEASE;
- canonical App Home/scopes/API/Function UIDs unchanged.

Bounded observation may wait for propagation; never redispatch release.

## Phase C — pre-fixture real embedded qualification

Before any fixture:
- open designated `insignia-rewrite-dev`;
- prove iframe resolves to canonical host;
- prove production admin/client bootstrap;
- verify current install/shop/grants/staff;
- verify trusted release/build/Function/commercial/readiness premises;
- verify Functions/modules are available.

If additional provisioning/enablement mutation is required and is not already authorized, STOP and return an exact blocker. Do not improvise.

## Phase D — G7 real-browser matrix

Execute the accepted M5-018 matrix: cold launch, deep link, reload, mobile, restricted cookies, expired identity, shop/install/staff isolation, private SSR/API, CSRF/origin/fetch metadata, Polaris/Preact hydration, visualizer synchronization, refresh/concurrency/readiness/late activation.

Unsupported/destructive criteria are BLOCKED_PLATFORM or NOT_APPLICABLE, never fabricated PASS.

## Phase E — one disposable merchant-flow fixture

Only after readiness passes.

Maximum one fresh disposable Shopify product and one ProductConfig.

Prove:
configure → preview → save → durable readback → stale-edit conflict → ambiguous-save recovery → publish request → immutable revision/request/outbox → FIRST_PUBLICATION v3 → truthful non-effective pending state → committed activation → idempotent replay → refresh/reopen exact effective revision.

Do not start M7 cart work.

## Phase F — cleanup

If all writes settle and ownership is exact, archive the disposable Shopify product once and verify ARCHIVED/effectively-unpublished.

No cleanup if write ownership is ambiguous.

## PASS

M5/G7 PASS requires released canonical version Active, canonical embedded admin, accepted real-browser matrix, successful real configure/preview/save/publish/v3 activation, truthful UI, safe cleanup, no unresolved write, complete accounting, unchanged live source/build, fresh CLEAR reviews and final CI.

If passed, stop for principal review; M6 requires separate authorization.

## Rollback

Do not auto-rollback for an ordinary G7 test failure.

Rollback only for a concrete release-induced safety/regression condition. If required, release previous `1153019904001 / insignia-3` exactly once, record settlement, do not re-release candidate in the same slice, and return STOPPED.

## Boundaries

No new app version.
No scope change.
No M6/M7 implementation.
No production merchant rollout.
No historical availability/discovery reopening.
Never release `1158837927937`.

Return one integrated evidence PR/candidate and stop for principal review.
