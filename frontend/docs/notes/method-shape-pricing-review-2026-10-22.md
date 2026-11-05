# Decoration method pricing shape review

Research-only UI recommendation, 22 October 2026. Vendor behavior below is evidence of workable models, not a claim that Insignia should copy their whole pricing engines. This note does not change the current pricing contract.

## Recommendation

Replace the name-only method dialog with a top-level **Methods** resource page and an editable method detail. For the first useful pricing UI, offer two mutually exclusive bases:

1. **Flat price per location, per garment.** Apply the entered rate once per selected location for each garment. Two prints at two locations charge twice; this can seed the product's exact price rows.
2. **Price by location and decoration size.** Enter the final per-garment price for each offered location × decoration-size choice. Do not add a second flat fee or a size adjustment on top.

Avoid ambiguous **per item**. If it means one method fee per garment regardless of how many locations use it, that is a different mode from a per-location decoration charge; current Lean's exact tuple pricing cannot express it without counting the fee repeatedly or adding method-level pricing. Defer that mode until the quote model supports it. A per-order setup fee is also outside Lean V1: current checkout accepts nonnegative unit surcharges and has no new setup charge. Do not spread an order fee across quantities to imitate it.

Keep the method form compact: **Name**, **Pricing basis**, the associated default amount, and **Products using this method** with explicit assignment actions. Amounts use the shop currency and describe decoration charges separately from the blank garment price. The product assignment view shows Location, Decoration size, and Final decoration price. Let the merchant choose **Use method price** (copy it into every eligible product location/size row) or **Set prices for this product**. Do not show a shared size-price matrix on the method itself: locations and decoration-size IDs are product-local.

The top-level amount should be presented as a reusable starting price. Applying a method copies/resolves it into the product draft; product-specific values replace the copied values. Do not silently add the method amount to product prices, infer missing locations, or live-update existing products after a method edit. Existing publications and orders keep their frozen values. If “Products using this method” is shown before linked assignments exist, describe it as explicit assignment state rather than an invented usage count.

## What vendor docs establish

- DecoNetwork exposes a simple flat mode and an advanced mode. In advanced pricing, **Single Price** means a fee each time a decoration area is used; it also documents product-level area-price overrides. Other modes include area pricing and tables for size/quantity or process variables. This demonstrates why “flat” needs its scope stated in the UI. [Decoration Pricing](https://help.deconetwork.com/hc/en-us/articles/236150748-Decoration-Pricing), [pricing per used decoration area and per product](https://help.deconetwork.com/hc/en-us/articles/232254668-Set-up-pricing-per-used-decoration-area-per-product), [Product Pricing](https://help.deconetwork.com/hc/en-us/articles/235675747-Product-Pricing).
- InkSoft keeps reusable account-level screen-print grids and activates methods plus a selected grid on each product. Its example separates a one-time setup charge per side/design from print price per item/side, and requires explicit `0.00` in cells intended to be free. This is useful evidence for explicit scope and zero semantics, not a fit for adding setup pricing to Lean. [Screen Print Pricing](https://help.inksoft.com/hc/en-us/articles/46724059783579-Screen-Print-Pricing), [product Decoration settings](https://help.inksoft.com/hc/en-us/articles/46724037237787-Edit-Products-Decoration-Blank-Products).
- Zakeke separates reusable Printing Methods from Pricing Rules. Rules can target product sides/areas, apply per item or per order, and use design properties or quantity tiers. It warns that an overlapping product rule takes priority and completely replaces the connected method rule. This supports explicit assignment and precedence, while also showing how quickly generic rule authoring grows. [Printing Methods](https://zakeke.zendesk.com/hc/en-us/articles/360016836099-Printing-Methods), [Pricing Rules](https://zakeke.zendesk.com/hc/en-us/articles/360015984779-Pricing-Rules).

These are documentation findings, not comparative usability results. No source supports enabling automatic embroidery stitch counting, ink/color pricing, design-area calculations, garment-color surcharges, or quantity breaks in Insignia merely because vendors offer them.

## Fit with Insignia's current model

The rewrite's method catalog currently stores a reusable name; product configuration owns allowed methods, locations, decoration sizes, and the final shop-currency surcharge for each method × location × size tuple. Missing price means unavailable; explicit zero means free. Published revisions freeze that table. See [the Lean pricing validator](../../../packages/domain/src/pricing/lean.ts) and [implementation plan §§3.1–3.5](../../architecture/implementation-plan.md).

Consequently, shared method price modes are not a direct replacement for current checkout data. A method-wide per-garment fee cannot be copied as the same amount into every location/size cell without charging it repeatedly. A per-location fee can seed cells, while size-specific prices belong to the product's location/size rows. For now, assignment should resolve the chosen method price into concrete product-local final prices, then leave each product editable. Persisting live links, once-per-garment method pricing, or per-order fees needs a later contract and pricing-engine decision; that integration work does not block the top-level UI proposal or a reversible UI exploration.

Do not add an “advanced rules” builder for quantity, stitches, colors, artwork size, garment color, or setup charge. Keep any later richer mode separate until its inputs, unit, precedence, preview and published-price behavior are specified and supported end to end.

## Example states to make unambiguous

| Merchant setup | Expected meaning |
| --- | --- |
| Per-location: front €5, back €5; both selected | €10 decoration surcharge per garment. |
| One-time per-garment fee: €5; same method on front and back | Useful future mode, but defer it; current exact tuple checkout cannot charge it once without additional scope support. |
| Per-location: front €5, back €0.00 | Front costs €5; back is explicitly free. |
| Per-location: front €5, back blank | Back is not offered. It must not become free or inherit €5 invisibly. |
| Size table: front Small €4, front Large €7 | Each choice is the final surcharge. Do not also add a base €4 or size delta. |
| One method on front, another on back | Each method's declared scope applies independently; explain whether each is once per garment or per location. |
| Method has no amount, or an assignment introduces a new product location/size | Leave it unset/unavailable and require a price before publishing that choice. |
| A one-time setup fee is requested | Do not offer it in this UI; it is not represented by current Lean unit pricing. |

Status: source-backed design recommendation only. No application behavior, contracts, or catalog records were changed.
