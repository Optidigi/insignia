# Product-knowledge assumptions audit — 2026-10-30

Read-only audit of the selected customer Preact prototype in `../designer-prototype`. No app source was changed and no tests were run. The supplied `127.0.0.1:5173` host was not listening, so this is source-only; the isolated browser attempt did not reach or alter a running page.

## Verdict

Keep the quantity step tab named **Quantities**. The step's stable task is entering amounts. An exact option name can still appear beside each field and in its instructions when supplied by the host. Avoid constructing a tab label such as “Models & quantities” from Shopify's option name: Shopify provides the option name and values, but not the singular/plural forms or the sentence grammar. The prototype's optional presentation contract requires both forms explicitly; this fixture supplies `model/models` and gets a sensible English label, but that is authored metadata, not safe inference.

For one-value axes, the current UI already collapses the step to “Quantities” and shows one field (`designer.tsx:101-102, 1787-1790`). That is a useful fallback. When presentation metadata is absent, however, the model falls back to `colour/colours` and `size/sizes` (`option-presentation.ts:5-22`); a non-apparel host must supply truthful labels rather than rely on that legacy default. Surrounding copy such as “item/items” and “Unavailable in this …” is also hardcoded English (`designer.tsx:1535-1538, 1569-1573`, `review-panel.tsx:126-139`), so changing only axis labels does not provide multilingual grammar.

## What this model can know

It can report the current local quantity for each configured row/column pair, the local sum, and the row/value order used by this view. It can show the currently loaded product image for a configured view and the current artwork reference. These are facts about the supplied `ProductConfig` and in-memory design (`model.ts:51-67, 149-153`; `review-panel.tsx:36-46`). They are not verified Shopify line items or accepted production assets. In particular, the design holds quantity keys shaped as local `rowId:valueId`; it contains no Shopify variant ID or authoritative option tuple (`model.ts:57-61`, `designer-state.ts:44-64, 235-243`).

The phone-case options scenario makes the boundary concrete: its two axes are explicitly presented as Finish and Model, but both finish values reuse the same generic schematic image (`scenarios/phone-case-options.json:2-20, 29-45`). It proves the labels and two-axis layout can be changed; it does not prove that the selected pair resolves to a real case SKU, price, inventory state, or Shopify cart line. The prototype README also explicitly describes option presentation as leaving the local matrix intact and not connecting it to Shopify variants (`README.md:32-38`).

## What it cannot infer

- **Arbitrary option taxonomy:** the schema has required `colors[]` and `sizes[]`, with a required hex on each row choice, plus only optional row/column presentation labels (`config.ts:37-72`). Named-choice mode suppresses the swatch in the UI; the required hex is a model-shape smell, not a visible swatch defect. This two-axis view model cannot by itself represent arbitrary option sets or establish exact variant identity. The host needs explicit variant-tuple-to-variant-ID mapping before any real add/update.
- **Physical product truth:** movement and placement coordinates are percentages of the fitted image (`position-geometry.ts:1-17`); the fixture itself calls its image schematic and uncalibrated (`scenarios/phone-case-options.json:6-7`). The UI can display merchant-configured bounds. It cannot infer device orientation, camera cutout shape, surface curvature, real dimensions, or manufacturing tolerances from the product name or image.
- **Merchant process behavior:** a configured method label, size, and demo price can be displayed. Option names and product type do not establish which methods, prices, or artwork limits a merchant will actually honor. Those must come from explicit merchant configuration and ultimately authoritative purchase data.

## Minimal product direction

Use **Quantities** as the invariant step label. Pass through exact Shopify option names as field/value context when known; keep any richer heading or localized sentence in an explicit locale/presentation contract. Treat current counts, order, and assets as local preview facts until the host supplies exact variant IDs, availability/pricing, accepted asset references, and verified Shopify mutation behavior. Do not infer physical or manufacturing facts from the schematic.
