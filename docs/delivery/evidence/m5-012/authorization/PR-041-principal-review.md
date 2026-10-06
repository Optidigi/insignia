# PR #41 — external principal review

**Verdict: APPROVED for normal merge at the stopped M5-011 evidence/correction scope.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #41
- Base / effective merge base: `1fffcb3048952ff762f1f9805f86aceed90f228f`
- Approved head: `9353bf9a5c13649daa55cb3693cab16532c6f6f6`
- Approved tree: `e00f2f8ce5b33321b67c6271cb13a315f34471a1`
- PR state at review: open, non-draft, unmerged, mergeable
- Current main at review: exact base above
- Native GitHub reviews: none
- Final-head workflows: 10/10 SUCCESS, all attempt 1

## Accepted empirical result

The single production ACTIVE→DRAFT acquire attempt is correctly classified **INCONCLUSIVE**.

Exact fixture:
- `gid://shopify/Product/10490211467547`
- marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`

The DRAFT mutation was acknowledged at `updatedAt=2026-10-06T13:09:51Z`. The production readback and later exact views returned DRAFT at `updatedAt=2026-10-06T13:09:52Z`.

Acknowledgement/readback visibility digests match, but provider versions differ. The production adapter therefore returned CONFLICT. That is a legitimate conservative result.

The legacy publication membership also changed across ACTIVE→DRAFT and would independently satisfy the adapter's membership-change conflict condition. The experiment therefore did not isolate one sole conflict cause.

All four captured `resourcePublicationsV2` partitions (APP, MARKET, COMPANY_LOCATION, NONE) were empty in ACTIVE and DRAFT. The prior V2-retained hypothesis is not supported by this store evidence.

Publication `gid://shopify/Publication/339456917787` is Microsoft Copilot, `autoPublish=true`, AppCatalog active. The fixture is last observed owned and DRAFT. Archive was correctly withheld under the executed settlement contract.

## updatedAt disposition

Do not add a timestamp tolerance.

Shopify documents Product.updatedAt as a broad last-modified timestamp that can change for different reasons. It is not documented as an atomic compare-and-swap token or as a guarantee that a mutation payload's timestamp must equal an immediate readback.

Therefore:
- the observed one-second change is real evidence;
- v1's exact-equality conflict remains fail-closed;
- the mismatch cannot be waived as harmless;
- a future adapter design may need a different ownership/settlement model, but that requires separate evidence and implementation review.

The offline successor timing correction in PR #41 is accepted: it fences acknowledgement/readback drift before collecting later adjudication reads. It does not change production behavior and was not run live.

## Publication-intent direction

V2 is not the only Shopify surface for channel intent.

Current Shopify product-search semantics expose channel-specific:
`published_status:<channel-or-app-id>-intended`

This means “added to the channel but not yet published.”

Publication also exposes `includedProducts`, explicitly described as products included but not necessarily published in the publication, with a searchable ProductConnection.

M5-012 will use those fixed read-only surfaces against the current DRAFT fixture and exact Microsoft Copilot publication/channel before any cleanup mutation.

PR #41 approval does not authorize production adapter changes, another hold transition, a new product, matrix continuation, M6/M7, RELEASE_BOUND, gate acceptance or launch.
