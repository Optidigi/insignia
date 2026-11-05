# Frontend localization implementation

4 November 2026. Implements the [approved plan](localization-implementation-plan-2026-11-02.md) across the current merchant frontend and selected sibling customer modal. English is the only advertised language. Expanded `en-XA` is a development test input.

## Implementation

`@insignia/localization` owns pinned i18next core, English catalogs, generated message/interpolation contracts, immutable message descriptors and native Preact bindings. Separate admin, customer and guest entry points include their own audiences. SSR creates a fresh translator; browsers keep a controller per document or customer modal. Newer locale preparation supersedes older work; failure retains the current complete snapshot. One failing subscriber cannot prevent other roots from updating.

Workflow state retains reason codes and data rather than translated sentences. Rendering uses the active translator. Locale changes preserve drafts, Undo, invalid input, focus, uploads, pending requests and retry identity. Product names, options, filenames and IDs remain supplied values. Unknown provider prose uses bounded recovery messages. The Products-launched setup-copy dialog also uses the document provider.

The initial hydrated snapshot matches SSR; a layout effect reconciles host locale before paint, including native component attributes. App Bridge navigation stays in an inert template until labels are ready. The existing reveal gate includes locale readiness. Unresolved SSR language uses neutral placeholders. Preview skeleton replacement now accepts the shell's added ARIA attributes, preserving the designed Methods/editor loading shapes.

Formatting remains separate from commerce and authorization. Counts retain BigInt precision; money uses exact decimal/minor-unit data and the authoritative currency. Locale does not change field parsing or canonical dates. Home and Orders share civil-day boundaries. Human PDF/archive copy captures the generation locale; machine manifests, filenames and the existing CSV contract stay stable. Guest UI sets language on its owned content and leaves the Shopify document language intact. A processing timeout retains the admitted asset for another status check.

Shopify still owns product, cart and checkout. The selected customer modal returns control to its host after verified completion. The older integration customizer does not replace that design.

## Verification

Independent reviews inspected actual English/expanded screens at 1440, 390 and 320 px. The [Home/Settings recheck](../../../.artifacts/localization-implementation-2026-11-03/screen-review/after/review.md) and [customer/editor recheck](../../../.artifacts/localization-implementation-2026-11-03/customer-editor-final-review/review.md) record concrete findings and their corrections. New browser regressions reproduce the hydration, independent-dialog and responsive defects before their fixes.

Native Chrome page zoom also reached 400%, confirmed by the browser's own zoom indicator. Expanded Settings content used a 378 px CSS viewport and a 378 px document width. Tab reached all three cards and scrolled the final Billing card and focus ring into view. Zoom was reset and the temporary tab closed. The [observation receipt](../../../.artifacts/localization-implementation-2026-11-03/native-zoom-reflow.json) scopes this to the local app frame, without the developer footer or a claim about Shopify's host.

The final source review confirmed that partial image-upload rejection feedback survives accepted-file completion, supplied order names remain unchanged in machine filenames, and editor panel/coordinate actions cancel stale queued name-field focus. Independent inspection of the generated expanded PDF then found an artwork caption extending beyond its thumbnail column. The renderer now wraps reference captions and missing-artwork labels within their columns and reserves the extra caption height. A regression measures actual Canvas glyph bounds, and the [four-page PDF recheck](../../../.artifacts/localization-implementation-2026-11-03/pdf-final-review/review.md) confirms the overlap is fixed without losing long supplied names, accented glyphs, quantities or footers.

The final customer package is `insignia-localization-0.1.0-1f7aed7ae1e28b6f.tgz`. Its disposable clean install and strict build passed. The [verification receipt](../../../.artifacts/localization-implementation-2026-11-03/verification-receipt.json) reconciles the broad run with complete reruns of the three corrected test files. The [source fingerprint](../../../.artifacts/localization-implementation-2026-11-03/frontend-source-fingerprint.json) confirms application code, catalogs, dependencies and the consumer archive stayed unchanged during those test repairs.

| Check | Result |
| --- | --- |
| Localization runtime, catalog parser and source guards | 32 tests passed; CLI checked 174 files; companion TSX/Astro/Liquid copy check passed. |
| Selected customer configuration and locale checks | 74 configuration and 9 locale tests passed. |
| Builds, types and source coverage | Merchant and both customer builds passed; all 39 strict compiler projects passed; no untyped or unchecked repository source. Formatting passed with existing warnings. |
| Merchant/shared browser and model coverage | 719 passing cases after reconciliation, 60 explicit environment/capture skips. |
| Integration buyer browser/model/cart contracts | 69 passed, 2 explicit skips. |
| Final complete rerun of corrected test files | 35 passed, 2 optional capture skips, no failures or cancellations. |

The broad run's web portion initially reported 710 passed, four failed and five cancelled cases. Their causes were obsolete copy expectations. A later combined rerun also exposed two navigation-load waits and an intermittent drag-test ordering problem. The final test-only repairs use actual workflow readiness after navigation, canvas focus and stable bounds before pointer input, and the effect-published projection after dragging. Original money, invalid-input, removal and saved-payload assertions remain. The [independent test-repair review](../../../.artifacts/localization-implementation-2026-11-03/placement-test-repair-independent-review.md) records both the preserved assertions and the distinction between observed behavior and the inferred stale-coordinate timing.

Every previously failing or cancelled case appears in the final passing rerun. This is staged verification against unchanged application sources. It does not claim that the earlier nonzero `frontend-state` invocation became green or that another complete invocation was run afterward. Earlier failed logs remain intact; `final-regressions.tap` and `final-types.log` are the final repair/type receipts.

## Boundaries

Canonical source/type checks run through `pnpm check`. Hosted CI does not provision the selected customer sibling, which is outside this Git repository and has no remote. The complete local `test:frontend` command requires its absolute path and verifies the immutable package, lock integrity, disposable clean install and build. Hosted customer enforcement needs an explicit versioned source acquisition arrangement. No checkout is invented here.

The existing full Polaris boundary command still flags pre-existing Home/guide/chip and semantic-markup choices. Snapshot comparison distinguishes those from localization additions. New inert spans/templates pass structural checks, with negative fixtures still rejecting substitute controls. This task does not redesign accepted UI to hide that earlier policy mismatch or declare the global boundary check green.

No Dutch, RTL, CJK, native Shopify propagation, real cart mutation, production deployment or owner acceptance is established. A real additional language needs complete catalogs and dedicated terminology/layout/input/output review. See the [package guide](../../../packages/localization/README.md) for editing messages and delivering artifacts.

## Sources

The implementation uses [i18next instances/API](https://www.i18next.com/overview/api), [configuration](https://www.i18next.com/overview/configuration-options), [interpolation](https://www.i18next.com/translation-function/interpolation), [Preact context](https://preactjs.com/guide/v10/context/) and [W3C text expansion](https://www.w3.org/International/articles/article-text-size.en). Merchant source priority remains the [admin guidance](admin-ui-guidance-2026-10-20.md). Shopify's [AppProvider migration guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/app-provider) separates app-owned localization from Polaris React locale imports. Pinned RC component validation, strict types and pinned-runtime screen checks are separate evidence.
