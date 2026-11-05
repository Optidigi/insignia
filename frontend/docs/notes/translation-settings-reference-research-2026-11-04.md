# Translation settings reference research

4 November 2026. Research only. No application code, store settings, or Shopify data changed.

## Reference trace

The prior native observations do not contain a captured translation editor, so I cannot verify the exact page remembered from a screenshot. They contain two nearby references:

| Evidence | What was actually seen or documented | Fit |
| --- | --- | --- |
| [Shopify Translate & Adapt resource hub](../../../../.artifacts/home-research-2026-10-26/translate-adapt-resource-hub.png), recorded in [native observations](home-native-app-observations-2026-10-26.md) | A live app landing page with English/default context, grouped content links, a secondary language/quick-start rail, and no translated languages. No editor was opened and no translation was changed. | Good evidence for a language-aware entry point. It is not evidence of the editor layout. |
| [Shopify Forms overview](../../../../.artifacts/home-research-2026-10-26/forms-inactive-overview.png), also recorded in [native observations](home-native-app-observations-2026-10-26.md) | A live overview with one inactive form. No translation editor was opened. | The closest prior app task, but no translation screen was observed. |
| Shopify Help Center's [Translating your forms](https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/translation) workflow | The current guide describes opening a form, choosing a language, entering a manual translation for each field, and saving. It also documents an optional review step for Shopify Forms' own auto-translation. | Closest documented match to "choose a language, write custom wording, save manually." The editor itself was not captured in the prior work. |
| Shopify Help Center's [Translate & Adapt guide](https://help.shopify.com/en/manual/international/languages/translate-adapt-app) | The guide describes selecting a language, choosing a Shopify resource, entering translated fields, and saving. Translate & Adapt cannot translate Shopify Forms or third-party app content that is not a Shopify translatable resource or storefront locale file. | Likely source of the broader manual-translation idea, but not a way to edit Insignia's private app copy. |

The strongest conclusion is that the remembered *interaction* may be Shopify Forms' manual translation workflow, while the only prior live translation-app screenshot is Translate & Adapt's home. The exact editor is unverified. Do not describe either reference as a captured translation editor.

## Product boundary

Insignia's [localization package guide](../../../packages/localization/README.md) and [4 November implementation record](localization-implementation-2026-11-04.md) say English is the only shipped language. The customer catalog alone currently has 181 message strings across its workflow groups, before shared messages. `en-XA` is a development expansion test, not a customer language.

The approved localization plan excluded a database translation editor. Merchant-entered translations therefore need a new per-shop persistence and runtime contract. They are not enabled by adding a Settings page, editing the English i18next JSON, or calling Shopify's Translations API. Shopify's `translationsRegister` applies to Shopify translatable resources and requires `write_translations`; Shopify says its content tools do not cover arbitrary third-party app copy. If Insignia owns these overrides, Insignia must store and render them.

Keep this feature to copy owned by the selected Insignia customer customizer. Shopify owns the product page, cart, checkout, storefront language selector, and the language's published state. Keep product and option names, merchant-authored placement/method labels, and artwork names as supplied content. Keep the Theme Editor's merchant-authored trigger label in Shopify's setting/translation path. Do not offer Admin UI, theme, guest, or checkout strings in this editor.

## Recommended scope and hierarchy

Build a small customer-copy editor, not a second translation hub:

1. **Settings entry.** Use a short title such as `Customer-facing translations` and one sentence that says these settings change wording inside Insignia's product customizer.
2. **Store language list.** Read Shopify's enabled locales and show the Shopify state separately from Insignia copy coverage. Shopify's current `shopLocales` query returns locale, primary, and published state; it requires `read_locales` or `read_markets_home`. Link to Shopify language settings for adding, publishing, unpublishing, or assigning a language. Insignia should not change those settings.
3. **One-language editor.** Open one locale at a time. Show English source text beside the editable target copy. Group strings by the buyer's actual journey: artwork, quantities/options, review, and shared controls/status messages. With 181 customer messages, an ungrouped giant form is not usable; add search if all messages are in scope.
4. **Save bar.** Save applies that locale's Insignia overrides. It does not publish the Shopify locale. A published locale can use saved overrides immediately. Missing Insignia strings continue in English and the page must say so.

The input language should be named as the target locale, not the store default. A store can have an English Insignia source even when Shopify's primary storefront language is different. V1 should key overrides by the full Shopify locale code and share them across Markets using that locale. Market-specific wording would be a separate feature.

Do not show an automatic translation button, generated suggestion, or "translated by Shopify" status. Shopify Forms and Translate & Adapt have their own documented automatic translation features. Insignia has no such capability in the current localization foundation. Label this workflow `Manual translations` or `Edit translations`.

## Language and copy states

- **No additional Shopify language.** Show that English is the current source and link to Shopify Settings > Languages. Do not offer a free-form language field or claim a new locale is enabled.
- **Shopify locale list loading fails.** Show a load error and retry. Do not reuse the empty state, which would falsely imply the shop has only English.
- **Unpublished Shopify locale.** If the editor allows pre-work, label the locale `Unpublished in Shopify`. Saved text stays hidden from buyers until Shopify publishes it. Keep the two statuses distinct.
- **No overrides / partial overrides.** Show a count and explain that untranslated strings use English. Save partial work; do not call it complete or live in all languages.
- **Source copy changed.** Mark the affected translation `Needs review`, preserve the merchant's saved wording, and let the merchant review it. New source keys start blank and use English at runtime. Do not silently overwrite merchant text.
- **Plural messages.** Four plural families currently appear in the customer catalog. The required forms vary by locale. Provide the locale's actual plural categories and require all of them; do not force English `one`/`other` onto every language.
- **Placeholders.** Preserve every required interpolation token, including `count`, names, limits, and values. Let merchants move tokens for grammar, but validate exact token names before save. Show a field-level error instead of removing a token or storing an invalid string.
- **Unsaved edits.** Warn before changing locale or leaving. Offer Save and Discard. Keep focus and the draft in place if validation fails.
- **Saving / saved / failed.** Disable duplicate submit while saving. On success say `Translations saved`, not `Published`. On error keep all edits and offer Retry. If another session changed this locale, keep the local draft and offer an explicit reload/review path.
- **Reset.** A per-string clear returns that message to English fallback. A whole-locale reset needs confirmation that names the selected language and effect. Reset removes Insignia overrides only; it does not remove or unpublish a Shopify locale.
- **Locale removed or unpublished later.** Keep Insignia overrides until the merchant explicitly resets them. Show that the locale is unavailable in Shopify and hide it from customers. Shopify distinguishes unpublishing from deleting a language; Insignia should not mirror Shopify's deletion action by erasing its own data.

## Current capability limit

The runtime currently registers only `en` and resolves all other locale tags to complete English. A functioning editor must add a per-shop override loader and merge it into the customer messages only, then test the target locale's plural rules, placeholders, direction, narrow layout, and fallback. Until that contract exists, a design can show the intended manual workflow, but it cannot claim that Dutch, Arabic, or another Shopify language is supported by Insignia.

## Primary sources

- [Shopify Forms: translating forms](https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app/translation)
- [Shopify Translate & Adapt](https://help.shopify.com/en/manual/international/languages/translate-adapt-app)
- [Shopify: managing store languages](https://help.shopify.com/en/manual/international/languages/manage-languages)
- [Shopify Admin GraphQL: `shopLocales`](https://shopify.dev/docs/api/admin-graphql/latest/queries/shopLocales)
- [Shopify: managing translated resource content](https://shopify.dev/docs/apps/build/markets/manage-translated-content)
- [Shopify Admin GraphQL: `translationsRegister`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/translationsRegister)
- [Shopify App Home settings pattern](https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings) and [form guidance](https://shopify.dev/docs/apps/design/user-experience/forms)
- [Theme app extension settings and translations](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration) and [theme input settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings)
