# M5-008R — combined release and grant-verification checkpoint

## Result

**BLOCKED before form editing or release: current installation inventory is not exposed in the inspected authenticated exact-app Overview.** PR #36 was normally merged at its approved refs. The new branch starts from that verified merge. The principal has accepted Shopify's combined create+release workflow, but its installation-impact prerequisite remains unproved.

The existing shared T3 browser is connected and authenticated. The actual Overview for app `429028933633`, Dev organization `200969036`, displays Insignia/Optidigi and Growth **Install events** (1) / **Uninstall events** (0) over seven days. Its rendered header, complete visible text, interactive controls and focused aside/label inspection expose no **Installs** current count or **Current installs** control. The aside displays Distribution only. Neither a current count nor a store list was obtained. Those event numbers were not substituted for inventory.

No current store row was inspected, so current count, sole designated-store identity and absence of other installed stores are **UNKNOWN**, not inferred from historical app/store authentication. No alternate Dashboard route, internal API or merchant-store investigation was attempted. The narrow diagnostic also observed an import-map parse error in the browser console; its relationship to the missing controls is **unknown**, not an established explanation or permission error. Raw console/network/session output is not exported.

The installation gate stopped the dependent branch. No create form was opened or edited in this slice. A final read-only Versions view still shows the sole displayed `insignia-1 — Active`, public detail path ending `1146748534785`. No version/release/grant change occurred. The required `write_products` capability was **not restored or freshly verified**.

## Authority and exact merge

[PR-036 external principal approval](PR-036-principal-review.md) is attributed external approval, not a native GitHub review. Immediately before normal merge, live target `main`, base/effective merge base `34c78b56df98cc049adca842653ad6f9ae23b2a8`, head `9e2d9ebe68d51c2ad346dafdfad78e2cca29dae3` and tree `976c08996fe61d56cdce86f4f60427fabd66d799` matched. The worktree was clean; all ten exact-head workflows were completed/success on attempt 1; GitHub reported MERGEABLE/CLEAN.

Executed `gh pr merge 36 --repo Optidigi/insignia --merge --match-head-commit 9e2d9ebe68d51c2ad346dafdfad78e2cca29dae3`. No approval commit, squash/rebase, force push, native approval or protection bypass.

Actual remote merge **`adecff04a3ff5b5d72665cbb404265477d6eb748`**, ordered parents:

1. `34c78b56df98cc049adca842653ad6f9ae23b2a8`
2. `9e2d9ebe68d51c2ad346dafdfad78e2cca29dae3`

Tree **`976c08996fe61d56cdce86f4f60427fabd66d799`** matches approval. GitHub commit readback and fetched remote main agree. `feat/m5-008r-combined-release` was created from that exact merge in a new worktree. [Premerge receipt](evidence/m5-008r/pr36-premerge.json), [merge receipt](evidence/m5-008r/pr36-merge.json).

The [M5-008R brief](prompts/M5-008R-COMBINED-RELEASE-AND-GRANT-VERIFICATION.md) permits the conditional combined release with `write_products` only, followed by one exchange and one identity/scope read. It does not permit release when current count/list is missing. [Package and runtime provenance](evidence/m5-008r/authority.json): supplied manifest 6/6 PASS; root/integrator and sole remote operator actual GPT-6.1-sol/high. Repository-pinned writing-for-agents, diagnosing-bugs, code-review and handoff are applied; no behavior correction or new harness was needed.

## Evidence and accounting

[Selected public UI observations](evidence/m5-008r/ui-observations.json) retain rendered text, narrowly selected controls, focused public DOM facts and final Versions evidence. Observation timestamps identify capture time, not provider event time. No screenshot, browser storage, hidden authentication field, intercepted request, session or contact detail is retained.

| Required stage | Actual result |
| --- | --- |
| Existing shared authenticated exact-app browser | PASS; exact Dashboard app/organization route and displayed Insignia/Optidigi |
| Current Installs = 1 and sole designated dev-store row | BLOCKED / UNKNOWN; no current count/list control exposed |
| Combined create+release contract | Established by supplied principal direction and public documentation; not executed |
| Fresh create-page prestate and extension inheritance | NOT_RUN after gate failure; prior M5-008 evidence remains historical |
| Form edit / confirmation / final Release | NOT_RUN; no new version |
| Structural new-version verification / rollback | NOT_RUN; final prior active version retained |
| Credential exchange / fixed Admin identity-scopes query | NOT_RUN; no credential file read or stat |
| Current write_products grant | NOT_VERIFIED |

[Closed register](evidence/m5-008r/register.json): all reservations **0** — new versions 0/1, releases 0/1, structural rollback 0/1, client-credentials exchanges 0/1, fixed Admin reads 0/1. No pending work, retry or automatic continuation. No Shopify CLI, scripted Admin/Partner/App Events call, product mutation, scope repair, preview operation or cleanup. Ordinary native browser navigation has background traffic; this is not a zero-network claim.

The prior active version was left intact; no run-owned remote resource exists to clean up. [Preservation receipt](evidence/m5-008r/preservation.json) checks 23 earlier retained references unchanged and hashes five retained M5-008 final artifacts without modifying them. Architecture v1.4, production source, operative TOML, dependencies, SQL, tests and CI are unchanged. Historical nine grants are retained context, not a freshly measured grant set. Old fixtures, billing resources and preview states were not operated on. The global CLI installation remains untouched, unused and unresolved.

## One proposed next decision

**Principal/owner disposition of the unavailable current-installation inventory evidence.** Establish whether the exact app's current Installs card/list is available in the owner's Dashboard session, and provide a sanitized current-count/list record identifying only the designated development store, or authorize a specifically supported replacement evidence route. This report does not authorize that replacement or further remote work. Do not substitute event charts, assume a store list, or infer an access/registration repair requirement from the absent control.

## Verification and handoff

The [research notes](M5-008R-RESEARCH-NOTES.md) distinguish public contracts from actual session observations. Focused documentation, JSON, new-link, manifest, historical-hash, sensitive-data and Git-scope checks plus fresh scoped GPT-6.1-sol/high Spec/correctness and Standards/security reports are returned in the PR packet. Exact candidate refs and automatic final-head CI belong in that packet after commit. No unchanged root/PostgreSQL/stress/benchmark suite is manually repeated solely for this docs/evidence checkpoint; automatic CI remains required.

Return this single docs/evidence PR and stop for principal review. Public-merchant auth, production readiness and RELEASE_BOUND remain unchanged. No M5-004 product case, activation, M6/M7, complete gate or launch is established.
