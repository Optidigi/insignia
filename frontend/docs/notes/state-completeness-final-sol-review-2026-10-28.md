# State completeness final independent review

28 October 2026. Sol review of the narrow corrections from the independent state completeness audits. The stable final corrections were independently reviewed after the coordinated web build. No application/test code, build output, provider data or shared live preview was changed by this reviewer.

## Scope and method

The source baseline is the assigned corrective hunks, rather than the whole dirty tree at HEAD `56ab3420b05013b693faaf6c45fa1b82e48a8cd0`. The sibling `designer-prototype` is outside Git. Reviewed repository AGENTS, README, current state, implementation-plan sections 3.1–3.2 and frontend architecture, and the local code-review, TDD and diagnosing-bugs skills. The prior five audit receipts establish intended recovery behavior.

Architecture references are Matt Pocock's own [architecture article](https://www.aihero.dev/how-to-make-codebases-ai-agents-love), his [pinned architecture guidance](https://raw.githubusercontent.com/mattpocock/skills/59db609eb1e18aaf59b63284d0e52255aff0c63c/docs/engineering/improve-codebase-architecture.md), [discriminated-union article](https://www.totaltypescript.com/discriminated-unions-are-a-devs-best-friend), and [Preact v10 hooks](https://preactjs.com/guide/v10/hooks/). They support a small event interface, coherent state variants and checking actual caller behavior. File size or reducer extraction alone is not a completeness verdict. No OpenAI or Anthropic architecture material supplied the review criteria.

## Standards

No concrete standards finding in the stable buyer upload and staged-history corrections. Upload completion remains a pure reducer transition and requires the active reading token, target, open modal and surviving print. New-start freshness is checked separately. File reading and image decoding remain in the Preact caller. The history correction checks the same active workspace modes both in the rendered actions and the shared history handler, so keyboard invocation cannot bypass the disabled action.

## Product intent

No concrete product-intent finding in those two corrections. A valid decoded file now applies and appears in the library. Invalid decode leaves usable retry controls. Cancelled completions retain their stale-result protection. Staged movement and measurement retain Done/Cancel ownership; global history resumes afterwards and one Undo reverses the completed boundary without undoing the preceding movement setting.

## Independent verification

All commands used Node 24.21.0. Browser origins were isolated and synthetic. The reviewer did not run a full suite or build.

- `INSIGNIA_DESIGNER_PROTOTYPE_ROOT=/Users/pc/Development/Insignia/designer-prototype corepack pnpm exec node --test apps/web/test/admin/designer-state-browser.test.mts`: 9 passed, 0 failed. Isolated Vite origin `http://127.0.0.1:57154`; sibling source digest `181bbce8eb3b6b7e2149e6ceee5ea9945692399e8dde0c663b98d2188cb6dc7e`. This includes actual success, invalid-decode retry and cancellation, plus stale-result reducer checks.
- `corepack pnpm exec node --test --test-name-pattern='staged canvas tasks keep global history' apps/web/test/admin/placement-workflow-browser.test.mts`: 1 passed, 0 failed. Actual desktop and 390px callers cover disabled host actions, keyboard Undo during a staged boundary, Done followed by a single Undo, and measurement Cancel.
- Additional independent public UI probe `node /tmp/insignia-final-sol-upload.mjs`: desktop 1440px and phone 320px each rejected a text file, rejected a file over 5 MiB, then successfully decoded/applied a PNG and showed it when reopening the library. Both reported zero page errors. This uses real input files and the rendered picker, with no reducer invocation or internal state read.

Inspected the current 320px upload capture `/tmp/insignia-final-sol-upload-320.png`, which shows the reopened picker and `accepted.png`, and the existing task capture `/tmp/frontend-workflow-task-captures/canvas-focused-movement-390.png`, which shows the movement task with its Done/Cancel controls. The latter is contextual task evidence, not a new screenshot of this fix. These observations do not grant owner visual acceptance or native Shopify qualification. The known static Polaris presentation gate remains separate.

The two stable initial corrections have 0 Standards findings and 0 Product-intent findings. The completed merchant and Orders review follows below.

## Persisted merchant source review

The implementing agent released the workflow and transaction sources for review before the shared build. Independently reran `corepack pnpm --filter @insignia/web exec node --test test/admin/merchant-config-editor-workflow-transaction.test.mts test/admin/merchant-config-transaction.test.mts`: 27 passed, 0 failed.

No concrete product defect found in the new source. `server-draft-changed` preserves an active/ambiguous save and keeps a known conflict through further local edits. Conflict discard delegates to the same validated latest-adoption operation. Missing, unsupported, different-configuration or different-generation latest data returns null; the caller checks that return before clearing its local fields or conflict UI. An uncertain create retains the exact command across read failure and suspension, authenticates a fresh read, and clears the command on observed configuration, authorization denial or disposal. Epoch checks fence old responses.

Review caught one new browser expectation inconsistent with that intended behavior: the stale-publication case expected zero Reload current draft actions even though a conflict renders that existing recovery action. Sent this to root before the coordinated build. This is a regression-test expectation issue, not a missing product state. The implementing agent corrected that expectation, and the independent built-artifact browser run below passed.


## Final merchant and Orders verification

Root released all final source after the coordinated web build passed. This reviewer then ran the new public browser callers against that artifact:

| Command suffix under `corepack pnpm --filter @insignia/web exec` | Result |
| --- | --- |
| `node --test --test-name-pattern='discarding after a save conflict\|stale publication rejection exposes\|lost first-create acknowledgement\|unresolved first-create retry\|passive publication refresh' test/admin/editor-browser.test.mts` | 5 passed, 0 failed |
| `node --test --test-name-pattern='terminal original download is unavailable while transient failures retry and resource changes reset it\|original-download component resets its terminal state when the mounted resource changes\|all-failed ZIP retry distinguishes transient metadata errors from unavailable artwork\|partial artwork ZIP keeps one download action when another placement fails transiently' test/admin/purchase-browser.test.mts` | 4 passed, 0 failed |
| `node --test test/admin/artwork-archive.test.mts` | 1 passed, 0 failed |

The first command uses the actual passive-refresh test name, which begins "passive publication refresh marks". All five intended merchant cases ran. The Orders checks include an actual mounted component resource change, rather than relying only on a page reload. Archive verification additionally covers metadata 408/429/503, signed-storage 403/410/503, checksum failure, real expiry, changed-order invalidation and authenticated denial.

Reviewed final `OriginalArtworkDownload.tsx`, `ArtworkArchiveDownload.tsx`, `artwork-archive.ts`, `artwork-archive-error.ts` and their tests. No material Standards or Product-intent finding. Authenticated metadata 410 is terminal, while signed-storage failures become a typed retryable archive error without a merchant authorization status. Size, checksum, archive-budget and expiry errors retain the nonretryable default. Zero-file transient preparation exposes the existing retry action; a partial archive retains one download primary action. Original-download terminal state resets on purchase/asset identity changes and aborted old results cannot restore it. Existing authenticated 401/403 handling still clears private purchase data.

Captured current built-artifact states with a temporary copy of the browser fixture outside the repository, adding screenshots only. The first attempt failed before browser startup because the temporary wrapper declared a loader after its use; correcting that wrapper produced 2 passing capture scenarios. A further 1-case run allowed the modal animation to settle for the transient screenshot. Inspected `/tmp/insignia-final-sol-original-terminal.png`, `/tmp/insignia-final-sol-zip-transient.png` and `/tmp/insignia-final-sol-zip-terminal.png`. They show terminal original copy with its action removed, zero-file transient ZIP with Try again, and terminal ZIP with Close only. Fixture image gaps and synthetic financial values do not represent new product failures.

This scoped review verifies the reported corrections through both source and actual rendered callers. It does not claim the full frontend suite, production provider qualification, owner visual acceptance or closure of the separate known Polaris presentation gate. Settings return continuity under blocked session storage and malformed-draft operator guidance remain recorded recommendations, outside these fixes.

Root subsequently formatted the changed files and removed an unused private reconcile-create parameter and duplicate fallback branch. Reviewed the resulting helper and all call sites; these changes preserve the verified command and recovery behavior. No further browser was started during the maintained full run.

Final counts: 0 Standards findings and 0 Product-intent findings. Neither axis has a worst issue in the final corrective scope.

## Integrated signing fixture follow-up

The maintained full run exposed one pre-existing signing test race, outside the frontend correction scope. Independently reviewed `signing-owner-action.ts` and the hostile closed-status fixture at `signing-owner-action.test.mts:307`. The fixture called `start()` and polled until `status()` returned PROVISIONED, then corrupted the result file. That observation does not establish that execution has finished. `persist()` writes the result directly with exclusive `open`, then syncs/closes the file and syncs/closes its directory. A status read may observe valid completed bytes while this work and the execution's `finally` remain pending. A later malformed read during that interval legitimately returns PENDING.

The narrow fixture correction is to establish completed PROVISIONED through `await action.prepare(actor, syntheticToken)`. That public method awaits execution, including the running-flag cleanup, before observing status. It accurately supplies the test's closed-execution precondition. Keep the hostile extra-token assertion, wrong file mode, FIFO rejection and 500ms nonblocking bound unchanged. No application behavior, permission or timeout change is justified. This is a source-confirmed diagnosis and recommendation; root owns reproduction loops, the test-only correction and the subsequent integrated rerun.

Root reproduced the old signing fixture failure on its third attempt with canonical `TMPDIR=/private/tmp`, then applied the public completion barrier only to the hostile closed-status test. Independently inspected that final fixture. Its extra-token JSON, 0644 mode, FIFO and 500ms nonblocking checks are unchanged. Independently ran `TMPDIR=/private/tmp corepack pnpm --filter @insignia/web exec node --test --test-name-pattern='nonregular, wrong-mode and hostile closed status files' test/admin/signing-owner-action.test.mts` under Node 24.21.0: 1 passed, 0 failed. This confirms the narrow fixture correction; it does not substitute for root's fresh complete run. Persistence wording remains direct exclusive file creation, with file and directory sync/close, not atomic rename.

## Orders breadcrumb fixture follow-up

The next combined run exposed two old breadcrumb tests activating an attached SSR `s-link` before Polaris had upgraded it. Reviewed `admin-navigation.ts`, the original cases, the causal probe at `/tmp/orders-breadcrumb-ready-probe.log` and the released fixture correction. The probe observed `data-admin-ready=false`, inert route content, undefined `s-link` and no native anchor at the early click; that activation stayed on the detail route. With public readiness and element definition established, the same href returned to the exact cursor and Previous navigated correctly.

The test-only correction waits for `html[data-admin-ready="true"]` and `customElements.whenDefined('s-link')` before activating the existing host action. The return URL and ready state are established before Previous. The page-two case deliberately delays the fixture's Polaris response by 250ms. That delay creates the old race; it is not a post-click sleep or increased timeout. The original trail, cursor, Previous and filter-preservation assertions remain. Native Shopify title-bar presentation is still outside this token-only fixture.

Independently ran `corepack pnpm --filter @insignia/web exec node --test --test-name-pattern='Orders breadcrumb restores previous-page navigation' test/admin/purchase-browser.test.mts` under Node 24.21.0: 2 passed, 0 failed, including the controlled-delay case. No application behavior or timeout changed. No new Standards or Product-intent finding. The browser process completed before root started the next full run.

## Production-sheet fixture clock diagnosis

Read-only review after the subsequent broad run found a production-sheet test's 40-second preview lease elapsed during its large sequential render/PDF fixture. `production-sheet-export.test.mts` computes the payload deadline at Node `Date.now()+60000` and the shorter lease at `Date.now()+40000`, once each. The late private-image failure assertion expects a placement-specific loading error. `renderProductionSheet` correctly checks expiry again in its catch path, so a test taking over 40 seconds sees the earlier expired-lease boundary instead.

Recommended fixture correction is one shared Node reference time, `page.clock.setFixedTime(referenceTime)` before browser navigation, and both existing relative deadlines derived from that reference. Playwright's [clock documentation](https://playwright.dev/docs/clock) and installed types confirm that `setFixedTime` controls Date while timers continue normally. This preserves the test's real cancellation timers, lease-bound equality, explicit expired-lease rejection and all rendering/budget assertions without increasing deadlines or changing production code. No browser was run during the remaining broad run. Controlled-time reproduction and the eventual fixture correction remain root-owned at this point.

After the broad run released the browser, inspected root's final fixture correction: one `referenceNow=Date.now()`, `page.clock.setFixedTime(new Date(referenceNow))` before navigation, and the original 60000/40000ms relative deadlines derived from that same value. No assertions or production code changed. Independently ran the entire file, without name filtering, under Node 24.21.0: `corepack pnpm --filter @insignia/web exec node --test test/admin/production-sheet-export.test.mts`. Result: 1 passed, 0 failed, 0 skipped; test duration 31.24s. Log `/tmp/insignia-state-audit-export-fixed-clock.log`. The complete sequential case reached its private-image failure, explicit expired lease, cleanup, image/page budgets and native `setTimeout(0)` PDF cancellation assertions. Browser process finished. This is a targeted correction receipt after the broad run, not a claim that a further complete command was rerun.
