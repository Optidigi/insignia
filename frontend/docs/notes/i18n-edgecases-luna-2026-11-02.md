# i18next edge cases: independent challenge

2 November 2026. Planning note only; no application files, dependencies, or tests were changed. This checks the selected `../designer-prototype` customer modal and the Astro/Preact merchant app against the existing localization plan. It is meant to sharpen that plan, not widen the rollout into every Shopify locale.

## Decisions worth adding before implementation

### Keep the requested locale, catalogue locale, formatting locale, and domain inputs distinct

The plan correctly separates language from currency, Market, and store time zone. Make the distinction explicit in the runtime contract: retain the requested BCP 47 tag, the language actually serving catalogue text, the locale used by `Intl`, and the owned surface's direction. If an unsupported request falls back to English text, decide whether dates and digits still use the request's regional preferences; do not let i18next fallback silently change formatting. Set `lang` to the text actually shown after a full-catalogue fallback.

For the merchant iframe, the existing plan names `shopify.config.locale`, while Shopify's localization guide describes the admin user's locale arriving in the app request's `locale` parameter. Verify which source is present during the actual Astro document request, validate and canonicalize it, then pass the same resolved choice into the hydrated islands. Avoid an English SSR shell that changes locale after hydration. Shopify's admin language list is not this app's supported-locale list; ship only complete, reviewed catalogues chosen for the merchant and buyer markets. [Shopify localization guide](https://shopify.dev/docs/apps/build/localize-your-app) · [W3C language tags](https://www.w3.org/International/articles/language-tags/)

### Treat quantity entry as parsing, not just formatting

The selected customer UI uses `<input type="number">`, reads `validity.badInput` and `valueAsNumber`, and dispatches `NaN` as an invalid draft. Its reducer stores numbers, while Shopify variant IDs and option IDs remain strings. The HTML Standard separates a number control's user-facing presentation from its submission value and only *encourages* locale-specific presentation; it does not promise that every browser accepts every locale's digit repertoire. The current quantity path has no explicit digit normalization. [quantity entry](../../../../designer-prototype/src/quantity-entry.tsx) · [quantity reducer](../../../../designer-prototype/src/designer-state.ts) · [HTML input localization notes](https://html.spec.whatwg.org/multipage/input.html#implementation-notes-regarding-localization-of-form-controls)

For every locale included in V1, verify typing, editing, clearing, and round-tripping the digits the target browser actually presents. If a shipped locale uses non-Latin decimal digits and the browser control does not accept them reliably, add a deliberate parser at the input boundary (map permitted Unicode decimal digits to ASCII, reject grouping/decimal/sign characters for whole quantities, then validate the same safe-integer bounds). Keep the reducer and cart payload numeric/canonical; never localize IDs or parse a formatted display string. Do not claim untested numerals work because the keypad or placeholder looks localized.

### Translate plural forms and workflow messages at render time

The customizer currently builds English `item/items` with `quantity === 1`, and the admin order count does the same for a `bigint`; quantity and recovery messages are also assembled as English strings. These assumptions do not cover locale plural categories or translated word order. Use plural resources with the raw `count` value, then format the visible digits with the resolved formatting locale. [quantity entry](../../../../designer-prototype/src/quantity-entry.tsx) · [admin order count](../../../apps/web/src/islands/OrdersOverview.tsx) · [i18next plurals](https://www.i18next.com/translation-function/plurals)

The customer reducer also stores strings in upload failures, cart-commit failures, and recovery notices. Convert those to stable message codes plus interpolation data at the boundary, and translate them where rendered. Keep API error codes, enum values, reducer events, IDs, and cart protocol fields unchanged. The existing plan already calls for this migration; the source inventory should explicitly include the recovery/undo and quantity-validation paths, not only static JSX.

### Set an explicit interpolation and rich-text rule

i18next escapes interpolation values by default. For values rendered as Preact JSX text, keep them as text nodes and never feed translated strings to raw HTML insertion. If `escapeValue: false` is selected to avoid rendering HTML entities twice, constrain it to that safe JSX path; links and emphasis should be composed as Preact elements with trusted destinations, not encoded as HTML inside a catalogue string. Test a merchant-authored name containing `<`, `&`, quotes, and mixed-script text. [i18next interpolation](https://www.i18next.com/translation-function/interpolation)

### Preserve exact money and calendar contracts

Merchant order money already carries an exact minor-unit string and exponent and formats integer and fractional parts with `BigInt` plus `Intl.NumberFormat`. Keep that path display-only: do not round-trip locale-formatted currency back into a number, and do not infer the currency or its exponent from the language. [purchase-view.ts](../../../apps/web/src/shared/purchase-view.ts) · [ECMA-402 NumberFormat](https://tc39.es/ecma402/)

There is a separate customer-currency boundary to settle before claiming broader Markets: the prototype schema accepts any three-letter currency, but its price model names values `cents`, divides them by 100, and lets `Intl` choose the currency's normal fraction digits. This is safe only under the existing two-decimal price contract. Localization must not imply that the customer pricing model now supports zero- or three-decimal currencies; confirm the domain unit contract before expanding currencies. [customer price model](../../../../designer-prototype/src/model.ts) · [customer config schema](../../../../designer-prototype/src/config.ts)

Order display already uses the merchant locale with the shop's IANA time zone; canonical date-only values are extracted using ISO/Gregorian and Latin digits. Preserve that separation. Keep comparisons on calendar days in the shop zone, never by adding 24 hours, and check both clock-change weekends. One boundary deserves an explicit policy: `orderDayBoundary` requires a local `00:00` match and throws after four attempts, so a time zone that skips midnight on a date may not produce a filter boundary. Decide whether the boundary is the first valid instant of that civil date or an explicit unavailable-filter state. Also verify the current English-only `formatToParts` literal adjustment against each supported English variant. [purchase-view.ts](../../../apps/web/src/shared/purchase-view.ts) · [OrdersOverview.tsx](../../../apps/web/src/islands/OrdersOverview.tsx)

### Keep content search and stable export schemas separate from UI translation

The admin order search and customizer option search call `toLocaleLowerCase()` without the selected UI locale. If case-insensitive search is part of a shipped locale, apply the same explicit locale handling to the query and candidate labels; add a focused Turkish-I case for the locale where it matters. Search merchant-authored option names as authored; they are content, not catalogue keys. Translate enum labels such as `PAID` at display time while preserving the code used in filters and requests.

`productConfigurationCsv()` is a downloadable snapshot with fixed English headers and translated-looking status strings, plus spreadsheet formula protection. It is not a server protocol, but no consumer inventory here proves merchants do not automate against those columns. Keep API/protocol headers and machine identifiers stable. Decide whether this CSV is a stable machine-readable schema or a human-facing report before localizing its headers/status values; do not change its contract as a side effect of translating the screen. Preserve its BOM, quoting, formula-injection guard, column order, and user-authored product/method/location text. [CSV serializer](../../../apps/web/src/shared/product-configuration-export.ts) · [download action](../../../apps/web/src/islands/ProductsOverview.tsx)

### Check actual accessibility and export rendering

The merchant surface uses Shopify Polaris web components. Translate every supplied label, heading, placeholder, tooltip, error, status, and accessible-name property. Do not assume a root `lang` or admin language automatically translates a component's internal picker/menu copy; verify the actual Polaris 2.0 RC component and its accessible name in the running app. The same check applies to native number-input hints. Shopify documents Polaris as the App Home component layer but the app localization guide still requires apps to externalize their own strings. [Shopify App Home](https://shopify.dev/docs/api/app-home/latest) · [Shopify localization guide](https://shopify.dev/docs/apps/build/localize-your-app)

For the selected LTR locales, set language and direction on the owned document/modal root; do not alter Shopify's parent document. Wrap arbitrary product names, option values, and IDs in `bdi`/`dir="auto"` where inline punctuation or counts surround them. A real RTL launch needs a separate layout, focus-order, icon, customizer-host, and export review; setting `dir="rtl"` alone is not acceptance. [W3C inline bidi guidance](https://www.w3.org/International/articles/inline-bidi-markup/index)

The worksheet renderer uses browser canvas text with `system-ui, sans-serif` at 150 DPI, then embeds each page as a PNG in the PDF. It therefore depends on browser font fallback for glyph coverage and produces raster text rather than selectable/searchable PDF text. For each locale actually shipped, inspect both the worksheet preview and downloaded PDF with representative names and translated labels. Future CJK support needs verified font coverage and script-aware line wrapping; future RTL needs directional layout and text alignment in the canvas renderer. Do not advertise either until those export checks pass. [production-sheet-render.ts](../../../apps/web/src/shared/production-sheet-render.ts)

## Small acceptance additions

- Exercise one complete real shipped locale and English, plus pseudo-localized copy for expansion only, at 320, 390, and 1440 px. Pseudolocalization does not prove real plural rules, number digits, calendar formatting, direction, or font coverage.
- In the shipped locale, check quantity digit entry and correction, plural counts (including zero/one/many as applicable), one money value with its exact currency exponent, and order-date boundaries around DST in the configured store zone.
- Verify translated accessible names and validation/live-status messages on the actual Polaris RC and customer modal, with keyboard focus still landing on the corresponding field after an error.
- Inspect a representative exported production PDF in the actual browser/font environment for glyphs, clipping, and counts. Keep CJK, RTL, and unsupported-font locales outside the advertised set until their dedicated review is complete.

No full cross-product locale matrix is needed. Add only cases for locale behavior actually offered by the chosen release locales.
