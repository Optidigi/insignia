# M5-010 publication-read and availability qualification

## Outcome

**STOPPED — publication membership after status-only ACTIVE setup.** Scope restoration and predecessor cleanup succeeded. The fresh DRAFT case passed; remaining cases and final archival are blocked by the unchanged unpublished guard. PR: <https://github.com/Optidigi/insignia/pull/40>. Final refs, completed-change reviews and CI are supplied in its review comment after committing.

## Authority and merge

The owner authorized only the normal PR #39 merge and [M5-010](prompts/M5-010-PUBLICATION-READ-AND-AVAILABILITY.md). [External principal approval](PR-039-principal-review.md) is attributed and is not a native GitHub review. The approved PR head was preserved.

Verified merge `25e6c487741e1685637d351137d9671033f3c53d` has ordered parents `9ce56a1a9b8f674a3500f6592803f7a52e2ef18d`, `0bc88f130b7f37b0a544846ba2c09a37f8d66c27` and reviewed tree `9878c2b1f5c06292aa750a2dc41183b939a48da9`. Ten approved-head workflows succeeded on attempt 1 before merge. The new branch begins at the verified remote merge.

## Offline qualification and frozen source

Fresh canonical profile: `/home/serveradmin/insignia-m5-010-handoff/run`. Closed M5-004 and M5-009 registers are preserved. Production availability/catalog adapters and their publication fields are preserved.

The new experiment requires three current capabilities (`write_products`, `read_publications`, `read_product_listings`) with fixed app/shop/install/development identity. It must resolve the fixed M5-009 predecessor before any fresh create: complete absence, or exactly one owned fully unpublished product verified ARCHIVED after at most one status-only archival update. Errors, partial connections, ownership/publication ambiguity and unknown settlement stop creation.

Separate durable native reservations cover one release, one two-scope request and one approval. Provider ceilings remain auth3/read96/create1/update16 plus predecessorArchive1. Final status/read reservations are retained.

Live source was frozen at `d0544cd8f2e72b5bb79410057121cd455db92f1a`, tree `05d58d32f8dd0d2e7ae7fd8c7412642546c3e946`, binding digest `67e70b24e47afd5cbeba3cdc87ef0e4f4f216c8bbe8d69baf58fbbd254b9b9f0`. [Gate](evidence/m5-010/live/gate.json) binds source/build outputs, offline checks, two restricted full-source safety reviews and ten exact-source attempt-1 passing workflows. The clean binding was checked before each native action and the sole provider entry. Later evidence delivery does not change that provenance; the live gate is now closed.

Pinned Node24.21.0/pnpm12.6.0: frozen install/build passed; normal focused runner **136/136**; root `corepack pnpm check` and style exit0; stress **100/100**, 25 per combination, zero retries; renderer control passed its expected missing-renderer failure. Local DB-gated tests skipped; both real PostgreSQL18 workflows passed on frozen exact source. Root began against identical source bytes before the commit and finished on the committed head. [Offline results](evidence/m5-010/offline-result.json) retain provenance and original failed-log hashes; [focused output](evidence/m5-010/local/focused-final.log) and red evidence are exported.

Actual GPT-6.1-sol/high was used by the root, separate restricted writer and independent reviewers. The writer's sandbox child pipes required temporary file-backed real subprocess capture; the integrator independently ran the normal runner. Fresh full-source safety [Spec](evidence/m5-010/safety-spec-result.md) and [Standards/security](evidence/m5-010/safety-security-result.md) reviews found no material issue; same-launch model/effort/read-only settings are retained. Reviewers inspected test evidence rather than claiming execution. Completed-change reviews are returned separately with the final PR.

## Native version and current grants

Existing shared-browser access verified Optidigi/app429028933633/dev organization200969036. Active `insignia-2` (`1152880803841`) had optional write_products. Its native prefilled form had empty required scopes. Exactly one field changed to optional `write_products,read_publications,read_product_listings`. Every other named public input matched pre/post edit and post-release reconstruction.

One combined create/release produced active **insignia-3, ID1153019904001**. Provider-generated name; retained app name Insignia, app URL https://example.com, embedded=true, legacy installation=false, API2026-07, blank redirects/preferences/proxy and POS=false. No extension modules were displayed before/after; this is a rendered-configuration observation, not an extension-manifest attestation. Narrow [prestate](evidence/m5-010/native-release-prestate.json) and [result](evidence/m5-010/native-release-result.json) are retained.

The fixed native optional-scope route requested only read_publications/read_product_listings on insignia-rewrite-dev. Approval showed Insignia and only read access to product listings/collections and publications. Update clicked once. [Approval receipt](evidence/m5-010/native-grant-result.json) distinguishes native return navigation from actual grant readback.

The fixed Admin query verified app `gid://shopify/App/429028933633`, client `1443cf6d03d39edae7c101a943c5c684`, shop `gid://shopify/Shop/105501393179`, domain insignia-rewrite-dev.myshopify.com, partnerDevelopment=true and installation `gid://shopify/AppInstallation/1054356963611`. Current handles: read_publications, read_product_listings, write_products, read_products. The last handle was observed, not newly requested.

Only the sole operator read the protected existing credential route after the complete gate. Private ownership checks passed (uid1000/mode600); secrets stayed in memory. No credential/auth response body or browser storage is exported.

## Live and final state

The fixed predecessor lookup returned exactly one original owned product `gid://shopify/Product/10490128138523`, marker `insignia-m5-009-439c9699-af2f-4e8a-b0f1-89003b88a2d4`, created `2026-10-02T19:58:01Z`. Both publication connections complete; resourcePublications empty, publishedAt/onlineStoreUrl null. One archival update acknowledged; exact readback verified **ARCHIVED and unpublished** before fresh creation. This new M5-010 recovery evidence does not alter closed M5-009 history or resend its create.

Fresh product `gid://shopify/Product/10490211467547`, marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`: one acknowledged DRAFT create, owned/unpublished readback. The unchanged production hold adapter completed DRAFT acquire/observe/restore with zero adapter mutations. Persisted/reloaded hold digest: `2532005934c65a3f8619c4be779f7dec50f8f1ead8bdb33652f435cd18b3c9b9`.

The sole fresh status update to ACTIVE began `2026-10-02T21:19:52.097Z`. Its acknowledged response and two complete readbacks show ACTIVE with resource publication `gid://shopify/Publication/339456917787`, **isPublished=true**, publishDate `2026-10-02T21:19:52Z`; publishedAt and onlineStoreUrl still null. Connections complete; no GraphQL/user errors. The request contained only product ID/status: no publication mutation was sent. This establishes the observed status-only response/readback association, not that channel's identity or a universal propagation rule.

`publication_membership` stopped the run. ACTIVE adapter/catalog qualification, UNLISTED, ARCHIVED and observed drift are **NOT_RUN**. Finalization made bounded reads but no writes because the required unpublished invariant failed. Last observed fresh state is **ACTIVE with publication membership**, not archived/unpublished. No unpublication, deletion, compensating status change, retry or alternate fixture followed.

## Budgets and closure

| Attempt kind | Actual / ceiling |
|---|---:|
| Existing-route auth | 1 / 3 |
| Admin reads | 16 / 96 |
| Fresh create | 1 / 1 |
| Fresh status update | 1 / 16 |
| Separate predecessor archival | 1 / 1 |
| Native release / scope request / approval | 1 / 1 each |
| Publication/deletion/variant/inventory/price/commerce/billing requests | 0 |

[Register](evidence/m5-010/live/register.json), [qualification](evidence/m5-010/live/qualification.json), [timeline](evidence/m5-010/event-summary.json) and [closure](evidence/m5-010/live/closed-receipt.json) retain sanitized direct observations and actual attempts. All write attempts acknowledged; no request in flight/operator lock. Native receipts closed. Both old canonical registers and 140 historical/architecture/production-source hashes match.

**Principal direction is required for publication membership and fresh-fixture disposition before cleanup or further qualification.** Keep the existing guard intact. No automatic unpublication, relaxed predicate or repeated experiment is proposed. Unused allowance grants no retry. No production activation, RELEASE_BOUND, complete M5/gate pass, M6/M7 or launch is authorized.
