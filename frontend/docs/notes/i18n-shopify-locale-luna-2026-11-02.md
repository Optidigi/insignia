# Shopify locale review of the i18next plan

2 November 2026. Independent plan-only research for `localization-implementation-plan-2026-10-30.md`. No code, Shopify store data, or configuration was changed. The current worktree already contains unrelated dirty work; this review adds only this note.

## Current surfaces and pins

- Merchant UI is an Astro app rendered inside Shopify Admin's iframe. [AdminLayout.astro](../../../apps/web/src/layouts/AdminLayout.astro) injects App Bridge when an API key is present and loads `polaris-2.0-rc.js`; its `<html>` currently has `lang="en"`. [apps/web/package.json](../../../apps/web/package.json) pins `@shopify/polaris-types` to `2.0.0-rc.3`. The `api_version = "2026-07"` values in the inspected Shopify extension TOMLs belong to Function/API configuration; they do not pin the App Home Polaris web-component runtime.
- The selected buyer UI is the separate `../designer-prototype` customizer modal launched from Shopify's product page. The current theme block [customize.liquid](../../../extensions/insignia-theme/blocks/customize.liquid) passes country, market ID, locale-aware cart root and merchant-configured trigger label, but it does not pass the active language or direction. The theme extension has no `locales/` directory yet. This frontend is not connected to Shopify today; `apps/storefront` remains the backend-integration UI.
- The app-owned billing screen is [MerchantBilling.tsx](../../../apps/web/src/islands/MerchantBilling.tsx). [billing.ts](../../../apps/web/src/server/admin/billing.ts) links to Shopify's hosted plan-selection URL.

## Findings that should amend the old plan

### 1. Use the documented Admin request locale for SSR when it is present

The old plan correctly says App Bridge is browser context and cannot be read during Astro SSR. Its fallback description misses Shopify's separate guidance: Admin-rendered apps receive the app user's `locale` in Shopify's initial GET request query. Astro can read that request URL while rendering. Resolve and allowlist the query value on the server for the first response, use it for the HTML `lang` and shell/bootstrap, then compare it with `shopify.config.locale` once App Bridge is available. Keep the explicit English fallback for local/stand-in hosts and missing or unsupported values. Never let `navigator.language` override Shopify's chosen translation language.

`shopify.config.locale` is synchronous client-side App Bridge config; Shopify documents it as the Admin user's BCP 47 locale and explicitly distinguishes it from the customer-facing storefront locale. App Bridge APIs are not versioned with Polaris. See [Config API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/config-api) and [Localize your app](https://shopify.dev/docs/apps/build/localize-your-app).

**Locale-region limitation:** Shopify's docs say BCP 47 and show regional examples, but they do not promise a region subtag for every Admin user. A Shopify staff reply in the [locale query/config discussion](https://community.shopify.dev/t/potential-bug-with-locale-in-shopify-admin-extension/33476) says those values are only guaranteed to be a valid language tag and can be `en`, even when the Admin's separate regional format is `en-US`. Treat that as a material gap to verify against the current platform. The plan should distinguish translation language from number/date formatting locale and define what to do when Shopify supplies only a base language; it should not claim access to the Admin regional format. Currency, shop time zone, language, country and Market remain independent values.

### 2. Bootstrap the buyer modal from the storefront's active language and direction

The supported Shopify source is Liquid's `localization.language`, whose `shop_locale.iso_code` is an IETF language tag and whose `direction` is `ltr` or `rtl`. `localization.country` describes the selected storefront country and its currency; `localization.market` is the most-specific Market for that country. A country change can also change language when the current language is unavailable. These are related buyer-context inputs, not interchangeable locale fields. See [Liquid localization](https://shopify.dev/docs/api/liquid/objects/localization), [shop_locale](https://shopify.dev/docs/api/liquid/objects/shop_locale), and [multiple currencies and languages](https://shopify.dev/docs/storefronts/themes/markets/multiple-currencies-languages).

For the selected product-page modal, pass the host's active language and direction alongside existing product/cart context. Use them only within the customizer root and any customizer-owned portals; do not rewrite Shopify's product-page `html lang` or global direction. The current cart root already preserves Shopify's locale/Market URL context, so customer translation must not change the host cart or checkout flow.

The Shopify language/country selector is a localization form and locale/Market URLs may change. Do not promise that a draft survives a Shopify-owned page navigation unless a separate persistence contract is approved. If Shopify changes locale in-place while the modal remains mounted, the host must explicitly update the modal's locale input and the active catalog must switch without resetting its design. Do not add a second app-owned language selector to this scope.

### 3. Polaris supplies semantics, not an app translation system

The App Home web components do not have the old React `AppProvider` i18n contract. Shopify's migration guide says to remove Polaris React locale imports with the final React consumer and keep the app's localization system for app-owned text. The pinned Polaris type manifest at `2.0.0-rc.3` exposes limited `lang`/`dir` properties: `dir` on `s-text`, `s-paragraph` and `s-number`; `lang` on `s-button`, `s-clickable`, `s-link` and `s-press-button`. Those attributes help text direction and pronunciation. They do not translate labels supplied by Insignia or establish a complete RTL layout.

Set the Admin document's `lang` from the resolved Admin translation language. Keep RTL unadvertised until the app layout is reviewed. Audit component-owned labels and dates separately: for example, the [App Home date-field reference](https://shopify.dev/docs/api/app-home/latest/web-components/forms/date-field) says its default displayed month uses the user's locale, and the pinned type has no locale prop. Verify actual behavior alongside translated `label`, `placeholder`, `error` and accessibility text.

There is a version-targeting issue to resolve before implementation: source currently requests `polaris-2.0-rc.js`, while types are pinned to RC.3. Shopify's [versioning guide](https://shopify.dev/docs/api/app-home/latest/web-components/versioning) now documents stable Polaris 2, says RC promotion requires changing the URL, and recommends `polaris-2.js` or a frozen stable release for production. Do not treat a rolling RC URL as proven identical to the RC.3 type package. Align the runtime and type pin, or verify the exact RC served. The current documentation route redirected the requested RC reference to stable v2.0, so the local pin is the applicable evidence for RC-only component typing.

### 4. Keep Shopify-managed content translation outside the i18next UI catalogs

Shopify recommends merchant-facing admin tools generally use untranslated base product/resource attributes so staff see stable identities. Buyer-facing previews should use the appropriate localized Shopify data. If Insignia later makes Shopify-stored product or publicly accessible metafield content translatable, Shopify exposes that as resource translations via `translatableResource(s)` and `translationsRegister`, with locale publication, access scopes and content digests; this is a separate data feature. Translate & Adapt does not translate Insignia's bundled i18next catalogs or private app-database configuration. Shopify's translation guide also states that App Proxies do not support translations. See [Shopify Markets guidance](https://shopify.dev/docs/apps/build/markets) and [manage translated content](https://shopify.dev/docs/apps/build/markets/manage-translated-content).

Continue treating product, method, placement and option names saved by merchants as content rather than lookup keys. For merchant-facing product lists, keep Shopify's base identity; only a buyer-facing preview should request/display Shopify's localized resource data where the existing data contract supports it. Translation of Insignia's private configuration and user-authored names remains a separate contract.

### 5. Theme extension locale files are a second Shopify-owned surface

The old plan correctly separates extension text from the i18next package, but should state the two Shopify locale-file roles explicitly. A theme app extension's `locales/` can contain schema locale files for merchant-facing Theme Editor names/settings and storefront locale files for fixed customer-facing block/embed text. Merchants cannot edit the extension's storefront locale strings. See [theme app extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration), [schema locale files](https://shopify.dev/docs/storefronts/themes/architecture/locales/schema-locale-files) and [storefront locale files](https://shopify.dev/docs/storefronts/themes/architecture/locales/storefront-locale-files).

The existing `button_label` is a merchant-authored `text` setting after configuration. Translate its schema label and default through Shopify's schema locale mechanism; Shopify also supports translation of merchant-entered text settings through Translate & Adapt. Keep that value in the Shopify-managed content path and verify the extension setting translation in a real localized storefront. Fixed launcher/recovery strings rendered outside the modal use the extension's storefront locale mechanism. The modal's own UI remains in its bundled customer i18next namespace. If a fixed phrase must exist in both surfaces, define how one reviewed source feeds both catalogs so copy cannot drift.

### 6. Preserve Shopify's hosted billing boundary

The local billing route points to Shopify App Pricing's hosted plan page. Shopify owns plan selection, approval and billing UI; app-owned Billing labels/status remain in the merchant i18next namespace. Shopify App Pricing can show its own local-currency estimates, while Shopify explicitly says prices on an app's own pages are not converted. Format Insignia's own amounts with their actual amount/currency data and do not copy or translate Shopify-hosted plan/approval UI. See [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) and [billing overview](https://shopify.dev/docs/apps/launch/billing).

## Risks and unresolved decisions

- Decide a supported policy for `Intl` formatting when Shopify gives Admin translation locale `en` but not an Admin regional-format locale. Do not assume `en` means the user's selected `en-US`, `en-GB` or `en-NL` format.
- Verify whether the active Admin `locale` query and `shopify.config.locale` agree on current Shopify surfaces, and whether they carry a region. Keep the query value allowlisted because it is a UI selection input, not an authorization signal.
- Align Polaris runtime and type pins before the i18next integration work; verify text attributes and internal date/field labels against the selected runtime.
- Add an owner decision on which Shopify theme-extension phrases are fixed UI and which are merchant-editable content; add the missing extension locale files as a separate Shopify catalog surface.
- Define buyer-modal behavior for host language changes that navigate/reload versus an in-place attribute update. The latter can preserve draft state; a host page navigation tears down the modal unless a persistence contract says otherwise.
- Confirm that RTL support remains a separate reviewed milestone. Shopify exposes locale direction, but the Polaris attributes above only cover selected text/components and do not establish layout or image-mirroring correctness.

## Primary Shopify references

- [App Home Config API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/config-api)
- [Localize your app](https://shopify.dev/docs/apps/build/localize-your-app)
- [Polaris App Home versioning](https://shopify.dev/docs/api/app-home/latest/web-components/versioning)
- [Migrate AppProvider from Polaris React](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/app-provider)
- [Liquid localization and shop_locale](https://shopify.dev/docs/api/liquid/objects/localization), [shop_locale](https://shopify.dev/docs/api/liquid/objects/shop_locale)
- [Multiple currencies and languages](https://shopify.dev/docs/storefronts/themes/markets/multiple-currencies-languages)
- [Theme app extension locales](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration), [input settings and Translate & Adapt](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings)
- [Shopify Markets translations](https://shopify.dev/docs/apps/build/markets/manage-translated-content)
- [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)
