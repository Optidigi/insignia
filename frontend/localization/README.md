# Current UI handoff

See [frontend/README.md](../README.md) for current ownership, launch commands and the example-only boundary. The notes below describe the earlier working checkout; paths and verification records may be historical. No backend integration is included.

# Frontend localization

This package owns application text for the merchant admin, the selected customer modal in `apps/designer`, and the embedded guest artwork input. English, Dutch, German, French, Spanish and Italian have complete built-in catalogs. `en-XA` is an opt-in expanded English test catalog, not a supported customer language.

The public entry points separate audiences:

- `@insignia/ui-localization/admin` includes merchant screens and the editor-launched artwork preview.
- `@insignia/ui-localization/customer` includes customer modal copy.
- `@insignia/ui-localization/guest` includes embedded artwork input and theme launcher copy.
- `@insignia/ui-localization/core` contains locale resolution, controllers, typed language-preference transitions, message descriptors and exact count formatting.
- `@insignia/ui-localization/preact` provides native Preact context bindings. Create a stable binding once per audience and give each modal or document its own controller.

Controllers prepare a complete snapshot before publishing it. A newer request supersedes older preparation; a failure keeps the previous snapshot. Locale changes must not recreate product configuration, dispatch commerce events, clear drafts, restart uploads or change request identities.

Keep the requested locale, active catalog language and formatting locale distinct. An unsupported language uses complete English copy and formatting. Supported language families retain their requested region for `Intl`, for example `de-CH` uses German copy and Swiss formatting. Locale is presentation context, never authorization, a currency, a Shopify Market or a shop time zone.

## Interface language preferences

Merchant Settings has an App language select; the customer modal has a header language picker. Both default to their supplied Shopify locale and offer the six built-in languages by native name. The customer adapter uses the first supported browser language only if its host locale is missing or malformed, then English; it never overrides a valid Shopify page locale. A valid but unsupported host language retains the complete English fallback policy. These preferences change Insignia controls only; store content, Shopify accounts, published languages, currencies and markets remain under their existing owners. The translations editor remains a separate sparse wording-override tool.

Manual preferences use separate optional browser keys (`insignia.admin.language.v1` and `insignia.customer.language.v1`). Missing or invalid values follow the host. Blocked storage leaves the mounted session usable; it does not guarantee persistence across a new document. Automatic restores the original full host locale, including region. Admin navigation retains that host context, rather than writing the manual override into the host locale parameter. Persisted history returns refresh successful durable preferences, while retaining session-only choices after a failed write.

Pickers share the pure `languagePreferenceReducer` (`ready`, `changing`, `failed`) and revision guards exported from `core`. Storage, locale preparation and callbacks stay in audience adapters. The selected customer adapter lives in `src/use-customer-language.ts`; it always issues a request when changing intent, even when returning to the active locale, so older preparation is superseded. Host-context refreshes preserve pending manual intent and successful persistence/callbacks occur once for the current request. Admin ignores customer/unrelated storage events.

Pickers activate the existing locale controllers without remounting product or commerce state. Customer wording remains exact-locale scoped; choosing another interface language cannot apply the host language’s custom wording to it. See [picker implementation](../../docs/delivery/notes/language-pickers-2026-11-05.md) and [language policy/state review](../../docs/delivery/notes/language-policy-2026-11-05.md).

## Changing copy

For translation drafting and quality review, use the project [translation-review skill](../../.agents/skills/insignia-translation-review/SKILL.md). It links the product glossary, locale briefs and review criteria. Proposed terms, AI-reviewed drafts, technical checks and actual target-language screen review have separate evidence statuses.

Edit `src/catalogs/en/<audience-or-workflow>.json`, then run `corepack pnpm --filter @insignia/ui-localization build`. Generated key and parameter contracts live under `src/generated`; do not edit those files. Generation rejects duplicate keys, blank messages, unsupported placeholders and incomplete English plural families. Target validation runs on every build and type check. It requires all namespaces and messages, exact placeholder occurrences, the locale’s `Intl.PluralRules` categories and the matching Theme Editor schema labels. Update all five target catalogs when source meaning changes; do not fill untranslated entries with English to pass coverage.

Use complete messages with named parameters. Keep merchant names, product options, filenames and Shopify content as values. Render returned strings as text nodes or escaped template values. Translation results are never HTML.

Store a domain reason or a typed message descriptor in state, then render it with the current snapshot. Never compare translated text to decide whether to save, publish, retry, clear an error or expire artwork. Message factories copy and freeze their primitive parameter values.

Use `count` for safe numeric plural selection and a separate `formattedCount` when a count needs locale formatting. `formatExactCount` preserves BigInt precision and distinguishes safe plural counts from values beyond the safe integer range. Money, dates, quantities and file sizes retain their source units and values; translation must not change arithmetic or input parsing.

`corepack pnpm check:localization` checks generated contracts and visible copy sources. The official i18next CLI checks supported TSX source shapes. The companion source check uses TypeScript and Astro parsers plus Liquid schema validation for the other templates. Selected presentation files under `apps/web/test/admin/support` are included. Developer hosts, fixture product content and the older integration customizer are separate from the selected UI. The sibling customer application has its own source-copy and interaction checks.

## Customer package artifact

The selected customer application is a separate npm project. It consumes an immutable, content-hashed package artifact rather than a live filesystem link.

Run artifact and complete frontend commands from the repository root. Set `INSIGNIA_DESIGNER_PROTOTYPE_ROOT` to the customer's absolute path and run:

```sh
node scripts/ci/localization-artifact.mts --sync
```

This builds the canonical package, creates the hash-named archive, updates the sibling manifest and installs its lockfile. Running the command without `--sync` checks the canonical archive, dependency path and lock integrity. Add `--clean-install` to run `npm ci` and a strict production build in a disposable copy with no existing dependencies or build output. Keep the archive with the consuming application's changes.

The complete frontend check is `corepack pnpm test:frontend`, with the same environment variable. It includes catalog/runtime/type contracts, copy checks, the package artifact, both builds and the frontend regression suites. Local previews do not prove Shopify cart mutations or native host behavior.

For a build rollback, restore the previous application source, dependency archive, manifest and lockfile together. Keep the archive's hash-named bytes unchanged. This is separate from runtime locale recovery, which retains the current complete snapshot when preparation of a replacement fails.

## Adding a language

Adding files alone does not advertise a language. Extend the explicit registry, include every required audience and namespace, review real wording and plurals, and verify locale metadata and formatting. Check expanded text, narrow screens, accessible names, dirty inputs, pending operations and actual generated output. RTL, CJK and non-Latin numeric input need dedicated checks before being offered.

The policy and implementation scope are recorded in [the localization plan](../../docs/delivery/notes/localization-implementation-plan-2026-11-02.md). i18next's [configuration](https://www.i18next.com/overview/configuration-options) and [interpolation guidance](https://www.i18next.com/translation-function/interpolation) define the underlying runtime behavior.

### Merchant-authored customer wording

`@insignia/ui-localization/customer` also exports the customer wording manifest,
`validateCustomerWordingOverlay`, source/form/default helpers and `CustomerWordingOverlay`.
An overlay contains one exact canonical customer locale and sparse messages keyed
by the existing typed message IDs. It may contain only customer/common text,
plain text and the same named placeholders and occurrence counts as the source. Empty forms use the built-in defaults for that language, or English for an unsupported language. They do not inherit another locale's merchant wording. Missing plural forms use the baseline language’s plural rules with the actual quantity.

Pass a validated overlay as `createCustomerTranslator(locale, { wordingOverlay })`
or to the selected Designer's optional `wordingOverlay` prop. Mounted customer
controllers accept `setWordingOverlay()` without resetting the design workflow.
A matching overlay supplies customer formatting and text direction; it does not
add a built-in catalog, change staff language or publish a Shopify language.
The Settings authoring UI shows the English source separately and the selected language’s default as a growing placeholder. Restoring a field removes its override; restoring a language removes only that language’s custom text. Neither operation stores a copy of the defaults.

The Settings authoring UI currently uses a shop-scoped browser storage port.
Shared persistence and live delivery remain separate integration work.

Current repository delivery uses `workspace:*` for both consumers. Tarball records below describe the former standalone customer checkout.
