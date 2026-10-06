# M5-015 — live Availability Hold v2 qualification

## Goal

Qualify the actual production Availability Hold v2 adapter on the exact designated development store using one fresh disposable product.

Prove, on one real provider lifecycle:

1. complete configured-intent observation;
2. ACTIVE semantic prestate;
3. v2 acquire to DRAFT/held-safe;
4. durable serialization and fresh-process observe;
5. v2 restore to the original semantic availability;
6. explicit safe archival cleanup.

This is adapter qualification only.

Do NOT execute the production activation coordinator, RELEASE_BOUND activation, Function deployment, publication mutations, G7, M6 or M7.

## Entry authority

Start only after owner-authorized NORMAL merge of PR #44 at:

- base `55060c5a48617a27858d10fb0db639c7e9efe148`
- head `02e45926529fed9659e1c3dca81dec5f5ebe3174`
- tree `8c906e854b9cadcb8e9eda2740a0098067a71ad0`

Verify the actual merge's ordered parents/tree and that remote `main` points to the resulting merge before beginning.

Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, TDD/tests-mocking, diagnosing-bugs, code-review and handoff skills.

Read M5-010 through M5-014R reports plus current delivery state/operating model.

All historical canonical runs remain closed and immutable.

## 1. Fresh qualification harness

Create a fresh canonical run:

`/home/serveradmin/insignia-m5-015-handoff/run`

Do not reuse M5-004/009/010/011/012/013 registers.

The harness must use the production:
- `createShopifyAvailabilityHoldV2Port`;
- v2 application contracts;
- current Admin API version and exact production GraphQL documents.

Do not reproduce v2 snapshot/acquire/observe/restore logic in experiment code.

Experiment code may provide:
- a fixed protected credential loader;
- one in-memory token for the bounded run;
- exact-current installation fencing;
- fresh durable run/register bookkeeping;
- fixed fixture creation/staging/cleanup operations.

## 2. Offline gate before credentials

Before any credential read or Shopify request:

- implement the M5-015 harness with TDD;
- prove fixed exact-app/store/installation fences;
- prove only one fresh marker-selected fixture can be mutated;
- prove no publication mutation document exists;
- prove no restore retry/replay path exists in the harness;
- bind production v2 source/build hashes;
- run focused v1/v2 adapter tests;
- run full applicable root regression;
- run publication stress 100/100 and renderer control;
- run PostgreSQL 18 CI as applicable;
- obtain two fresh full-source GPT-6.1-sol/high safety reviews;
- obtain all applicable exact-source CI green;
- freeze source/tree/build/review/CI in the fresh register.

Any tracked source/build change after freeze closes live authority.

## 3. Fixed identity and grants

Require exact:
- App `gid://shopify/App/429028933633`
- Client `1443cf6d03d39edae7c101a943c5c684`
- Store `insignia-rewrite-dev.myshopify.com`
- Shop `gid://shopify/Shop/105501393179`
- Installation `gid://shopify/AppInstallation/1054356963611`
- partnerDevelopment = true

Require current grants contain:
- `read_products`
- `write_products`
- `read_publications`

Record additional valid grants; do not require exact equality.

No scope/app-version operation is authorized.

## 4. Provider ceilings

Whole-slice maximums:

| Operation | Ceiling |
|---|---:|
| client-credentials exchanges | 2 |
| Admin GraphQL requests | 96 |
| productCreate attempts | 1 |
| direct status-only setup/cleanup updates | 3 |
| v2 adapter status mutations | 2 |
| publication mutations | 0 |
| product deletion | 0 |
| inventory/variant/price/media/collection mutations | 0 |
| app config/version/scope operations | 0 |
| billing/cart/checkout/order/refund operations | 0 |

Every outbound attempt consumes its reservation.

No blind retry, no parallel provider requests.

The adapter's internal reads/pagination count against the global GraphQL ceiling.

## 5. Create one disposable fixture

Create exactly one fresh product:

- initial status DRAFT;
- unique run-bound `insignia-m5-015-...` title;
- exact same run marker as handle/tag;
- no media;
- no collection;
- no inventory seeding;
- no extra variant work;
- no publication mutation.

Use only the returned Product GID.

If the create response is ambiguous:
- do not resend create;
- one exact-marker recovery lookup is permitted;
- require zero or one complete exact owned result;
- otherwise stop.

Verify exact ownership and DRAFT state.

## 6. Initial v2 DRAFT observation

Take one production v2 snapshot.

Require:
- valid `m5-product-availability-snapshot-v2`;
- exact product/scope;
- state unavailable/DRAFT;
- `configuredIntent.scheduled=[]`;
- complete configured intent;
- held-safe effective visibility.

Record, without merchant names:
- included publication IDs;
- each included publication's `autoPublish`;
- each included publication's `supportsFuturePublishing`;
- count of future-capable included publications;
- effective publication IDs.

A future-capable included publication is useful additional live coverage but is **not required** for core M5-015 success. If absent, record `FUTURE_CAPABILITY_NOT_OBSERVED`; do not mutate publication membership to manufacture the case.

Any actual scheduled record stops the v2 lifecycle branch as `SCHEDULED_PRODUCT_UNQUALIFIED`, followed only by safe fixture cleanup when possible.

## 7. Stage ACTIVE

Perform exactly one direct status-only update on the owned fixture:

DRAFT → ACTIVE.

No publication mutation.

Require acknowledged ACTIVE and an exact production v2 snapshot after the update.

The ACTIVE v2 `before` snapshot must:
- be valid and intent-qualified;
- preserve configured intent from the DRAFT observation unless provider behavior explicitly establishes a new configured-intent relationship caused by the status transition; any such change is a STOP for principal review;
- have no schedule.

For the strongest qualification, require at least one effective published publication ID in ACTIVE. If ACTIVE has zero effective publication IDs, stop the hold/restore branch as `ACTIVE_EFFECTIVE_VISIBILITY_NOT_OBSERVED`, cleanup safely, and report partial evidence rather than pretending the core membership transition was exercised.

Persist the exact ACTIVE v2 snapshot.

## 8. Create durable v2 hold intent

Create:

`m5-availability-hold-v2`

with:
- unique operation ID;
- exact ACTIVE `before`;
- held = null.

Persist/fsync the exact hold intent before the adapter mutation call.

This is experiment durability evidence, not production activation-state persistence.

## 9. Acquire exactly once

Call the production v2 adapter `acquire` exactly once.

Expected success:
- kind HELD;
- one DRAFT mutation;
- exact acquisition acknowledgement retained;
- current/held state DRAFT;
- configured intent digest unchanged from ACTIVE before;
- no current effective published publication IDs;
- no online-store effective visibility;
- no schedule;
- held-safe = true.

Record actual acknowledgement/readback `providerUpdatedAt` values and delta. No particular delta is required.

A timestamp difference alone is not conflict.

If acquire returns CONFLICT/ambiguous/failure:
- do not replay;
- persist exact result;
- proceed only to safe cleanup if all writes are settled and current exact state is known.

## 10. Persist and reload in a fresh process

On HELD success:

- persist the exact returned v2 hold JSON byte-for-byte;
- terminate the adapter/harness process cleanly;
- start a fresh process from the frozen source;
- load the persisted hold without reinterpretation.

Call production v2 `observe` once.

Require HELD and semantic equality with the persisted held snapshot under the v2 contract.

No mutation is allowed in this step.

## 11. Restore exactly once

From the fresh process, call production v2 `restore` exactly once using the persisted hold and exact current HELD observation.

Expected success:
- RESTORED;
- one status-only mutation to original ACTIVE;
- configured intent equals original ACTIVE before;
- effective published publication-ID membership equals original ACTIVE before;
- online-store effective booleans equal original ACTIVE before;
- actual schedule remains empty;
- provider updatedAt / publish timestamps may differ and are recorded.

Do not require timestamp equality.

If restore is `RESTORATION_PENDING`, NOT_DISPATCHED, CONFLICT or ambiguous:
- do not retry;
- do not infer ownership from later matching status;
- stop the qualification branch;
- safe cleanup requires separately known settled state.

## 12. Explicit cleanup

After successful restore, or after a stopped branch only when all writes are settled and exact ownership/current state are known:

archive the exact disposable fixture with at most one direct status-only update if not already ARCHIVED.

Then perform an exact production v2 snapshot/readback.

Require final:
- ARCHIVED;
- exact owned fixture;
- no effective published publication IDs;
- no online-store effective visibility;
- no schedule.

Do not delete the product.

Do not mutate publication membership.

If cleanup write settlement is ambiguous, use only the bounded exact read needed to classify state; never resend.

## 13. Required result classification

One integrated report must classify:

### `PASS_V2_LIVE`
All of:
- DRAFT v2 observation valid;
- ACTIVE effective visibility observed;
- acquire HELD;
- fresh-process observe HELD;
- restore RESTORED to original semantic availability;
- final ARCHIVED/effectively unavailable cleanup;
- no retry/unknown outstanding write.

Also record:
- `FUTURE_CAPABILITY_OBSERVED` or `FUTURE_CAPABILITY_NOT_OBSERVED`;
- actual ACK/readback timestamp deltas.

### `PARTIAL`
A safe provider condition prevents exercising the complete lifecycle, e.g. ACTIVE has no effective publication membership, but exact state/cleanup remain known.

### `STOPPED`
Any ownership, schedule, provider-shape, permission, settlement, intent or cleanup ambiguity.

Do not convert PARTIAL/STOPPED into PASS.

## 14. Evidence

Return one PR containing:
- PR #44 merge receipt;
- exact source/build/gate binding;
- fixture create/ownership receipt;
- DRAFT and ACTIVE v2 snapshots;
- durable hold-intent record;
- acquire result and acknowledgement;
- persisted hold bytes/hash;
- fresh-process observe result;
- restore receipt;
- final ARCHIVED cleanup/readback;
- request accounting;
- future-capability observation flag;
- exact timestamp diagnostics;
- fresh completed-change GPT-6.1-sol/high Spec/security reviews;
- final exact-head CI.

No raw bearer/secret/auth body, browser/session data, or unrelated merchant information.

## 15. Limits

Even `PASS_V2_LIVE` does not prove:
- scheduled publishing;
- high-publication-count live pagination;
- all-channel propagation timing;
- in-flight checkout drainage;
- native CAS/race exclusion;
- production activation/RELEASE_BOUND;
- complete G6/G7/M5 acceptance.

Stop for principal review.

No successor merge, production activation, M6/M7 or launch.
