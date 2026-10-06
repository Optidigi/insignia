# M5-013 — exact DRAFT fixture cleanup

## Goal
Archive the one owned disposable fixture left DRAFT by M5-011/M5-012, with no publication mutation and no reuse of closed registers.

This slice is cleanup only. It does not qualify or change the production availability adapter.

## Baseline
Owner forwarding requires verified NORMAL merge of corrected PR #42 at:
- base `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e`
- head `022f5ea238444e3ae2fcd93bb571162ccde63fd6`
- tree `759634634ba8e2362ff6736fe4412e8fe2178614`

Verify actual merge parents/tree and begin from remote main.

Use actual GPT-6.1-sol/high and repository-pinned TDD/tests-mocking, diagnosing-bugs, code-review, writing-for-agents and handoff skills.

Closed M5-004/009/010/011/012 registers remain immutable.

Exact fixture only:
- Product `gid://shopify/Product/10490211467547`
- Marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`
- Created `2026-10-02T21:19:48Z`
- Last accepted observation: DRAFT, effective publication false

## 1. Fresh fixed cleanup operator
Create a fresh canonical cleanup register under `/home/serveradmin/insignia-m5-013-handoff/run`.

The operator is hard-coded to the exact fixture and exact app/shop/install identity. No search and no dynamic product ID.

Allowed GraphQL documents only:
1. identity + exact product prestate read;
2. status-only `productUpdate` to ARCHIVED for that product;
3. exact final product read.

No ACTIVE/DRAFT update, create, delete, publish/unpublish, scope/version, inventory, variant, price, cart/order or other mutation.

## 2. Pre-access offline gate
Before credential access:
- TDD the exact-target/no-alternate-target fences;
- verify production packages/source remain unchanged;
- verify the cleanup mutation contains only `{id,status:ARCHIVED}`;
- run applicable focused/root/style/secret checks;
- obtain fresh GPT-6.1-sol/high Spec and Standards/security reviews;
- obtain all applicable exact-source CI green;
- freeze source/tree/review/CI binding.

Any tracked source change after freeze closes live authority.

## 3. Provider ceilings
Whole slice:
- client-credentials exchanges: 1
- Admin reads: 3
- status-only updates: 1
- every other provider operation: 0

No retries or parallel calls.

## 4. Exact prestate
Using the protected existing credential route, read exact identity and exact product. Require:
- exact known app/client/shop/domain/installation and partnerDevelopment=true;
- current grants include `write_products`, `read_products`, `read_publications`, `read_product_listings`;
- exact product ID, marker/title/sole tag/createdAt ownership;
- status exactly DRAFT, or already ARCHIVED;
- `publishedOnPublication(publicationId:339456917787) == false`;
- `publishedAt == null`;
- `onlineStoreUrl == null`;
- complete legacy resourcePublications connection with no `isPublished=true` node.

Do not require historical `updatedAt` equality. Record the current timestamp as observation only. If ownership/effective availability is ambiguous or status is neither DRAFT nor ARCHIVED, STOP with zero mutation.

## 5. Cleanup mutation
If already ARCHIVED: perform no mutation and proceed to final verification.

If DRAFT: reserve and send exactly one status-only `productUpdate` to ARCHIVED.

Do not require mutation-response `updatedAt` to equal final readback. This cleanup is not the production availability hold and does not establish restoration ownership/CAS.

After the single mutation attempt, perform one exact final read.

Cleanup is settled successfully only if the final read proves:
- exact owned product;
- status ARCHIVED;
- effective publication false for publication339456917787;
- publishedAt/onlineStoreUrl null;
- no effective `resourcePublications` membership.

If the mutation transport is ambiguous, use at most the one reserved final read to classify state; never resend.

Report acknowledgement/readback timestamp differences exactly, but do not convert a harmless timestamp difference into permission to restore/retry.

## 6. Return
Return one docs/evidence PR with merge receipt, fresh gate, request accounting, prestate, mutation settlement, final ARCHIVED receipt, fresh completed-change reviews and final CI.

Stop for principal review. No production adapter correction, new product, matrix continuation, M6/M7, activation, RELEASE_BOUND/gate pass or launch.
