# Frontend state completeness audit

28 October 2026. Five independent Luna Max audits examined the current merchant and buyer journeys, state models, actual UI callers and recovery paths. Root independently reproduced every defect selected for correction. A separate Sol reviewer verified final source, actual browser callers and corrected screenshots.

Status: the seven confirmed issues below are corrected. Independent review passes. Verification covers 706 passing checks across the complete run and the corrected export-fixture rerun, with 62 explicit environment-gated skips. The complete command's one fixture failure and its isolated repair are recorded separately below. No new page, product feature, backend integration or provider operation was introduced.

## What was missing

The important gaps were transitions and recovery within existing pages. A reducer branch existing in source, or a passing cancellation test, did not establish that normal completion and its next action worked.

| Journey | Confirmed problem | Correction |
| --- | --- | --- |
| Polished buyer artwork | Success and decode failure reused the active upload token, but a guard incorrectly demanded a newer token. Both were ignored, leaving Opening file visible. | Target validity and new-start freshness are separate; completion still requires the exact active token and target. Successful upload, bad decode and retry now have an actual phone browser regression. |
| Merchant publication and passive refresh | A current authenticated read could find a newer draft while the page retained the old version, disabled Publish and offered no useful latest-draft recovery. Further edits could also re-enable a known-stale save. | Preserve the local draft, retain the newer snapshot separately and enter the existing conflict state. Review/Reload is reachable; further local edits remain conflicted until a current CAS base is deliberately adopted. |
| Merchant conflict discard | Discard could forget a known newer draft, restore the old entry snapshot and say All changes saved at the stale version. | Explicit discard adopts a verified, editable latest snapshot. Missing, malformed or different-context data cannot erase the unresolved conflict or local draft. |
| First configuration creation | A lost create acknowledgement could leave an existing server configuration behind a repeated Create button and 409 errors. | Authenticate a fresh read after an uncertain result. Load an observed configuration; otherwise retain the exact in-memory create request/key for deliberate retry. Denial and disposal clear it. |
| Staged movement and measurement | Global Undo could cancel a staged canvas task and also undo an earlier committed product setting. | Done/Cancel owns the staged task. Undo/Redo and their shared keyboard handler are inactive during it; history resumes after completion or cancellation. |
| Retained original download | An authoritative unavailable response was presented as Try again indefinitely. | Original artwork has a terminal unavailable state, with the download action removed. It resets when purchase/asset identity changes; temporary failures remain retryable. |
| All-failed artwork ZIP | Temporary file failures and terminal unavailability had the same retry copy. With no ready file, retry required closing and reopening the modal. | Entries distinguish terminal metadata unavailability from retryable loads. A zero-file retryable result uses the existing Try again primary action. Terminal-only results avoid false retry; partial results keep one download action. |

The earlier upload checks covered cancelled and stale completion, but not successful completion. That was a real coverage gap. The new browser test failed before the fix and passes afterwards. The previous broad green run was accurate for its tests, but was not proof of state completeness.

## Cross-page conclusion

No additional standalone page was demonstrated necessary for the reviewed V1 journeys. Errors, empty results, conflicts, unknown outcomes and expired resources belong with the task that encountered them. Several needed states already existed but were not reached or rendered correctly.

| Family | Existing states and paths examined |
| --- | --- |
| Home and product entry | First use, no Shopify products, guide dismissed/completed, draft/published setup, bounded recent orders, unknown theme, plan restriction, independent loading/failure/retry, validated product selection and pagination. |
| Persisted product setup | Loading/missing/unsupported draft, local edits, CAS conflict, ambiguous save, stale/ongoing publication, authority loss, reinstall context, back-forward resume and disposal. |
| Designed merchant workspace | First view/no photo/no methods, manual colour/fit assignment, shared geometry and explicit exceptions, upload cancel/reject/retry, drawing/movement/measurement modes, staged pricing/copy, Undo/Redo, validation and publication blockers, phone/keyboard navigation. |
| Buyers | Bootstrap denial/failure, artwork and quantity selection, review, expiry, duplicate requests, cart editing/removal/renewal, product returns, history, unsupported or missing previews and stale asynchronous completion. Production authorization and the polished local cart remain separate contracts. |
| Orders and production downloads | Empty/no-result/read-failure/missing order, query scope, bulk partial results, retained historical economics, artwork replacement, lock/expiry/denial, export preparation and downloads. |
| Settings and storefront | Permission consent declined/unknown/incomplete, verified readback, theme unsupported/missing/active, picker cancellation, unpublished/deleted product, billing unknown/trial/active/inactive/pending and Shopify handoffs. |

For Insignia's current architecture, Shopify owns plan selection and approval, account identity/security, checkout, refunds and fulfillment. Their absence as custom Insignia pages is intentional. The owner-deferred customer-data Settings flow, removed automatic image matching and later example-product/first-time tutorial are not missing requirements in this audit.

## Smaller recommendations for the next UI/UX pass

These recommendations were subsequently implemented and independently reviewed in the [frontend recovery follow-up](frontend-recovery-polish-2026-10-28.md). The list below preserves this audit's original recommendation and scope boundaries.

- Preserve the product-testing task on the return from product setup. With browser storage blocked, the selected product is lost and must be picked again; even normal return lands at the page root. Carry a validated numeric testProduct preselection and #test-product anchor through a narrowly allowlisted return path. Do not infer a public handle, revive an unrelated cached product or auto-publish. This is recoverable continuity friction, not a new page requirement.
- Make existing recovery information clearer where it is currently generic. The production cart's repairRequired observation is not presented explicitly, although review/renew/removal paths exist. Unsupported stored setups fail closed, but the current admin-build wording could give a more useful next step. Neither finding justifies inventing cart repair, destructive reset or a support destination that the product does not provide.

## Independent receipts

1. [Persisted merchant editor](state-completeness-persisted-merchant-2026-10-28.md): audit, independently reproduced failures, controller corrections and five browser cases.
2. [Both buyer interfaces](state-completeness-buyers-2026-10-28.md): production versus polished contracts, successful-upload failure and the pre-fix coverage gap.
3. [Designed merchant workspace](state-completeness-polished-editor-2026-10-28.md): manual/variant photos, history, staged task finding and 17 focused browser journeys.
4. [Orders and export](state-completeness-orders-2026-10-28.md): authenticated 410 versus temporary failure, exact originals/ZIP probes and recovery corrections.
5. [Settings and cross-page flow](state-completeness-settings-crossflow-2026-10-28.md): permission/setup/billing states, hosted ownership and blocked-storage return probe.
6. [Independent final Sol review](state-completeness-final-sol-review-2026-10-28.md): standards and product-intent checks, independently run public/browser cases and inspected current captures. No material finding remains in the corrected scope.

## Verification

Root's unchanged Home/read/leave checks pass 13 model cases and two actual Home browser journeys. The final fast frontend model/controller command passes 99 checks. Both buyer and merchant strict builds pass, along with the sibling's 62 configuration checks. All 36 effective strict TypeScript projects pass; source coverage reports zero untyped or unchecked files. The formatting/lint gate passes with existing non-blocking warnings.

Independent final browser verification passes nine polished buyer checks across all 13 scenarios, a staged-task desktop/390 check, five new merchant recovery cases, four new purchase/export cases and the archive module check. An additional reviewer probe successfully rejected invalid/oversize files and then applied a PNG at desktop and 320px.

Root recorded failing and passing browser regressions for upload and staged history. The merchant implementation used failing public controller cases before correction. Root independently reproduced the merchant and Orders failures before assigning their fixes. Temporary probes were preserved outside the source tree and removed from repository source coverage.

The export classification keeps two authorities separate. An authenticated metadata API 410 establishes that artwork is unavailable. A failed signed storage URL can require a new short-lived URL; its HTTP 403/410 never becomes merchant authorization denial or proof of asset retention expiry. Metadata 408/429/5xx and transport failures remain retryable. Byte, checksum, size/budget and actual expiry verification remain enforced.

The configured Polaris 2.0 RC validator passes changed original-download and workspace sources. The archive's standalone validation initially could not infer its imported reducer state. A temporary validation fixture includes the exact existing reducer source with the unchanged component; it passes without casts or invented stubs. Actual project strict compilation and browser checks independently pass. Component validation does not validate native markup or establish visual acceptance.

Current corrected-state captures include `/tmp/insignia-final-sol-original-terminal.png`, `/tmp/insignia-final-sol-zip-transient.png`, `/tmp/insignia-final-sol-zip-terminal.png` and `/tmp/insignia-final-sol-upload-320.png`. Captures establish those local states, not native Shopify qualification.

### Combined-run fixture correction

The first combined run exercised all 707 merchant/artwork/polished-buyer checks: 646 passed, one failed and 60 skipped. All 61 production-buyer checks completed with 59 passed and two skipped. The one failure was the existing hostile-closed-signing-status test, outside the corrected UI workflows.

Root independently reproduced it on the third isolated attempt. The fixture waited for a readable PROVISIONED result, then corrupted the file while persistence and execution cleanup could still be running. PENDING was a legitimate intermediate observation. The test now establishes the closed-run precondition using its existing public `prepare` operation, which awaits completion. No backend behavior changed. Hostile JSON, mode, FIFO and the 500ms nonblocking bound are unchanged. All 17 signing-owner tests pass; Sol independently reviewed and reran the affected case. Red and green receipts: `/tmp/insignia-state-audit-signing-fixture-red.log` and `/tmp/insignia-state-audit-signing-fixture-green.log`.

### Combined-run breadcrumb fixture correction

The next combined run passed the signing test and all new workflow regressions, but two existing Orders breadcrumb tests timed out: 645 merchant/artwork/polished-buyer checks passed, two failed and 60 skipped; production buyer remained 59 passed and two skipped.

The Orders auditor reproduced the cause by delaying the pinned Polaris response by 250ms. The tests activated an attached server-rendered `s-link` before the custom element was defined, while the actual route was still hidden and inert. The host had no anchor and its programmatic click could not navigate. Waiting for the application's existing public `data-admin-ready` signal allowed the same link to navigate with its cursor trail, and Previous returned to the correct page. The two fixtures now respect that ready boundary and the link definition before activating a host action, and wait for the returned route and ready list before Previous. The page-two case retains the controlled 250ms delay. Both focused cases pass with the original deadlines and cursor/filter assertions. No application navigation or timeout changed. Diagnostic receipt: `/tmp/orders-breadcrumb-ready-probe.log`.

### Export fixture clock correction

The third full run passed all application regressions, signing and both breadcrumb cases. Its only failure was the existing large production-sheet export fixture: its many rendering/PDF cases took 48 seconds before the private-image-failure assertion, exceeding the synthetic preview lease's 40-second lifetime. The renderer correctly raised Artwork access expired rather than the unrelated expected image-failure message. The 60-second overall test deadline was not exceeded.

That fixture now takes one reference time, fixes browser wall time with Playwright's `setFixedTime`, and derives its existing 40/60-second synthetic deadlines from the same reference. Native timers continue running. The exact earliest-lease assertion, explicit year-2000 expired-lease rejection, private-image error, cancellation, cleanup, page/image budgets and PDF assertions are unchanged. No runtime behavior, deadline or test timeout changed. Sol independently reviewed the correction and ran the entire file: one passed, zero failed, in 31.24 seconds. All its sequential assertions ran. Receipt: `/tmp/insignia-state-audit-export-fixed-clock.log`. The final fixture also passes strict admin-test compilation and Biome.

### Final integrated result

The latest complete command used Node 24.21.0 and the explicit sibling source root. It completed 707 merchant/artwork/polished-buyer checks: 646 passed, one export fixture failed and 60 skipped. All 61 production-buyer checks completed with 59 passed and two skipped. Thus 705 passed in the broad run; the remaining export fixture passed its independent complete-file rerun after the clock correction. This verifies 706 checks across those runs, with 62 explicit skips and no unresolved test failure. All new behavior regressions passed. The broad command exited nonzero and was not rerun after that last test-only correction; it is not reported as an uninterrupted green run. No application source changed after the complete run.

Latest complete-run receipts: `/tmp/insignia-state-audit-final.log`, `/tmp/insignia-state-audit-final-web.tap`, `/tmp/insignia-state-audit-final-storefront.tap`. Earlier runs remain under `/tmp/insignia-state-audit-integrated.*` and `/tmp/insignia-state-audit-verified.*`. Focused counts above overlap these runs and are not added to the totals.

The local preview was restarted against the current artifact on port 62168. No production deployment or provider write occurred. Environment-gated database/native/capture prerequisites remain distinct. The preexisting static Polaris presentation audit remains red, with 41 messages across 26 unique file/rule/tag findings; no checker rule was weakened.

## References and method

Root reread Matt Pocock's [architecture article](https://www.aihero.dev/how-to-make-codebases-ai-agents-love), his own pinned architecture/TDD skill guidance and [Preact's hooks guide](https://preactjs.com/guide/v10/hooks/). The practical application was to inspect both transition logic and the actual caller, and write regressions through their public interface. This is our application of that guidance, not a claim that Matt reviewed Insignia or supplied an exhaustive state checklist.

Checklist Design's bundled Dashboard, Settings, Empty State and input-error checklists supplied functional questions about state distinctions, next actions and context. The individual audit receipts record the matching flow checklists. Shopify's [App Pricing documentation](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) confirms its hosted plan-selection responsibility. Shopify's pinned App Home guidance for [safe button actions](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/button) informed enabled/loading/failure/retry review. These are platform/design references; actual Insignia behavior is established by the reported source and browser evidence.
