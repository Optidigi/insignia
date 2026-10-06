# M5-012 — publication intent resolution and safe fixture cleanup

## Goal

Resolve the Microsoft Copilot publication intent for the existing owned DRAFT fixture using Shopify's current read-only search/publication surfaces, then archive that disposable fixture once if the fresh state remains exact.

This slice does not change production availability code and does not repeat an availability hold transition.

## Baseline

Owner-forwarded authority requires the verified NORMAL merge of PR #41 exactly at:

- base `1fffcb3048952ff762f1f9805f86aceed90f228f`
- head `9353bf9a5c13649daa55cb3693cab16532c6f6f6`
- tree `e00f2f8ce5b33321b67c6271cb13a315f34471a1`

Verify the actual ordered merge parents/tree and start from that remote main.

Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, TDD/tests/mocking, diagnosing-bugs, code-review and handoff skills.

Closed M5-004/M5-009/M5-010/M5-011 canonical registers remain immutable.

Fixed target:
- Product `gid://shopify/Product/10490211467547`
- Numeric product ID `10490211467547`
- Marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`
- Created `2026-10-02T21:19:48Z`
- Last observed status DRAFT
- Publication/Channel `gid://shopify/Publication/339456917787` / `gid://shopify/Channel/339456917787`
- Channel app `gid://shopify/App/294412484609` / numeric app ID `294412484609`

## 1. Fresh fixed harness

Create `/home/serveradmin/insignia-m5-012-handoff/run`.

The harness must be fixed to the target above. No product search by arbitrary text, no alternate product/publication/channel, and no dynamic target selection.

Allowed operations:
- exact identity/current-grant read;
- exact product projection read;
- exact publication metadata read;
- publication `includedProducts` read filtered to the exact product ID;
- root `products` reads with fixed exact-ID plus fixed `published_status` / `publication_ids` predicates described below;
- one status-only ARCHIVED cleanup on this exact fixture if fresh state permits;
- one exact final readback.

Forbidden:
- product create;
- ACTIVE/DRAFT/UNLISTED transition;
- availability port acquire/restore;
- publish/unpublish mutation;
- deletion;
- scope/app-version changes;
- any other product.

Production availability adapter source/build remains unchanged.

## 2. Fixed intent queries

Validate these exact 2026-07 query semantics offline before provider access.

### A. Publication includedProducts

Query exact publication `339456917787`:

`includedProducts(first:2, query:"id:10490211467547")`

Retain only exact product identity/status plus complete pageInfo.

Shopify defines includedProducts as products included, but not necessarily published, in the publication.

### B. Channel-app intended search

Root products query with fixed search:

`id:10490211467547 published_status:294412484609-intended`

Return at most 2 nodes and require complete pageInfo.

### C. Channel-ID intended search

Root products query with:

`id:10490211467547 published_status:339456917787-intended`

### D. Publication association search

Root products query with:

`id:10490211467547 publication_ids:339456917787`

### E. Effective check

Exact product read should also retain:

`publishedOnPublication(publicationId:"gid://shopify/Publication/339456917787")`

alongside status/updatedAt, legacy publication fields and ownership identity.

No broad listing of other merchant products is permitted. All connections are first:2 and must be complete.

## 3. Offline gate

Before credentials:
- TDD every exact query/variable/search string;
- prove alternate IDs/search strings are rejected before HTTP;
- bind unchanged production source/build;
- validate 2026-07 schema/search documentation;
- run focused/root checks and applicable stress;
- fresh full-source GPT-6.1-sol/high Spec and Standards/security reviews;
- all applicable exact-source CI green;
- freeze source/tree/build/review/CI.

Any tracked source/build change after freeze closes live authority.

## 4. Provider ceilings

Whole-slice maximum:
- client-credentials exchanges: 2
- Admin reads: 8
- status-only updates: 1
- all other mutations: 0

No retry and no parallel requests.

## 5. Fresh state gate

Verify exact app/client/shop/domain/installation/development identity and current grants include `write_products`, `read_products`, `read_publications`, `read_product_listings`.

Read exact product and require:
- exact product/marker/title/tag/createdAt ownership;
- current status DRAFT or ARCHIVED;
- no unexpected ACTIVE/UNLISTED state;
- no GraphQL/provider ambiguity.

If already ARCHIVED, skip cleanup mutation after intent reads.

If current state differs materially from the last observed DRAFT, record drift and stop before mutation.

## 6. Intent classification

Run A–E above without mutation.

Classify:

### `INTENT_CONFIRMED`
The exact DRAFT product is returned by at least one documented intent/inclusion surface (`includedProducts` and/or channel `-intended`) with no contradictory exact-ID result. Record which surfaces agree/disagree.

### `NO_INTENT_OBSERVED`
All exact intent/inclusion surfaces validly exclude the product, while effective `publishedOnPublication` is false.

### `INCONSISTENT`
The fixed surfaces materially disagree, return incomplete/ambiguous data, or provider/search semantics cannot be safely interpreted.

Do not rewrite the M5-011 V2 result. V2 remains empty evidence.

## 7. updatedAt interpretation

Do not introduce any timestamp tolerance and do not modify production hold semantics.

Record the current DRAFT `updatedAt` only as a fresh observation.

The principal interpretation remains:
- Product.updatedAt is a broad last-modified value, not a native CAS token;
- the one-second M5-011 drift therefore cannot be dismissed, but neither can it identify the changing actor/field;
- a future correction must define explicit ownership/settlement semantics rather than simply adding epsilon tolerance.

## 8. Safe fixture cleanup

After intent reads, if and only if:
- exact ownership remains true;
- current status is DRAFT;
- all reads are settled;
- no provider ambiguity exists;

issue exactly one direct status-only `productUpdate` to ARCHIVED on this exact disposable fixture.

Then perform one exact readback.

Cleanup success requires exact owned product with status ARCHIVED. Publication/intention fields are recorded but are not mutated.

If update response is ambiguous, perform the one final exact readback only; never resend.

If status was already ARCHIVED, perform no mutation and preserve that state.

## 9. Handback

Return one integrated evidence PR with:
- PR #41 merge receipt;
- M5-012 binding/gate;
- exact current product observation;
- publication includedProducts result;
- app-ID and channel-ID intended-search results;
- publication_ids result;
- publishedOnPublication result;
- intent classification;
- final cleanup receipt/state;
- fresh completed-change reviews;
- final-head CI.

Also provide a concise principal recommendation for the next production-adapter decision, but do not implement it.

Stop for principal review.

No new product, availability transition, production adapter correction, publication mutation, M6/M7, activation, RELEASE_BOUND/gate pass or launch.
