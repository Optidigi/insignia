# Colour variant setup: recommended direction

Research and independent Luna Max challenges, 27 October 2026. This is a proposed product direction. No application UI, backend, Shopify catalog or store settings changed.

## Decision

Keep one product setup and real Shopify variants. Add grouped image assignment inside product setup. For ordinary clothing, group by the product's Colour option and share the images across sizes. If another option changes appearance, such as Fit or Material, allow that option to distinguish the groups too. Groups are exact combinations that exist in the catalog, not a general conditional-rule system.

For example, Black / Regular across S–XL can share Front and Back images. Black / Oversized can use different photos. Front and Back remain views in both cases. Do not create separate view tabs for every colour, or require another product configuration for each colour.

The grouping changes media assignment and photo alignment. It does not merge variant IDs, inventory, prices, orders or customer designs.

## What the references changed

| Reference | Observed or documented pattern | Decision for Insignia |
| --- | --- | --- |
| [Shopify variant images](https://help.shopify.com/en/manual/products/product-media/add-images-variants) | One assigned image per variant; gallery media provides additional photographs. Native image assignment supports selecting variants in bulk. | Reuse Shopify's catalog and media. Insignia must map each offered view; a native variant image alone does not establish which photograph is Front or Back. |
| [Customily product images](https://help.customily.com/articles/9628015600-setting-up-product-images-in-your-product-base) | One shared print area across product images; images must have the same or similar size and layout. | Share artwork areas for aligned colour photos, but provide explicit alignment exceptions. Same image dimensions do not establish the same crop. |
| [Customily existing-product matching](https://help.customily.com/articles/7057019054) | Explicit mapping between Shopify options/values and a separate product-base catalog. | Keep a single Shopify catalog in Insignia so merchants do not have to reconcile two independently authored colour catalogs. Suggest mappings only when the underlying catalog/media evidence is clear. |
| [Teeinblue assignments](https://support.teeinblue.com/en/article/assign-variants-to-mockup-13wqtx6/) | Bulk many-to-many assignment, with views grouped by mockup or variant. Unassigned variants can show all mockups. | Bulk assignment is useful. Showing unrelated colours as a missing-image fallback is unsuitable for an exact artwork placement preview. |
| [Zakeke variants](https://zakeke.zendesk.com/hc/en-us/articles/360015501299-Variants-Detailed-guide-on-setting-them-up-for-your-customizable-product) and [sides](https://zakeke.zendesk.com/hc/en-us/articles/360009494599-Side-s) | Per-variant images and print areas; a side can be unavailable for a particular variant. | A colour-only default cannot cover every product. Preserve exact variant exceptions and make missing photos distinct from an intentionally unavailable customization surface. |
| [Kickflip dynamic colouring](https://help.gokickflip.com/en/articles/4668498-applying-colors-on-an-image) | Dynamic colouring uses specially prepared near-white/desaturated images, with lighting controls. | Useful for a future deliberate rendering mode, not an automatic treatment of arbitrary photographs. Use actual product photos by default. |
| [Kickflip multi-option linking](https://help.gokickflip.com/en/articles/15424618-inventory-sync-with-shopify-limitations-when-creating-shopify-variants) | Multi-option variant creation cannot be guessed safely; the documented alternative is creating combinations in Shopify and linking them. | Shopify owns variant creation, SKU identity, inventory and base prices. Insignia should not synthesize missing colour/size combinations. |
| [InkyBay colours](https://docs.inkybay.com/spf/en/how-to-set-up-product-colors) | Supports supplied colour values and actual images instead of recolouring; panels can have linked groups. | Support real image or colour swatches with labels. Do not require every pattern, fabric or finish to be represented by an invented hex value. |

I inspected the published Customily matching screenshot and Teeinblue grouping screenshot in their rendered help pages, alongside their DOM. These are vendor-published examples, not logged-in vendor app tests. Captures are stored under `/Users/pc/Development/Insignia/.artifacts/color-variant-research-2026-10-27/`.

## Merchant workflow

1. Start with the selected Shopify product and its actual options. Use reliable existing option/media metadata to suggest the grouping. Let the merchant correct it; ask which option affects the images only if that is unclear. A single appearance needs no grouping step.
2. Set up the existing views and placements once. In each selected view, manage its variant images from the existing image control. A compact list shows the actual option labels, image thumbnails, covered variants and unresolved assignments. Bulk-select groups to reuse images or assign a prepared set. No separate global Settings page or per-size setup wizard.
3. Switch the active colour or other appearance choice on the canvas. Keep view navigation and placement selection intact. Choosing a preview colour must not silently change which variants a shared placement edit affects.
4. Keep shared artwork areas as the normal case. Reveal an explicit action to adjust alignment for the selected group or exact variant when its photo differs. Label the edit scope beside the area control. Provide a return to the shared area; base edits preserve existing exceptions. A photo replacement needs alignment review, because the system cannot establish garment position from image dimensions alone.
5. Reuse Save draft, customer preview and Publish. Save incomplete work. At publication, show only unresolved coverage and validation issues, linked to their owning view/group. Avoid an extra permanent checklist or repeated instruction card when there is no issue.

The image-assignment list should follow Polaris resource-list or table conventions with padded rows, labels and scoped bulk actions. On phones, show labelled Front/Back image slots for each group rather than dropping column meaning. Keep the existing canvas/settings workflow and avoid opening a second editor inside a modal. A normal media picker may still be a modal.

## Robustness outcomes

- **Colour + Size + Fit:** group by Colour + Fit when fit changes the photo. Do not multiply setup by Size unless size itself changes appearance.
- **Missing Back photo:** show an unresolved Back assignment for that group and block publication while an offered view lacks a valid image. Assign a correct photo or explicitly use an appropriate shared image. Missing photography must not silently remove a printable area or show a different colour. Variant-specific view availability is a separate, currently unsupported capability until represented and validated in the product contract.
- **Different physical capabilities:** different printable sides, maximum sizes, methods or decoration prices are production configuration differences. A photo-alignment exception cannot encode them. Keep incompatible variants out of the offered customization set until their actual capabilities are defined and validated. Variant-specific production support is a separate extension to the present Lean contracts, not a hidden part of image grouping.
- **New size:** after catalog refresh, it may inherit a known appearance assignment, with coverage checked before publishing. A new appearance value requires new mappings. Neither change rewrites accepted purchases or a previously published revision silently.
- **Renamed options:** bind to stable source option/value identities when available. The current name/value-only projection cannot promise that yet. Detect changed source data and ask for a remap rather than guessing from translated text.
- **Overlapping groups:** generate disjoint groups from selected exact option values. Reject conflicting manual membership rather than defining a winner. Exact variant exceptions have a single explicit scope.
- **Several colours under one design:** preserve the same artwork and customization choices, with actual SKU quantities and prices. If another colour cannot accept that design, preserve the work and offer a correction. A separate design is an option only when those variants have a valid supported method and production setup; it cannot repair an unsupported production capability. Do not silently resize, invert or substitute artwork.
- **Swatches and patterns:** use supplied Shopify swatches where available, including image swatches, or labelled choices. [Shopify option values](https://shopify.dev/docs/api/storefront/2026-10/objects/ProductOptionValue) expose colour/image swatches. Names alone are not colour measurements.

## Alternatives challenged

| Approach | Judgment |
| --- | --- |
| Every full variant edited independently | Precise but repetitive. Keep it for exceptions. Six colours × eight sizes × four views would expose 192 image assignments, versus 24 colour/view assignments before exceptions. These are assignment counts, not measured setup time. |
| Hard-coded colour grouping | Easy for simple shirts but fails when Fit, Material or Shape changes the image. Use selected exact appearance options instead. |
| Separate configuration/product for every colour | Appropriate if the catalog already contains distinct products. Requiring it for ordinary variants duplicates work and encourages drift. |
| General rules with conditions and priorities | Flexible in theory, but introduces overlap, precedence and recovery work. No current need justifies that interface for photo mapping. |
| Automatic photograph tinting | Reduces assets only with suitable prepared imagery. Poor default for accurate fabric, texture, patterns and product-photo representation. |

## Guidance applied

[Shopify layout](https://shopify.dev/docs/apps/design/layout) supports a visual editor with a live preview, appropriate density and native spacing. [Shopify content](https://shopify.dev/docs/apps/design/content) argues for single-purpose steps, clear verbs and avoiding duplicated content. [Resource list](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/resource-list) supports scannable selection and scoped bulk actions. The installed toolkit search used the project's pinned Polaris 2.0-rc target.

Checklist Design's bundled Table, Checkbox, Button, Input Field, Uploading media and Submitting a form checklists informed the proposed states and acceptance criteria: explicit headers/context, labelled selections, clear scope/action copy, responsive content, upload/retry feedback and inline recovery. This is a proposal review, not a visual audit score or a claim that unbuilt controls pass their states.

Fresh [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) informs keyboard access, visible focus, accessible names, local errors and non-gesture alternatives. [Memorisely's hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) informs the separation of view, selected appearance and edit scope. [Zander Whitehurst's disclosure lesson](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) informs revealing exceptions when needed. Those lessons were re-read as primary teaching sources; they are not claimed installed skill packages.

## Current implementation limits and testing

The existing model still limits explicit variant images to 100 per view, the buyer catalog to 250 variants, and selected variants to 32 per design. Grouping the UI does not remove these. Eleven colours across ten sizes would expand to 110 image mappings in today's geometry. For larger products, persist group-level media mappings with a deliberate geometry resolver/contract change rather than duplicating one image reference per size. This is later integration work; it must be addressed before claiming those catalogs are supported.

Three independent Luna Max agents examined competitors, model alternatives and workflow/guidelines. Their notes are [competitor evidence](color-competitor-research-2026-10-27.md), [14 hand-worked stress cases and model experiment](color-options-stress-review-2026-10-27.md), and [workflow guidance](color-workflow-guidelines-review-2026-10-27.md).

The final independent challenge tightened two boundaries: missing images for offered views block publication, and a separate buyer design is offered only where a valid production setup already exists. The workflow reviewer describes both the older four-stage production editor and the newer workspace; the proposed controls should fit the newer owner-reviewed view/canvas/placement workspace, rather than restoring the old wizard.

The throwaway model experiment ran 11 checks outside application source and demonstrated counterexamples to naive colour grouping and group-count-based capacity. It also exercised missing images, explicit shared intent, preserved exceptions, catalog additions, overlap rejection and unchanged SKU identities. Root inspected and reran it. These checks test the proposed model only. They do not prove implementation, customer usability, native Shopify behavior or final visual quality. The next implementation slice should render and test this workflow against the existing editor, then receive an independent actual-screen review.
