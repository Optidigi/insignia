# M5-011 — published-state availability adjudication and safe fixture cleanup

## Goal
Use the already-owned M5-010 fixture to establish publication semantics across ACTIVE→DRAFT, exercise the current production availability adapter once, and leave the fixture ARCHIVED when safe.

No new product. No M5-010 matrix continuation. No restore to ACTIVE. No publication mutation. No production availability-source change in this slice.

## Baseline
After verified normal merge of PR #40:
- base `25e6c487741e1685637d351137d9671033f3c53d`
- head `ca250edb776e6c5b4567334c1fb4f2c750ddcc5a`
- tree `8b9d8389f48c0a8c12a6c56880abe994573af5c6`

Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, TDD/tests/mocking, diagnosing-bugs, code-review and handoff skills.

Closed M5-004/M5-009/M5-010 registers remain immutable.

Fixed fixture:
- Product `gid://shopify/Product/10490211467547`
- Marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`
- Created `2026-10-02T21:19:48Z`
- Last observed ACTIVE
- Publication `gid://shopify/Publication/339456917787`

## 1. Fresh fixed harness
Create `/home/serveradmin/insignia-m5-011-handoff/run`.

The harness may only:
- verify exact app/shop/install/current grants;
- read this exact product;
- read a fixed adjudication V2 projection;
- read publication `339456917787`;
- call the current production `ProductAvailabilityHoldPort.snapshot` and `acquire` once;
- archive this exact fixture once after adjudication when safe;
- read final state.

No product search/dynamic target, create, availability restore, ACTIVE mutation, publish/unpublish, scope/version change or other product.

Production availability-adapter source stays byte-identical during live work.

## 2. Fixed V2 projection
Read exact ownership fields plus status/updatedAt/publishedAt/onlineStoreUrl and:
- legacy `resourcePublications(first:250, onlyPublished:false)`;
- `unpublishedPublications(first:250)`;
- `resourcePublicationsV2(first:250, onlyPublished:false,catalogType:APP)`;
- same V2 connection for MARKET;
- COMPANY_LOCATION;
- NONE.

Every connection includes complete pageInfo. Each V2 node retains only isPublished, publishDate and publication id.

All four catalog types are mandatory because V2 defaults to APP if omitted.

Separately query publication `339456917787` for id, autoPublish, supportsFuturePublishing, catalog type/id/title/status where available, and channels(first:50) with complete pageInfo plus minimal channel/app identity. Do not request merchant account names/IDs or unrelated resources.

Incomplete connections stop.

## 3. Offline gate
Before credentials:
- TDD the fixed harness;
- prove no alternate target, restore-ACTIVE or publication mutation path;
- bind unchanged production adapter/build;
- validate selected 2026-07 fields;
- run applicable focused/root checks and 100/100 stress where relevant;
- obtain fresh full-source GPT-6.1-sol/high Spec and Standards/security reviews;
- obtain all applicable exact-source CI green;
- freeze source/tree/build/review/CI.

Any tracked source/build change after freeze closes live authority.

## 4. Ceilings
- client-credentials exchanges: 3
- Admin reads: 16
- status-only updates: 2
- productCreate: 0
- publication mutations: 0
- deletion: 0
- scope/app-version operations: 0

No blind retry or parallel provider calls.

## 5. Exact prestate
Require exact known app/client/shop/domain/installation/development identity and grants `write_products`, `read_products`, `read_publications`, `read_product_listings`.

Read the fixed product through V2 projection. Require exact marker/title/tag/createdAt ownership, ACTIVE status and publication `339456917787` still effectively published. Otherwise STOP on drift.

Read the exact publication metadata and record legacy, unpublished and all four V2 partitions.

## 6. Current production hold exactly once
Construct a fresh hold from the current production adapter's own `snapshot`. Call current production `acquire` exactly once. This targets DRAFT/unavailable.

Record before snapshot, acknowledged mutation/readback, adapter result (HELD/CONFLICT/failure), and accounting.

Never call restore.

If mutation settlement is UNKNOWN and bounded observation cannot establish exact current state, STOP without cleanup mutation.

## 7. Post-DRAFT adjudication
If exact owned product is known DRAFT, read the V2 projection again.

Compare ACTIVE vs DRAFT:
- legacy resourcePublications;
- V2 IDs for APP/MARKET/COMPANY_LOCATION/NONE;
- V2 isPublished/publishDate;
- unpublishedPublications;
- publishedAt/onlineStoreUrl;
- publication metadata/autoPublish.

Answer explicitly:

**Does V2 retain publication `339456917787` as staged/configured while the legacy view disappears in DRAFT?**

Also state whether the current adapter returned CONFLICT because its legacy membership digest changed across the transition.

Do not infer beyond captured evidence.

## 8. Explicit cleanup
After adjudication, only if ownership is exact, state is known DRAFT/ARCHIVED, and no write settlement is UNKNOWN, settle this disposable fixture ARCHIVED.

If DRAFT, one direct status-only `productUpdate` to ARCHIVED is authorized. This is experiment cleanup, not merchant-product archival authority.

Perform one exact final readback and require ARCHIVED. Record publication fields; do not mutate them.

If cleanup is ambiguous, use only one bounded readback to classify settlement, then stop. Never resend.

## 9. Return
Return one integrated evidence PR and classify:
- `SNAPSHOT_FIELD_DEFECT_SUPPORTED`;
- `DIFFERENT_PLATFORM_BEHAVIOR`; or
- `INCONCLUSIVE`.

If the snapshot defect is supported, propose but do not implement the smallest adapter correction, covering V2 staged/published membership, APP/MARKET/COMPANY_LOCATION/NONE coverage, stable publication intent vs effective visibility, restoration equality, and persisted `m5-availability-hold-v1` compatibility/versioning.

Return merge receipt, binding/gate, pre/post projections, publication metadata, adapter result, cleanup receipt, fresh completed-change reviews and final CI.

Stop for principal review.

No new product, matrix continuation, restore ACTIVE, publication mutation, production adapter correction, M6/M7, activation, RELEASE_BOUND/gate pass or launch.
