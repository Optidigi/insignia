# Storefront setup interaction review

26 October 2026. Independent source and isolated Chromium review of the final local Storefront setup redesign. No blocking finding remains in the reviewed flow. This is local implementation evidence; native Shopify activation, theme editing, theme saving, deployment and owner acceptance were not performed.

## Scope and sources

Read `AGENTS.md`, admin UI guidance, storefront setup research, the affected specification sections, Shopify's `polaris-app-home` skill and the project-local supplementary Web Interface Guidelines skill. Checked current official App API documentation and the runtime pins: `polaris-2.0-rc.js` and `@shopify/polaris-types` `2.0.0-rc.3`.

Reviewed `StorefrontSetup.tsx`, `shared/storefront-setup.ts`, the page shell, layout CSS, preview fixtures, focused unit tests, browser seam tests and gallery tests. The implementing agent reports successful build, TypeScript, version-matched Polaris validation and focused browser seam checks. This verifier inspected those tests without duplicating their suite runs.

Official reference: [App API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api). Theme activation records describe the published theme. `unavailable` can describe a placed item whose availability condition is disabled, so it does not establish theme incompatibility.

## State and action boundaries

- The application only reads `shopify.app.extensions()`. The reviewed flow adds no scope request, GraphQL mutation, theme-source write or theme save.
- Only the expected `customize` section block and `cart-repair` body embed can produce task states. Missing or ambiguous handles, wrong targets, malformed responses, contradictory status/placement data and invalid theme IDs produce unknown states.
- Empty extension results and absent App Bridge support do not produce green states. Rejected or timed-out checks produce recoverable failures. The source bounds a check to eight seconds.
- Add/enable deep links appear only with positive `available` evidence. Active and unknown states use an editor-only handoff. Active links contain neither `addAppBlockId` nor `activateAppId`.
- Host and API key validation constrain editor URLs. Outside-host fixtures have no theme link. Editor changes remain owned by Shopify and the merchant.
- Initial readiness waits for the check to settle behind the shared route skeleton. Return events recheck, clear old status and coalesce in-flight work. The focused browser seam covers delayed return checks and duplicate focus/visibility events.
- Published-theme labels, draft-theme guidance, template coverage and the final customer test remain distinct. Returning from an editor is not completion evidence.

## Independently observed behavior

Used a fresh Playwright-launched Chromium process against `http://127.0.0.1:62168/admin/settings/storefront`; did not touch the user's Chrome tabs or profile.

All 21 combinations of 1280, 390 and 320 pixel viewport widths with available, active, unknown, unsupported, unavailable, outside-host and failed-check fixtures had document scroll width equal to viewport width. Unknown, unsupported, outside-host and failed-check tasks displayed `Not checked`. The unavailable fixture displayed `Unavailable`; it did not claim incompatibility.

Pointer activation of Add to theme opened the loopback editor handoff. Returning showed the original available state, without claiming the block had been added. Actual available links retained the expected public key and block/embed handles and `_top` target. Active fixtures offered edit-only links and retained Test a product.

Keyboard Enter activated Retry, recovered the failed check and moved focus to the Published theme setup region. Space expanded Other themes and product templates. Tab then reached Choose a product with native `:focus-visible` styling at desktop, 390 and 320 widths. A screenshot confirmed the visible blue focus ring. Expanded guidance remained readable and caused no horizontal scrolling. A threefold task paragraph, injected only in the isolated review browser, also wrapped at 320 pixels.

Observed no HTTP request using a method other than GET or HEAD during the interaction run. Preview theme links are intercepted only by the loopback fixture and cannot change a merchant theme.

## Findings and evidence

An early source pass identified that removing Retry during a check would lose keyboard focus. The implementation now keeps that control mounted during checking and moves focus to the theme region after recovery. Live verification passed.

The implementing agent fixed narrow unknown/outside banner overflow with a shrinkable layout track. Independent final 390 and 320 checks and visual inspection of the 320 screenshots passed.

Artifacts are in `.artifacts/storefront-interaction-review-2026-10-26/`: `checks.json`, `390-keyboard.png`, `320-unknown.png`, `320-outside.png` and `320-error.png`. The focus screenshot predates the final banner-track fix and is used only for focus-ring evidence. Final narrow screenshots and measurements were captured after the fix.

A discarded attempt to intercept the preview's global App Bridge assignment prevented fixture hydration. It was a reviewer harness failure, not application evidence. All reported live outcomes above use the unmodified preview fixtures.

## Gallery delivery recheck

After the preview route allowlist fix, independently fetched the gallery index and all ten current Storefront setup desktop/mobile pairs from port 62168. The index returned 200 HTML; all 20 image URLs returned 200 `image/png`, valid PNG signatures and nonzero image dimensions. This check exercised the actual served URLs, not just files on disk. No application rebuild or source change was performed by this verifier.

## Final product-test and guidance review

The later redesign connects Test the customer flow to native product selection, an authenticated effective-publication check, and a product-specific theme-editor link. Final status wording uses `Not verified` for unknown evidence and `Couldn’t check` for a rejected check. This supersedes the earlier copy recorded above.

Added a pure product-context boundary and five passing behavioral tests for cancellation, strict product identity, URL delimiters, localized handles, the observed `previewPath` format and effective-publication eligibility. The helper preserves Unicode letters, numbers and combining marks as an encoded product path segment. Official handle documentation describes letters, hyphens and numbers without an ASCII-only restriction. A newer pending publication does not replace evidence from an existing effective revision.

Added a focused standalone browser seam. It passed selection and cancellation, exact product-specific URL and `_blank`, unpublished setup navigation, cached-choice fresh verification, pending-state removal of stale preview, 503 retry focus, 401/403 cached-choice clearing, invalid picker data and long titles at 320 pixels. The actual config page's Storefront setup breadcrumb declaration and its exact return URL are checked in that seam. Focused Biome and strict TypeScript checks passed. The standalone App Bridge double cannot establish host title-bar rendering.

The final loopback review separately exercised the visible host controls with fresh isolated Chromium. At 1280, 390 and 320 pixels, Enter opened placement help, Escape closed it and returned focus to its trigger, and the local native-shaped product picker supported Enter, Escape, pointer selection and Cancel. Controls remained reusable after dismissal. Long selected product titles wrapped with the preview action at all three widths. The complete 320-pixel card was visually inspected in `final-long-title-320-full.png` under the artifact directory recorded above.

A real catalog T-shirt selection opened product setup successfully. Clicking the visible outer `Back to Storefront setup` control returned to this page and restored the selected product with a fresh check. The final published action is `Preview in theme editor`, with an accessible new-tab description. Its URL contains only `previewPath` and the actual selected product handle and template context. Pointer activation opened a separate local handoff tab with `task=preview`, left the original app URL and verified selection intact, and caused no request to the synthetic Shopify shop domain. The local handoff does not establish that a native Shopify editor loaded successfully.

The review caught a loopback fixture mismatch after switching from synthetic IDs 111/222 to the actual demo catalog IDs. The browser wrapper omitted scenario parameters for those real IDs, making published/error/denied cases all look unpublished. The implementing agent corrected the ID matcher and restarted the preview. Independent rechecks then observed the intended published, 503 and 403 states. The rejected check offered Retry without stale preview, and denied access cleared the cached product. No blocking finding remains in the final reviewed flow.

The final name-density refinement was independently rechecked at 320 pixels after restart. The selected 258-character title occupies exactly three lines and 60 pixels, with its full text retained in the document. Keyboard Enter on View full product name reveals the exact complete name in the native popover; Escape closes it and returns focus to the trigger. The open popover causes no horizontal overflow. The focused browser assertion now covers this behavior. Earlier product-flow findings and verdict remain unchanged; the prior unbounded long-name screenshots are historical. Final reveal evidence is `final-name-reveal-320.png` in the review artifact directory.

A final combined browser run exposed a timing assumption in the retry-focus test. The preview link can be committed before Preact runs the separate focus effect, so an immediate focus sample is not a valid completion signal. The test now waits for the actual Storefront product test focus transition, bounded to 1.5 seconds, before asserting it. Three instrumented focused runs passed, including two concurrent runs; focus was already correct at the first sample in those runs. The original intermittent failure was not reproduced locally, and no production focus-loss defect or production change was established. Temporary diagnostics were removed. The final clean `node --test test/admin/storefront-product-test-browser.test.mts` run passed, with the browser test taking 1.96 seconds. Focused Biome and strict TypeScript checks passed. Only the browser test changed for this correction; no application rebuild was needed.

After the owner's compact-layout correction removed the sample illustrations, the combined browser run exposed the same one-shot timing assumption in the theme-retry focus assertion. That test now waits directly for Published theme setup to receive focus, bounded to 1.5 seconds, before asserting it. Only the test changed. The two focused storefront browser workflows then passed together, with 2 tests passed and 0 failed in 1.85 seconds; focused Biome and strict TypeScript checks also passed. Earlier illustration screenshots document the superseded composition and do not represent the corrected layout.
