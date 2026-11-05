# Insignia concept glossary

This defines product meaning for translation. It does not replace architecture contracts or authorize UI changes. English labels below describe current source usage, not a new source-copy rewrite. Target-language terms need their own status in the relevant locale brief.

## Term status

- **Source-verified:** meaning checked against the current product contract or callers. This says nothing about target-language approval.
- **Proposed:** a target term or register suggested for a draft, with a reason/source.
- **Accepted for draft:** selected consistently for an authorized translation batch, with who/date/scope recorded. This is not native-language certification.
- **Linguistically reviewed:** a qualified target-language reviewer actually checked the term in the stated context; record reviewer/date/revision. Broader acceptance is not inferred.

Approved variants can account for grammar, plural forms and context. Match concepts, not English substrings. Source evidence below is repository-relative; use the active checkout.

## Source map

Catalog references such as `customer.json:review` mean a key/section in `packages/localization/src/catalogs/en/`. Architecture means `docs/architecture/implementation-plan.md`; inspect its named contract, not a stale line number. Other short references resolve to:

- Localization README: `packages/localization/README.md`.
- `customer-wording.ts` and `customer.ts`: `packages/localization/src/`.
- `customer-translations-state.ts` and `customer-translations-workflow.ts`: `apps/web/src/islands/`.
- Selected customer adapter/workflow: sibling `../designer-prototype/src/`; read its AGENTS.md and actual caller. This is the chosen customer design, separate from `apps/storefront` integration evidence.
- Detailed caller links and domain distinctions: `docs/delivery/notes/translation-glossary-domain-review-2026-11-04.md`.

These paths aid lookup; current contracts and callers take precedence if a dated note diverges.

## Source concepts

| ID | Source wording and meaning | Distinction or translation trap | Evidence |
| --- | --- | --- | --- |
| product | A Shopify product that can have variants. | Not an individual unit, product configuration or a saved buyer design. | `packages/localization/src/catalogs/en/products.json`; architecture product/config contracts |
| variant | A concrete Shopify product variant identified independently of its displayed option values. | Colour is not a synonym for variant; options may be model, fit, material or supplied names. | architecture `GarmentQuantityVector`; `customer.json:options` |
| option | App-owned generic label for a selectable product option when a supplied name is unavailable. | Translate this generic label; retain actual Shopify option names and values as supplied. | `customer.json:options.genericLabel`; selected customer adapter |
| view-noun | A product-view image/orientation such as a front or back view. | Not a view count, a browser page, or the View action. A merchant's view name is supplied data. | architecture `Placement/View/Step`; `customer.json:chrome.productView` |
| view-action | Open or inspect the named resource or preview. | Choose a natural verb, not the noun used for an orientation. | `common.json` actions; `settings.json:storefrontTest.actions` |
| placement | A named artwork location belonging to a configured product view. | Distinct from the artwork's movable coordinates inside an area. Admin uses placement; buyer copy may call the choice a position. | architecture `Placement/View/Step`; `editor.json`; `customer.json:placements` |
| position-choice | Buyer-facing wording for selecting a configured placement. | Preserve its relation to placement. Don't translate merchant labels such as Left chest as if app-owned. | `customer.json:artwork.choosePosition`; `customer.json:placements.positions` |
| position-adjustment | Location of artwork within the allowed area, controlled by drag or movement buttons. | Reset position resets geometry, not artwork content, quantity or wording. | `customer.json:positioning`; architecture production geometry |
| artwork-area | Configured maximum artwork area and, where enabled, allowed movement bounds. | Not the full photo size, garment dimensions or a guaranteed physical calibration. | `editor.json`; architecture production geometry |
| artwork | Uploaded visual file/content used for customization. | Can be a logo or another design. Avoid a fine-art term or logo-only wording that narrows the feature. | `customer.json:artwork`; architecture `ArtworkSelection` |
| design | Buyer customization specification, potentially covering several placements and compatible variant quantities. | Not merely the uploaded file or its preview thumbnail. Follow the actual caller when the source uses design casually. | architecture `CustomizationGroup`; `customer.json:review` |
| preview | Display representation for checking appearance. | Not automatically the original artwork file or a calibrated production proof. | `customer.json:chrome`; architecture artwork/preview distinctions |
| original-artwork | Retained production-source artwork, subject to access and retention. | A preview image is not a substitute and unavailable does not always mean never uploaded. | `orders.json`; `artwork.json`; architecture artwork retention |
| artwork-later | Explicit merchant-enabled choice to provide necessary artwork later. | Not blanket permission to skip all requirements or an invented buyer post-order upload feature. | `customer.json:artwork.provideArtworkLater`; architecture `ArtworkSelection` |
| garment-size | Product variant option such as supplied S/M/L. | Supplied options can be something other than garment size; preserve supplied names/values. Never equate it with decoration size. | architecture `Placement/View/Step`; `customer.json:quantities` |
| decoration-size | Merchant-defined size/scale choice for the artwork at a placement. | Not clothing size, image file resolution or a count of products. Prefer a term covering supported methods, not printing only. | architecture `Placement/View/Step`; `customer.json:positioning.decorationSize` |
| method | Merchant-defined decoration method available at the placement. | Not a payment/shipping method. Actual method names are supplied data. | architecture `DecorationMethod`; `methods.json`; `customer.json:artwork.method` |
| reusable-method | Library method/default offered for product setup. | Editing reusable defaults does not silently reprice existing product configurations or accepted orders. | architecture `ProductConfigRevision`; `methods.json` |
| price-scope | Price expressed for the exact item/placement/method/decoration-size scope in the source. | Preserve per-item/per-placement units, free versus missing, and original versus current prices. | architecture `PricingRule`; `customer.json:review`; `methods.json` |
| quantity | Number of physical product units for the selected variants. | Not number of uploads, artwork placements or designs. Zero removal and unavailable selection wording depend on the actual action. | architecture `GarmentQuantityVector`; `customer.json:quantities` |
| save | Persist the current editable draft through the named owning workflow. | Not publication or proof a Shopify setting/cart mutation succeeded. | `editor.json`; `settings.json:translations.save`; editor workflow |
| publish | Make a product customization revision available after the owning workflow confirms it. | Distinct from saving a draft, publishing Shopify languages or publishing a theme. Preserve pending/unverified states. | architecture publication contracts; `editor.json`; `settings.json` |
| discard | Abandon unsaved changes and return to the saved baseline. | Not delete the resource or restore shipped default wording. | `common.json`; `settings.json:translations.leaveDescription` |
| remove | Remove the named selection/resource within its stated scope. | Its consequence differs by caller. Removing artwork, a quantity selection, a language target and retained history are different actions. | `customer.json`; `settings.json:translations.removeDescription` |
| restore-wording | Remove a selected form override, or confirmed locale-wide overrides, exposing the applicable language baseline/fallback. | Retains the language and other locales. In the authoring UI this is a draft until Save. Not deleting all translations from Shopify. | `settings.json:translations`; `customer-translations-state.ts` |
| default-wording | Shipped baseline or documented fallback for that exact locale. | Separate from merchant overrides and Shopify's store-default language. Check current supported catalogs rather than assuming every authoring target is bundled. | localization README; `customer-wording.ts`; `customer.ts` |
| authoring-language | Exact locale receiving merchant-written customer wording. | Not staff UI language, currency, Market or evidence a storefront language is published. | `customer-translations-workflow.ts`; localization README |
| add-to-cart | Add the reviewed customization to the Shopify cart through the owning integration. | Not checkout, payment or a new Insignia cart page. Local demo success is not live verification. | AGENTS.md selected customer scope; `customer.json:steps.addToCart` |
| update-cart | Apply edits to the existing customization in the Shopify cart. | Not add another design, edit a paid order or automatically place an order. | selected customer workflow; `customer.json:steps.updateCart` |
| review-action | Buyer checks the current design, choices and quantities before add/update. | Not a customer testimonial, a product rating or a completed purchase. | `customer.json:steps.review`; `customer.json:review` |
| unavailable | A selection, resource or verified action cannot be used in this context. | Distinguish from no results, empty input, loading, not offered, access denied and expired retention. Preserve the source's uncertainty. | `customer.json:recovery`; `orders.json`; `settings.json` |
| loading-pending | Work is in progress or an outcome remains unresolved. | Never translate as success, readiness or a verified absence. Use separate failure and empty states. | customer and admin catalogs; reducers/workflows |

## Ownership rules

Translate application labels, instructions, notices, generic fallbacks and accessible text. Retain supplied product titles, option labels/values, view/placement/method/size names, filenames, identifiers and historical values. A localized generic name used when creating an entity becomes supplied merchant content once saved; changing UI language must not rename it. Use provenance, not whether the value happens to look English, to distinguish a fallback from a saved name. Those values can themselves be localized upstream, but this translation task must use the values supplied by that owner rather than rewriting them.

Insignia and Shopify remain protected product names unless an explicit brand policy supplies a local form. Preserve exact placeholder names and syntax. Translate grammatical context around them without modifying money, units, limits, quantity arithmetic, time zones or resource identity. Preserve a file extension as syntax even when the phrase around it changes.

For a target decision, record `concept ID | locale | preferred term | allowed forms | context exclusions | status | evidence | reviewer/date/revision`. A proposed term is a useful drafting decision, not a universal ban on other natural forms.
