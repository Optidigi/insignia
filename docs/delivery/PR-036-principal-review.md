# PR #36 — external principal review

**Verdict: APPROVED for merge at the stopped M5-008 documentation/evidence scope.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #36
- Branch: `feat/m5-008-product-access`
- Base / effective merge base: `34c78b56df98cc049adca842653ad6f9ae23b2a8`
- Approved head: `9e2d9ebe68d51c2ad346dafdfad78e2cca29dae3`
- Approved tree: `976c08996fe61d56cdce86f4f60427fabd66d799`
- GitHub state at review: open, non-draft, unmerged, mergeable
- Native GitHub reviews: none
- Changed files: 13, documentation/evidence only
- Final-head workflows: 10/10 completed/success, all attempt 1

## Accepted stopped result

The operator correctly did not submit the native confirmation. The observed create page had `write_products` only in the unsaved required-scope field, all other public configuration unchanged, and the confirmation explicitly said `Release this new version?`. Cancel returned the app to its prior state, with `insignia-1` still active. No version, release, credential read, scripted Admin request, scope change or grant change occurred.

The seven-day install-event chart is not current installation inventory and was correctly rejected as impact evidence.

## Principal disposition of the two blockers

### Native combined create/release

Current Shopify documentation confirms this is the supported Dev Dashboard workflow: Versions -> Create a version -> Release -> optionally name/message -> Release again to confirm. A separate unreleased-save step is not part of that documented flow.

The earlier M5-008 ordered requirement to create an unreleased version before release is therefore superseded. M5-008R may use the combined native release workflow after all pre-submit checks pass.

### Installation impact

Current Shopify documentation distinguishes:
- install/uninstall **events** over a selected time range; and
- **Installs**, the current net count of stores whose installation is still on record.

Selecting the Installs count opens **Current installs**, a searchable current-install list.

M5-008R must use that current-install list. Release is authorized only when:
1. current Installs count is exactly 1; and
2. the sole current install is the already-verified designated development store `insignia-rewrite-dev`.

That store was independently established in prior evidence as the exact partner-development store for this app installation. If the count is not exactly 1, the current-install list differs, or identity is ambiguous, stop before release.

## Next slice

M5-008R corrects only the procedure and impact-evidence source. Required scope remains `write_products` only. It permits one combined version create+release after the current-install and exact-form preconditions pass, followed by one bounded auth exchange and one fixed Admin identity/scope read.

It does not authorize product mutation, M5-004 replay, preview cleanup, M6/M7, RELEASE_BOUND, gate acceptance or launch.
