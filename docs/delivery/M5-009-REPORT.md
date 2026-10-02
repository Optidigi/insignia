# M5-009 — current-capability availability qualification

## Authority and baseline

[PR-038R external approval](PR-038R-principal-review.md) supersedes the earlier CHANGES_REQUESTED verdict only at approved PR #38 head/tree. The owner authorized its normal merge and this [fresh qualification](prompts/M5-009-AVAILABILITY-QUALIFICATION.md). Actual merge `9ce56a1a9b8f674a3500f6592803f7a52e2ef18d` has ordered parents `d3adffdd7ea6c538016ac3569d1f17e81259aa89`, `8dbe18ccc7f5c465384d7f34df92822b85c743a7`, tree `a88f092e62f9fabceb0c35e8a468383897ad9b9c`. Ten exact-head checks passed attempt1 immediately before merge. No reviewed-head commit, native approval or bypass. [Receipts](evidence/m5-009/pr38-merge.json).

## Successor harness and offline gate

A fixed `m5-009` profile reuses M5-004's operator, qualification matrix and binding verifier; the old default profile keeps its exact-nine-grant behavior. The successor fixes only canonical directory/run marker/source binding and identity capability policy. It requires exact designated app/client/shop/domain/installation/development identity, a bounded unique well-formed accessScopes array and current write_products; it permits and records additional valid grants. It does not separately request read_products. The unchanged production availability adapter still checks its existing returned read/write product handles; an incompatible provider response stops rather than changing that adapter.

New run: `/home/serveradmin/insignia-m5-009-handoff/run`. Closed M5-004 live history is read for preservation hashes only, never reopened/reset/written. Source/build gate includes shared and successor tooling, complete production source/build dependencies, root manifests and workflows. Before credentials it requires a clean exact committed source, successful offline receipt, two fresh actual GPT-6.1-sol/high restricted full-source safety reports with settings, and all ten exact-source green workflows. Any source/build change closes the gate.

TDD red: write_products-only identity failed with retained_grants against the old guard. Green: successor accepts it and extra valid grants; malformed/duplicate/absent scope and every wrong identity fail. Full synthetic workflow uses real production availability/catalog adapters, fresh-process hold reload and external fake HTTP/credentials only. Both minimal current product-grant and additional-grant cases finish the five-case matrix with 1 auth/62 reads/1 create/12 status updates, no parallel dispatch, no lost-response retry. Legacy 33 tests remain intact. Shared matrix, response/ownership/settlement helpers and request documents are compared to the approved merge. Negative identity/capability/lost-ack controls retain stop/finalization rules.

[API2026-07 documented contract checks](evidence/m5-009/schema-contract.json) reuse unchanged documents against eight public versioned reference pages: hashes still match the original M5-004 contract. This is a selected documented-field/input/enum validation, not full SDL/introspection/MCP validation. Public Markdown U+200B word-breaks were stripped for identifier lookup after the initial literal check failed. No authenticated schema request.

[Offline results](evidence/m5-009/offline-results.json): focused44/44 (legacy33 + successor11), root PASS, stress100/100 without retries and expected missing-renderer rejection PASS. Root passed before the final extra gate-probe test; focused44 and final style include that addition. The natural exact-source foundation workflow must independently qualify the complete committed source. Initial test/style failures and synthetic-fixture correction are retained, not hidden. Both full-source restricted safety reviews found no unresolved material finding, with same-launch gpt-6.1-sol/high/read-only settings. All ten source-head workflows passed naturally on attempt1 before credential access, including complete foundation/PostgreSQL execution. The frozen live head was `e92a2131f33d82f51f6ed15f7e4361c62238e04b`, tree `7bcaefb8a14c9d6e9cdce95eaf83249bc22b4693`. [Safety gate](evidence/m5-009/live/gate.json), [source/build binding](evidence/m5-009/live/binding.json), [review reports/settings](evidence/m5-009/safety/). Final evidence/test changes close that source gate; no more remote requests are permitted. Completed-change reviewer/session and final-head refs belong in the PR packet to avoid self-referential commits.

## Live limits and finalization contract

One sole serialized operator; auth3/read96/create1/status-update16 maximum, with final12 reads/3 updates reserved. The same fixed request documents, response bounds, no-retry transport, exact ownership and complete-empty-publication guards apply. Only returned new run-owned fixture is eligible. No publication, deletion, extra variants, inventory/price or policy/Function operation. Unknown write settlement/ownership stops mutations and leaves the last observed fixture; settled owned finalization is ARCHIVED and unpublished.

## Actual live result — STOPPED / publication-read permission blocker

One entry execution on pinned Node24.21.0, 2 October2026 at 19:58UTC, used only the reviewed protected route. Credential file metadata satisfied same-user/private regular-file and directory checks (uid1000, file600); credentials/bearer/auth bodies were not persisted. Auth returned HTTP200. The fixed identity read returned HTTP200 with exact app429028933633/client1443cf6d03d39edae7c101a943c5c684, shop105501393179/domaininsignia-rewrite-dev.myshopify.com, installation1054356963611, partnerDevelopment true, Basic App Development, and actual handles write_products/read_products. Current capability and identity passed.

The one reserved `productCreate` requested only DRAFT/title/handle/tag for marker **`insignia-m5-009-439c9699-af2f-4e8a-b0f1-89003b88a2d4`**. HTTP200 returned product=null, userErrors=[], and a GraphQL ACCESS_DENIED at `[productCreate, product, unpublishedPublications]`. The unchanged operator classified create settlement UNKNOWN and stopped with graphql_contract. It made its one permitted exact-marker recovery lookup; HTTP200 returned data=null and ACCESS_DENIED at `[products, nodes, 0, unpublishedPublications]`. No usable Product ID, ownership or publication prestate could be retained. A product may have been created despite the response-field denial; null product is not proof of rollback. The lookup path through nodes0 is not a usable identity or verified fixture receipt.

Actual [sanitized register](evidence/m5-009/live/register.json) and [qualification](evidence/m5-009/live/qualification.json) retain both safe error codes/paths and selected response bodies. Original provider messages were replaced by `<redacted provider message>` by the retained sanitizer; their exact wording and any explicitly named missing scope are unavailable. responseDigest binds the original complete bounded body, not the rewritten JSON. No additional call was made to recover discarded messages.

| Live criterion | Result |
| --- | --- |
| Current exact identity / write_products | PASS |
| New DRAFT create settlement / returned fixture ID | UNKNOWN; one attempt |
| Exact-marker lookup / ownership / unpublished state | UNRESOLVED; one lookup, permission denied |
| DRAFT / ACTIVE / UNLISTED / ARCHIVED status matrix | NOT_RUN |
| Hold persistence/reload / catalog / observed drift | NOT_RUN live; retained synthetic tests pass |
| Final ARCHIVED/unpublished receipt | NOT_ESTABLISHED; ambiguity prohibits finalization |
| Status writes / publication writes / deletion | 0 /0 /0 |

**Final budget:** auth1/3, reads2/96 (identity + one recovery lookup), create1/1, updates0/16. Four outbound attempts total, serial; no retry or alternate document/credential. Finalization reserves were unused. The process exited0 because the entrypoint serializes a stopped outcome; this is not qualification success. operator.lock is absent, no request remains in flight. [Closed stop receipt](evidence/m5-009/live/closed-receipt.json) binds the canonical register without rewriting it; unused allowances do not resume this run. No fixture was archived/deleted, and no manual compensation was attempted. The last requested state was unpublished DRAFT; actual final remote state is unknown.

### Local captured-response replay and next principal decision

The added public `qualifySynthetic` regression replays the three actual sanitized Admin response events through the real successor operator/qualification workflow, with synthetic auth only. It verifies exact documents/variable shapes, one create, one lookup, UNKNOWN settlement, no matrix/status/finalization, and released lock. Full retained33 + successor12 = **45/45 PASS**. This is off-store replay, not additional live evidence. Production adapters/documents/matrix remain unchanged; test/evidence changes after the frozen live head close the live gate.

The supported interpretation is **publication-field read access is missing despite product capability**. Shopify's [current access-scope table](https://shopify.dev/docs/api/usage/access-scopes) assigns publication fields to read_publications; its [product-query example](https://shopify.dev/docs/api/admin-graphql/latest/queries/product) additionally names read_product_listings for publication information. These are public contract references, not proof that either/both grants alone would cure this exact request. Neither is present in the actual two-handle response. The preserved error establishes the denied field, not a complete sufficient permission set.

The smallest next decision is principal review of a narrowly scoped publication-read prerequisite and an identity-preserving read-only resolution of this marker's possibly created fixture, followed by separately bounded qualification if appropriate. This slice authorizes no scope/config/grant repair or more live requests; none was attempted. Do not drop publication guards or resend create to bypass the failure.

## Evidence limits

Even a full matrix result establishes only tested unpublished-fixture status/schema/ownership/restoration behavior. Withdrawal of an already-published product, nonempty publication histories, all-channel propagation, in-flight drainage, native status CAS, genuine RELEASE_BOUND and production recovery remain unproved. M5/G6/G7 remain incomplete. Stop for principal review; no successor merge, production activation, M6/M7 or launch.
