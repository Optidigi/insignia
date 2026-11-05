# Product setup and placement editor direction

Research proposal, 22 October 2026. No application changes or new backend commitments. The owner requested exploration of the product/placement workflow before implementation. This recommendation supersedes the earlier screen map's separate Images & placements and Options & prices editors as a UI proposal. The subsequent Methods exploration also superseded that map's name-only Settings library.

## Recommended structure

Use two connected page types: a product setup overview and a focused placement editor. Customer preview is an action from setup, not another configuration destination. First setup has a sensible sequence, but returning merchants can open any existing placement directly.

Products → Product setup → Add/edit placement → Product setup → Preview → explicit publish.

Product setup owns:

- Shopify product identity and read-only garment variants/base prices. Avoid duplicating Shopify's catalog editor.
- Product views with their image and placements, plus concise readiness feedback.
- Methods eligible for this product, including whether they come from manual selection or a tag rule in the Methods exploration. An eligible method is not automatically offered at every placement.
- Product-wide optional/required customization policy.
- Preview, save draft and publication state.
- Reuse from another product as an independent copy, not a synchronized relationship.

The focused placement editor owns:

- Selected view/image context and the placement's customer-facing name.
- Its editable artwork boundary with drag/resize and numeric alternatives.
- Methods offered here, decoration sizes and prices, while the corresponding garment remains visible.
- Per-placement artwork-later permission where supported.
- Variant image/geometry exceptions behind an explicit control, with shared defaults visible.

Opening a product should reveal existing locations and unfinished tasks, rather than a blank canvas or a lengthy form of every available setting. For a new product, choose a front image and add the first placement. For a populated product, open Left chest directly. Edit view imagery within the same workspace; do not require another settings page just to correct an image.

## Relationship and terminology

Product → View → Placement → allowed method/decoration-size combinations.

Example: Hoodie → Front → Left chest → Printing or Embroidery. Hoodie → Back → Upper back → Printing only. Front is the image angle; Left chest is a selectable position on it. One view can contain multiple placements. One selected placement has one selected method in the current buyer contract, while different selected placements may use different methods.

Use Placement as the selectable customer position. Use Artwork area for its boundary in the editor. Decoration size refers to artwork, not garment S/M/L. Avoid switching between position, location, print area and placement as if they were different configurable records.

## Layout

The overview follows a normal Polaris details page with product context and a concise list grouped by view. Each placement row summarizes its methods, offered sizes and actual setup gap, with a direct edit target. Product-wide settings are separate from placement controls. A publication aside can summarize blocking tasks on desktop; essential actions and failures remain in the main content on phones.

The visual editor uses two columns: a large image/canvas region and one settings column for the selected placement. A compact view selector and placement list control the same active selection as the canvas. Do not create independent selections in several panels. Keep all other placement outlines subdued and make the selected boundary clear. Do not expose the visualizer's state/version IDs to the merchant.

On phones, use the same page and selection model with a broad preview followed by the active placement settings. Offer an explicit expanded positioning mode for precise editing; do not keep an oversized sticky canvas above a small scrolling form. Keep numeric positioning available. Modal dialogs fit image selection and confirmations, not the whole placement workflow. Normal Shopify page actions and contextual Save/Discard remain consistent with the existing polished pages.

## Pricing presentation

For a fixed-price method, show the method amount and its origin without requiring re-entry at every placement. For product-specific pricing, show a compact size/price list under that method in this placement. A missing amount is not offered or needs a price; zero is explicitly free. No quantity tiers, setup-fee system, inheritance engine or hidden size multiplier is introduced by this proposal.

Do not render an entire product × method × placement × size spreadsheet. Only the active placement needs editable prices. The overview can expose incomplete pricing without duplicating all inputs.

## Important edge cases

- One view, method or size: show the value and omit a redundant picker.
- Many placements: searchable/selectable list grouped by view, not an endless horizontal tab row. Renaming does not alter stable identity. Duplicate names on different views remain distinguishable through view context.
- Many methods: compact per-placement offered-method list; no global matrix of every catalog method. Long labels wrap or truncate with a way to inspect the full label.
- Many colors/sizes: use Shopify's actual option names and variant identity. Keep shared image/geometry defaults and reveal exceptions only when needed. Do not create a new rectangle for every size/color combination by default.
- Replacing an image can invalidate apparent positioning. Show the affected view and require visual review rather than implying automatic calibrated placement.
- Removing a placement or its method identifies dependent prices/options before confirmation. Preserve other draft work and the published configuration.
- No image, no methods or no prices: explain the missing dependency and offer a direct correction path. Drafts may remain incomplete; preview/publish must distinguish incomplete from valid free decoration.
- Optional customization at product level is different from artwork-later permission at a placement.

## Existing implementation and later integration

`MerchantConfigEditor.tsx` already has views, shared/variant imagery and geometry, product-local method copies, per-placement allowed methods/sizes, tuple prices, customer policies and explicit publication. Its stage structure separates method creation, allowed choices and price authoring, causing cross-section round trips. Existing controls can be reorganized; this is not a reason to rewrite economics or publication.

Methods are currently a separate frontend exploration. Its assignment rules and fixed pricing are not wired to production product drafts. Do not describe current library copies as live-linked global records or infer identity from matching labels.

Current geometry sizes are product-wide definitions whose preview footprint is a fraction of the chosen placement. Optional physical millimeters do not calibrate the photograph. The proposed placement-context editing should not silently change shared definitions. If independent per-placement/per-method physical dimensions are required, that needs a deliberate later model/integration change. Prototype the intended interaction first and expose shared impact where the existing model is retained.

## Research basis and limits

- [DecoNetwork product views and areas](https://help.deconetwork.com/hc/en-us/articles/235607368-Configuring-Product-Views-Assigning-Decoration-Areas-for-Products) co-locates view imagery, area positioning and compatible processes. Borrow the relationship and contextual editing, not its nested advanced menus or global category propagation.
- [Zakeke customizable product setup](https://zakeke.zendesk.com/hc/en-us/articles/360026668693-Create-a-customizable-product) describes product → sides → print areas and supports draft save/test before publication. This supports distinct views and placements, not treating them as the same thing.
- [Printful Design Maker](https://help.printful.com/hc/en-us/articles/50264179910673-How-does-the-Design-Maker-work) uses visual placement context and technique-specific requirements. It designs against a provider's catalog; Insignia merchants author their own available areas, so provider-defined restrictions cannot be assumed.
- [Shopify layout guidance](https://shopify.dev/docs/apps/design/layout) recommends two-column visual editing for live preview and responsive page composition. Use Polaris controls/type rather than importing a competitor's visual style.
- [Vercel interface guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) support numeric/keyboard alternatives to dragging, inline recovery, long-label handling and unobscured focus.

Memorisely's public site lists paid prototyping skills, including progressive disclosure and system status, but their full instruction text was not available in this research. Checklist Design lists relevant form/upload/save checklists; individual checklist contents were not retrievable. Neither is evidence for specific placement-editor recommendations above. No paid material was accessed or invented.

Browser control returned “Local browser use is disabled in Work settings.” Current implementation findings come from source inspection, not fresh live editor or competitor application DOM observation. Official illustrated documentation informed competitor workflows. No UI build/tests are needed for this research-only proposal; no Shopify record was changed.
