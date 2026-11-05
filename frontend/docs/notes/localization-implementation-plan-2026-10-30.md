# Localization implementation plan

Superseded by the [complete 2 November plan](localization-implementation-plan-2026-11-02.md), which incorporates fresh Shopify/i18next research, actual text ownership, four independent Luna Max reviews and responsive/input/export checks. This file retains the earlier proposal as history.

30 October 2026. Plan only. No translation dependency, catalogue migration or hosted translation service is introduced by this task.

## Decision

Use i18next core with a small native Preact adapter. Keep approved translations in source control and serve them with the application. General Translation can later help prepare reviewed catalogue changes; production rendering must not depend on its translation API. The [runtime comparison](translation-options-independent-2026-10-30.md) and [GT/Astro follow-up](astro-translation-options-2026-10-30.md) record sources and alternatives.

## Ownership

| Responsibility | Intended location | Contract |
| --- | --- | --- |
| Supported locales, canonical source keys, interpolation types and fallback rules | A shared `packages/localization` package, once approved | Framework-independent and browser-safe; no Shopify auth, backend credentials, mutable global server locale or domain state |
| Merchant catalogue | `merchant` namespace in that package | Admin interface copy, supported Polaris text properties, validation and accessible labels |
| Merchant Astro shell | `AdminLayout.astro`, navigation and route title/bootstrap helpers | Translate shell strings as well as hydrated islands; derive both from the same resolved admin locale |
| Customer catalogue | `customer` namespace in that package | The agreed sibling `designer-prototype` modal; never download merchant-only copy into the customer modal |
| Shared wording | A small `common` namespace | Only genuinely identical meanings; do not merge unrelated labels merely because their English spelling matches |
| Preact provider/hook and catalogue readiness | Shared localization adapter and each app's composition root | Explicit locale, initialized instance and subscribed updates; no React bindings or compatibility aliases |
| Astro rendering | Merchant request/bootstrap layer | Use an instance/fixed translator owned by the request; hydrate using the same locale and resources |
| Shopify launch-button and theme-extension schema text | Extension locale files | Shopify owns this outside-modal interface; these are not a merchant-editable translation store for our private configuration |
| Merchant-created names | Existing presentation data, with a future explicit locale-keyed content contract | Product names, method names, placements and option values are content, not lookup keys |

The selected design rollout covers the merchant presentation and the sibling `designer-prototype`. `apps/storefront` remains the unselected backend-integration UI; keep its protocol/error mapping compatible when integrating, but do not treat translating that older screen as delivery of the chosen customer modal or duplicate the UI rewrite there.

Set the admin iframe document's `lang` from its resolved locale and keep SSR/bootstrap/client ownership consistent. The customer modal should carry the host-selected language on its owned root and any owned portals. It must not change Shopify's parent document language or global direction. Directional layout support remains subject to the separate review below.

The package placement is a proposal. Before implementation, verify how the sibling Vite project resolves workspace packages and choose an explicit build/import arrangement that works in both checkouts. Do not add a hidden dependency on an absolute developer path or copy catalogues into two maintained locations.

## Language selection

1. Merchant screens follow the Shopify admin user's `shopify.config.locale`, distinct from the shop's storefront language. Browser-only App Bridge context must not be assumed available during Astro SSR. If server locale is unavailable, resolve it before revealing the existing localized island, preserving the current skeleton shape.
2. The customer modal receives the selected storefront language from its Shopify host. The local host adapter supplies the equivalent explicit locale while the UI remains disconnected.
3. Normalize and resolve an allowlisted BCP 47 locale, preserving script and region information. Use supported variants and a deliberately configured fallback to bundled English. Browser detection must not override Shopify's choice.
4. Language, order currency, country/Market and store time zone remain separate inputs. Translate labels and format displays without changing exact amounts, inventory identities or accepted quote economics.

Sources: [Shopify admin config](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/config-api), [Liquid localization](https://shopify.dev/docs/api/liquid/objects/localization), [i18next fallback](https://www.i18next.com/principles/fallback).

## Integration with reducers and asynchronous work

Store stable codes and interpolation values in domain/workflow state, then resolve their text during rendering. Existing string-bearing upload/recovery events need an explicit mapping as part of migration. Do not put a translator instance, rendered string or locale dependency into pure price/design reducers.

Changing language must preserve the design, selected real variant IDs, unsaved draft, undo history, pending upload/request generations, idempotency keys and accepted totals. A stale catalogue response must not activate a language that has already been superseded. Keep the current usable language until the next one is complete; use the bundled fallback if initial loading fails. Never reload the document merely to translate an active customizer.

Load the current screen's required namespaces and fallback before its readiness signal. This uses the navigation/loading coordinator already introduced; do not add an English-first render, arbitrary minimum delay or another application router. If multiple islands or modal instances coexist, share only deliberately scoped client state. Concurrent server requests must never change each other's language.

Render messages as text and safe component properties. Do not turn translation strings into raw HTML. Configure interpolation with Preact's text escaping in mind, and use an explicit component-based mechanism for links when necessary.

Sources: [i18next instances and initialization](https://www.i18next.com/overview/api), [interpolation](https://www.i18next.com/translation-function/interpolation).

## Implementation sequence after approval

1. Inventory current merchant Astro/TSX, selected customer TSX and theme Liquid strings, including placeholders, modal actions, validation, loading announcements, empty/error/recovery states and accessibility properties. Identify server error codes and presentation labels separately. Preserve the reviewed English copy.
2. Add the pinned core package and a typed, framework-independent message interface. Use literal resource declarations or generated types so missing keys and required interpolation parameters fail checks. Configure plural rules and explicit fallback behavior. No paid service is needed.
3. Add the native Preact adapter, request-safe Astro initialization and host-locale bootstrap. Validate them with actual Polaris text properties and the sibling Vite build before migrating screens.
4. Migrate by complete workflow: common controls and navigation, merchant products/editor, methods, orders/exports, Home/settings, then the selected customer artwork/quantities/review/recovery flow and Shopify launcher text. Retain existing reducers and visual composition. This is a whole-frontend rollout organized into reviewable changes, not a separate pilot that leaves the rest untranslated.
5. Add source extraction/lint rules covering our actual `t` interface and custom-element properties. The official CLI's default TSX support does not imply `.astro` or Liquid parsing; support those explicitly. Add complete reviewed launch locales only after the owner chooses them. Dutch and a pseudo-locale can be test fixtures without promising them as supported customer languages.
6. Update the handoff guide with catalogue ownership, locale bootstrap and the rule that new UI strings require entries. Optional GT-generated translations arrive as reviewed file changes, not automatic production wording changes.

Sources: [i18next TypeScript](https://www.i18next.com/overview/typescript), [plural rules](https://www.i18next.com/translation-function/plurals), [official extraction CLI](https://github.com/i18next/i18next-cli), [GT local generation](https://generaltranslation.com/en-US/docs/cli/guides/generating-translations).

## Proportionate acceptance checks

- Compile-time wrong-key and missing-parameter examples; catalogue completeness, nonempty strings, placeholder parity and required plural categories.
- Selected/default/unsupported locale resolution, missing namespace, failed or superseded catalogue load and two concurrent SSR locales.
- Locale changes during an unsaved design and pending request preserve state and operation identity. Existing workflow tests continue exercising stable semantics instead of duplicating every scenario for every language.
- Representative long translations and pseudo-localization at 1440, 390 and 320 px, including modal footers, numeric inputs, truncation, error messages and accessible names.
- Compare initial SSR/client text and readiness behavior, preventing hydration mismatch and untranslated flashes.

Right-to-left support needs a separate directional layout review before it is advertised. Product image geometry must not be mirrored accidentally. Merchant-authored content translation, a translation Settings screen, runtime machine translation and automatic translation of uploaded artwork are outside this interface-localization plan.

## Maintenance

Pin versions and retain the lockfile. Review routine dependency updates with the repository's normal maintenance; act sooner on relevant security fixes. Major upgrades require reviewing the migration guide and the focused checks above. Most ongoing work is keeping approved copy complete when features change, rather than following every i18next release. [Migration guide](https://www.i18next.com/misc/migration-guide).
