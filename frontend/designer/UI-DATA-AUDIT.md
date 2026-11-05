# Frontend data dependencies

The UI should need merchant data only where the customer's choice actually depends on it. Generic interface messages belong to the app's translation catalogue. Labels for sellable options belong to the store. Stable IDs connect the two without parsing visible words.

This audit is based on the current prototype and the new Insignia's local buyer and merchant-presentation contracts. It is not a Shopify integration. The prototype JSON combines these sources to make UI testing possible.

| UI content | Source | Handling |
| --- | --- | --- |
| Product name and product-page description | Shopify product | Display as supplied. No need for a separate garment noun in every sentence. Header may shorten the product name; product page shows it fully. |
| Colour names, size labels, variant availability | Shopify options and variants | Keep their original labels and stable identities. Do not assume that every store calls an option Colour, spells it in English, or uses sizes S/M/L. Production needs an explicit option mapping. |
| Swatch colours and variant/view photographs | Store media or merchant configuration | Colour names cannot reliably generate hex values. Photos must correspond to the selected variant and view. The prototype uses calibrated-by-fixture image mappings and supplied hex values. |
| View labels and placement names | Merchant presentation | Render supplied labels. Never infer front/back, sleeve/chest, orientation or geometry from translated text or IDs. |
| Placement thumbnail and marker | Existing view image and placement coordinates | Generated. No icon field, icon catalogue, translation or per-placement artwork needs maintenance. Photo thumbnail uses the same image as the preview. Marker centre and width use the same geometry. |
| Garment illustration | Demo fixture only | A small set of generic silhouettes, with an explicit illustration angle per view. Production photo previews do not require a garment-type field or a matching silhouette for every product. |
| Method names and permitted combinations | Merchant configuration | Display supplied names, filtered by placement. Do not assume the word Print or a method called embroidery has a particular surcharge or capability. |
| Physical artwork widths | Placement geometry and manufacturing configuration | The demo uses centimetres. Production needs explicit physical units and calibrated dimensions. Generic UI copy cannot infer these from the garment. |
| Artwork-later permission | Each placement's policy | Supported individually in the prototype, with a product default. A buyer cannot defer artwork at a placement that requires it. |
| Prices, currency, taxes, discounts and availability at purchase | Shopify and authoritative Insignia quote | The demo arithmetic is illustrative. Removed unconditional VAT included and shipping-at-checkout claims because those details are not supplied. Production should show tax wording only when supplied by the host or quote. |
| Uploaded filename | Customer file | Keep it unchanged. Use generated artwork IDs for references. Compact labels preserve the extension and accessible full name. Names that overflow the two-line label in the artwork library offer a Full filename disclosure for touch and keyboard users. It wraps the complete name when expanded. |
| Upload types, limits and inspection status | Upload service capabilities | PNG/JPG/SVG and 5 MB are implemented local-prototype limits, not a promise about the production service. Production must supply or share the accepted policy and validate files server-side. |
| Item, Artwork, Width, Method, Add artwork, errors and counts | App translations | Shared messages, independent of product type. The current prototype is English. Full message translation, plural rules and localized sentences still need integration. Locale-aware money formatting alone does not translate the interface. |
| Return destination and cart result | Store host integration | The current product page and cart are simulations. Use the actual return destination and cart proposal results in production. |

## Large or unpredictable content

- More than eight configured positions gets search and a view filter. Search also matches view labels. Group headings distinguish identical names on different views. A view-specific add action starts with that view selected.
- The close button, search and filter stay visible while results scroll. The picker works with keyboard scrolling and at 320px width.
- Already added positions remain visible, marked Added and disabled. When only one position remains, the existing direct-add behavior avoids another chooser. When none remain, the add action disappears.
- The preview accepts up to 32 placements, matching `BuyerConfigSchema` and the purchase contract. The gallery includes a realistic 18-placement sponsor hoodie. Independent placement settings remain in the accordion list.
- Store labels wrap inside the available space. Price and close controls keep their space. Filenames shorten only in compact contexts; their full text is available in the file chooser without hover. Very long names expand on request, keeping the normal file grid compact. The dialog header stays visible while the file list scrolls.
- Removed the contrast warning keyed to the sample artwork ID. A real contrast or resolution warning needs actual image analysis, chosen physical dimensions and method rules. A filename, sample ID or colour name cannot establish quality.

## Where the new Insignia already helps

`../insignia/packages/contracts/src/v1/buyer.ts` defines stable labelled methods, placements, steps, options, variant availability, per-placement `logoLaterAllowed`, `geometry` and image URLs. `merchant-draft.ts` separately supplies labels keyed by IDs. These support the split above.

Geometry is currently typed as `unknown` at that boundary. Production still needs a defined, validated mapping from geometry and image URLs to views and coordinate systems. The prototype's percentages of a square photo are a UI fixture convention, not proof that the production geometry has this shape. Photos must use consistent crops or provide per-image geometry.

There are further explicit adapter differences: prototype IDs exclude colons, prices assume two decimal places, variants use colour/size pairs, and width choices use local array indexes. The production buyer contract has its own IDs, variants, step IDs and currency exponent. Those should be mapped at the integration boundary rather than made to depend on the visible label.
