# Complete frontend localization plan

2 November 2026. Plan only, following the owner's request for fresh research and independent Luna Max reviews. This supersedes the [30 October plan](localization-implementation-plan-2026-10-30.md). No dependencies, application code, catalogs, Shopify configuration or language settings were changed.

## Recommendation

Use i18next core with a small native Preact adapter, source-controlled translation catalogs and explicit Shopify locale inputs. Keep one canonical localization package shared by the admin app and selected customer customizer. Translate complete workflows and their failure/recovery states. Keep commerce state, merchant content and technical identities separate from display language.

The implementation covers the complete selected frontend, organized into reviewable changes. It is not a pilot or a replacement UI. Reviewed English copy and the current layouts remain the baseline. Translation changes should repair expansion/reflow problems without redesigning accepted screens.

English remains the source and fallback language. The initial advertised additional languages are a product choice, not something Shopify's language list determines for us. I recommend Dutch as the first additional language, subject to a complete copy review. German/expanded pseudolocalization provide layout stress. Arabic and CJK cases provide targeted engineering checks and are not advertised languages until their own language, input, font, direction and export checks pass.

## Research and current facts

Main-agent research checked current i18next, Shopify, Preact, Astro and W3C sources alongside the actual manifests, admin document/navigation, theme blocks, exact-money/date helpers and new quantity layout. Four independent Luna Max investigations supplied:

- [Source and text ownership inventory](i18n-text-inventory-luna-2026-11-02.md).
- [Shopify locale and extension boundaries](i18n-shopify-locale-luna-2026-11-02.md).
- [Runtime, package distribution and responsive behavior](i18n-runtime-layout-luna-2026-11-02.md).
- [Input, accessibility, money, time and export edge cases](i18n-edgecases-luna-2026-11-02.md).

Two follow-up challenges of the consolidated plan identified three contracts to make explicit: the initial shell/skeleton visibility gate, exact BigInt aggregate counts versus numeric plural selection, and civil-day boundaries around midnight transitions. The plan incorporates those corrections. The edge-case reviewer confirmed its two findings resolved. These are source/documentation reviews; translated screen and runtime acceptance tests belong to implementation.

The admin currently uses Astro 7.3.5 and Preact 10.29.8. The selected customer modal is the separate Vite/Preact `designer-prototype`, not `apps/storefront`. Current translation support consists of scattered locale-aware formatting, not an existing i18next/catalog system. Some selected Methods/editor presentation lives in `apps/web/test/admin/support`, so excluding all test paths would omit the UI being handed off.

The registry reported i18next 26.7.1 and i18next-cli 1.82.1 during this research. These are candidates to pin and verify at implementation, not installed versions. Fresh [i18next TypeScript documentation](https://www.i18next.com/overview/typescript) says typed string keys remain supported and selectors remain optional. An older search excerpt claimed future deprecation; that claim is superseded by the fetched documentation. Prefer typed semantic string keys for this codebase. Do not add selector optimization or React bindings without a demonstrated need.

## 1. Define exactly which text belongs where

| Text family | Treatment |
| --- | --- |
| Admin shell | Translate document titles, App Bridge navigation, route headings, page skeleton announcements, initial unavailable/reopen messages, shared actions and save/discard feedback. |
| Home | Setup guide tasks and actions, statistics labels and definitions, date ranges, recent-order captions/statuses, draft actions, first-use/empty/loading/error states and guide dismissal/restoration. |
| Products | Search, filters, sort/columns, selection and paging, configuration states, bulk actions, copy/export feedback, no-results/retry states and full-name disclosures. |
| Methods | Index, create/edit/rename/duplicate/remove, pricing/default scope, assignment/tag/product/collection pickers, dialogs, validation, limits, unsaved/conflict/recovery and empty states. Include selected support-folder presentation. |
| Product editor | Views, placements, artwork areas, images and variant-photo assignment/grouping, size/method/price controls, customer options, previews, keyboard instructions, Undo/Redo, save/publication, unavailable/conflict/discard and image-error states. Include canvas DOM labels and selected support-folder components. |
| Orders and artwork | Search/date/display controls, payment/artwork states, quantities, original artwork attachment/history/expiry, preview and download controls, export scope, production-sheet dialogs, unavailable files, progress and recovery. |
| Artwork upload surfaces | Existing authenticated upload and guest-upload components in their actual editor/order/custom-element owners, access/expiry states, file guidance, verification, progress, success, reselect and retry. There is no standalone guest-upload page to add. Share messages only where the audiences and recovery meanings agree. |
| Settings | Settings hub, Storefront setup and test guidance, App permissions, app-owned Billing statuses/actions and errors. The removed customer-data request UI stays removed. |
| Customer modal | Artwork, Quantities, Review, option/placement pickers, method/decoration-size labels owned by the app, upload/positioning controls, price breakdown captions, notices, validation, unavailable selection recovery, close/discard/Undo, pending add/update and failure recovery. Include light/dark theme menu text. |
| Editor-launched artwork preview | Inventory its own title, loading/failure/context text and pass the merchant's language as explicit presentation context. Reuse customer messages for shared Designer controls. Its separate document also needs matching language metadata. This preview remains outside the connected customer modal bundle; lab controls and host/cart stand-ins remain development-only. |
| Accessible and less-visible text | `aria-label`, meaningful `aria-description`, Polaris `accessibilityLabel`, placeholders, tooltips, image alternative descriptions, full-filename/name affordances, live regions and keyboard instructions. ID references such as `aria-describedby` and key tokens such as `aria-keyshortcuts` remain stable. |
| Human-readable generated output | Localize production-sheet headings, warnings, captions, counts and layout at generation time. Localize human ZIP README/reason text while preserving technical manifests, folder paths and originals. |
| Shopify theme extension | Use Shopify's separate schema locale files for Theme Editor names/settings/defaults, and storefront locale files for fixed launcher/recovery text outside the modal. Keep Shopify-managed text setting values in that content system. |
| Merchant and Shopify content | Display product/order/variant names, option names/values, view/placement/method/size names, filenames and accepted history as supplied. They are not i18next keys. A buyer can receive Shopify-localized content when the integration supplies it; this plan does not machine-translate private configuration. |
| Technical and development text | Keep IDs, enum values, API/JSON keys, amounts, currency codes, URLs, hashes, extensions, log messages, test assertions, fixtures and local gallery/lab controls outside shipping translation catalogs. App-generated generic fallback captions still need translation. |

App-generated default names need an explicit rule: a new default can be localized when created and then becomes saved merchant content. Existing names such as Front or Small must not be silently rewritten when the interface language changes. Branding remains Insignia. Translate descriptions around a filename or SKU, not its identity.

Each source file gets a disposition in a maintained inventory: migrated, merchant/platform content, technical-only, development-only or retired. A path named `test` is not enough to exclude selected presentation. The full file-family mapping is in the inventory review above.

## 2. Resolve Shopify and formatting locales explicitly

Keep these distinct: requested host locale, active catalog language, formatting locale and UI direction. Currency, currency exponent, country/Market and shop IANA time zone remain independent domain inputs.

### Merchant admin

1. Read Shopify's documented `locale` parameter on the initial Admin GET request for SSR. Validate/canonicalize it and resolve it against an explicit supported-language registry. It is presentation input, never proof of authentication, shop identity or permission.
2. Render the Astro shell, document `lang`, title and initial resources from that resolved context. During browser bootstrap, reconcile with synchronous `shopify.config.locale` before revealing content. App Bridge's value wins for the current embedded admin user.
3. Preserve the resolved locale on app-owned internal GET navigation through a common URL builder. Retain Shopify host/auth context; do not append language to cart signatures or reinterpret it as a Market. The current production admin uses full-document navigation, so this does not require a new router or an invented fragment-fetch header.
4. If the server receives no usable locale, use a text-free, `aria-hidden` loading structure and the branding-only title Insignia until resolution. The existing skeleton is not already neutral: it contains English headings/status copy, and the current readiness rule hides only route content. Explicitly gate App Bridge navigation, skeleton text and shell copy as well as islands. Publish localized navigation, title, loading announcements and controls together once the context is ready. A failure must reach a usable, internally consistent English fallback with `lang="en"` rather than remain hidden indefinitely.
5. Use a per-request translator for SSR. Independently hydrated Preact roots share the document's client locale controller explicitly; a provider inside one island does not localize other roots or static Astro markup. Make shell copy reactive where browser reconciliation can change it.

Shopify documents the GET parameter in [Localize your app](https://shopify.dev/docs/apps/build/localize-your-app) and browser locale in the [App Bridge Config API](https://shopify.dev/docs/api/app-home/v2.0/apis/authentication-and-data/config-api). A base tag such as `en` does not establish a separately selected regional-format preference. Use the supplied tag as supplied; do not manufacture `en-US` or derive a region from the shop's country.

### Customer customizer and theme

The connected theme adapter passes `localization.language.iso_code` and its direction to the selected modal alongside existing product and commerce context. The current blocks pass country, Market and localized cart root, but omit language. The local demo adapter supplies the equivalent explicit language for testing. [Liquid shop_locale](https://shopify.dev/docs/api/liquid/objects/shop_locale) documents language tags and direction.

The modal owns only its root, dialogs and portals. It leaves the Shopify page's document language and direction alone. Shopify keeps its product page, cart, checkout, plan approval and consent UI. No new app language selector is needed. An explicit in-place host locale update can preserve the mounted draft; a Shopify language form that navigates/reloads the parent tears down the modal, and this plan does not promise persistence across that navigation.

Shopify's translation tools do not automatically translate our bundled catalogs or proxy responses. Schema/storefront locale files and merchant-editable theme text remain Shopify-owned. This is distinct from a future translated private product-configuration feature. [Theme extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration), [Shopify content translation](https://shopify.dev/docs/apps/build/markets/manage-translated-content).

### Resolution and fallback rules

- Canonicalize BCP 47 tags, catch malformed values, allowlist resource mappings and preserve script distinctions. Declare mappings for regional variants rather than treating `zh-Hant` and `zh-Hans` as interchangeable.
- If a supported language family has the requested regional tag, retain that tag for formatting, for example Dutch text with `nl-BE` formats. If the language is unsupported, use complete English UI and English app formatting. Keep the original request only as diagnostic/presentation context.
- Verify `Intl` support for the selected format locale. Never infer an unavailable user regional preference. Default browser detection cannot override Shopify's language choice.
- Set `lang` and `dir` to the language actually rendered after fallback. A full English fallback is LTR even if the unsupported request was RTL; isolate merchant text with its own direction.
- Missing/empty keys fail CI. English is also bundled as runtime protection. If a locale chunk fails during initial startup, use the complete English route/modal. If a later locale preparation fails, keep the previous complete language. Log safe diagnostics without sending names or uploaded content to a translation service.

## 3. One package, two frontend build arrangements

Create canonical `packages/localization` with browser-safe ESM/types and narrow exports: `core`, `admin`, `customer`, and `preact`. Keep Preact a peer dependency of the adapter. Admin and customer entry points expose only their allowed messages. Server-only code and merchant catalogs must not enter the customer bundle.

The monorepo admin uses its normal workspace dependency. The separate npm/Vite customer project cannot consume `workspace:*`. Build and pack an immutable versioned package from the same source, deliver that artifact with the frontend handoff, and pin its relative artifact path/version/integrity in the customer lockfile. CI verifies the artifact digest against the canonical build and proves a clean customer install without an absolute developer path. The tarball is generated distribution, not a second editable catalog. A private registry can carry the same package later; it is not required for V1. A local source bridge is development-only.

Ship no hosted translation dependency, runtime machine translation, React compatibility layer, Astro locale-prefixed router or database translation editor. General Translation may prepare reviewed catalog changes later; it is not a runtime dependency.

Use workflow namespaces rather than one enormous file: small common actions, merchant shell, Home, Products, editor, Methods, Orders, Settings, exports and customer modal. Start with the current workflow's required namespaces and bundled English fallback. Other language/workflow chunks use explicit build-time import maps, not arbitrary URLs derived from locale input. Cache immutable catalogs/import promises by version, language and namespace.

## 4. Typed messages, state and safe rendering

Keep approved English messages as the canonical JSON source. Generate literal key/interpolation declarations from it and use i18next strict key checks through audience-specific typed functions. Required `count`, maximum, filename and resource-name parameters should fail compilation when missing. Add explicit parameter contracts where numeric/string semantics cannot be inferred from placeholders. Prefer semantic keys such as customer quantity errors to English sentences as keys. Do not concatenate translated fragments or deduplicate unrelated messages merely because both currently say Save.

Use native JSON-v4 plural categories and raw numeric `count`; format its visible digits separately. Validate locale-appropriate plural categories rather than requiring every language to have English's exact suffix list. Use whole-sentence interpolation, and `Intl.ListFormat` for human lists. Avoid manual capitalization and English `count === 1` branches. [i18next types](https://www.i18next.com/overview/typescript), [plurals](https://www.i18next.com/translation-function/plurals), [namespaces](https://www.i18next.com/principles/namespaces).

Existing order totals also aggregate counts as `BigInt`. Keep the exact value for display formatting and pass a separate formatted-count string to messages. A checked adapter may supply i18next's numeric plural `count` only within the safe-integer range; never pass `BigInt`, its string form or an unchecked `Number()` conversion as that argument. For an aggregate beyond that range, use an explicitly authored count-neutral message such as a total label plus its exact formatted value. This avoids inventing inaccurate plural categories. Require type/runtime checks at the actual aggregate call sites, including `0n`, `1n` and values beyond the safe-integer boundary.

Move locale-dependent text out of reducer/runtime state into render-time mappings from stable reason codes and safe values. Include upload, commit, discard, remove/Undo, validation, publication/conflict and retained-selection errors. Locale changes re-render an existing notice without replaying its request. Keep translators, language strings and formatting out of pure price/design reducers.

Existing API errors need a bounded code/status/path mapping. Unknown provider prose gets a reviewed generic message, not raw `Error.message`. If a precise message needs a new semantic response code, coordinate a strict shared-contract change with the backend; do not classify English substrings or casually add fields to strict DTOs. Raw schema/debug details stay diagnostic.

Messages return text. Preact text nodes and Astro's escaped interpolation are the rendering sinks. Configure escaping once to avoid double-escaped names, and test `<`, `>`, `&`, quotes and malicious-looking filenames at each sink. Never insert translations as raw HTML or trust a URL from a catalog. Prefer existing separate action links; if a full sentence genuinely needs reorderable links/emphasis, use a small allowlisted component-parts mechanism with destinations supplied by code. Exports use their own escaping, including retained CSV formula protection. [i18next interpolation](https://www.i18next.com/translation-function/interpolation).

SSR gets a fresh initialized i18next instance/fixed translator per request. Cache resources, not mutable request language. Browser state is scoped to the admin document or each modal. To switch language, prepare a separate translator snapshot with the complete required resources, then atomically activate only the latest requested generation. A generation check around concurrent `changeLanguage()` calls on one shared mutable instance is not enough. Keep the current complete language visible while preparing, and remove listeners on unmount. Native Preact context/hooks subscribe to the controller snapshot; no React hooks are required. [i18next instances/API](https://www.i18next.com/overview/api), [Preact context](https://preactjs.com/guide/v10/context/).

The existing admin readiness condition must include shell/catalog readiness before revealing controls. Do not add an arbitrary delay or regress the loading/popping fixes. Locale preparation does not reset resource authority, pending operations, request generations, drafts, Undo, accepted totals, retries or idempotency keys. Bfcache return rechecks host locale alongside the existing independent authentication/resource resume path.

## 5. Formatting and input rules

| Concern | Rule |
| --- | --- |
| Money | Reuse exact minor-unit/exponent formatting for historical orders. Currency comes from authoritative data, never language. Preserve JPY/KWD/large-integer checks. The customer fixture's `cents / 100` is a two-decimal demo contract; translating it does not enable more currencies. Resolve that separately when connecting real prices. |
| Quantities | Keep safe-integer domain values and existing blank/invalid behavior. Never put grouped display digits into `value` or parse formatted totals. Test actual shipped-locale keyboards, typing, paste, clearing and invalid drafts. Native number-input digit support varies; a non-Latin-digit launch requires a tested input-boundary parser or proven native support. |
| Editable money/dimensions | Use the actual field's locale contract. Where the app parses text, accept only declared digits/separators and preserve exact decimal conversion. Do not remove commas blindly. Blank price remains missing; explicit zero remains free. Preserve the locale in which an active dirty field began editing until its value is committed or cleared, avoiding reinterpretation mid-edit. |
| Dates | Display with the active format locale and actual shop IANA zone. Retain canonical ISO/Gregorian machine dates and calendar-day comparisons. Language cannot change filtering, chronology or expiry. A civil-day boundary is its earliest valid instant, using the earlier occurrence of repeated midnight and the first valid time after a skipped midnight. A wholly skipped civil date advances the boundary to the next existing day. If adjacent boundaries coincide for an explicitly requested day, show the localized empty-period state without sending the invalid equal-bound filter. Share this policy across Orders and Home windows; derive the next calendar boundary rather than adding 24 hours. |
| Counts, units and lists | Format numbers, limits, percentages, file sizes and physical dimensions; preserve their actual scales and cm/mm/byte meanings. Let translators control word order, plural forms and captions. Do not perform unit conversion as a translation side effect. |
| Search and sorting | Use the same explicit locale normalization for query and content. Keep canonical status/filter values stable. Use locale collators only for presentation-owned sorts, never protocol ordering or server cursors. Preserve authored/catalog order for options. |

Separate formatting from `createProductModel(config)`'s currently cached `config.locale` formatter. Updating language must not require a new product configuration identity or remount the designer. Use locale-aware display helpers while price arithmetic and exact variant identities remain unchanged. [i18next formatting](https://www.i18next.com/translation-function/formatting), [ECMA-402](https://tc39.es/ecma402/).

## 6. Responsive layouts, truncation and direction

Short English labels can expand substantially. Use flexible space and normal reflow, not smaller text to force translations into English-sized boxes. Pseudolocalize short actions aggressively as well as paragraphs. [W3C text expansion](https://www.w3.org/International/articles/article-text-size.en.html).

- Keep primary actions, field labels, validation, prices and option distinctions readable. Wrap actions or stack their group before clipping an essential word. Reserve count/status space independently of long names. Footers and focus rings must remain reachable and unobscured.
- Restrict ellipsis/clamping to content summaries with an existing full-text disclosure that works on keyboard and touch. A native hover title alone is insufficient. Keep full accessible names. Never truncate the stored text or modify identifiers to fit.
- Inspect Products/Orders identity columns, Methods pickers, editor side panels, image/group labels, dialogs, Home tasks, Billing cadence/status and customer option/quantity/review controls. Test native Polaris shadows/internal labels, not just supplied outer text.
- UI-only translation must not rebuild the quantity layout. If newly localized merchant/Shopify content crosses the current twelve-code-point grid/list heuristic, preserve a stable quantity view during editing or restore the same row/column input and its draft/caret after a deliberate layout change. Prefer responsive control geometry over adding more English character thresholds.
- Keep the modal instance, variant IDs and configuration keys stable across locale updates. Do not dispatch a quantity-selection event merely to translate it. Preserve IME composition and dirty numeric-field parse context.
- Use language/direction on the owned document/modal and its portals. Use logical layout properties for chrome and bidi isolation for names, SKUs and filenames. Keep source strings and copyable IDs free from inserted formatting characters. Text-only sinks that need bidi controls get a display-only wrapper. [W3C bidi guidance](https://www.w3.org/International/articles/inline-bidi-markup/index).
- Full RTL support needs its own accepted pass. It changes relevant text/chrome alignment and directional navigation icons; it must never mirror garment photos, artwork, canvas coordinates or placement movement controls. English fallback remains LTR. CJK needs font and line-break checks as well as translation.

Verify runtime/type identity for the existing `polaris-2.0-rc.js` and pinned `@shopify/polaris-types` RC.3. Current docs distinguish RC and stable channels; do not silently upgrade the UI as part of translation. Confirm the actual served components' language/direction behavior and internal date/number/accessibility text against the chosen pin. [Polaris versioning](https://shopify.dev/docs/api/app-home/latest/web-components/versioning).

## 7. Outputs and content contracts

Capture the export locale and message version at the start of generation. One PDF/ZIP cannot change language halfway through because the UI changes. Preserve order facts and existing expiry/retention decisions; existing archived/accepted outputs are not regenerated or translated in place.

The production sheet currently draws text to canvas and embeds page images in a PDF. Inspect both screen preview and actual downloaded PDF for glyph coverage, wrapping, pagination and warnings. This includes multilingual merchant names, not just our UI labels. Use reproducible licensed font coverage and await fonts before measuring/drawing. Keep selectable PDF text or a new PDF engine outside this localization change unless a separate requirement justifies it. Do not advertise RTL/CJK output based on English/Dutch screenshots.

Preserve the existing configuration CSV's column order, fixed headers/status representations, quoting, BOM and formula-injection protection as its current stable export contract. Its UI action and surrounding feedback are translated. Do not silently turn that file into a locale-dependent spreadsheet; a separately versioned human-localized export can be considered later. Keep JSON manifests, IDs, currency codes, artifact paths and original filenames stable. Human README/warning text can be localized through an export namespace.

## 8. Implementation sequence and completion criteria

| Stage | Work | Done when |
| --- | --- | --- |
| Inventory and contracts | Build the file/text disposition inventory, glossary, locale registry, error-reason mappings and output policy. Record actual Polaris runtime/types. | Every selected workflow and text property has an owner; production versus selected preview versus fixture text is explicit; backend code gaps are listed without guessing messages. |
| Shared foundation | Pin i18next core/CLI, create catalogs and generated types, audience exports, package artifact, Preact adapter and SSR helpers. | Both builds consume one catalog source from clean installs; wrong key/namespace/parameter examples fail types; catalog and artifact checks pass. |
| Locale/readiness integration | Add Admin GET/App Bridge resolution, shell/island parity, customer host input and Shopify extension locale files. | Initial/current/fallback language and `lang` agree before reveal; no new router or English flash; two SSR requests and two modal instances remain isolated. |
| Complete workflow migration | Migrate shared shell, Home, Products/editor, Methods, Orders/artwork/exports, existing authenticated/guest upload components, Settings and customer modal, including all loading/error/accessibility text. | Each workflow works in English with identical actions, IDs, draft behavior and money. Selected merchant preview loading/failure text is covered and developer fixture copy is excluded deliberately. |
| Real languages and layout | Complete/review the chosen first locale, glossary and Shopify extension catalogs; run expanded pseudo-locale and representative real-language checks. | No missing/empty messages, broken plurals, clipped essential copy, unusable inputs or missing output glyphs in advertised languages. |
| Integrated review and handoff | Run focused state/locale tests, rendered review and existing frontend regressions; document adding/changing messages and package publishing. | Whole-frontend inventory has no unexplained gaps, independent findings are resolved, rollback restores the previous catalog/build, and native Shopify observations are reported separately. |

The canonical catalog stays editable in source control. Use current official i18next-cli where it supports the source shape, with explicit extraction/lint adapters for Astro, Polaris text properties and Shopify locale files. Its plugin hooks support non-JavaScript processing; a file glob alone does not add an Astro/Liquid parser. Add small positive/negative fixtures proving each extractor catches a real hidden string and ignores a technical ID. Avoid regex-only claims of complete TSX/Astro coverage. [i18next CLI plugin API](https://github.com/i18next/i18next-cli#plugin-system).

## 9. Proportionate verification

Fast checks cover every shipped locale: key/parameter parity, empty values, permitted plural families, safe interpolation, complete workflow namespaces, locale mapping/fallback, deterministic package build and customer namespace isolation. Use relevant plural values such as 0, 1, 2, 5, 11 and 21; a pseudo-locale does not prove real grammar.

Run focused behavioral cases for:

1. Two concurrent SSR languages, missing/malformed/unsupported locale, same-browser staff/shop context changes and two simultaneous customer modal locales.
2. Initial resource failure, missing namespace, old catalog version and out-of-order locale preparation. The latest request wins without an incomplete-language render or indefinite loader.
3. A language update during a draft, Undo, pending upload/cart request, error/retry, filtered quantity edit and open dialog. IDs, exact totals, request generation/idempotency and input focus stay unchanged.
4. Real-locale integer and decimal input correction; exact aggregate-count display with guarded numeric plural selection, including zero and values beyond the safe-integer range; one very large exact historical amount and zero-/three-decimal exponent formatter checks. Date checks cover normal DST, skipped/repeated midnight and a wholly skipped civil date in both Orders filters and Home periods, including the no-invalid-query empty-period result.
5. Full accessible names, field/error associations, screen-reader announcements and keyboard navigation on actual Polaris and customer controls. Fallback language attributes match the text spoken.
6. Actual production-sheet PDF and human ZIP output with long translated labels and multilingual names. Existing CSV bytes/columns/security remain contract-compatible.

Keep the existing full frontend suite for the English baseline. Add representative visual coverage rather than multiplying all 14 customer scenarios by every locale/theme/width: expanded Home/Methods/editor/Orders/Settings plus compact, bulk and long-list customer states at 1440/390/320; include dark appearance and one real 400%-zoom/reflow check. Review errors, menus, tooltips, footer actions, retained unavailable selections and long unbroken content. Add a real-language grammar/input smoke for each advertised locale. RTL/CJK get dedicated direction/font/export cases only when offered. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow), [Vercel interface guidance](https://vercel.com/design/guidelines).

The final implementation review must inspect actual translated screens and an actual PDF, not just validate catalogs or compare English screenshots. Local assertions cannot establish Shopify host locale behavior, theme setting translations or a real cart mutation; test those at the integration seam when it is connected.

## Maintenance and decisions remaining

New user-facing text enters the appropriate catalog with context, parameters and translations. CI reports new untranslated literals and incomplete catalogs. Approve copy changes alongside code. Pin runtime and tooling versions, update through ordinary dependency maintenance and focused checks, and handle relevant security advisories. No paid translation service or continual runtime translation operation is required.

The remaining owner choice is the first advertised language set and who reviews its actual wording. English plus reviewed Dutch is the recommended starting point. Engineering choices, scope, fallback behavior, package distribution and acceptance checks are specified above. Implementation still requires the owner's approval; this turn is research/planning only.

## Step-one inventory follow-up

The owner authorized the inventory on 3 November. The [source inventory, independent audits and baseline checks](localization-step1-inventory-2026-11-03.md) refine text ownership and record the English-string comparison, archive warning classification, shared-summary reveal heuristic and selected-preview document context that need care during migration. Step one does not install i18next, change application behavior or approve translated layouts.
