# Colour variants in the configurator

Researched 27 October 2026 from the current source, schemas and focused tests. No application implementation changed. The temporary Cloudflare tunnel was stopped; local preview services remain running.

## What the customer-facing prototype already does

The polished buyer prototype on port 5173 has an explicit colour model, colour swatches and searchable large palettes. Its Classic scenario supplies six colours with photos for every configured view. Selecting another colour chooses the corresponding photograph; it does not recolour a source photograph. Illustration scenarios use supplied colour values on a schematic garment.

Quantities are stored by colour and size. The buyer can add several colour rows, and each row exposes its own size availability. Switching the active preview colour preserves entered quantities. Review and the simulated cart group the quantities under the design. One design owns one set of artwork/settings across its colours. Different artwork or methods require another design.

Primary evidence:

- [Prototype colour schema](/Users/pc/Development/Insignia/designer-prototype/src/config.ts:47) and [required photo mapping for each view](/Users/pc/Development/Insignia/designer-prototype/src/config.ts:208).
- [Classic colour/photo fixtures](/Users/pc/Development/Insignia/designer-prototype/src/scenarios/classic.json:41).
- [Image lookup and colour/size availability](/Users/pc/Development/Insignia/designer-prototype/src/model.ts:149).
- [Colour switching](/Users/pc/Development/Insignia/designer-prototype/src/designer.tsx:746), [quantity rows](/Users/pc/Development/Insignia/designer-prototype/src/designer.tsx:1413), and [saving/editing separate designs](/Users/pc/Development/Insignia/designer-prototype/src/designer.tsx:670).

These are prototype interactions. Its quantities use local colour/size keys and its price model uses one product base price. They are not evidence that Shopify variant mapping, stock and contextual prices are already integrated into this polished UI. The existing [UI data audit](/Users/pc/Development/Insignia/designer-prototype/UI-DATA-AUDIT.md) explicitly identifies that integration boundary.

## What the application model supports

The application keeps real Shopify variants. One design group can specify quantities for multiple variants, with each variant's authoritative base price plus the selected decoration charges. Geometry supports a shared image and optional per-variant images for each view, as well as per-variant placement rectangles. Missing overrides fall back to the shared image/rectangle. A fallback is not proof that the image matches the selected colour.

Catalog selected options are available, but the production buyer projection currently exposes variant ID, label and availability rather than a structured colour/size matrix. Blue/S and Blue/M are separate identities; there is no first-class colour group in the geometry schema. A merchant-friendly colour group would need to map its shared photos to those variant identities.

The older MerchantConfigEditor has a per-variant selector, shared-versus-variant image assignment and print-area overrides. That is underlying authoring capability, rather than evidence that the newer polished editor exposes the same workflow. See the [independent model research](color-variant-model-research-2026-10-27.md) for code references, normalization, immutable purchase history, pricing and current limits.

## The missing part in the current merchant experience

The newer editor served in the review preview uses a product schema with an image library, views, placements and methods, but no variant/colour assignment field. Each view stores one image. Its customer-preview adapter deliberately generates one colour named "Product image" and one placeholder size.

Evidence:

- [Preview host installs the newer workflow](/Users/pc/Development/Insignia/insignia/apps/web/test/admin/preview.mts:597).
- [Current view/product schemas](/Users/pc/Development/Insignia/insignia/apps/web/test/admin/support/placement-workflow-model.mts:76).
- [Single-colour/single-size customer-preview adapter](/Users/pc/Development/Insignia/designer-prototype/src/admin-preview.tsx:237).
- [Production variant labels and image projection](/Users/pc/Development/Insignia/insignia/apps/web/src/server/buyer/production.ts:499).

The gap is therefore merchant authoring and integration, rather than an absence of colour concepts throughout the product.

## Recommended next design slice

Keep one product configuration. Treat Front, Back and other views as shared perspectives, then map colour-specific photos within each view. Reuse artwork areas across colours by default, with deliberate exceptions when photo crops or product construction differ. Do not represent Black front and White front as unrelated customer view tabs.

Use the product's supplied options and variant identities to establish which option represents colour; do not infer colour identity or swatch values from English names. Let the merchant confirm grouping and reuse each colour's photos across its sizes. The preview should then switch colours and show the corresponding available size quantities using those real mappings.

Before considering that slice complete, exercise missing colour photos, missing back/side photos, sold-out combinations, single-colour products, larger palettes, differently cropped photos and mixed-colour designs. Keep artwork consistent within one design; do not silently invert or replace it for a different garment colour. Expose a separate design when the customer wants different artwork.

Current model limits also need to be included in that later work: the backend buyer catalog rejects truncated or over-250-variant products; each design permits at most 32 selected variants; geometry permits 100 variant image mappings per view. These are implementation limits, not endorsed UX defaults. A product with many colour/size combinations can encounter them even when the visual colour picker looks scalable.

## Verification and limits

Fresh checks passed: 62 prototype configuration/model tests, 12 buyer utility tests, 8 visualizer geometry tests. The independent researcher also checked five domain identity cases. Tests cover variant image/rectangle selection, ID normalization, colour/size fixtures and design identity. They do not establish native Shopify checkout acceptance or a completed merchant colour-authoring flow. No UI redesign, backend change or production rollout was performed.
