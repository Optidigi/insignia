# Superfunny legacy customizer import checklist

## Verified source boundary

- Source store: [Superfunny](https://superfunny.nl).
- The live `Ontwerp Zelf` collection showed six product cards; each of those six product pages had an Insignia `Personaliseer` link.
- The public sitemap exposes 1,010 product URLs. This inventory verifies the six dedicated collection members; it does not claim that every URL in the full catalog was checked for an Insignia link or config.
- The separate `Live Product Options Interactive T-Shirt` listing is excluded. Its public page had no `Personaliseer` link and describes itself as a demo; public Shopify product JSON reports creation and publication on 2025-11-28. See `excludedPublicProduct` in `legacy-inventory.json`.
- Do not include products based only on a garment title, tag, category, or assumption. Add a source item only after its current product page exposes a `Personaliseer` link and the exact variant/config is captured.

## Destination safeguards

- Reuse the six visibly labeled QA copies already populated by CSV in the Insignia DEV store. See `bulk-catalog-result.json` and `destination-catalog-map.json`.
- Preserve existing rich Superfunny T-shirt product ID `10588458647835`; it is an existing calibration fixture with 64 variants, six colors, four views, and six placements.
- Keep source facts in `legacy-inventory.json`. DEV QA prices are examples in the destination store currency and must not be described as FX-converted source prices.
- Do not edit, upload to, or otherwise mutate Superfunny. No source cart, checkout, or customer data is part of this import.

## Source-to-DEV test recipe

For each product marked fully verified in `legacy-inventory.json`:

1. Open the exact public product/config record in the inventory. Confirm its current product ID, option names, color labels, variant IDs, prices, and availability before entering anything.
2. Reuse the exact mapped QA product ID. Shopify catalog products, variants and gallery photos are already imported; manual entry is reserved for Insignia configuration.
3. Verify the imported option axes and exact variant combinations. Preserve source variant IDs in the QA ledger and use the distinct destination IDs.
4. Keep variant base price, method price, placement base adjustment, and placement step adjustment as separate values. Do not bake design fees into the variant price. For the cap, the source reports a €17.50 base, `Bedrukken` at €0, `Patch` at +€7.50, and `Standaard` at €0. The current DEV example uses USD amounts as a QA convention, with no FX claim.
5. Create each method and placement with its captured name, description, file constraints, visibility rules, price adjustments, and default step. Retain the source “send logo after checkout” wording/behavior only if the destination feature supports it; do not invent a substitute.
6. Add view images only from local files mapped to the same source color and perspective. Record local path, MIME type, dimensions, and SHA-256 where available. Do not reuse a black or blue view image for another color merely to fill a slot.
7. Enter placement geometry as the source percentages (center X/Y and full width/height). Preserve each color override. The Insignia image picker normalizes uploads to a maximum 1,200 px edge. Percentage geometry survives proportional resizing, but `calibrationPxPerCm` does not: record the source decoded dimensions and the target dimensions inspected after upload. Adjust calibration proportionally only when that image-dimension relationship is verified; otherwise leave physical calibration unresolved. The inventory's source calibration remains historical data, not a new physical measurement.
8. Record unsupported or missing source properties as unknown. Current public config does not expose numeric movement bounds, independently measured physical print dimensions, or additional manufacturer limits beyond the upload constraints.
9. Verify each DEV QA product in the Insignia UI: selected variant, view/color pairing, placement/method pricing, accepted upload types/size limit, and logo-later control if present. Do not place an order or perform checkout.
10. Update the corresponding product status and note any destination UI limitation in `legacy-inventory.json`; do not silently flatten color differences or substitute data.

## Current product status

All six catalog products, 261 actual variant tuples, 29 gallery photos and 261 variant-image assignments passed native Shopify export readback. All copies are Draft and unpublished. All 101 source view images are staged and hashed in `legacy-view-assets.json`. Insignia views, placements, methods, calibration and publication remain manual UI test work.

The historical fixture under `frontend/admin/examples/admin/support/legacy-catalog.json` is dated 2026-10-20 and covers only one selected color each for hoodie, polo, and unisex T-shirt. It is not sufficient evidence for current all-color setup.

The current hoodie config exposes one live `Bedrukken` method, while all six placement `pricePerMethod` maps also contain a price under method ID `54f013a5-5382-41de-b36e-d80e6fc1c971`, which is absent from the live methods array. The inventory preserves this source key as an unresolved inconsistency; do not invent the missing method or attach that price to `Bedrukken`.

The unisex T-shirt also has 64 variants, but its source matrix is six colors × sizes, with white ending at 5XL while the other five colors extend to 7XL. The exact source IDs are listed in the inventory. The match in row count with an existing DEV T-shirt does not prove a match in product ID, color assets, configuration, or variants.

## Source facts that must stay separate

- The source product/variant base price comes from the Shopify product and variant data.
- Method price, placement base adjustment, and step price are separate Insignia config values.
- Color-specific view images and placement geometry can vary even when method and pricing settings match.
- A configured calibration factor does not establish garment measurements or production print limits.
- If an uploaded view changes dimensions, never copy its source pixels-per-centimeter unchanged. Record both source and target dimensions, scale only from a verified proportional resize, and leave calibration unresolved when dimensions or aspect-ratio changes are unknown.
- Product gallery images and customizer view images are separate asset roles; map them independently.
