# M5-009 — current-capability real-Shopify availability qualification

## Outcome

Complete the real Shopify availability-adapter qualification that M5-004 could not start because access was absent.

Use one new unpublished disposable product and the unchanged production availability/catalog adapters to qualify:

1. original DRAFT;
2. original ACTIVE;
3. original UNLISTED;
4. original ARCHIVED;
5. known observed drift conflict.

Finalize an owned, settled fixture as ARCHIVED and unpublished.

This is M5 qualification evidence only. It is not production activation, RELEASE_BOUND, M6/M7 or launch.

## Baseline and authority

Owner forwarding requires the verified NORMAL merge of PR #38 exactly at:

- base `d3adffdd7ea6c538016ac3569d1f17e81259aa89`
- head `8dbe18ccc7f5c465384d7f34df92822b85c743a7`
- tree `a88f092e62f9fabceb0c35e8a468383897ad9b9c`

Verify the resulting merge's ordered parents and tree before beginning M5-009.

Use actual GPT-6.1-sol/high. Read:
- root AGENTS;
- architecture ledger and operating model;
- M5-003/R/R2;
- M5-004 through M5-008S reports;
- PR-038 principal approval;
- implementation-plan publication/activation sections;
- pinned writing-for-agents, tdd/tests/mocking, diagnosing-bugs, code-review and handoff skills.

No new skill/framework installation.

## 1. Fresh successor qualification harness

The old M5-004 canonical run is CLOSED and immutable.

Do not reopen, reset, replace or write beneath:
`/home/serveradmin/insignia-m5-004-handoff/run`

Create a fresh canonical live run:
`/home/serveradmin/insignia-m5-009-handoff/run`

The new run must have its own initialization sentinel, register, lock, source/build binding and review/CI receipts.

Reuse the accepted M5-004 qualification semantics and the current production availability/catalog adapters. Do not reimplement product state behavior.

### Required grant-policy correction

M5-004 required an exact historical nine-handle grant set. That is obsolete for this qualification.

The new identity gate must:
- preserve exact app/client/shop/domain/installation/partnerDevelopment checks;
- validate the returned access-scope shape safely;
- require `write_products` to be present;
- permit additional valid granted scopes;
- record the actual sanitized handle set;
- not require the obsolete nine-handle set.

`read_products` may be present because Shopify grants it with `write_products`; do not require it as a separately requested capability.

### Implementation shape

Keep this correction in experiment/test tooling only.

Prefer a minimal successor/refactor that reuses M5-004 harness behavior rather than duplicating product/adaptor logic. A new M5-009 entrypoint/profile is expected so the old live directory/register can never be mistaken for the new run.

Whatever implementation is chosen, prove by tests/source comparison that the only intentional live-contract differences from M5-004 are:
1. fresh M5-009 run identity/directory/binding; and
2. capability-based `write_products` grant gate.

Request documents, product ownership rules, publication checks, response bounds, mutation settlement rules, no-retry behavior, budgets and adapter imports remain materially unchanged.

Use TDD for this harness correction.

## 2. Offline freeze before credentials

Before any credential read or Shopify request:

- build current production packages used by the harness;
- validate Admin GraphQL documents against API `2026-07`;
- run all focused M5-009/M5-004 regression tests;
- run applicable root checks;
- run both fresh full-source GPT-6.1-sol/high Spec and Standards/security safety reviews;
- obtain all applicable exact-source CI successfully;
- freeze source commit, tree, operator files, production adapter build hashes and review/CI receipts in the run binding.

A source change after freeze closes the live gate. Do not patch and continue live.

Historical M5-004 source/register evidence stays preserved.

## 3. Fixed target and request ceilings

Reverify live identity before product creation:

- App `gid://shopify/App/429028933633`
- Client `1443cf6d03d39edae7c101a943c5c684`
- Store `insignia-rewrite-dev.myshopify.com`
- Shop `gid://shopify/Shop/105501393179`
- Installation `gid://shopify/AppInstallation/1054356963611`
- partnerDevelopment = true
- granted scopes contain `write_products`

Use only the existing protected credential route already reviewed for this app/store.

Whole-slice maximums:

| Operation | Ceiling |
|---|---:|
| client-credentials exchanges | 3 |
| Admin GraphQL reads | 96 |
| productCreate attempts | 1 |
| productUpdate status-only attempts on returned fixture | 16 |
| publication mutations | 0 |
| metafield/policy/key/Function mutations | 0 |
| inventory/variant/price mutations | 0 |
| billing/cart/checkout/order/refund operations | 0 |
| app config/version/scope/preview operations | 0 |
| product deletion | 0 |

Reserve 12 reads and 3 updates for safe finalization/stop handling exactly as in M5-004.

Every outbound attempt consumes its reservation. No blind retries or parallel provider calls.

## 4. Disposable fixture

Create exactly one new product:
- status DRAFT;
- unique run-bound `insignia-m5-009-...` title, handle and tag;
- no media;
- no collections;
- no inventory seeding;
- no extra variants;
- no publication operation.

Use the returned Product ID only. Never reuse an older fixture by title.

Verify exact ownership identity and that the product is unpublished before the first matrix case and after every completed case.

A lost create response may use only the same bounded exact-marker lookup semantics retained from M5-004. Never resend create.

If ownership/publication is ambiguous, stop mutation work.

## 5. Execute unchanged matrix serially

Use the current production availability adapter and catalog reader/transport, not hand-written substitutes.

### DRAFT
Snapshot -> acquire -> persist/reload hold in fresh process -> observe -> restore.
Expect no adapter status mutation.

### ACTIVE
Stage ACTIVE while unpublished, then:
snapshot -> acquire DRAFT -> persist/reload -> observe -> restore ACTIVE -> exact readback.

### UNLISTED
Stage UNLISTED while unpublished and run the same cycle restoring UNLISTED.
Inspect the narrowly bounded catalog detail and exact-handle list behavior.

### ARCHIVED
Stage ARCHIVED and run the same cycle restoring ARCHIVED.

### Known observed drift
Stage ACTIVE, acquire DRAFT, then make one separately acknowledged status-only update to ARCHIVED on the same fixture.
Observe/restore must report conflict and must not overwrite the known drift.

This is an observed-drift control, not a concurrent CAS proof.

Do not repeat a successful case for screenshots. Provider rejection or unsupported behavior is evidence and stops the affected branch rather than authorizing workaround.

## 6. Failure and finalization

On schema, identity, permission, ownership, publication, normalization or restoration mismatch:
- persist the actual sanitized provider observation;
- stop the affected live mutation sequence;
- build a local replay from captured evidence;
- do not modify production code or expectations during the live run.

If every relevant write is settled and ownership is known, finalize the fixture as:
- ARCHIVED;
- still unpublished.

Use a reserved status-only update only if required.

Verify and retain Product ID and run marker. Do not delete the product.

If any write settlement or ownership is UNKNOWN, leave the last observed unpublished fixture alone and report it. Cleanup authority never overrides ambiguity.

## 7. Required evidence

Return one integrated qualification PR containing:
- PR #38 merge receipt;
- exact M5-009 source/build binding;
- offline test/review/CI safety gate;
- auth/identity/current-grant observation;
- request budget accounting;
- fixture ownership/prestate;
- complete case matrix;
- captured provider state vs normalized adapter decisions;
- persisted-hold reload evidence;
- restoration outcomes;
- drift-conflict outcome;
- final ARCHIVED/unpublished fixture receipt or precise unresolved final state;
- minimal sanitized response evidence only;
- fresh completed-change GPT-6.1-sol/high Spec and Standards/security reviews;
- all applicable final-head CI.

Do not import raw credentials, bearer tokens, auth bodies, browser/session traces or unrelated merchant data.

## 8. Evidence limits and stop

Even a complete pass establishes only the tested unpublished-fixture status/schema/ownership/restoration contract.

It does NOT establish:
- withdrawal of an already-published product;
- preservation of arbitrary nonempty publication histories;
- all-channel propagation;
- in-flight checkout drainage;
- native product CAS;
- production RELEASE_BOUND identity;
- production recovery authority;
- complete G6/G7/M5 acceptance.

Stop for principal review.

No successor merge, production activation, M6/M7 or launch.
