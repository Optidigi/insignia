# Individual wording changes and restoring defaults

4 November 2026. Implemented in the existing Translations settings screen. Frontend authoring remains browser-local; Shopify publication, shared persistence and live storefront delivery are not connected.

## Research and decision

[Shopify's theme wording editor](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/language/change-wording) supports changing individual phrases for branding without translating the whole theme. [Translate & Adapt](https://help.shopify.com/en/manual/international/languages/translate-adapt-app/manual-translation) and [Forms](https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/translation) document a language/resource/field/Save workflow. Those pages do not document a general whole-language restore button.

Shopify does document a narrower override pattern in its [storefront locale files](https://shopify.dev/docs/storefronts/themes/architecture/locales/storefront-locale-files#override-shopify-provided-translations): removing a Shopify-provided override key exposes the next applicable default. Insignia adapts this separation of custom wording and defaults; it does not claim Translate & Adapt owns our private customer-copy records.

Root inspected the live Translate & Adapt DOM again on the dev store. English/United States market adaptation had English/Global reference fields beside empty editable targets. Entering one unsaved test phrase enabled Save; clearing that phrase returned Save to disabled. Root restored the field to empty and did not save any Shopify content. This is evidence about unsaved-field behavior, not proof of deleting a persisted Shopify translation. Two independent Luna Max researchers checked the Shopify sources and our sparse model.

## Implemented behavior

- Authors can change one phrase or any subset. Untouched values continue to use the shipped defaults; no full translation is required.
- All text and Customized text are deliberate views in desktop navigation and the compact section selector. Customized text shows entries with override records, not a translation-completion score.
- Each changed form has a Restore default action with a native tooltip and a descriptive accessible name. It removes that override rather than copying today's default into storage. Focus returns to the actual text area.
- Restore all defaults has an explicit confirmation for the selected language. It clears that locale's custom wording while retaining the locale and preserving other locales. It remains a draft until Save; Cancel and Discard retain their usual roles.
- Empty target fields say Use default. The English reference and fallback explanation remain visible in their existing places. English is currently the only bundled language. A Dutch authoring target does not imply bundled Dutch defaults.
- Edited/reset entries and custom-wording search results remain available while editing. They refresh after Save, Discard, context change or a new search, so clearing the phrase used to find a row cannot remove it midway through replacement.
- Clearing search retains scope. The chosen authoring language survives the overview breadcrumb and reload through `wordingLocale`, separately from the staff UI `locale` parameter.
- Variable-bearing fields explain which exact tokens to preserve before validation fails. Active sections are announced through Polaris's supported accessibility label. Host `aria-current` did not reach the native button and was removed.
- The compact section chooser remains through 1199 px and the desktop rail begins at 1200. Comparison rows stack through 760. This corrects the old 901 px editing-width cliff. Loading skeleton breakpoints match.

Persisted overrides retain the existing version 1 schema and pure save transaction. A separate small presentation reducer owns section, search, pagination and pinned result membership. Defaults and merchant wording remain separate records; shipped catalogs are not modified. When additional bundled languages are introduced, their baseline catalogs and fallback registry must be added explicitly. No automatic translation or new default language is invented here.

## Verification

The existing browser workflow was extended rather than replaced. It passed customization of two English phrases, custom-wording search replacement/clearing, individual restore with focus, Discard, Save/reload, bulk restore Cancel/confirm/Save/reload, retained locale, global search, authoring-language navigation, variable-error focus, long text growth/shrink, Arabic direction/plural forms and all existing load/save/read-only/storage recovery states. Saved captures wait for the host Save button to settle to disabled, avoiding a transient unsaved header next to successful save feedback.

The same run measured target text areas at 601/700/760/761/900/901/1024/1199/1200 px. All retained at least 200 px and no page overflow was found. Desktop 1440, phone 390 and short-phone 320 captures remain. The gallery contains 22 translation states/66 images; nine additional intermediate-width captures are retained alongside them. Two query-aware loading-skeleton browser checks pass.

Focused model/route/guard/fixture tests:25 passed. Localization:28 Vitest tests and 14 script tests passed, including removing individual overlays and returning to defaults without modifying the shipped catalog. All 39 strict compiler projects, source contract, copy/localization checks, web Astro check/build and clean customer archive installation/strict build pass. Style has no errors; existing 137 warnings/127 informational diagnostics remain. Exact receipts/logs are in `.artifacts/translation-wording-defaults-2026-11-04`.

The pinned runtime remains Polaris 2.0-rc / types 2.0.0-rc.3. Shopify's isolated public-control contract validator passed, resolving its 2.0-rc endpoint to v2.0. Full app source is checked by the repository's pinned compiler because Shopify's source-mode validator cannot resolve local workflow imports. Native text-area focus uses a small compatibility helper that traverses open shadow roots semantically and calls standard focus; it does not change native values, attributes or styles. A future closed shadow tree can limit that fallback and requires a runtime-upgrade regression check.

An independent Sol reviewer checked source plus final Customized text 1440/390/320, per-field restoration, restore confirmation, restored defaults and 761/901/1200 px images. Its two findings, live-search row loss and ineffective active-section semantics, were corrected. The corrected capture also shows a settled saved header. No material finding remained in that review. See [independent review](translation-wording-defaults-sol-review-2026-11-04.md). Full keyboard/assistive-technology conformance, native host Save Bar behavior, shared persistence and live delivery are not established by this local pass.
