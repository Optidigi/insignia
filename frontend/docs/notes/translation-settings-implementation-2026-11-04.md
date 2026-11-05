# Customer translation settings

4 November 2026. The owner rejected the first composition. The replacement below was rebuilt from fresh native DOM measurements, corrected through actual-screen review and verified locally. Owner acceptance remains separate.

## Reference and scope

The owner opened the working Shopify Translate & Adapt app on `insignia-rewrite-dev`. The earlier saved artifact was its resource hub, not its editor. This task inspected the actual **Default theme content** editor in English / United States, including its rendered DOM and computed layout.

At desktop width, its semantic table is a CSS grid: a 180 px field column and two equal reference/target columns. Source fields are read-only inputs; targets are separate editable fields. Search filters fields. Accessible labels, variables and separate plural forms are included. At a 390 px browser override, the app iframe was 379 px wide and each record stacked its label, source and target in a single column. The temporary browser viewport override was reset. No Shopify content, language, theme or translation was saved.

Reuse the source/target relationship, field grouping, filtering, explicit fallback and responsive stacking. The first interpretation omitted the category sidebar and resource-to-editor flow. The owner rejected that adaptation. The redesign follows the measured overview/editor hierarchy, compact comparison rows, section navigation and one-time column headings. Insignia still does not invent Market adaptation or an automatic translation service.

The new Settings destination edits Insignia's customer-customizer text. It does not edit Shopify product names, option values, merchant placement names, the theme block's button setting, Shopify's product/cart/checkout, or the staff Admin language. Shopify retains storefront-language publication. A selected translation target is not evidence that Shopify has published that language.

The current frontend phase uses browser-local storage through a narrow port. Shared shop persistence and deployment to a live storefront remain integration work. The review gallery identifies this local scope outside the merchant UI. Built-in catalog support remains English; merchant-written overlays are a separate customer-only input, with empty forms falling back to English. No automatic translations are invented.

## Sources and independent research

- Live Translate & Adapt DOM and pixels, described above.
- [Shopify Translate & Adapt](https://help.shopify.com/en/manual/international/languages/translate-adapt-app) and [manual translation](https://help.shopify.com/en/manual/international/languages/translate-adapt-app/manual-translation).
- [Shopify Forms translations](https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/translation), which also pairs language selection with field editing.
- [Shopify Settings template](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/settings) and [Save Bar API](https://shopify.dev/docs/api/app-home/v2.0/apis/user-interface-and-interactions/save-bar-api). The documentation aliases to v2.0; implementation must also pass the repository's exact 2.0.0-rc.3 types and 2.0-rc runtime checks.
- Installed Checklist Design Settings, Saving Changes, Input Error, Searchbar and Empty State checklists, recorded item by item in the [UX preflight](translation-settings-ux-preflight-2026-11-04.md).
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md): visible labels, keyboard/focus, inline errors, unsaved changes, content growth and narrow-screen overflow. Shopify sentence case and native controls take precedence where guidance differs.
- Three independent Luna Max passes: [reference research](translation-settings-reference-research-2026-11-04.md), [runtime audit](translation-settings-runtime-audit-2026-11-04.md), [UX preflight](translation-settings-ux-preflight-2026-11-04.md).

## Intended checks

Pure overlay/locale and reducer tests; save/load/discard/error/placeholder browser flows; actual desktop 1440, phone 390, short phone 320 captures; long copy, plural, search miss, unsaved switch, loading, read failure, write failure and read-only states. Independent Sol review must inspect actual pixels and source before completion. Results will be recorded after execution, not inferred from the design plan.


## Delivered behavior

Settings now includes Translations. The editor pairs the immutable English reference with merchant-authored text, groups the actual customer catalog, searches source and current text, and keeps normal sections in one compact table; an All sections search is paginated at 50 entries. Navigation fields follow the actual customer workflow before its loading/status labels. English wording can be edited, but its entry cannot be removed. Each locale remains independent; blanks use shipped English rather than another merchant-edited locale.

Language targets are manual authoring targets. Common choices use localized language names; additional canonical locale codes are validated, including duplicate, unsupported and reserved development tags. The selected customer runtime receives only validated customer/common overlays. Product names, option values and other supplied content are unchanged. No automatic translation, invented built-in languages, Shopify locale read, or language publication is presented.

The reducer owns load/save snapshots, dirty work, latest request outcomes, added/removed locales, reset and discard. Storage failures retain the draft; malformed records require an explicit confirmed reset. The existing Save Bar gains optional context props while its product-editor defaults and modal ID remain intact. A failed save receives visible focus; invalid submission reveals its first invalid section/page/field. Input errors wait until blur or submission rather than interrupting typing. Right-to-left target controls preserve the Admin/reference layout.

The selected Designer accepts a wording overlay through its existing per-instance locale controller, without resetting its design state. A real browser test changes/removes Dutch wording while a quantity is invalid and focused: input, focus and workflow remain intact. There is no Settings draft-preview action because this page has no selected configured product context; no fake product was added to imply one.

## Review and verification

Three Luna Max research/implementation lanes and two independent Sol reviews were used. The earlier composition passed functional checks but the owner rejected its interpretation of the reference; those first reviews do not constitute acceptance. Root returned to the actual Shopify app, inspected its overview, editor, phone layout, long text and computed DOM, and rebuilt the composition. The final two Sol reviews inspected fresh desktop/390/320 images and source, with no unresolved material finding in the reviewed local scope. Native reference inspection was performed by root; reviewers explicitly distinguish those observations from their independent implementation-pixel review.

The replacement follows the resource overview → editor flow, section sidebar (~300 px desktop), 180 px field column and equal reference/target columns, one set of headings, 52 px short rows and a shaded reference band. Native public Polaris text areas retain their supported borders, unlike Shopify's private internal editor controls; this is an intentional implementation difference, not pixel identity. Phone controls use a top language chooser and section selector, then label/reference/target stacking. Source and target text share real content insets. Save is the page primary action, with the existing unsaved-change guard and no duplicate bottom fallback.

Long text areas use their public rows property, measured from a hidden HTML copy of the rendered control. The adapter reads nested open shadow roots in the pinned runtime but does not mutate its native DOM or cursor. It observes width, font readiness and value changes, shrinks after replacement, cancels work on cleanup and has a usable four-row fallback if future native internals become inaccessible. Rows cap at 12 with native scrolling for unusually long text. The browser test proves full normal long wording at each width and a return to a one-row field after short replacement.

The revised gallery contains 18 translation states (54 images), plus the refreshed Settings hub. Fresh redesign verification includes the complete translation browser flow, two query-aware overview/editor skeleton cases, the four-destination Settings flow, two existing product-editor save/discard cases, 19 model/route/leave-guard/fixture cases, all 39 strict compiler projects, source and copy/localization checks, style (no errors; existing warnings/information remain), and Astro check/build (183 files, zero diagnostics). Earlier unchanged localization/controller suites remain recorded separately in the receipt. The clean customer archive install and strict production build passed with `insignia-localization-0.1.0-3a07d791e020fd44.tgz`.

The Shopify source-mode validator cannot resolve the full component's local workflow imports and reported derived values as unknown. The actual repository compiled against pinned `@shopify/polaris-types` 2.0.0-rc.3 without diagnostics; an isolated contract using all the actual native control props also passed Shopify validation. Its documentation endpoint resolved 2.0-rc to v2.0. Both validator receipts are retained rather than treating the first failure as native component evidence.

An existing Vite dependency prebundle initially served the old customer controller after the immutable archive changed. The browser fixture now starts Vite with `--force`; the fresh customer run passed, as did the clean production install/build. No public tunnel, store content write, deployment or backend integration was performed.
