# PR #40 — external principal review

**Verdict: APPROVED for normal merge at the stopped M5-010 qualification scope.**

## Exact binding
- Base/effective: `25e6c487741e1685637d351137d9671033f3c53d`
- Head: `ca250edb776e6c5b4567334c1fb4f2c750ddcc5a`
- Tree: `8b9d8389f48c0a8c12a6c56880abe994573af5c6`
- Final workflows: 10/10 SUCCESS, all attempt 1
- Native reviews: none

M5-010's experiment tooling, predecessor recovery, source gate and evidence are accepted. The M5-009 predecessor was archived and verified unpublished.

Fresh fixture:
- `gid://shopify/Product/10490211467547`
- marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`
- created `2026-10-02T21:19:48Z`

DRAFT creation and DRAFT adapter case passed. The sole status-only setup to ACTIVE was acknowledged; response plus two readbacks showed ACTIVE with publication `gid://shopify/Publication/339456917787`, `isPublished=true`, publishDate `2026-10-02T21:19:52Z`, while `publishedAt` and `onlineStoreUrl` remained null. The unchanged publication-membership guard correctly stopped all later writes. No publication mutation/retry/cleanup followed.

Do not weaken that guard.

This does not yet invalidate the DRAFT hold architecture. Shopify distinguishes legacy `resourcePublications` from `resourcePublicationsV2`, which can expose staged publication state. Shopify staff has specifically explained that standard publication fields can appear empty for DRAFT products while V2 exposes publications configured to become effective when ACTIVE.

The production availability adapter currently uses legacy `resourcePublications(first:250, onlyPublished:false)` plus `unpublishedPublications`. M5-010's DRAFT reads did not expose publication `339456917787`; ACTIVE did. The implementation plan already required sufficient visibility metadata to detect drift.

M5-011 must empirically adjudicate legacy vs V2 state on this exact fixture before any production correction.

Approval does not authorize matrix continuation, restore-to-ACTIVE, production adapter changes, publication mutation, M6/M7, RELEASE_BOUND, gate acceptance or launch.
