# M5-016 — publication coverage adjudication + cleanup + conditional local correction

## Entry
After verified normal merge of PR #46 at:
- base `6a186bea8e5d1c01a66f7ab683c06393fe81e991`
- head `38bac0cfabf96632e533e11df2ccfda9c513dea3`
- tree `b54b0f83beee01a06a5218af0a18f604f6e3482b`

Fresh run only:
`/home/serveradmin/insignia-m5-016-handoff/run`

Exact fixture:
`gid://shopify/Product/10495813091611`

Exact target Publication:
`gid://shopify/Publication/339456917787`

Historical target AppCatalog:
`gid://shopify/AppCatalog/188090286363`

Never reopen M5-015R.

## Phase A — offline gate
Before credentials:
- TDD fixed read-only adjudication + cleanup harness;
- retain the M5-015R process-level network escape guard;
- only exact fixture may mutate;
- only mutation allowed is one status-only ARCHIVED update;
- no publication/create/delete/scope/version documents;
- bind unchanged production v2 source/build;
- focused/root/stress/renderer/PostgreSQL checks;
- two fresh GPT-6.1-sol/high full-source reviews;
- exact-source CI green;
- freeze source/tree/build/review/CI.

Any tracked source/build change closes Phase A provider authority.

## Identity
Require exact app/client/shop/domain/installation/development identity and grants containing:
`read_products`, `write_products`, `read_publications`.
Record `read_product_listings` if present.

## Ceilings
- auth exchanges 1
- Admin GraphQL attempts 16
- status-only updates 1
- every other mutation category 0
- no retries, no parallel calls

## A1 exact product prestate
Read exact ownership/status plus:
- publishedAt
- onlineStoreUrl
- `publishedOnPublication(publicationId:339456917787)`
- complete `resourcePublications(first:250, onlyPublished:false)`
- complete `unpublishedPublications(first:250)`

Require exact ownership and ACTIVE. Require target still effectively published; otherwise STOP on drift.

## A2 exact target Publication
Query exactly `publication(id:339456917787)` and retain only:
- id
- autoPublish
- supportsFuturePublishing
- catalog __typename/id/status
- `includedProducts(first:2, query:"id:10495813091611")` + complete pageInfo
- channels(first:2) with id and app.id only

No names/titles/account data.

Classify direct inclusion confirmed/not confirmed.

## A3 explicit APP publications
Run one complete forward `publications(..., catalogType:APP)` enumeration with production-equivalent safety bounds.
Retain IDs, autoPublish, supportsFuturePublishing, catalog id/status only.
Record whether target appears.

## A4 APP catalogs
Run one complete forward `catalogs(..., type:APP)` enumeration, retaining catalog __typename/id/status and publication.id only.
Record whether target AppCatalog or target Publication appears.
Provider denial/omission is evidence; do not retry or change scopes.

## A5 classify
- `GENERIC_DISCOVERY_CONFIRMED`: exact direct inclusion confirmed AND target appears in explicit APP publications or APP catalogs.
- `DIRECT_ONLY`: exact direct inclusion confirmed but neither generic discovery surface exposes target.
- `UNRESOLVED`: direct query null/not included/incomplete/error or identity/coverage ambiguity.

Preserve the historical unfiltered omission.

## A6 cleanup
After A1–A5, if ownership exact, current state ACTIVE, pending=0 and no unknown writes:
- exactly one direct ACTIVE→ARCHIVED update;
- then one exact final read.

Require:
- ARCHIVED
- `publishedOnPublication(target)=false`
- no resourcePublications node with isPublished=true
- onlineStoreUrl=null

Record publishedAt without mutating publication state.

Ambiguous cleanup response: one classification read only; never resend.

Close/seal Phase A. No provider access afterward.

## Phase B — conditional local correction
Only after Phase A closes.

### If GENERIC_DISCOVERY_CONFIRMED
Implement the smallest local production correction using the generic surface that actually exposed the target.

If explicit APP publications exposes it:
- enumerate APP explicitly rather than trusting unfiltered behavior.

If APP catalogs exposes it:
- use complete APP catalog discovery to obtain publication IDs and exact-resolve Publication/includedProducts.

In all cases:
- effective/staged IDs remain consistency candidates;
- every candidate must resolve into configured intent or fail closed;
- supportsFuturePublishing remains capability evidence;
- actual schedules remain unqualified;
- updatedAt remains diagnostic;
- v1 unchanged.

Add exact PR46-shape regression and full tests/CI/reviews.

### If DIRECT_ONLY or UNRESOLVED
Do not patch production. Exact-ID lookup validates a known Publication but does not prove generic complete discovery for arbitrary hidden intent. Stop after cleanup for principal review.

No live hold rerun in M5-016.

No production activation, RELEASE_BOUND, G7, M6/M7 or launch.
