# Variant selection and bulk quantities: independent research

Date: 2026-11-02. Research only. No customer UI or behavior changed. Scope: the customer customizer modal launched from Shopify, with automatic presentation derived from supplied variant data and no merchant setup or product-type guesses.

## Finding

Shopify provides clear precedents for two different tasks: choosing one variant and entering quantities across several variants. Its first-party themes do not establish a universal numeric threshold for switching between them. Insignia can simplify small option sets automatically, but variant count alone cannot establish whether a customer wants one combination or a mixed order.

My recommendation is a compact picker for a small choice set, with an obvious way to enter multiple variants. Preserve a direct quantity-per-variant view for bulk orders. A matrix is useful when its real variant relationships stay readable, but it should not be the compulsory representation for every product. The automatic rule and any thresholds below are proposals, not Shopify guidance.

## What primary sources actually support

| Evidence | Consequence for Insignia |
| --- | --- |
| Dawn renders one picker per Shopify option, with radio-style pills, dropdowns or swatches. It suppresses the picker for a product with only the default variant. Its picker style comes from theme settings, not an automatic option-count cutoff. [Dawn picker](https://github.com/Shopify/dawn/blob/05222537f672cc0e8ae8aa3ac07808b9cfc34742/snippets/product-variant-picker.liquid) | A familiar compact pattern is option choice followed by one quantity. This source does not justify claiming that Shopify switches to a matrix above some count. |
| Horizon also offers configured buttons/dropdowns and swatches. A non-swatch option containing one value becomes plain option name/value text. [Horizon picker](https://github.com/Shopify/horizon/blob/dfad90d87be2408de52636315069fc998da28c9e/snippets/variant-main-picker.liquid), [settings](https://github.com/Shopify/horizon/blob/dfad90d87be2408de52636315069fc998da28c9e/blocks/variant-picker.liquid) | Remove controls that offer no choice, while retaining useful facts such as the finish or model. An option with one value and a product with one option are different cases. |
| Dawn quick order lists render actual variants as rows, paginate them, and provide per-variant quantities. Horizon does the same, with variant, quantity, price and total columns and a separate mobile arrangement. Neither inspected implementation is a cross-product matrix. [Dawn list](https://github.com/Shopify/dawn/blob/05222537f672cc0e8ae8aa3ac07808b9cfc34742/snippets/quick-order-list.liquid), [Horizon list](https://github.com/Shopify/horizon/blob/dfad90d87be2408de52636315069fc998da28c9e/sections/quick-order-list.liquid) | A compact list of actual variant tuples is a first-party bulk precedent and a safe fallback for sparse or complex structures. |
| Horizon uses a directly editable numeric quantity input with decrement/increment controls, variant minimum, maximum and increment. Its quick-order view supplies a minimum of zero. Dawn also checks availability and quantity rules. [Horizon quantity](https://github.com/Shopify/horizon/blob/dfad90d87be2408de52636315069fc998da28c9e/snippets/quantity-selector.liquid), [Dawn row](https://github.com/Shopify/dawn/blob/05222537f672cc0e8ae8aa3ac07808b9cfc34742/snippets/quick-order-list-row.liquid) | Bulk entry needs zero for an unrequested variant and direct typing for larger quantities. A positive quantity must still satisfy the actual rules. |
| GOV.UK radios are for one choice, not multiple selections. GOV.UK discourages selects as a default in its public-service context and suggests reducing the choice set first. [Radios](https://design-system.service.gov.uk/components/radios/), [Select](https://design-system.service.gov.uk/components/select/) | Visible choices suit a short list. A compact picker cannot replace a mixed-quantity order without another way to retain multiple combinations. GOV.UK's service rules are supporting evidence, not storefront requirements. |

## Proposed automatic policy

Use the supplied option order, distinct values, actual variant tuples, availability and quantity rules. Do not inspect product titles or look for words such as shirt, size, finish or model to choose behavior.

1. If there is only one real variant, show its meaningful attributes as text and one quantity control. Do not display Shopify's synthetic default option as a customer decision.
2. For a small set of choices, show one labelled control per varying option and one quantity. For the reported Finish Matte/Gloss × Model A/B case, this means two small choice groups and one quantity, instead of four separate numeric fields before the customer asks for a mixed order.
3. Keep an explicit customer action such as "Order multiple variants" available. In that view, show each requested combination and its quantity. Switching views must preserve all quantities; show the mixed selection summary when returning to compact view.
4. For a larger, regular one- or two-axis set, a quantity list or matrix can open by default. This makes sequences such as apparel sizes quick to enter without needing to identify apparel. Choose columns by measured label/control fit and supplied ordering, not guessed meanings. Keep a list fallback when the grid is sparse or too wide.
5. For three varying axes, use a labelled selector for one axis plus a list or matrix for the remaining axes, or use a flat list of actual tuples. Quantities from other sections must remain visible in the order summary.

There is no evidence here for a universal "four variants", "six sizes" or "two rows" switch. If implementation needs fixed initial limits, name them as Insignia design decisions and verify them against short labels, long translated labels, phone widths and mixed-order tasks. A measured fit constraint is more defensible than product-type inference. Structure can choose a starting layout; the customer must still be able to express a different ordering intent.

## Pitfalls that affect the decision

- Sparse variants: Matte/A and Gloss/B do not imply Matte/B exists. Shopify explicitly allows option combinations with no associated variant. An absent combination needs a distinct state from an existing sold-out variant. Bind quantities to real variant IDs, never to generated cell positions. [Shopify variant support](https://shopify.dev/docs/storefronts/themes/product-merchandising/variants)
- Availability: option availability may be conditional on earlier selections. Shopify's high-variant guidance describes top-down availability and deferred loading. Do not disable a whole option value merely because the currently selected tuple is invalid. Do not treat a partial variant response as the full catalog; Liquid `product.variants` can return only 250 variants without the appropriate loading approach. This is a data-completeness warning, not an Insignia API implementation prescription. [High-variant products](https://shopify.dev/docs/storefronts/themes/product-merchandising/variants/support-high-variant-products)
- Mixed quantities: selecting Gloss after entering Matte must not silently move or overwrite Matte's quantity. Reusing one quantity field needs explicit selected-tuple editing and a persistent multi-variant summary. Existing positive quantities cannot be hidden by a responsive layout change or filter. These are proposed invariants.
- Mobile: a table can qualify for the WCAG reflow exception when two dimensions are needed for meaning, but the surrounding modal and individual cell content still need to reflow. The exception does not make a squeezed matrix usable. Prefer stacked actual-variant rows or one selected axis when labels and controls no longer fit. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- Quantity entry: retain direct typing. Carbon describes steppers as useful for small adjustments and warns about large changes requiring many clicks. GOV.UK warns about accidental number-input increments and missing invalid-character feedback. Shopify's use of number inputs is a precedent, not proof that every implementation is accessible. Verify keyboard, wheel and touch behavior. [Carbon number input](https://carbondesignsystem.com/components/number-input/usage/), [GOV.UK input](https://design-system.service.gov.uk/components/text-input/)

## Accessibility acceptance points for a later prototype

Use labelled native radio groups with a legend for single choices. A custom radio implementation must preserve checked state and the expected keyboard behavior. [W3C radio pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)

In a matrix, use a table caption and explicit row/column headers. Give each quantity input an accessible name containing the complete tuple, for example "Quantity, Matte, Model A", so focus does not rely on visual position. Table headers establish relationships but do not replace input labels. [W3C table headers](https://www.w3.org/WAI/tutorials/tables/two-headers/), [W3C spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/)

Validate positive quantities against real minimum, maximum and increment rules. Explain the specific error beside the affected field and retain the entered value for correction. Do not silently round quantities. For custom quantity widgets, expose a name and current value, applicable bounds and invalid state. [W3C spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/)

Check touch targets and spacing. WCAG 2.2 target-size guidance specifies 24 × 24 CSS pixels or an applicable exception, and recommends larger targets for easier use. A compact design must not derive its field capacity by shrinking controls below usable dimensions. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Suggested prototype cases: one real variant; one varying option with 2 and 12 values; dense 2 × 2; sparse 2 × 2; long option labels; three axes; sold-out and missing tuples; quantities 0, 1 and 250; rule minimum/increment; an existing mixed order; keyboard only; a narrow viewport and zoom. This is proposed validation coverage, not completed testing.

Source code was read from Shopify's public repositories. Commit links above identify the inspected snapshots. Research does not establish visual acceptance, connected Shopify behavior or an official automatic-layout algorithm.
