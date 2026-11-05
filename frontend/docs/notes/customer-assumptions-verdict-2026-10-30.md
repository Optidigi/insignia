# Customer designer assumptions: consolidated verdict

30 October 2026. Investigation only, using three independent Luna Max audits and a main-agent code/probe review. No application source, fixture, dependency or UI was changed.

## The phone-case tab

The designer does not detect phone cases. The local [`phone-case-options.json`](../../../../designer-prototype/src/scenarios/phone-case-options.json) explicitly supplies row labels `finish/finishes`, column labels `model/models` and named-choice mode. [`designer.tsx`](../../../../designer-prototype/src/designer.tsx) constructs the quantity heading from that supplied column label when more than one value exists. Product name/type is not consulted.

That is a legitimate rendering input, but it is not a completed product-data feature. The admin preview does not supply this metadata; the connected host does not exist yet; the current buyer DTO lacks the Shopify option-tuple mapping required to populate that layout reliably. The previous change demonstrated configurable presentation, not automatic understanding of a product.

## Important findings

| Finding | What is established | Direction |
| --- | --- | --- |
| Legacy colour/size fallback | Omitted `optionPresentation` produces colour swatches and size language regardless of actual option labels. Every row still requires a hex value even in named-choice mode. | Use `Quantities` for the stable task tab. Show exact configured option names beside controls. Unknown semantics should use text choices, not fabricated swatches. Retain explicit swatches when provided. |
| Missing availability means every cell is offered | `isSizeAvailable` returns true for every defined row/column pair when the row omits its availability list. This is the current view-model convention, not knowledge of Shopify combinations. | A connected adapter must supply explicit actual tuples, availability and exact variant IDs. Never manufacture a Cartesian product or split variant titles to infer it. |
| Real catalogue data is not carried through | Shopify catalogue reads include selected option name/value pairs, but the buyer projection exposes flat variant IDs/labels/availability and separate production customization options. Those production options are not Shopify variant axes. | Extend the integration contract deliberately; use canonical variant identities and option metadata, without deriving axes from title/type. There is no need for a phone-case classifier. |
| Artwork-only preview invents context by design | Its adapter supplies one product-image choice, one placeholder size, base price zero, EUR/en-GB and quantity limit one. Quantity/cart UI is hidden, but method/size price cues can still display. | Keep that adapter explicitly artwork-only; do not use it as buyer bootstrap or evidence of store currency, base price or selectable variants. |
| Inconsistent grouped-product preview messages | The main editor resolves the active image and removes `variantPhotos` before sending. The overview/copy path can send it unchanged; the receiver's strict schema omits it and silently rejects the message. | Normalize an explicit preview DTO at one seam, with clear unsupported/error handling. Add a sender-to-receiver compatibility regression when implementing. |

These are current local model/preview limitations and integration hazards, not evidence that a live customer was sold an invalid variant. The selected customer UI remains disconnected.

## What does not need to be guessed

Shopify supplies option names and selected values. Merchant configuration supplies the chosen view labels, photo assignments, permitted methods, decoration sizes and artwork areas. A renderer can faithfully display those explicit inputs without knowing whether the item is a phone case, mug or shirt. Shopify's [`ProductOption`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductOption) and [`SelectedOption`](https://shopify.dev/docs/api/storefront/latest/objects/SelectedOption) describe the names/values. [`ProductOptionValue`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductOptionValue) may provide an explicit swatch; absence is not permission to guess one from a name.

Singular/plural wording, an appropriate quantity-layout axis, photo orientation, equivalent framing, actual print dimensions, camera cutouts, surface shape and manufacturing tolerances are different responsibilities. Do not infer them from product names, filenames or option text. Use provided metadata or merchant decisions, and show a neutral absence/unsupported state when essential facts are unavailable.

The current selected designer already requires photos for configured photo views and uses a neutral unavailable-image illustration when a garment fixture is not explicitly configured. Its phone-case fixture explicitly labels the image as schematic. Relative geometry, optional size labels and demonstration prices remain authored fixture/configuration data; they do not prove physical suitability or production totals.

## Proportionate verification

The main-agent in-memory probe bundled the actual config schema, option-presentation resolver and product model. Results:

- Renaming the phone-case product to an unrelated name did not change the labels.
- Removing only the explicit presentation metadata restored colour/size/swatches.
- The fixture's four row/column cells were all offered because no row availability restriction was supplied.

No full browser or backend suite was run for this read-only investigation. One agent's attempt to open the previously supplied 5173 URL found that server unavailable; no UI critique is based on that failed observation.

## Recommended next change

Make the tab label invariant (`Artwork`, `Quantities`, `Review`). Retain actual option names as control context. Define an explicit, validated host-to-designer variant/option mapping and require named choices unless swatch data is supplied. Keep the artwork preview DTO and the customer purchase DTO distinct. Correct the grouped-preview message mismatch with a focused contract test.

This is a recommendation, not an implemented fix. The audits are [customer inputs](customer-data-assumptions-audit-2026-10-30.md), [preview and backend mapping](preview-data-assumptions-audit-2026-10-30.md) and [independent product logic](product-knowledge-assumptions-review-2026-10-30.md).
