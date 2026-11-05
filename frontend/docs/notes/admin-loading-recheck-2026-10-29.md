# Admin loading recheck

29 October 2026. Fresh audit against actual cold rendering, native components ready with data pending, and loaded rendering at 1440, 390 and 320 px. The audit did not accept the previous loading review as evidence of the current result.

The repository's admin UI guidance and saved UI delivery workflow governed the review. Shopify App Home 2.0 RC is the selected runtime, with `@shopify/polaris-types` 2.0.0-rc.3. [Shopify's SkeletonPage migration guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/skeleton-page) calls for stable known page structure and loading only pending regions. Actual native geometry, source and direct pixel comparisons supplied the findings below.

## Findings and corrections

- Products first paint stacked checkbox, image and title vertically. A cold row was about 121 px tall before becoming a 57 px native row. The loading identity grid now preserves the real horizontal arrangement. A final loaded-row comparison also found the known phone rule that hides product thumbnails and narrows the identity column. Products now reuses the loaded table's identity/thumbnail classes and pinned 400 px desktop / 144 px narrow column. Orders likewise reserves its actual 140 px identity column. The new regression compares both real loaded islands at the 760 px resource-container boundary and rejects direct focus and Tab entry into decorative loading scrollports.
- The generic first-paint `label`, `value` and `leading` selectors overrode declared widths and heights. Order-detail badges became equal text bars, an 80 px full-width region became a 40 px square, and toolbar controls shrank. Shared `AdminSkeletonBar` wrappers now own the declared geometry. Native gap and inline layouts also survive runtime readiness.
- The designed Methods detail shell showed one card with three equal fields and a boxed summary. The real editor has Method details, Default pricing and Product availability sections and an unboxed summary. Loading now preserves those sections, the 32 px name input and 80 px library-note textarea. Known explanatory text reserves additional phone lines. Selection-specific controls remain generic pending regions, and unavailable selected-product counts are not inferred.
- The designed Methods phone list hid all metadata while its loaded rows show four metadata lines under the method name. Loading now reserves that responsive row shape and uses the real column meanings. It does not infer the number of returned methods.
- An existing server-rendered `s-scroll-box` in the Methods loading shell triggered a reproducible pinned-runtime constructor failure when Polaris registered the element before its private static setup completed. The loading shell now uses the existing app-owned scroll container. Loaded native controls and the vendor fixture are unchanged. A browser regression rejects page errors during upgrade.
- Permissions, Billing and Storefront setup placed known section headings inside loading cards while native Sections place them outside. Those bootstrap headings now sit outside the card. Permissions reserves its actual initial title/badge/description rows, including phone wrapping. Settings reserves its fixed two-line phone descriptions. Storefront preserves the known task padding and two/three-line descriptions, plus the product-test card's horizontal desktop and wrapped phone selection arrangement. These synchronous pages have no new request or artificial wait.
- Home reused product-image placeholders for recent orders. Products retain their image/copy loading rows; orders now reserve the real text, product description, metadata and right-aligned status arrangement without product thumbnails. Both bootstrap and in-place pending panels use the same explicit variants.
- Order-detail loading used a narrower frame and boxed sidebar. The real native Page has a 760 px main column and 280 px aside at 1440, with 48 px between them, and 16 px phone gutters. Bootstrap now follows that measured native composition. Both bootstrap and in-place loading use unboxed customized-item and payment groups, with a generic image/variant/amount row and payment facts. Exact garments, number of lines, refunds and conditional warning banners remain unknown until data arrives.

## Scope and limits

The production persisted product editor and the richer designed placement editor remain separate implementations. The persisted editor's saved configuration is unavailable before its read completes; its initial generic form does not claim that a configured canvas or a particular method/placement count already exists. The designed preview retains its known three-panel workspace and phone arrangement. Unknown data may change row counts or conditional regions after loading; that is different from dropping known columns, cards or fields.

All probes used independent loopback SSR or preview hosts, the pinned Polaris fixture and read-only local scenarios. The user's live browser was untouched. No authentication, backend, Shopify provider or production state was changed.

## Verification and evidence

Eight source-rendered browser checks cover declared dimensions before/after native readiness, Methods structure and mobile row density, native Permissions card geometry, Home order metadata/status positions against real loaded rows, order columns against an actual native Page with aside, and fixed-copy wrapping against the real Settings and Storefront components. Each behavior correction was preceded by a failing regression. Scoped formatting has no errors and retains three existing CSS warnings. Strict admin test compilation passed. The complete loading browser suite against the final artifact passed all 9 tests, including the real loaded Products/Orders comparison and direct focus/Tab rejection in loading content. Updated native component and expanded Methods markup validation passed against 2.0 RC. Root owns the final production build and the broader merchant regression run.

Initial audit evidence is in `/tmp/insignia-loading-recheck-2026-10-29/`: 126 cold/delayed/loaded captures, `matrix.json`, source-rendered regression logs and `compare-*` triptychs. The initial triptychs retain the before state. Intermediate direct Methods captures combine current preview markup with the previous built stylesheet and are not approval evidence.


Final evidence is in `/Users/pc/Development/Insignia/.artifacts/frontend-recheck-2026-10-29/admin-loading/`. `matrix.json` covers 126 captures across all 14 production/explicit-preview route cases, with no document overflow, no page errors and no reachable controls in loading placeholders. `compare-*` triptychs show cold, native pending and loaded states side by side. The folder also contains the capture script, browser/type/style/validator logs and source hashes.

The last pixel pass checked the corrected Settings, Storefront and Methods phone compositions directly. Measured known card heights match the real native components:

| Region | 1440 px | 390 px | 320 px |
| --- | --- | --- | --- |
| Settings destinations | 202 px | 262 px | 262 px |
| Storefront theme tasks | 265 px | 393 px | 413 px |
| Storefront product test | 60 px | 112 px | 112 px |

Cold card tops differ from native ready cards by 1 px. The final independent reviewer also checked the aside collapse at 1024, 784 and 783 px. The 784 px aside has a nonblocking 2.72 px horizontal difference; this was recorded rather than expanding a completed correction into another layout redesign. Methods' selected-product list height and conditional error/refund/plan regions remain data dependent.

The final local result has been implemented, compiled, tested and visually inspected with pinned native components and synthetic read-only data. These checks do not establish native Shopify-host observation, integration, deployment or owner acceptance.


A final 320 px triptych exposed a Products responsiveness discrepancy after the first verification run. Root authorized a bounded correction using the actual loaded classes and column contract. It also corrected Orders' fixed identity width, after a source/pixel check ruled out an analogous hidden-thumbnail issue there. Source regressions compare actual loaded components rather than two copies of the pending shell. The final 18 Products/Orders recaptures at 1440, 390 and 320 px passed without overflow or page errors. The canonical 126-state matrix now records each capture build, retaining the other 108 unaffected states from the preceding verified build. At 320 px the identity columns match across cold, native pending and loaded states: Products is 144 px wide with Configuration starting at x=160; Orders is 140 px wide with Date starting at x=156. The responsive source regression also covers viewport widths 793/792 px, which place the resource container immediately above and at its 760 px breakpoint. Products keeps its desktop thumbnail at the wider boundary and hides it at the narrow one. Direct focus and keyboard Tab cannot enter either decorative loading scrollport before or after Polaris upgrades. No additional UI finding remained after the final pixel pass.
