# Manual QA catalog copy — Superfunny hoodie

## Source record

- Source: Superfunny public product [Ontwerp je eigen Superfunny hoodie](https://superfunny.nl/products/ontwerp-je-eigen-superfunny-hoodie), handle `ontwerp-je-eigen-superfunny-hoodie`, product GID `gid://shopify/Product/15468416336256`, configuration ID `cb86e7b8-0281-4062-a7e3-52214a2e28e9`.
- Current source price: EUR 24.95 for each of 33 actually available variants.
- Exact source option labels and value order: `Kleur` = `Zwart`, `Grijs`, `Navy`; `Maat` = `XS`, `S`, `M`, `L`, `XL`, `XXL`, `3XL`, `4XL`, `5XL`, `6XL`, `7XL`.
- All 3×11 color/size pairs exist and were marked available in the source inventory. Source variant IDs and the full recipe are in [legacy-inventory.json](legacy-inventory.json), under `fullyVerifiedProducts` for this handle.
- The destination price below is a numeric USD QA example matching the source number. It is not currency conversion or a commercial price-parity claim.

## Destination and boundaries

- Store: `insignia-rewrite-dev` (Shopify Admin header showed the dev store), opened at `/store/insignia-rewrite-dev/products` in a new Chrome tab (`835133943`). No source Superfunny admin page was used for this lane.
- Authorized copy: `QA legacy import — Superfunny hoodie` only. Shopify product ID `10590396317979`, handle `qa-legacy-import-superfunny-hoodie`, Admin path `/store/insignia-rewrite-dev/products/10590396317979`.
- Status was set to Draft before the first Save and remained Draft after a fresh reload. All 33 destination variants show USD 24.95 and 0 available at the shop location. The source availability is not represented by the zero-stock QA copy; do not treat this draft as a purchasable mirror. Any inventory plan is separate follow-up work.
- Shopify suggested `Hoodies in Clothing Tops` after the title was entered. That suggestion was not accepted. The category is `Uncategorized` on fresh reload. Description and media are blank; no collection, tag, or Insignia configuration was added. The product was not published and no customer or checkout flow was opened.
- No product media was uploaded, and no Insignia views, placements, methods, or configuration were created. Preserve dev-store USD/US settings and existing products; no other catalog record was changed in this lane.

## Manual UI steps and readback

1. Opened Shopify Admin `Products > Add product` in the separate dev-store tab. Verified the store name and `/store/insignia-rewrite-dev/products` path before entering product data.
2. Entered the QA-labeled title and USD 24.95 base example. Under `Variants`, used `Add options like size or color` > `Create custom option` to enter `Kleur` and the three source color values, then added `Maat` with the 11 source sizes. Set Status to Draft before saving.
3. Shopify's option editor kept both option editors expanded, each with an `Add another value` field. During entry, size values were briefly added to the `Kleur` option in the unsaved form. I noticed the first option listed more than the three source colors, removed those 11 misplaced values before the first Save, and entered them into the distinct `Maat` editor. No product or variant data had been saved at that point.
4. Before Save, the UI showed `Select all 33 on page`, three groups (`Zwart`, `Grijs`, `Navy`) with 11 variants each, USD 24.95, and 0 available. `Kleur` contained only the three colors; `Maat` contained exactly `XS` through `7XL` in the source order. Cleared Shopify's automatic category assignment back to `Uncategorized`, leaving its category suggestion unaccepted.
5. Clicked Save once. Shopify showed `Product created` and navigated to product ID `10590396317979`. Reloaded that exact Admin product page. Fresh readback showed the same title, Draft status, `Uncategorized`, both exact option labels/value sequences, `Select all 33 on page`, and three color groups of 11 variants.
6. Expanded all three color groups after reload. Each showed the exact 11 sizes in source order; each row displayed `$24.95` and `0` available. Total inventory remained 0. No further catalog edits followed the reload.

## Evidence

- Fresh Admin Draft readback and option summary: [hoodie-admin-draft.jpg](../evidence/frontend-qa-2026-11-08/hoodie-admin-draft.jpg)
- Expanded Zwart variants: [hoodie-variants-zwart.jpg](../evidence/frontend-qa-2026-11-08/hoodie-variants-zwart.jpg)
- Expanded Grijs variants: [hoodie-variants-grijs-navy.jpg](../evidence/frontend-qa-2026-11-08/hoodie-variants-grijs-navy.jpg)
- Expanded Navy variants: [hoodie-variants-navy.jpg](../evidence/frontend-qa-2026-11-08/hoodie-variants-navy.jpg)

Screenshots are captured from the CUA browser tab after the fresh reload. The completed work is a Shopify catalog Draft only; it is not a fully configured Insignia import or a customer-side parity result.
