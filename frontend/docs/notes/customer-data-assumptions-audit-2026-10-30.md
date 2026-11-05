# Customer product data assumptions audit — 30 October 2026

Read-only source audit of the selected customer prototype in `../designer-prototype`. No UI or shared-browser changes. The JSON scenarios are local fixtures; they do not establish what a connected Shopify host will supply.

## Findings

### P1 — Option naming has an explicit-fixture / legacy-fallback wiring gap

There is no product-type inference. `resolveOptionPresentation()` uses supplied `optionPresentation` or always falls back to **colour/colours**, **size/sizes**, and **swatch** (`designer-prototype/src/option-presentation.ts:5–22`). `Designer` uses those terms in the option chooser, quantity step, buttons, availability copy and review (`designer-prototype/src/designer.tsx:91–103, 925–939, 1083–1140, 1506–1512, 1569–1602, 1687–1695`; `color-picker.tsx:32–80`; `review-panel.tsx:29–46, 103–145`). The `phone-case-options` fixture explicitly sets Finish/finishes, Model/models and named-choice (`src/scenarios/phone-case-options.json:11–21`); the ordinary phone-case fixture intentionally omits it (`src/scenarios/phone-case.json:11–18`). This is not a fixture inference bug: the first fixture is correctly labeled, and the second is a legacy-format case. It is a live wiring gap if a connected non-garment product reaches `Designer` without matching metadata; it then gets the legacy colour/size wording. The product title or type cannot reliably fill that gap.

The host-facing `Designer` accepts a complete `ProductConfig`; the local scenario gallery is expressly excluded from a connected entry (`designer.tsx:73–89`; `README.md:24–28`). The buyer/merchant contracts expose labelled options and values plus variant availability, but the selected prototype has no connected producer for its row/column presentation object, and those contracts do not supply singular/plural or swatch-vs-name metadata (`insignia/packages/contracts/src/v1/buyer.ts:81–101`; `insignia/packages/contracts/src/v1/merchant-draft.ts:19–27, 37–47`). That missing wiring is the real issue; guessing product type would only hide it.

**Source / smallest fix:** use the exact Shopify option names and values beside their controls, with a generic **Quantities** step/action heading. Do not guess singular/plural or infer roles from product type/title. Render a swatch only when the merchant explicitly chooses that presentation and supplies verified swatch data; otherwise render a named choice. The current prototype is a two-axis matrix, so unsupported option shapes need an explicit adapter rather than silent remapping.

### P1 — A “named choice” still requires invented swatch data; variants are not identified

Every row entry is structurally a `color` and requires a six-digit `hex`, even when `display` is `named-choice` (`src/config.ts:37–49, 60–71`). The phone fixture intentionally assigns the same neutral hex to Matte and Gloss because named-choice hides it (`phone-case-options.json:29–45`; `SCENARIOS.md:80`). That test value is not a bad fixture assumption. The live risk is that a non-color Shopify option without verified swatch data must either be mapped to named text choices or would need fabricated hex values under this schema.

The local quantity model keys rows × columns, not Shopify variant IDs. Missing `availableSizeIds` means every configured pair is treated as available (`src/model.ts:181–188`); the phone fixture therefore treats all four Finish × Model pairs as selectable. Local price arithmetic also gives the same base price plus placement costs to every pair (`src/model.ts:105–129`). Its €24 base and the four combinations are explicitly fixture values, not mapped SKUs or a live quote (`phone-case-options.json:25–45`; `SCENARIOS.md:78–80`).

**Concrete breakage:** a shop can have Matte/Model A but no Gloss/Model B, or different variant prices. With absent availability/pricing data, the UI offers the missing pair and reports a plausible but unsupported total. The new buyer contract already represents availability per variant; purchase prices come from the authoritative quote, not these local estimates (`buyer.ts:97–100, 108–132`; prototype `README.md:28`).

**Source / smallest fix:** map each supported option tuple to a real variant ID and its current availability; only show pairs the host confirms. Use the accepted quote for purchase totals. Make swatch hex conditional on swatch display (or represent named values separately), instead of manufacturing placeholder hexes.

### P1 — Live preview and movement geometry require product-specific source data

Photo image paths are keyed by row value and view, not by the full variant tuple; photo fixtures require a path for each configured row/view but validation cannot prove the asset depicts that choice (`src/config.ts:60–83, 221–248`; `src/model.ts:149–153`). The phone Finish × Model fixture intentionally reuses one schematic for both finishes and models (`phone-case-options.json:29–49`; `SCENARIOS.md:80`). That is documented test data; a real model-specific product image cannot currently be selected by the column/model axis.

`movementArea` is optional and is one rectangle on a placement in normalized image coordinates. Drag clamping keeps artwork inside that rectangle; it does not infer a printable surface or represent an internal obstacle such as a camera cutout (`src/config.ts:12–26, 84–103`; `src/position-geometry.ts:151–185`). The phone fixture’s rectangle is intentionally drawn over a generic SVG and is expressly not a calibrated manufacturing template (`phone-case.json:7, 38–48`; `SCENARIOS.md:78, 82`). Reusing that fixture geometry for real case models could permit artwork over a camera or edge on one model.

The illustration path is also explicit fixture data: it supports only T-shirt, hoodie, polo and apron silhouettes (`src/config.ts:55–56, 129–133`; `src/garment-preview.tsx:12–14, 72–78`). A view ID does not select its angle; `illustration` defaults to `front` (`src/config.ts:73–83`). Thus `id: "back"` without an explicit angle can show the front silhouette. Neither a product title nor a product-type string can supply accurate imagery or placement geometry.

**Source / smallest fix:** use the selected Shopify media and merchant-authored view/placement geometry. Key media and safe areas to the actual variant/view when they differ. Keep movement disabled unless the configured region is valid for every selectable variant; for irregular exclusions, do not claim a rectangle guarantees a safe print area. Use real product photos for non-garments rather than extrapolating a garment illustration. The current phone art and safe area remain intentional fixtures.

### P2 — Relative artwork labels can hide uncalibrated physical scaling

Artwork dimensions scale the preview in proportion to the first configured dimension (`src/position-geometry.ts:62–80`). The displayed label uses `sizeLabels` when present, otherwise it appends a hard-coded `cm` (`:105–114`). The phone fixture intentionally pairs 8/10/12 scaling values with relative Small/Medium/Large labels (`phone-case-options.json:64–68`); it does not claim those are case measurements. A centimeter claim or to-scale preview in a live product needs manufacturer/merchant measurements and calibrated image geometry. The fixture guide says its coordinates are percentages of the preview image, not body measurements (`SCENARIOS.md:82`).

**Source:** manufacturing setup or merchant-approved physical measurements and units. When those are absent, keep the choices explicitly relative and the preview illustrative; do not infer centimeters from image pixels or a garment/product category.

### P2 — Product-option labels do not localize the surrounding interface

`optionPresentation` changes only axis nouns and row display mode; the rest of the prototype copy remains English (including Artwork, Review, action labels and validation). `locale` is used for formatting/capitalization, not as a message catalogue (`README.md:105`; `UI-DATA-AUDIT.md:18`). If a product label is translated while the app copy is not, the screen is only a layout fixture, not a translated customer flow.

**Source:** app message catalogue for UI copy; Shopify/merchant labels for product option, view and placement names. Do not generate product-category copy from the product name.

## Scenario coverage

All 14 JSON entries are static test fixtures (`src/scenario-catalog.ts:7–22`; `SCENARIOS.md:5, 17–19`). The table records what each exercises, not what any live store sells.

| Fixture | Product data exercised | External fact needed before live use |
| --- | --- | --- |
| `classic` | 6×6 T-shirt matrix, 3 photo views, 5 placements (1 movable) | Current product variants, per-view media, movement calibration, prices and stock |
| `phone-case`, `phone-case-options` | Portrait case schematic; second fixture labels 2 finishes × 2 models | Real model/finish compatibility, model-specific photos, variant mapping, safe areas and quote |
| `minimal`, `one-size-apron` | Apron illustrations; 1×1 and 3×1 matrices | Actual colors, one-size claim, images/geometry and price |
| `colour-studio`, `large-palette` | Illustrated T-shirts; 24 and 60 color rows | Actual option values, swatches and availability; palettes are fictional |
| `extended-sizes` | Photo tee, 2×14 matrix with sample restrictions | Actual size run and color/size stock; supplied photos are not a live feed |
| `front-only`, `many-widths` | Single-view photo tees; five size values; width/pricing stress case | Actual SKU data, image and calibrated print sizes/prices |
| `staff-polo`, `long-content` | Illustrated polos; 3×7 and 2×8; long/bilingual labels, one restricted row | Real option labels, measurements, supported methods and availability |
| `team-hoodie`, `many-placements` | Illustrated hoodies; 4×8; four views and up to 18 placements | Real view mapping, placement geometry, allowed methods and pricing |

The four T-shirt-photo scenarios reuse a small static shirt-image set; the two phone-case scenarios intentionally use a separate schematic. Hoodie, polo, apron, palette and phone-case illustration assets are test data (`README.md:74`; `SCENARIOS.md:76–80`). These are fixture limitations, not accidental claims about live products; none substitutes for product/variant-specific host data.

## Recommendation

Keep the selected customer layout product-agnostic. At the live adapter boundary, require explicit option-axis/display metadata, current variant IDs and availability, variant/view media, merchant-approved geometry/physical units, and authoritative quote data. Preserve the current fallback only for a host that explicitly declares the legacy garment color/size mapping. A product type or title is not a reliable source for any of those decisions.

This was a static source audit; no browser suite or implementation tests were run.
