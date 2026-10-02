# M5-009 — current-capability availability qualification

## Authority and baseline

[PR-038R external approval](PR-038R-principal-review.md) supersedes the earlier CHANGES_REQUESTED verdict only at approved PR #38 head/tree. The owner authorized its normal merge and this [fresh qualification](prompts/M5-009-AVAILABILITY-QUALIFICATION.md). Actual merge `9ce56a1a9b8f674a3500f6592803f7a52e2ef18d` has ordered parents `d3adffdd7ea6c538016ac3569d1f17e81259aa89`, `8dbe18ccc7f5c465384d7f34df92822b85c743a7`, tree `a88f092e62f9fabceb0c35e8a468383897ad9b9c`. Ten exact-head checks passed attempt1 immediately before merge. No reviewed-head commit, native approval or bypass. [Receipts](evidence/m5-009/pr38-merge.json).

## Successor harness and offline gate

A fixed `m5-009` profile reuses M5-004's operator, qualification matrix and binding verifier; the old default profile keeps its exact-nine-grant behavior. The successor fixes only canonical directory/run marker/source binding and identity capability policy. It requires exact designated app/client/shop/domain/installation/development identity, a bounded unique well-formed accessScopes array and current write_products; it permits and records additional valid grants. It does not separately request read_products. The unchanged production availability adapter still checks its existing returned read/write product handles; an incompatible provider response stops rather than changing that adapter.

New run: `/home/serveradmin/insignia-m5-009-handoff/run`. Closed M5-004 live history is read for preservation hashes only, never reopened/reset/written. Source/build gate includes shared and successor tooling, complete production source/build dependencies, root manifests and workflows. Before credentials it requires a clean exact committed source, successful offline receipt, two fresh actual GPT-6.1-sol/high restricted full-source safety reports with settings, and all ten exact-source green workflows. Any source/build change closes the gate.

TDD red: write_products-only identity failed with retained_grants against the old guard. Green: successor accepts it and extra valid grants; malformed/duplicate/absent scope and every wrong identity fail. Full synthetic workflow uses real production availability/catalog adapters, fresh-process hold reload and external fake HTTP/credentials only. Both minimal current product-grant and additional-grant cases finish the five-case matrix with 1 auth/62 reads/1 create/12 status updates, no parallel dispatch, no lost-response retry. Legacy 33 tests remain intact. Shared matrix, response/ownership/settlement helpers and request documents are compared to the approved merge. Negative identity/capability/lost-ack controls retain stop/finalization rules.

[API2026-07 documented contract checks](evidence/m5-009/schema-contract.json) reuse unchanged documents against eight public versioned reference pages: hashes still match the original M5-004 contract. This is a selected documented-field/input/enum validation, not full SDL/introspection/MCP validation. Public Markdown U+200B word-breaks were stripped for identifier lookup after the initial literal check failed. No authenticated schema request.

[Offline results](evidence/m5-009/offline-results.json): focused44/44 (legacy33 + successor11), root PASS, stress100/100 without retries and expected missing-renderer rejection PASS. Root passed before the final extra gate-probe test; focused44 and final style include that addition. The natural exact-source foundation workflow must independently qualify the complete committed source. Initial test/style failures and synthetic-fixture correction are retained, not hidden. Live qualification remains NOT_RUN until both safety reviews and all exact-source CI pass; no credential access before that gate. Reviewer/session and final-head refs belong in the PR packet to avoid self-referential commits.

## Live limits and finalization contract

One sole serialized operator; auth3/read96/create1/status-update16 maximum, with final12 reads/3 updates reserved. The same fixed request documents, response bounds, no-retry transport, exact ownership and complete-empty-publication guards apply. Only returned new run-owned fixture is eligible. No publication, deletion, extra variants, inventory/price or policy/Function operation. Unknown write settlement/ownership stops mutations and leaves the last observed fixture; settled owned finalization is ARCHIVED and unpublished.

## Evidence limits

Even a full matrix result establishes only tested unpublished-fixture status/schema/ownership/restoration behavior. Withdrawal of an already-published product, nonempty publication histories, all-channel propagation, in-flight drainage, native status CAS, genuine RELEASE_BOUND and production recovery remain unproved. M5/G6/G7 remain incomplete. Stop for principal review; no successor merge, production activation, M6/M7 or launch.
