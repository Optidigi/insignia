# Frontend workflow final independent review

Reviewed the current files at HEAD `56ab3420b05013b693faaf6c45fa1b82e48a8cd0` plus the dirty working tree on 28 October 2026. This is a scoped source and rendered-evidence review, not attribution of the full working-tree diff. No application source changed during this review.

Scope: merchant editor workflow, island wiring and renderer lifetime; save/publication transaction recovery; Methods workflow, island and transaction; buyer review claims, expired proposals and removal; sibling designer unload guard; failed image-upload no-op behavior and narrow drawing-task caption styling.

## Standards

No material finding in this scope. The workflow modules earn their place by owning request claims, retained commands, invalidation and recovery. Deleting them would move that coordination back into callers. UI effects retain DOM, overlay and renderer responsibilities. No new library or global store appeared in the reviewed change.

Reviewed against AGENTS.md, admin UI guidance, the local code-review and TDD skills and their test/mocking guidance, and the available codebase-design vocabulary. There is no project-local codebase-design SKILL.md at the advertised sibling path; the installed skill supplied that vocabulary. Reread Matt Pocock's [architecture article](https://www.aihero.dev/how-to-make-codebases-ai-agents-love) and [pinned architecture skill](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/improve-codebase-architecture/SKILL.md). The conclusions follow their focus on real caller complexity, public behavior and locality, rather than file size alone.

Public controller tests exercise held asynchronous responses, duplicate submissions, malformed responses, failed authenticated resume, exact replay, changed generation and stale completion. Expected outcomes include literal request bodies, identities, visible state and denied request counts. These are behavioral checks rather than assertions that recompute the implementation. Reducer checks supplement those caller tests. The actual Konva browser test checks changed canvas pixels and pointer dragging reflected in the typed position field.

## Spec

No material finding against frontend-workflow-followup-2026-10-28.md and editor-workflow-deepening-2026-10-28.md. Save retries retain the original command; publication intent remains separate from editable draft state. Stale publication retirement requires a matching rejected attempt and a current authenticated DRAFT observation with a changed version. Epoch checks prevent old completions releasing newer claims. Methods writes require a current successful read, and failed suspension recovery retains the fresh-session requirement. Buyer review claims precede request-lane allocation, expiry preserves the design for fresh review, and successful removal clears renewable identity.

The renderer setup follows editor availability and design-stage presence and destroys late-created renderers after cleanup. The designer unload predicate covers saved and dirty-empty designs. Failed image batches do not invoke selection changes when no additions exist. The task-caption rule preserves room for the active task at small widths.

## Evidence and limits

Independently ran with Node 24.21.0:

`node --test apps/web/test/admin/merchant-config-editor-workflow-transaction.test.mts apps/web/test/admin/method-library-workflow.test.mts apps/web/test/admin/method-library-transaction.test.mts apps/storefront/test/buyer-state.test.mts`

Result: 36 passed, zero failed or skipped. Read the production buyer browser assertions for synchronous double review, pending state, expiry recovery and removal of obsolete renewal; designer browser assertions for saved, dirty-empty and Undo unload state; upload rejection/retry assertions; and renderer pointer/pixel assertions. Browser runs and integrated build remain separately owned; this review did not rerun them concurrently.

Inspected actual captures `/tmp/frontend-workflow-task-captures/canvas-focused-movement-320.png`, `canvas-focused-movement-390.png` and `/tmp/insignia-method-workflow/methods-index-mobile.png`. At 320 and 390 the Movement area task remains readable, its drawing instruction fits, and Done/Cancel remain reachable. Methods mobile records retain readable labels, values and row menus. These captures establish those local states only; they do not approve the whole presentation or establish native Shopify acceptance. Synthetic unload events verify listener wiring, not a guaranteed browser-native prompt.

The preexisting static Polaris boundary failure remains explicitly deferred: 41 raw occurrences across 26 unique file/tag pairs. This review neither relaxes that rule nor claims whole CI is green. No deployment, provider mutation, owner visual acceptance or release approval is implied.

Standards: zero material findings. Spec: zero material findings.

## Final advisory-confirmation correction

After the initial review, an independent reviewer identified a real completion bug: advisory fingerprint computation could reject after the cart adapter had verified application, before entering the confirmation promise's rejection handler. That left the buyer in applying state. Root's recorded red browser run `/tmp/frontend-buyer-advisory-red-2.log` timed out waiting for `Customized cart updated.` after injecting that digest failure.

Reviewed the correction in `apps/storefront/src/customizer.tsx`: both advisory fingerprint creation and optional confirmation now run inside the same try/catch, followed by the existing cart notification and completion. Actual cart-integrity failures still use the earlier cart-application failure path. This correction does not cancel already accepted mutation work on unmount.

Independently reran from `apps/storefront` with Node 24.21.0: `node --test --test-name-pattern='^buyer reviews full retained cart' test/buyer-browser.test.mts`. Result: one passed, zero failed or skipped. The test injects failure only when advisory input contains new cart item keys, asserts that injection occurred, and then observes completed cart status. No remaining material finding in the corrected scope. The static Polaris and whole-CI limitations above remain unchanged.

## Focus assertion correction

The maintained browser run later reported a duplication focus failure. Source review identified that `receivesFocus` retained one input node throughout its polling window, although selecting the duplicate replaces the keyed properties pane. Root reproduced this deterministically by starting the focus check with the Duplicate menu open, then duplicating through the real UI. The old input disconnected and the current input owned focus, while the old helper still returned false. Recorded red evidence is `/tmp/frontend-placement-focus-poll-red-confirmed.log`.

Reviewed the corrected helper and public UI regression without another browser run during integrated verification. Each probe now re-resolves the locator through `evaluateAll`, requires a unique connected target, and checks that target's document or shadow-root active element. The one-second deadline and eventual false result are retained. This fixes the test's ownership of an obsolete DOM node without changing runtime focus behavior or depending on private menu state.

The regression asserts keyed input replacement and current focus, then uses actual keyboard selection and insertion to rename the duplicate. That verifies the practical typing interaction rather than relying on `fill`, which can focus a field itself. Root's `/tmp/frontend-placement-focus-poll-green.log` records the focused case passing, one test and zero failures. No remaining material finding in this correction; full maintained verification remains independently reported by root.
