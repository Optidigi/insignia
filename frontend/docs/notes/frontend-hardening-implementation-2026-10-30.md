# Variant workflow and frontend handoff

30 October 2026. Implements the owner's attached multi-part request. Translation work is a plan only. No native Shopify, backend database or deployment write was made.

## Decisions and implementation

- Keep shared artwork geometry as the default. Existing photo-specific overrides remain independent and can reset to the current shared area. Do not introduce another apply-to-all prompt or infer image orientation/alignment. The new 140-variant sparse Model/Material/Capacity regression verifies exact membership, absent combinations, shared updates, override preservation, reset and regrouping.
- Fix same-view placement duplication through `duplicateProductPlacement`. The product-level helper copies each group's rectangle exception to the new placement with independent objects, preserves review state and checks global ID collisions. The UI now calls that helper. Cross-view copy remains separate because destination photography can differ.
- Search variant photo groups by the values/label/ID of each actual member. Tokens must match one member together, so a query cannot combine values from two unavailable sparse combinations. Retain compact group labels and the existing grouping heading instead of repeating option names throughout the list.
- Explain the actual scope when editing grouping: methods, decoration sizes and prices stay shared across variants. Photo grouping does not establish material-specific production eligibility or prices.
- Add optional `optionPresentation` metadata to the selected customer view model. Row and column names plus swatch/named-choice mode let the existing quantity matrix show Finish/Model or other configured axes. Existing colour/size defaults and IDs remain unchanged. Named choices omit colour swatches in picker, review and related controls. The phone-case options fixture reuses the existing schematic and explicitly documents that its labels do not represent SKU compatibility or manufacturing calibration.
- Separate customer effects behind explicit artwork/cart ports. Required injected adapters and request/result reducer states replace synchronous preview cart success. Local saved designs, FileReader/decode, fixture artwork and development host navigation live in `src/demo`. The core bundle has no import path to those modules. Matching applied receipts, pending edit locks, cancellation, stale-result guards and retry idempotency are tested. The owner-reviewed modal still returns control to Shopify; no Insignia cart page was added.
- Replace persistent cart-failure toast with an inline footer alert so it cannot cover the Review summary. New submissions say “Adding to cart…”; updates say “Updating cart…”. Failures preserve the draft and keep retry reachable, including by document scrolling on a short phone.
- Keep contextual first-product actions rather than adding a second wizard or invented example product. The selected polished editor is non-linear; the separate production editor's four-step wizard is not claimed as part of the selected design. Home acknowledgements remain distinct from verified publication/theme/test completion.
- Refresh upstream references and create the clean `insignia-backend-upstream` worktree at fetched `origin/main` `54c222ba`. Current UI HEAD contains that commit and is ten ahead, zero behind. No newer canonical backend source was available to merge and no frontend was overwritten.

## Handoff and removability

The [customer adapter record](frontend-demo-adapters-implementation-2026-10-30.md) and sibling README identify the production composition inputs and exact demo imports to exclude. A live adapter still needs canonical configuration/assets, capabilities, exact authoritative quote review, complete customized-cart subset composition, authorization and verified Shopify application. A receipt label is not authorization, and an abort signal is not proof of remote rollback.

The merchant preview remains isolated in the loopback harness; real production modules do not import its fixtures/transports. However, that harness currently also contains selected polished presentation. The backend developer must port/reuse that presentation before retiring its demo-only entry and effects. Do not delete the entire `test/admin/support` directory as if every file were disposable simulation. The [independent handoff review](frontend-handoff-independent-review-2026-10-30.md) maps the selected UI and owning production routes. This task does not claim to have connected or replaced the merchant persistence implementation.

Photo grouping's stable option/value IDs and group-native persistence are not present in the current production catalogue contract. Production's 250 catalogue variants, 32 selected variants per design and 100 overrides per view/placement are separate limits. They were not raised silently. Different material-specific methods/prices need a deliberate product/backend contract; photo groups alone cannot provide them.

## Proportionate verification

- Merchant variant-photo model: 21 passing tests, including the new duplicate, member-search and 140-variant regressions. Customer-positioning policy tests: 3 passed.
- Actual variant-photo browser workflow passes across desktop/phone/narrow states: assignment, grouping, image errors, review, geometry, undo/redo and persistence. Its large rendered fixture has 96 variants; the separate 140-variant check is a model check, not a rendered performance claim.
- First-product setup passes on desktop and phone. Selected placement duplicate/rename/remove action browser check passes.
- Selected customer runtime contracts: 12 passed. Config/model checks: 66 passed. Final combined customer browser suite: 17 passed, no skips/failures, including all 14 scenarios and pending/failure/cancel/retry journeys.
- Customer strict build and merchant admin-test strict TypeScript pass. Source contract passes with no uncovered source. Targeted Biome checks pass. Modified Polaris photo panel validates against selected 2.0-rc contracts.
- Independent Sol reviewed the changed source and actual merchant/customer captures, including final named choices at 1440/390/320 and failure recovery in light/dark/short-window states. Its [final review](frontend-hardening-final-sol-review-2026-10-30.md) reports no remaining blocker within this local scope.

The first variant browser run caught a stale local variable after the search refactor; it was corrected before the successful full rerun and strict check. The failure-layout test initially assumed a sticky footer on short windows; the existing mobile design deliberately scrolls the document, so the final check verifies reachable retry after scrolling and alert/total/button ordering instead of introducing an overlay. No unrelated full-backend/database suite was run.

## Owner report and research

The dark [HTML report](../frontend-review-2026-10-30.html) summarizes the decisions, implementation and [translation plan](localization-implementation-plan-2026-10-30.md). The report has bundled local screenshots and no external font/runtime dependency. It is also served locally at `http://127.0.0.1:62170/`.

Research: [variant audit](variant-workflow-audit-2026-10-30.md), [first-product guidance](first-product-guidance-research-2026-10-30.md), [demo separation](frontend-demo-separation-research-2026-10-30.md), [upstream checkout](backend-upstream-local-checkout-2026-10-30.md). The research distinguishes documented patterns and local observations from real merchant usability evidence.

Frontend source backup and before hashes are under `/Users/pc/Development/Insignia/.artifacts/frontend-hardening-2026-10-30/`. The active preview was restarted on 62168 to serve the changed merchant bundle; the existing customer Vite server remains on 5173. These are local verification and review surfaces, not deployed production.

The review gallery was refreshed to 317 current/historical states and 542 screenshots. Latest changes leads with named options, quantity/review and inline submission recovery, followed by the affected variant image states. Existing screens remain under All current states. The generated gallery verified every PNG and sampled current screenshot routes returned HTTP 200. The dark report also passed desktop/phone render checks with no horizontal overflow or browser errors; its plan and two evidence images load locally.
