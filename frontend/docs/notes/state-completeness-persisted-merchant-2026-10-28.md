# Persisted merchant configuration editor state audit

Audit date: 28 October 2026. Scope: `merchant-config-editor-workflow.ts`, `merchant-config-transaction.ts`, and their `MerchantConfigEditor.tsx` caller. I reviewed user recovery and async ordering, not presentation acceptance.

I found three reproducible recovery defects. Save conflict, publication continuation, and authorization/generation fencing work through their intended paths, but some stale or uncertain outcomes leave the merchant on a screen with no in-page way to reconcile it. A malformed stored draft fails closed, as intended, though its message does not identify the actual problem or give a next step.

## Findings

### P2: A stale publication rejection leaves the editor on the old draft with no reload action

The browser starts with draft version 1. The probe changes the server fixture to version 2 with a different mode, then returns HTTP 409 to the publish request. The controller's authenticated read observes version 2 and correctly rejects the stale publication. It updates only publication metadata and disables eligibility when the saved version differs from the view at request start. It does not retain the newer draft as `latest` or update the displayed draft/version (`apps/web/src/islands/merchant-config-editor-workflow.ts:407-423, 738-755`).

The UI says, “The saved draft changed before this publication was accepted. Review it and publish again.” The page still displays version 1 and the old draft, disables Publish, and offers none of Review latest, Reload current draft, or Retry session. The relevant actions only render for `latest` or save states `conflict`/`ambiguous` (`apps/web/src/islands/MerchantConfigEditor.tsx:2727-2755`). The merchant must leave and reopen the route to see version 2. This conflicts with the stale-editor 409 and conflict-feedback contract (`docs/architecture/implementation-plan.md:387, 418`).

Reproduction: `stale publication observation probe` in the scratch browser file listed under Verification. Its JSON result was:

```json
{"displayedVersion":["Draft version 1"],"mode":"optional","serverVersion":"2","serverMode":"required","reviewLatestActionCount":0,"reloadCurrentActionCount":0,"retrySessionButtonCount":0,"publishDisabled":true}
```

The current UI capture is `/tmp/insignia-merchant-config-audit-20261028/stale-publication-rejected.png`.

**Minimal recommendation:** When the publication reconciliation read finds a different saved draft, keep that response as a separate latest snapshot and expose Review latest or Reload current draft. Preserve any local edits until the merchant chooses to replace them.

Confidence: high. The request, 409, authenticated version-2 read, status message, stale fields, disabled action, and absent recovery controls were observed in the browser.

### P2: Discarding after a save conflict clears the newer snapshot and reports the old draft as saved

The save-conflict path stores the authenticated server configuration in `latest` but leaves the old view in place (`apps/web/src/islands/merchant-config-editor-workflow.ts:600-619`). After the merchant chooses Discard changes, `discardDraft()` restores `state.view.config.draft` and clears `latest`, even when the transaction is in `conflict` (`apps/web/src/islands/merchant-config-editor-workflow.ts:863-869`). The caller then clears the conflict banner (`apps/web/src/islands/MerchantConfigEditor.tsx:2781-2797`). Both latest/reload actions disappear because the save state is now clean and `latest` is null (`apps/web/src/islands/MerchantConfigEditor.tsx:2727-2755`).

The browser probe began at version 1 / Optional. It changed the server to version 2 / Required, returned 409 to Save, then clicked Discard changes and confirmed. The page ended at version 1 / Optional with “All changes saved”; the server fixture remained version 2 / Required. No write occurred. The UI had no latest or reload action after the discard, so the user could mistake a stale page-entry snapshot for the current saved configuration.

Reproduction: `conflict discard observation probe` in the scratch browser file listed under Verification. Its JSON result was:

```json
{"displayedVersion":["Draft version 1"],"mode":"optional","methodName":"","latestReviewActionCount":0,"reloadCurrentActionCount":0,"serverVersion":"2","serverMode":"required"}
```

The capture is `/tmp/insignia-merchant-config-audit-20261028/conflict-discard.png`. It shows no conflict banner, the old version and mode, and the clean save badge.

**Minimal recommendation:** On Discard from a conflict, adopt the authenticated `latest` snapshot as the saved baseline, or retain the conflict and a reload/review action. Do not clear the conflict while keeping the stale view.

Confidence: high. The conflict response, newer authenticated read, user discard, final view, and absence of controls were observed in the browser.

### P2: A lost first-create acknowledgement leaves an existing configuration hidden

`createConfiguration()` sends a new idempotency key, loads the page only after a successful response, and returns a generic failure without reconciling a non-authorization error (`apps/web/src/islands/merchant-config-editor-workflow.ts:775-790`). The UI keeps showing Create configuration for a view with no config and does not show Retry session, because `view` is still non-null (`apps/web/src/islands/MerchantConfigEditor.tsx:825-840, 1178-1211`). The server's create operation uses the idempotency key and rejects a product that already has a config (`apps/web/src/server/merchant-config.ts:393-435`).

The probe simulated a successful server-side create followed by a lost response. The first click showed “Failed to fetch.” A second click used a new key and got “Product already has a configuration.” The view still showed Create configuration, with no configuration form and no Retry session action. Reloading the route would read the created config, but the editor offers no recovery action.

Reproduction: `create lost-acknowledgement observation probe` in the scratch browser file listed under Verification. Its JSON result was:

```json
{"serverHasConfiguration":true,"createRequests":2,"createButtonCount":1,"retrySessionButtonCount":0,"configurationSectionCount":0,"displayedError":"Product already has a configuration"}
```

The pre-retry capture is `/tmp/insignia-merchant-config-audit-20261028/create-lost-response.png`; the repeated-conflict screen is `/tmp/insignia-merchant-config-audit-20261028/create-conflict-loop.png`.

**Minimal recommendation:** Treat a create whose acknowledgement is uncertain as an owned command. Authenticate a read after the error and load the config if it exists; if the read confirms absence, retain and retry the exact command key. A visible reload/recheck action would also let the merchant recover without leaving the page.

Confidence: high for the UI behavior. The lost response was simulated after setting the server fixture to created; the second distinct-key request returned the expected occupied conflict.

## Fail-closed state and intentional boundary

The controller validates persisted drafts with `MerchantDraftSchema` and geometry validation, and does not place an invalid draft into editable state (`apps/web/src/islands/merchant-config-editor-workflow.ts:159-167, 342-348`). The product service returns the stored draft as `unknown` while marking publication eligibility unavailable (`apps/web/src/server/merchant-config.ts:323-358`). The editor note explicitly records malformed values as unsupported rather than sending them into UI code (`docs/delivery/notes/editor-workflow-deepening-2026-10-28.md`). This fail-closed behavior is correct.

The browser screen for `{ ...draft, pricingRules: null }` showed only “This draft version cannot be edited in this admin build.” It had no editable field or Retry session button. That copy describes a schema-version mismatch, not malformed persisted data; the screen gives no support or operator next step (`apps/web/src/islands/MerchantConfigEditor.tsx:594-609, 1178-1216`). I treat the lack of an in-app repair action as intentional safety, with a smaller information gap. A clearer message should say the saved configuration cannot be opened and direct the merchant to an operator or support path. The capture is `/tmp/insignia-merchant-config-audit-20261028/malformed-draft.png`.

## States already covered by focused tests

- Loading and failed/denied reads leave the form closed; initial read failures expose Retry session. Focused browser tests cover verified-missing creation and successful creation into the editor. The valid empty draft remains editable, and its browser test configured it through typed controls.
- Existing browser coverage checks that normal dirty edits use the host save state and confirmed discard restores the loaded draft without a write.
- Save conflict retains the latest server snapshot and exposes Review latest / Reload current draft until the merchant chooses an action. The defect above is the later Discard transition.
- Ambiguous save retry reuses the original key/body. Suspended saves wait for a successful authenticated resume read; failed reads block retry. 408/429 and malformed success responses remain ambiguous.
- Publication continuation preserves the original immutable request across reload, and server observations do not settle a different publication. Rejected stale publication is the missing in-page refresh case above.
- Authorization denial clears private UI and fences late responses. Generation changes drop old-generation save identity.
- Persisted back-forward-cache resume reauthenticates, reconciles the exact retained save, and does not admit a second write while an old response is still in flight.

Full document destruction does not persist private draft or save bodies. That is an explicit retained boundary, not a finding: the delivery note says a user-confirmed native leave prompt discards those in-memory bodies and the next document reads server state (`docs/delivery/notes/frontend-state-implementation-2026-10-28.md:46`). `AdminSaveBar` wires the native leave warning (`apps/web/src/components/AdminSaveBar.tsx:94-128`). Publication identity has separate session storage and recovery tests.

## Verification

I ran focused tests under Node 24.21.0. I did not run a build or the full frontend suite, and I did not use the live preview, Shopify, or a connected provider. Existing browser fixtures started their own `PORT=0` loopback server and stubbed authenticated API responses.

| Command | Result |
| --- | --- |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec node --test test/admin/merchant-config-editor-workflow-transaction.test.mts test/admin/merchant-config-transaction.test.mts` | 18 passed, 0 failed |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec node --test --test-name-pattern='mobile deep link, cookie-free reload, interrupted save, stale conflict, and missing Polaris control' test/admin/editor-browser.test.mts` | 1 passed, 0 failed |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec node --test --test-name-pattern='(pagehide and persisted pageshow|persisted resume drops|interrupted publication resumes|publication retry keeps|stale stored publication is replaced|reinstalled Admin discards|authorization denial fences a save already in flight|pre-command passive observation|operator and restoration conflicts|uncertain saves fence edits)' test/admin/editor-browser.test.mts` | 11 passed, 0 failed |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec node --test --test-name-pattern='(first configuration creation releases the editor|empty merchant draft can be configured through typed controls)' test/admin/editor-browser.test.mts` | 2 passed, 0 failed |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec node --test test/admin/merchant-config-discard-conflict.probe.mts` | 4 scratch probes passed. The probes report UI state; passing means the observed transitions completed. |

The scratch probe was copied by the root reviewer to `/tmp/insignia-state-audit-merchant-probe.mts` before its removal from the repository. Its screenshots and JSON output are under `/tmp/insignia-merchant-config-audit-20261028/`.

## Follow-up fix receipt

The three reproduced recovery defects above were fixed in the workflow controller, with public controller tests and browser regressions added. The host editor caller did not need a UI change: its existing Review latest, Reload current draft and Discard actions now receive accurate workflow state.

- A stale publication read now stores the authenticated configuration as `latest` when its saved version or draft differs from the page baseline, while retaining the visible baseline and any unsaved local edit. A `server-draft-changed` transaction event marks clean, saved, and dirty baselines conflicted, leaves saving/ambiguous commands untouched, and keeps the conflict badge through additional local edits. Existing Review latest adopts only a valid draft from the same configuration and installation generation. See `apps/web/src/islands/merchant-config-editor-workflow.ts:388-438, 945-959` and `apps/web/src/islands/merchant-config-transaction.ts:39-45, 203-212`.
- Discard from a save conflict adopts the authenticated latest draft and version as the new clean baseline. If no latest read is available or the newer draft is unsupported, the method returns without clearing the local draft, latest observation or conflict. See `apps/web/src/islands/merchant-config-editor-workflow.ts:929-955`.
- Create now retains one exact in-memory POST request and idempotency key while its outcome is uncertain. It performs an authenticated read after an uncertain/malformed response or 409; a found configuration is loaded, a confirmed empty read leaves that exact request available for an explicit retry, failed reads preserve the request while returning to Retry session, and authorization denial clears it. A successful acknowledgement also requires a subsequent read to find the configuration before the caller reports success. The request is intentionally not persisted across full document destruction, consistent with the retained private-body boundary above. See `apps/web/src/islands/merchant-config-editor-workflow.ts:230-234, 299-304, 348-350, 785-857`.

Controller coverage lives in `apps/web/test/admin/merchant-config-editor-workflow-transaction.test.mts:447-700` and `apps/web/test/admin/merchant-config-transaction.test.mts:99-133`; cases cover valid/unsupported conflict discard, passive and rejected stale publication, edits after a known conflict, active/ambiguous command ownership, lost create acknowledgement, 409 reconciliation, same-command retry, and auth-denied cleanup. Actual browser regressions were added in `apps/web/test/admin/editor-browser.test.mts:948-1192` for conflict discard, stale publication review, passive publication refresh, lost acknowledgement, and same-key retry.

Verification after the fix:

| Command | Result |
| --- | --- |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec node --test test/admin/merchant-config-editor-workflow-transaction.test.mts test/admin/merchant-config-transaction.test.mts` | 27 passed, 0 failed |
| `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm --filter @insignia/web exec tsc --noEmit -p tsconfig.admin-test.json` | Passed |
| Browser regressions added in `editor-browser.test.mts` | Not run here; the root reviewer is coordinating a single web build and browser run after the concurrent Orders review releases `dist`. |

Malformed stored drafts remain read-only with no reset operation. Transaction changes are limited to representing a known newer saved draft without inventing a fake save command; existing exact-request, authorization, and generation-fencing tests remain green. The original scratch probe was removed after the root reviewer copied it to `/tmp/insignia-state-audit-merchant-probe.mts`.
