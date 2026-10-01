# M5-003R — availability contract correction on PR #29

## Authority and provenance

The attributed [principal review](PR-029-principal-review.md) is **CHANGES_REQUESTED**, not native GitHub approval. The user authorized only its [local correction](prompts/M5-003R-AVAILABILITY-CONTRACT-CORRECTION.md) on the existing PR. Before edits, remote main/base/effective base was `8a84ddeaf277368852d224915abe6d4a93a3d8a4`; GitHub and the clean worktree agreed on head `a426719e5350f61ecb5620f6c90ab7a0e365e66b` and tree `6b60ec923a3601584e05c76fcce362a9c0534d88`. No newer work was discarded. The handoff ZIP SHA-256 is `caaa75e6f3a4076cb0c6c8d21db134602f9f2dbf1c7a33a67b50b387a50f25cd`; every supplied manifest entry verified. The complete [principal package](evidence/m5-003r/principal-package/README.md) preserves the old-source diagnostic and its Node22 qualification. Its snapshots were never copied onto current source.

## R1 observation origin

The complete availability adapter now captures `observedAt` before credential/provider I/O and records `receivedAt` after transport, body consumption and post-response fencing. Publication admission, activation and recovery continue to use the conservative origin for freshness; receipt cannot renew authority. `updatedAt` is checked against receipt, so a valid timestamp generated during a request is accepted. Reversed clocks, malformed timestamps, future versions/receipts and existing finite budgets remain rejected. Acquisition/restoration use the same normalization.

Public tests reproduce the old defect through `createShopifyAvailabilityHoldPort` and the real PostgreSQL `core.productionActivations.create(...).publications.advance(...)` facade. Fetch, body and post-response credential delays previously returned `PENDING/shop-config-written`; corrected results stay `ADMISSION_PENDING/prepared` with zero policy writes, no immutable activation evidence and no effective revision. Immediate/999ms/exact 1000ms observations pass a 1000ms budget. Mid-request provider-version, observe-origin, mutation/readback and malformed/reversed/future controls are retained. No fixed sleep, longer timeout or extra mutation-authority system is used.

## R1 fresh-review dispatch correction

Both first fresh full-source reviews independently found that a correct observation could become stale during the later projection/current-state reads. Their complete [Spec](evidence/m5-003r/reviews/first-spec.md) and [Standards/security](evidence/m5-003r/reviews/first-security.md) reports are preserved against first corrected head `0c8e473f4ed38aa5a66c62f4a1602067ca500a44`, together with selected actual model/high/read-only contexts and its ten green attempt-1 CI runs. Neither was clearance.

New permanent real-PostgreSQL public-facade tests were red at that runtime: four write phases and a reversed clock failed; three immediate/999ms/exact-1000ms controls passed. All eight pass after correction. Admission now carries an internal ephemeral freshness check, retaining the observed origin and establishment time. Projection reads cannot renew it. It is checked again after projection I/O and final current-installation/key preparation, synchronously immediately before `remote.set`, with no intervening await. A reversed/nonfinite clock or expired observation stays `ADMISSION_PENDING`, without additional remote writes, activation evidence or effective revision. Same-mode no-hold behavior remains unchanged. No new public authority, extra provider observation/retry or persisted lease is introduced.

## R2 legal status and exact restoration

`UNLISTED` maps to a distinct normalized `unlisted` state; `available` remains ACTIVE and `unavailable` remains DRAFT. Catalog list/detail retain UNLISTED, including mixed ACTIVE/UNLISTED pages and bounded pagination. Unknown controls use `UNSUPPORTED_SYNTHETIC_STATUS` and still fail closed. Synthetic mutation/readback tests preserve `UNLISTED → DRAFT → UNLISTED`; a merchant switch to ACTIVE while held yields conflict without a restoration write. ACTIVE/DRAFT/ARCHIVED controls remain intact. Real PostgreSQL public read/restart and immutable activation evidence retain the original unlisted state and exact restoration sequence.

The existing Admin DTO carries status as a string and renders it without remapping; its catalog adapter now accepts the legal value. No merchant visibility is broadened. The old test assumption is preserved at the reviewed Git ref and in the principal record, not relabelled as correct.

Primary contract material: [current ProductStatus enum](https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus), [21 October 2025 changelog](https://shopify.dev/changelog/posts/new-unlisted-product-status), [unlisted guide](https://shopify.dev/docs/apps/build/product-merchandising/unlisted-products). They identify UNLISTED in Admin API 2025-10 onward, distinct from ordinary ACTIVE and unavailable DRAFT. The version-specific 2026-07 web page was inaccessible in this tool; the adapter API version remains 2026-07. Documentation is not live status/propagation evidence.

## Persistence and preservation

This is an additive typed JSON snapshot change, not a SQL schema change. New snapshots carry `receivedAt`; older stored snapshots lacking it keep their recorded `observedAt` and use it only as the historical version-validation bound. Their timestamps are never rewritten or retroactively claimed to have conservative provenance. Only new observations can supply the corrected origin. Existing hold/evidence versions and state identities remain intact, with one new legal state. No previous migration or historical receipt changed.

Architecture/ledger v1.4, v2 bytes/Functions, M2 money, tenant/install/key/epoch/effective-pointer fences, immutable evidence, one-use restoration claims, independently trusted settlement and release authority remain unchanged. The package uses one integrator/writer, actual GPT-6.1-sol/high, and repository-pinned mattpocock skills. Existing unrelated browser processes and shared host/test-server state are preserved.

## Verification and review

Executed complete root PASS; application174, Shopify221, PostgreSQL105, HTTP16, worker15, stress100/100 with no retries and renderer-negative control PASS. Strict complete fixtures, secrets and style pass. Red/green commands, logs, fresh full-source reports and final exact-head CI are supplied by the [evidence index](evidence/m5-003r/README.md) and exact-head PR packet. The whole pinned root, real PG18, HTTP/worker, 100-case no-retry stress and renderer-negative controls are required. All six preserved 100k query-plan script/built seam/migration bindings remain identical after rebuilding the dispatch correction. Final head/tree/base/CI are recorded after committing, avoiding self-reference.

## Remaining boundaries

No authenticated Shopify/provider request, owner credential read, Shopify CLI, preview/deployment, product/metafield change or real activation occurred. Nine retained grants, billing fixtures, historical previews/orders and legacy resources remain unchanged. DRAFT has no native atomic product-version CAS; all-channel/in-flight propagation remains unqualified. No production RELEASE_BOUND or operator recovery source is wired; DEV_PREVIEW_OBSERVED stays live-unqualified. M5 and G6/G7 remain incomplete. Stop for principal rereview; no merge, M6/M7, next package or launch.
