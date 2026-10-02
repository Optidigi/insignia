# PR #37 — external principal review

**Verdict: APPROVED for merge at the stopped M5-008R documentation/evidence scope.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #37
- Base / effective merge base: `adecff04a3ff5b5d72665cbb404265477d6eb748`
- Approved head: `77d01a5cfe828c723f37d7ab45e245d01e44d5bd`
- Approved tree: `f11ba18504ccf44c29c0319aa3f1afc8ed91103e`
- State at review: open, unmerged, documentary/evidence candidate
- Final-head workflows: 10/10 completed/success, attempt 1
- Native GitHub reviews: none

## Accepted stopped result

The authenticated exact-app Overview displayed install/uninstall event charts but no current Installs count/list. The operator correctly refused to treat event counts as installation inventory and stopped before opening/editing the version form.

No version creation, release, credential access, Admin API request, grant change, product mutation, preview operation, or M5-004 case occurred. `insignia-1` remained active.

The missing current-Installs control is accepted as an observed UI limitation, not evidence of zero other installations or a permission defect.

## Principal disposition

The current-installation inventory prerequisite is retired for the next development-access attempt.

Shopify's access-scope model provides a safer store-local route:

1. Release a new version that changes only `optional_scopes` from empty to `write_products`, while required scopes remain empty.
2. This declaration alone does not change granted scopes on existing installations.
3. Request the optional scope only on the exact designated development store.
4. Verify the resulting grant with one bounded client-credentials exchange and one fixed Admin scope read.

This removes the need to know every installation before the release, because other installations are not granted or prompted for the optional scope merely by declaring it.

The final production scope catalog remains a separate product/release decision. This is only a development qualification mechanism.

PR #37 approval does not authorize M5-004 product mutation, M6/M7, RELEASE_BOUND, gate acceptance, or launch.
