# Source copy checks

The localization source check is intentionally split across parsers:

- `i18next.config.mts` configures the pinned `i18next-cli` 1.82.1 linter for app TS/TSX and the selected Methods/editor presentation files. Its JSX linter checks visible child text, listed text-bearing props, translation interpolation, and concatenation. The input list excludes the Home preview host and its fixture controls.
- `verify-copy-source.mts` uses the TypeScript AST for app TSX sinks, the Astro compiler AST for rendered template markup, and JSON parsing for the Shopify `{% schema %}` block. It checks Astro component markup separately because extending an `i18next-cli` input glob does not add an Astro parser.
- Shopify `t:` schema references are checked against `extensions/insignia-theme/locales/en.default.schema.json`. Theme schema `name`, `label`, `info`, `placeholder`, and `content` are display text; string defaults are checked for `text`, `textarea`, and `richtext` settings. The `proxy_prefix` setting default is a protocol value and remains technical.

Run the checks from the repository root:

```sh
pnpm exec i18next-cli lint --config packages/localization/scripts/i18next.config.mts
node packages/localization/scripts/verify-copy-source.mts
```

The AST check scans all `apps/web/src/**/*.tsx` and `.astro` files, plus the explicit selected presentation components in `apps/web/test/admin/support`. Those are the app-owned Methods/editor workflows called out by the inventory. The local Home preview host (`home-preview.tsx`), fixture data, gallery controls and synthetic outcomes are outside the input list. Markup in `code`, `pre`, `script`, and `style` is also outside copy scanning. The exact brand `Insignia` is retained as branding. This check has no accepted-issue baseline: each new source literal must be translated or reviewed as a small explicit technical/content exclusion.

These parsers inspect static text directly in rendered JSX/Astro and the named text props. The TSX adapter also walks JSX nested in JSX expressions, reads immediate object/array lookup values, and follows lexically visible `const` initializers only while their expressions remain statically readable. For `&&`, it ignores the left operand because that operand gates rendering; for `||` and `??`, both possible text values are inspected. It stops at dynamic expressions, translator calls, parameters and merchant object properties; it does not perform general TypeScript dataflow analysis or classify values supplied by merchants. Shopify Liquid parsing is limited to schema blocks; Liquid runtime templates and compiled theme bundles need their own source owner. The CLI is not configured as the catalog writer: `catalog-source.mts` and the generated type checks remain authoritative for the typed catalogs.

Three narrow technical contexts are covered by positive and negative fixtures: physical legends from a small key-name set are stable inside `<kbd>` while their ARIA labels are still checked; `A` and `B` are exempt only inside an `aria-hidden` SVG with the `placement-calibration-line` class; and `UTC` is treated as a timezone identifier only as the fallback in a local `timeZone = page?.timeZone ?? 'UTC'` binding. The same strings remain findings elsewhere.

The CLI file-type limitation and plugin API are documented in the [v1.82.1 project README](https://github.com/i18next/i18next-cli/blob/v1.82.1/README.md#advanced-features).
