# Decoration method MVP: source findings and scope

Research check for the decoration-method proposal dated 21 October 2026. Provider requirements below are examples from those providers, not universal print standards.

## Recommendation

Defer reusable physical size presets and physical calibration. Keep the current product-scoped decoration sizes and manually entered dimensions, labeled as the merchant's declared maximum artwork box. The millimeter values do not calibrate the preview, prove fit on a garment variant, or promise that artwork with another aspect ratio will print at both stated dimensions. Explain that artwork keeps its proportions inside the box. Do not claim physical fit until the product's real area dimensions and applicable variants can be checked together.

This is a strong MVP boundary: provider guidance shows that limits depend on product, location, provider, garment size and technique. A copied physical preset cannot establish fit on its destination product by itself.

## Official source facts

- Printify describes the print area as the product's maximum printable space. Recommended file dimensions vary by product, print area and sometimes item size; artwork can be smaller within the maximum area when resolution permits. [Printify: What dimensions should my design be?](https://help.printify.com/hc/en-us/articles/4483601892497-What-dimensions-should-my-design-be)
- Printful defines actual print-file size as the design's real-world size and says files should match actual print dimensions; pixel resolution alone is not enough. [Printful: What is DPI, resolution and actual print file size?](https://help.printful.com/hc/en-us/articles/50264010605457-What-is-DPI-resolution-and-actual-print-file-size)
- Printify says providers can offer different print locations and sizes, and each product/location has its own maximum printable size. [Printify: How are the print areas different?](https://help.printify.com/hc/en-us/articles/4483637776401-How-are-the-print-areas-different)
- Printful documents a variant-specific exception: a 15 × 18 in front area on some DTG garments is reduced to 11.5 × 13.8 in for smaller sizes, with artwork proportionally downscaled. Its example says the larger area applies to L and up for Bella + Canvas 3001. This is a provider/product rule, not a universal grade rule. [Printful: How is my design scaled for different garment sizes?](https://help.printful.com/hc/en-us/articles/50264397552657-How-is-my-design-scaled-for-different-garment-sizes)
- Printful's embroidery requirements vary by technique: flat and puff embroidery have different minimum line and negative-space dimensions, and standard embroidery has a thread-color limit. Such requirements are not captured by one max-width/max-height box. [Printful: How should I prepare my design for embroidery?](https://help.printful.com/hc/en-us/articles/50263985175953-How-should-I-prepare-my-design-for-embroidery)
- For all-over printing, Printify distinguishes print, safe and bleed areas and says the printable area may vary slightly by size variant. This needs coverage and variant-specific handling beyond a normal placement rectangle. [Printify: What are safe areas and bleeds?](https://help.printify.com/hc/en-us/articles/4483626015889-What-are-safe-areas-and-bleeds)

## Existing checkout facts

- The reusable method catalog persists an ID, name and version, capped at 100 entries; it has no description or size presets in [the catalog repository](../../../packages/database/src/repositories/method-catalog.ts#L4).
- Product geometry already has product-scoped size-step IDs, percentage bounds and optional `physicalMm`, plus variant-specific placement rectangles in [the geometry contract](../../../packages/visualizer/src/geometry.ts#L24). The renderer scales the step against the selected placement and contains raster artwork by aspect ratio; it does not use `physicalMm` to set preview scale ([renderer](../../../packages/visualizer/src/geometry.ts#L320)).
- The editor lets merchants enter production width and height manually and says those values do not resize the preview ([product editor](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L2264)). The production sheet records those configured values or says physical size is not configured ([production sheet](../../../apps/web/src/shared/production-sheet-render.ts#L473)). These are useful production facts, not a fit calculation.
- Buyer configuration exposes methods and allowed method/size lists per placement, while final price validation checks a selected method/placement/step tuple ([buyer contract](../../../packages/contracts/src/v1/buyer.ts#L84), [Lean pricing](../../../packages/domain/src/pricing/lean.ts#L35)). A richer buyer workflow still needs its offered-choice projection to avoid presenting unpriced combinations as selectable.

## MVP scope and material edge cases

Keep the library to a reusable name and optional short buyer guidance. Configure method, locations, product-specific sizes and final prices together in product setup, then expose only server-derived offered method/location/size tuples. Keep size labels and preview percentages local to the product; preserve manually entered millimeter values as the declared maximum box and approximate preview. Do not add technique presets, inferred print-area dimensions, auto-fit, or provider-derived defaults.

| Edge case | MVP handling |
| --- | --- |
| A smaller garment variant has a reduced print area | Deferring presets does not remove this issue. Require each offered maximum box to fit every variant in that product configuration; use separate product configurations/products when needed until explicit variant eligibility exists. Do not silently shrink the artwork. A preview override is not physical validation. |
| Artwork does not fill its maximum box because its aspect ratio differs | Keep the box and artwork bounds distinct. Preserve aspect ratio and show resulting bounds when artwork is known; never describe the box dimensions as guaranteed exact output dimensions. |
| Technique needs constraints that a rectangle cannot express, such as embroidery detail or thread limits | Keep method names descriptive only. Show centrally supported upload facts as guidance; defer method-specific acceptance rules until assignment, publication and server checks enforce them. |
| All-over print needs bleed, safe zones and variant-specific coverage | Exclude it from the MVP's normal placement/size promise; it needs a separate coverage model and variant-aware review. |

The proposal's basic Shopify save behavior is sound: the official App Home Save Bar can detect changed form values and present Save/Discard for a settings form. That supports a simple library editor lifecycle; it does not supply sizing or fit semantics. [Shopify App Bridge Save Bar](https://shopify.dev/docs/api/app-home/v2.0-rc/app-bridge-web-components/save-bar)
