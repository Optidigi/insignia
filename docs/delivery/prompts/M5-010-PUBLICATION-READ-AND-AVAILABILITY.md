# M5-010 — publication-read restoration, predecessor resolution, and fresh availability qualification

## Outcome
Restore only the publication-read capability required by the existing qualification, resolve the possibly-created M5-009 predecessor without resending create, then conditionally run one fresh disposable-product matrix.

## Baseline
Owner forwarding requires normal merge of PR #39 exactly at base `9ce56a1a9b8f674a3500f6592803f7a52e2ef18d`, head `0bc88f130b7f37b0a544846ba2c09a37f8d66c27`, tree `9878c2b1f5c06292aa750a2dc41183b939a48da9`. Verify actual merge parents/tree. Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, TDD/tests/mocking, diagnosing-bugs, code-review and handoff. Historical M5-004 and M5-009 registers stay closed and immutable.

## 1. Fresh profile
Use `/home/serveradmin/insignia-m5-010-handoff/run`. Extend experiment profile machinery minimally for `m5-010`. Preserve exact app/client/shop/domain/installation/partnerDevelopment checks. Require current `write_products`, `read_publications`, and `read_product_listings`; permit/record other well-formed grants. Keep legacy M5-004 and M5-009 profile behavior covered. Keep production availability/catalog adapters and shared matrix unchanged.

## 2. Predecessor resolution
Fixed predecessor marker: `insignia-m5-009-439c9699-af2f-4e8a-b0f1-89003b88a2d4`; original run start `2026-10-02T19:57:53.469Z`. Before a fresh create, perform one exact-marker lookup with the complete retained ownership + publication fields.

Branch A: zero nodes, complete connection, no GraphQL errors => record absence and continue.

Branch B: exactly one product satisfying the original ownership predicate (exact handle/title/tag, valid Product GID, createdAt in the original ownership window) and complete unpublished state (`publishedAt=null`, `onlineStoreUrl=null`, zero resource-publication membership, complete publication connections) => if not ARCHIVED, perform exactly one status-only update to ARCHIVED and exact readback; verify still owned/unpublished. Do not delete.

Branch C: ambiguity, multiple nodes, partial connection, publication membership, metadata mismatch, unsupported state, permission/GraphQL error, or unknown settlement => STOP before predecessor mutation/new create.

## 3. Offline freeze
Before credential access: TDD the M5-010 profile/recovery logic; validate 2026-07 documents and scope contract; run focused M5-004/M5-009/M5-010 regressions, root/style, 100/100 no-retry stress and renderer control; run two fresh full-source GPT-6.1-sol/high safety reviews; require applicable exact-source CI green; freeze commit/tree/operator/build/review/CI hashes. Any tracked source/build change after freeze closes the live product gate.

## 4. Add publication-read optional scopes
Using the exact-app Dev Dashboard, release one version whose only configuration change is adding `read_publications` and `read_product_listings` to optional scopes. Required scopes remain empty; existing optional `write_products` remains. Resulting optional set: `write_products`, `read_publications`, `read_product_listings`. Change nothing else. Use the native combined create+release route. No second version/retry.

## 5. Grant only the two new optional scopes
On existing authenticated `insignia-rewrite-dev`, request exactly `read_publications,read_product_listings` via Shopify's documented optional-scope route for the fixed client. Approve once only if exact app/store and only those two new read permissions are shown. Stop on any extra permission, account/store/app mismatch, undeclared-scope or consent ambiguity.

## 6. Provider ceilings
Use only the protected existing credential route. Max: auth exchanges 3; Admin reads 96; fresh productCreate 1; M5-010 matrix/finalization status updates 16; predecessor archival status update 1; publication mutations 0; deletion 0; variant/inventory/price mutations 0; post-grant scope/config/version/preview operations 0; billing/cart/checkout/order/refund operations 0. Every outbound attempt consumes reservation; no parallel calls or blind retry. First authenticated sequence: exact identity/grants -> require all three capabilities -> predecessor resolution.

## 7. Fresh fixture and matrix
Only after predecessor branch A or successful branch-B cleanup: create exactly one DRAFT product with unique `insignia-m5-010-...` title/handle/tag, no media/collection/inventory seeding/extra variants/publication operation. Use returned ID only and verify complete ownership/unpublished state. Then run unchanged production-adapter matrix serially: DRAFT, ACTIVE, UNLISTED, ARCHIVED, known observed drift. Persist/reload holds, exact readbacks, no publication mutations. Drift must conflict without overwrite. Provider rejection is evidence, not authority to work around it.

## 8. Finalization
If all writes are settled and ownership known, finalize only the new M5-010 fixture ARCHIVED and fully unpublished, using reserved status update only if needed. Never delete either product. Unknown settlement/ownership/publication state => leave last observed safe state and stop.

## 9. Handback
Return one integrated PR with PR39 merge receipt, source/build/review/CI freeze, optional-scope version/grant receipts, granted scope observation, predecessor resolution/cleanup, fresh fixture and matrix evidence, budgets, final state, fresh completed-change reviews and final CI. No raw bearer/credentials/auth bodies/browser storage. Stop for principal review. No successor merge, M6/M7, activation or launch.
