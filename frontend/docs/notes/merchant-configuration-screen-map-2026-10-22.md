# Merchant configuration screen map

Recommendation for the task “offer printing and embroidery on this hoodie’s chest and back”: start from the product, configure its physical placements and commercial choices in two directly connected editors, then review the result from the product setup overview. Keep the reusable method library as an optional source of names and explanations. Do not require a method-library visit, wizard sequence, or a separate pricing destination before a merchant can begin.

This is an information-architecture proposal for later individual UI passes. It does not change product, method, geometry, or pricing contracts.

## Screens and ownership

1. **Products** — Select the Shopify product to configure.
2. **Product setup overview** — Show the selected product, its current configuration state, the two editing tasks below, and the existing review/publish action. Keep supported product-level behavior here and show shop currency as read-only context. Merchants can revisit either editor without repeating a wizard. Options & prices requires at least one location; its empty state links directly to creating one. Both editors belong to the same product draft.
3. **Images & placements** — Own Shopify product images, views, placement names, placement rectangles, and variant-specific image/rectangle overrides. Show a visual editor and live preview. Do not put method selection or prices here.
4. **Options & prices** — Own which product-copy methods and product decoration sizes are offered at each existing placement, plus the price for each exact offered tuple. Start with a location selector so the merchant can work on “chest” and “back” against the corresponding garment view. For each location, show its methods, available decoration sizes, and direct price fields. Add a size here in the selected placement context; expose its preview footprint and label beside the choices. Include a contextual **Edit placement** link that opens the selected location in Images & placements and returns to the same location afterward. The selected view and placement preview should remain visible while setting its choices.
5. **Settings → Decoration methods** — A reusable resource list with a short create/edit dialog for method name and optional customer explanation. Keep locations, geometry, size availability, and prices out of this library. From Options & prices, **Add method** can select a saved method or create a product-only method in the open draft, so a name-only library record is never a required first stop.

Use location-first organization for Options & prices. It anchors the decisions to the physical place on the garment and makes each available method/size/price combination clear in context. A method-first screen would make the chest/back relationship less direct and scatter each method’s location-specific prices. Do not add a second view toggle; there should be one obvious way to edit this product.

## Price and size presentation

Show one explicit shop-currency unit surcharge for every `method × placement × decoration size` tuple. A missing value means **Not offered**; `0` means **Free**. Do not create a method base price, size multiplier, or hidden “base plus add-on” authoring rule. In the review, show the exact per-garment result for a concrete choice, including the Shopify variant’s base price and the selected placement surcharges. For example: `€20 garment + €3 chest print + €6 back print = €29 per garment`. This keeps the entry tied to the exact tuple while sparing the merchant mental arithmetic.

Treat decoration-size definitions as product-owned shared choices created from Options & prices, not as global method presets. One definition has one label and one product-level preview footprint; location eligibility and prices are then shown where the merchant configures that location. Keep the size editor compact and inline for the common case, with placement preview available there. Do not send the merchant to a separate “sizes” master screen to price a new choice.

## Integration limits to carry into later passes

The current rewrite already has product-local method copies, per-placement allowed methods/sizes, and Lean prices keyed to method, placement, and size. A library selection copies a name into the product; subsequent library edits do not update that product. Preserve that independence and do not infer shared identity from matching names.

Current geometry keeps product views, images, placement rectangles, and step definitions separately. Step preview width/height are fractions of the selected placement; optional physical millimeters do not calibrate the preview. The existing model therefore supports product-level shared size definitions, not a different physical size definition per method/location or automatic fit derived from garment imagery. Keep wording and preview claims within that behavior. Per-method/per-placement physical boxes, measured fit, or automatic geometry require a separately approved integration change; this map adds no persistence contract.

The unit amount shown for a tuple is a placement surcharge in the current Lean model. The customer total combines the Shopify variant base with the surcharges for selected placements. A product overview or review preview should show that composition, but no second pricing formula should be authored.

## Design basis

Shopify recommends focused single-column pages for one obvious task and a two-column layout for visual editors that need a live preview; its form guidance also recommends sections for larger forms and the standard contextual save bar. These patterns support a product overview plus separate visual and commercial editors, while keeping their shared draft/save behavior consistent ([Shopify layout guidance](https://shopify.dev/docs/apps/design/layout), [Shopify form guidance](https://shopify.dev/docs/apps/design/user-experience/forms)).

Method, location, size, and price are commonly adjusted together, so keep those controls in Options & prices. NN/g’s progressive-disclosure guidance cautions that frequently co-used, back-and-forth choices belong together; use separate editors for the genuinely distinct visual-geometry task, with a direct return path between them ([NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).

## Current contract references

- [Implementation plan, product configuration and pricing](../../architecture/implementation-plan.md#31-configuration-and-publication) — product-local configuration, methods, placements, steps, and final tuple prices.
- [Merchant configuration editor](../../../apps/web/src/islands/MerchantConfigEditor.tsx) — current product-rule, image/placement, and price responsibilities.
- [Geometry model](../../../packages/visualizer/src/geometry.ts) — product-wide step fractions and optional independent physical dimensions.
