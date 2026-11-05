# Decoration method creation and configuration

Design proposal, 21 October 2026. This document describes a proposed workflow and the work required to support it. It does not change the current specification, application behavior or published configurations.

## MVP decision after the follow-up review

The owner subsequently asked for the smallest robust functioning release. **This section takes precedence over the broader design below.** Reusable physical presets and automatic fit are follow-up work, not prerequisites for improving method creation.

Keep the first library form to a required name and optional short customer explanation. A compact create/edit dialog is sufficient for those fields. Use its own Save/Cancel actions, while the product editor retains its existing host Save Bar. Do not introduce a dedicated settings page per method, a wizard, preset reordering, duplication, source-provenance tracking or a new archive lifecycle in the MVP.

In a product, add one saved method or create one product-only method without leaving the draft. An addition is local until the product draft is saved. Creating a product-only method must not also create a library entry. Put this method's locations, decoration sizes and final prices in one focused editing context. A small price grid or location selector is enough; a new bulk-edit system is not a release requirement.

Keep decoration-size definitions and existing manually entered production dimensions on the product. Label supplied dimensions as the maximum artwork box, preserve artwork proportions, and describe the mockup as approximate. Do not infer measurements, resize production artwork automatically, or claim variant-fit validation. The merchant must choose offerings suitable for every variant included in that configuration. Where that is impossible, use separate Shopify products/configurations until explicit decoration eligibility by variant is supported. One Shopify product cannot have two independent Insignia configurations under the current contract.

Reusable physical presets need product area measurements, a new geometry representation and fit enforcement. Deferring them avoids adding those responsibilities to the first method release. It does not eliminate the underlying production-fit concern. The [source check](decoration-method-mvp-source-check-2026-10-21.md) documents provider examples where product, print location and garment size affect the usable area.

### The six safeguards that matter for the MVP

| Risk | Required handling |
| --- | --- |
| A method and size are separately allowed, but their combination has no price | Derive offered choices from valid final method/location/size price records on the server. Send them with the matching revision to the buyer UI. Omit methods and locations with no offered choices. Continue checking every submitted combination on the server. |
| Switching printing to embroidery keeps an invalid size or old total | Keep a size only if valid for the new method. If exactly one valid size exists, select it and visibly update the choice; otherwise ask for a size again. Retain the artwork. Invalidate the prior price proposal and require a current review before purchase. Do not submit an incomplete selection for quoting or treat a late response for the previous selection as current. No hidden price substitution. |
| A blank price is mistaken for a free decoration | Blank means Not offered. An explicit zero means Free. A partially entered amount is an input error, not another saved status. Refuse publication of a customization setup with no offered combinations; an unfinished draft does not need invented prices. |
| A saved library method is renamed or removed after products use it | Existing product copies, published revisions and purchased orders remain unchanged. Explain that consequence at the library action. Warn about same-name additions without merging IDs or silently creating a live link. |
| A new size appears production-accurate but only the picture was resized | Preserve the existing distinction between preview fractions and declared production dimensions. Show a maximum box, not a guaranteed exact artwork width and height. Require merchant review across the configured garment variants; no automatic physical-fit claim. |
| A save times out, two staff edit together, or part of an import fails | Reuse the current idempotent commands, optimistic versions and authorization checks. Apply each method addition/removal and its references in one draft change. Preserve input after failure and reconcile uncertain writes before creating another command. |

Maintain ordinary long-text wrapping, existing capacity limits, clear field errors and loading/retry states. Use stable IDs rather than names. These are acceptance checks, not reasons to add more merchant settings. A missing optional mockup must have a clear fallback; it must not silently delete the method or imply missing production geometry is safe.

### Small implementation and verification plan

1. Define one server-derived offered-choice projection using the existing final prices and allowed references. Update the versioned buyer read contract and selection logic together, including no-choice and method-change behavior. Existing server purchase validation remains authoritative.
2. Improve the product method workflow using the existing draft, pricing and geometry models. Keep the library modal small. If the optional explanation ships, carry it through a versioned catalog/presentation/buyer path and read old name-only records as having no explanation. Do not rewrite old publications or orders.
3. Verify a single free choice, printing plus embroidery with different sizes, front/back using different methods, a switch that invalidates size, no offered choices, editing/removing a library entry after import, and retry/conflict behavior. Include a realistic product with several garment variants, and the same flows on phone and desktop with long labels.

Implementation tests should cover only those changed contracts and interactions. This review inspected existing code/tests and primary sources; it did not run application tests or implement features. The broader screens, physical-size presets, calibration, per-variant eligibility, synchronized updates and advanced artwork rules below remain a roadmap.

## Broader recommendation

Make a decoration method a reusable starting point that a merchant can apply to a product. Give the library a proper editor, but put the final location, size and price decisions together in the product editor. A merchant should be able to answer "What can I offer on this garment, and what will the customer pay?" without visiting several unrelated sections.

Keep the merchant-facing name **Decoration methods**. Explain copying once, when it matters. Avoid a new hierarchy of techniques, profiles, rules and policies in the navigation.

The creation flow should work with only a name. Optional defaults save repeated work; they must never silently make a product purchasable. Existing products and orders stay independent of subsequent library edits.

## What the application actually supports

The current library stores a name, ID and optimistic version. Adding it to a product creates a new product-local method ID and copies the name. There is no continuing link, usage inventory, description, constraint enforcement or size template in that operation.

Product configurations already hold placements, shared decoration-size definitions, per-placement method and size lists, and final prices for individual method/location/size combinations. A missing price makes a combination unavailable; an explicit zero is a valid free choice. Each selected placement has one method, while separate placements can use different methods.

The geometry model stores preview fractions and optional physical dimensions independently. Physical dimensions currently do not calibrate the preview. Production options are selected for a customization group, not independently for each method or placement.

Legacy had customer names, descriptions, a base price and artwork constraint fields. Those fields are useful evidence of merchant needs, but are not proof that the rewrite enforces their behavior. In particular, its format choices included formats the rewrite does not accept.

Relevant code: [library](../../../apps/web/src/islands/MethodLibrary.tsx), [product editor](../../../apps/web/src/islands/MerchantConfigEditor.tsx), [catalog](../../../packages/database/src/repositories/method-catalog.ts), [geometry](../../../packages/visualizer/src/geometry.ts), [Lean pricing](../../../packages/domain/src/pricing/lean.ts), [buyer contract](../../../packages/contracts/src/v1/buyer.ts). The [specification](../../architecture/implementation-plan.md), especially sections 3.1–3.5 and 7.3, remains authoritative.

## Where each setting belongs

| Information | Reusable method | Product configuration | Purchased order |
| --- | --- | --- | --- |
| Name | Required starting value | Independent customer-visible copy | Purchased label retained |
| Short customer explanation | Optional proposed default | Editable copy, shown beside the method choice | Retain relevant purchased presentation |
| Decoration sizes | Optional proposed presets | Actual sizes and preview scale for this garment | Selected size and recorded geometry |
| Price | No live global price | Final amount for each offered method/location/size | Accepted unit amounts and totals |
| Front, back, sleeve and other placements | No garment-specific geometry | Views, real images, rectangles and variant overrides | Purchased placement and image revisions |
| Garment colors and garment sizes | None | Shopify variant data | Purchased variants and quantities |
| Artwork-later availability | No misleading global switch | Existing placement policy | Actual artwork or deferred intent |
| File security and retention | Not merchant-overridable | Central enforced service policy | Actual availability and expiry |
| Method-specific file restrictions | Later, only with enforcement | Resolved restrictions for offered choices | Retained applicable requirements |
| Thread colors or other production choices | Possible future reusable choices | Only when their actual selection scope is supported | Exact selected values |

## Screen 1: Decoration methods

Use the established resource-list composition, with **Create method** as the primary action. The method name opens its editor. Do not repeat Rename and Remove buttons on every row.

For a small library, the useful columns are **Method** and **Size presets**. An empty preset value says **Set on product** rather than implying a broken method. Add search when the list is large enough to need it. Keep the existing cap of 100 saved methods and make the limit explicit when reached. After creation, offer **Set up a product** without implying that saving the method enabled it anywhere.

Do not display invented counts of linked products. Existing imports have no source lineage. If usage is added later, it must distinguish drafts from current published configurations and acknowledge unknown historical origins. A count of products that once copied a name is not a count of products that will change.

Start with create, edit, duplicate and confirmed **Remove from library**. Removal affects future selections only. Keep product-copy and order history intact. An archive lifecycle is unnecessary in the first release; do not offer undo unless recovery is implemented.

## Screen 2: Create or edit a method

Use a dedicated page once richer settings are implemented. A large configuration form should not be squeezed into the current name modal. Use the App Bridge Save Bar for dirty state, save and discard. Saving a library entry is not publishing a product.

The page has a compact main column with these sections:

1. **Name.** One required name, up to the existing 80-character limit. Label its customer visibility. Avoid two compulsory names that must be kept in sync. An internal reference can be added later if real merchants need two differently configured methods with the same storefront name.
2. **Customer explanation.** Optional short plain text, proposed limit 240 characters. For example, "Stitched with thread" can help distinguish embroidery from print. Leave it blank by default. Show a small customer preview beside this section on desktop and immediately after it on phone. Hide the preview's explanation when empty.
3. **Size presets.** Optional. Start empty, with **Add size**. Each reusable size has a name and a maximum physical width and height. Use ordinary unit-aware fields, such as Width and Height in cm, with canonical millimeters behind them. For example, Small, fitting within 10 × 10 cm. Explain once that artwork keeps its proportions inside that box. Require both dimensions and positive valid values. Merchants can leave presets empty and configure sizes on the product. Do not create arbitrary Small/Medium/Large defaults or prices for every technique.

Each preset needs its own stable identity and a name. Reordering uses accessible move actions as well as any pointer interaction. Removing a preset affects future imports only. Separate garment sizes from decoration sizes in every label.

Deliver physical presets together with the product sizing work described below. A bounding box of 100 × 100 mm is not an exact 100 × 100 mm print for every artwork aspect ratio. The current renderer does not derive its scale from those millimeters. Do not ship the new inputs while silently using unrelated preview fractions. Percentages are useful implementation data and a compatibility path for old configurations; they should not be the primary reusable sizing language presented to merchants.

Use Screen printing, Embroidery and DTF as examples, not an enforced technique enum. A name must not activate hidden pricing or artwork behavior. Custom methods, several methods of the same technique, and methods named in another language must work equally well.

The page's contextual actions are **Duplicate** and **Remove from library**. No prominent Refresh action during ordinary editing. Show a contextual reload/retry only when loading, conflicts or uncertain writes require it.

## Screen 3: Add methods to a product

**Add method** opens one searchable selection dialog showing saved methods and any reusable size presets. Already-added methods are identified. Selecting several methods is allowed, followed by one **Add methods** action. It adds unsaved product copies.

An empty library must not force a trip through Settings. Offer **Create for this product** in the same workflow. That creates a product-local method in the draft, with a name only initially. Do not secretly save it globally. A later explicit **Save copy to library** action can make the configured method reusable without changing the product's identity or publication.

For new imports, keep optional draft-only source ID/version metadata keyed by the product-local method ID. Its purpose is to recognize an already-added library entry in the picker. Validate and remap it when copying drafts, but never publish it as a live dependency or use it to synchronize changes. Old product methods have unknown origins; do not invent them by comparing names. A removed source row must not invalidate its product copy.

Imported presets get fresh product step IDs with their intended physical boxes. The import review shows fit against the product's locations, or **Set area dimensions** when that fit is unknown. It must not activate an unverified size merely because a default preview fraction exists. Never merge by name: two sizes called Small can have different definitions. Reusing a matching product size must be an explicit choice. Repeated import should warn and offer the existing product method rather than silently creating another copy. A same-name match without provenance is advisory, not proof of identity.

**Save copy to library** copies the product method's name and explanation. For optional size presets, list the distinct steps referenced by that method's actually priced tuples and let the merchant choose which to reuse. Copy their names and explicit physical boxes, not location-specific geometry, variant overrides or prices. A preview-only size without trustworthy physical dimensions cannot become a physical preset by guesswork. A method with no priced choices can still save its name and explanation. Do not infer ownership from all of the product's shared sizes.

Adding a method should immediately show the next required task. For example, **Choose locations**. A method with no locations is not ready for customers, but it is a valid unfinished draft.

## Screen 4: Configure this product's method

Replace the scattered method/size/price setup with a method summary and one focused configuration context. The merchant can still edit geometry on the garment canvas, but should not need to reconstruct the relationship between settings.

An example summary row is:

> Embroidery · Left chest, right sleeve · 2 decoration sizes · No prices set

Use actual labels, reveal full long content, and make **Set prices** open the relevant choices. When an unfinished edit has a missing or invalid amount, its recovery action opens that exact field. Avoid a generic "incomplete" badge with no recovery.

The focused editor shows:

1. **Locations.** Select existing product locations. An action can open the placement editor and return to the same method. Do not import generic sleeve or chest rectangles from a global method.
2. **Decoration sizes.** Choose or create sizes for this method's locations. Keep a single size simple; the buyer does not need a one-option picker. Names and production boxes can differ between methods. Show the relevant garment preview when adjusting scale.
3. **Prices and availability.** Show the final offered choices in shop currency. On desktop, a small grid can put locations in columns and method sizes in rows. With many locations, use a location selector instead of a very wide matrix. On phone, show one location at a time, retaining its method and size context.

An absent saved price says **Not offered**, with an **Add price** action. A saved zero says **Free**. After the merchant clicks Add price, an empty or invalid input gets an adjacent **Enter a price or cancel** error if submitted. That is an unfinished local edit, not a new stored availability state. Save must either complete or explicitly cancel that edit; do not silently claim a price was saved. No pending-price metadata is needed. In the published model, only explicitly priced choices are offered, and blank never means zero.

For example:

| Embroidery size | Left chest | Right sleeve | Back |
| --- | --- | --- | --- |
| Small | €4.00 | €4.00 | Not offered |
| Large | Not offered · Add price | Not offered | Not offered |

A useful bulk action is **Set price for selected choices**. Show the selected locations and sizes before applying it, and retain an ordinary draft discard path. Do not copy a price to future locations automatically.

Keep starter prices out of the first method-library release. First make setting prices across real product choices efficient. If reusable starter prices are later justified, store their currency and require an explicit application to named product cells. Never convert or reinterpret a saved amount after a shop-currency change.

The current broad method/size lists can remain. The final priced tuples already determine availability. First try deriving the method-specific UI from them. Different size geometry gets distinct IDs. Introduce a new published availability contract only if a demonstrated case cannot be represented safely this way.

The current buyer response is an important gap. It exposes separate allowed-method and allowed-size lists, without the final priced combinations. The storefront currently selects the first allowed size and filters size choices by placement alone. Therefore the server must provide a bounded, revision-bound projection of offered method/location/size tuples before this richer workflow is released. Update the buyer response contract and consumers together. Select initial values only from those offered tuples. Server quote validation remains authoritative; the projection improves selection and does not authorize a purchase.

Respect existing reader limits when importing presets. The buyer contract currently caps methods at 32 per product, sizes at 64 overall and allowed sizes at 32 per placement. The library's 100-entry limit is separate. Check capacity before an import and offer an actionable smaller selection; never accept an admin configuration that its buyer reader cannot decode.

### Physical sizing is part of the feature

For a product location, the merchant supplies its real maximum decoration width and height, based on the garment or supplier. Its normalized preview rectangle describes where that area appears in the product image. Do not derive physical measurements from Shopify image pixels. If the physical area is known, calculate fit, derive the size's relative preview box for that location, and reject incompatible dimensions. When the physical area is unknown, show **Set area dimensions** instead of a false fit result. A method can remain in the draft while those tasks are unfinished.

This requires geometry work. One global `GeometryV1.steps` fraction cannot render the same 100 mm box consistently in a 120 mm chest area and a 300 mm back area. Add a versioned representation of physical area dimensions and per-placement size projection, including variant overrides. Keep readers for existing geometry. Avoid manufacturing dozens of duplicate size IDs to simulate that relationship or bypassing the 64-size cap. The existing pricing tuples remain the economic authority; this is a geometry/presentation extension, not a new pricing engine.

Use one physical-fit and projection resolver for admin and buyer previews. Include fit in the server-derived offered choices and enforce it at publication and quote validation, against the applicable revision. A price alone cannot make a physically invalid choice purchasable. Freeze the selected physical box in the purchased specification. Merchant-supplied dimensions describe production intent; photo perspective and mockups can still make the preview approximate. Existing relative configurations keep their old meaning until a merchant explicitly supplies physical bounds.

Check the actual applicable variant areas too. Initially, offer a size only when it fits every garment variant to which that offered choice applies. If method/size availability needs to vary by variant, introduce an explicit eligibility contract and buyer projection for that behavior. Do not silently turn Shopify variants unavailable, change quantities or shrink an artwork to make the choice fit. Explain incompatible variants and the available recovery.

Contain-fit preserves artwork aspect ratio. Show the resulting bounds when the artwork is known, and distinguish those bounds from the maximum box. Changing decoration size, method or garment variant must recheck the choice; do not retain a stale incompatible selection.

## Customer and production behavior

The customer sees only methods and sizes actually offered at the selected location. Changing methods revalidates the selected size, price and artwork. Keep a still-valid selection; otherwise ask for the affected choice again. Explain any artwork incompatibility where it occurs. Do not silently change to a more expensive size or clear an uploaded file without explanation.

One available method or size can be shown as a value instead of an interactive picker. Several selected locations can use different methods. Garment color is independent of ink or thread color. An embroidery setting must not replace Shopify garment colors.

Orders and production sheets use purchased labels, selected method per placement, dimensions when provided, quantities and the actual artwork revision. Later method edits or removal do not relabel a historical job. Missing or expired artwork remains a real condition, not "complete" because its method is configured. Do not reintroduce a lock-artwork workflow through method settings.

## Artwork requirements: useful settings, with real limits

The first release should show the real supported upload formats and size limit as read-only information at the relevant artwork step. The rewrite currently accepts inspected PNG, JPEG and SVG, with a 5 MiB original upload limit. Do not carry Legacy's PDF, AI, EPS, TIFF or other format checkboxes into this editor.

Method-specific restrictions are a useful later capability, but every exposed rule needs buyer behavior, server enforcement and a versioned published snapshot. Evaluate compatibility when assigning artwork to a choice, because one inspected asset can be used for different methods. Do not globally reject an otherwise valid reusable upload merely because one method cannot use it.

| Possible setting | Recommended behavior |
| --- | --- |
| Accepted artwork formats | Merchant can narrow centrally supported formats only after selection and purchase enforce the restriction. Never expand the inspector's allowlist. |
| Minimum raster quality | Compute effective quality from verified pixels and actual output bounds. File DPI metadata alone is insufficient. Without trustworthy output dimensions, give guidance rather than a false pass/fail guarantee. |
| Maximum ink or thread colors | Do not claim automatic enforcement from a simple image color count. Anti-aliasing, gradients and digitization make that unreliable. Start with clear customer guidance; add structured production choices only when supported. |
| Artwork required before purchase | Today this is a placement policy. If it becomes method-specific, resolve mixed-method placements explicitly and enforce the purchased combination. A library toggle alone would be misleading. |
| Internal production instructions | Add only when saved instructions reach the order and production sheet as a resolved copy. Keep them separate from customer guidance. |
| Thread palette or ink selection | Needs method/placement-scoped choices, not today's group-wide production option pretending to serve multiple independent placements. |

Embroidery digitization, vector conversion, color separation and machine-ready files are separate production work. A method name or a usable preview must not imply those jobs have happened. All-over print also requires more than a rectangular placement, including bleed and product-dependent coverage, so it is not unlocked by naming a method "All-over print".

## Edits, duplicates and removal

- Editing the library changes future copies only. Save feedback says **Method saved. Existing products are unchanged.**
- Editing a product changes its draft. Save and Publish remain separate. Existing accepted orders retain their facts.
- Duplicate creates new IDs, focuses the new name and requires review. Never merge two same-name methods or sizes by string comparison.
- An exact duplicate name in the library should produce an advisory warning, offer the existing entry, and allow **Create separate method**. When both appear on one product, ask the merchant to distinguish their customer names or explanations. Do not silently add numeric suffixes or treat names as IDs.
- Removing a product method names its affected locations and price choices before removing draft references. Removing a library method does not remove those copies.
- Changing a preset does not trigger a hidden "update all products" operation. A future explicit update tool would target one product draft, show differences and preserve local edits.

## States and responsive behavior

Use the public Polaris components and existing request/save handling. Reuse the application's list toolbar where search is justified. A richer editor is not a reason to copy Shopify's private component code or introduce a second form framework.

Store merchant content separately from interface translations. Method IDs must not be derived from translated names. Use the store's primary content as the fallback; future translations belong in the planned language editor rather than repeating language inputs throughout method creation. Empty optional guidance adds no blank space. The new guidance needs a new versioned presentation shape with readers for both that shape and existing strict `m5-presentation-v1` records, plus a matching buyer response. Do not just add fields to the old strict contract or rewrite existing revision hashes and purchased records.

Match the useful aspects of the live Shopify shipping-profile editor inspected on 21 October: short resource title, distinct section headings, related controls grouped together, and actions close to the content they change. That is a composition reference, not a claim that shipping profiles have Insignia's copying semantics. On phone, the reference keeps sections in one column rather than compressing a desktop form and sidebar together.

For Insignia, put the customer preview after its related inputs on phone, allow labels to wrap, and keep price controls in one readable location context. Do not make ordinary mobile setup depend on horizontal scrolling. Test 320, 390, 768 and wide desktop widths, enlarged text, both host appearances and an open phone keyboard.

Retain silent skeletons matching the final sections. Loading is not an empty library. A failed read gets a retry. Field errors remain adjacent to their controls and a failed submission focuses the first actionable error, including a row hidden by filters. Preserve input after failure. Don't announce success until the write has settled.

Preserve optimistic versions and idempotency keys. A conflict cannot overwrite another staff member's changes. An uncertain response cannot become a second create merely because Save was clicked again. Leaving a dirty editor uses the host's discard protection. Losing authorization clears private data and write controls, including dialogs. Keyboard focus returns to a sensible place after additions, removals and overlays.

## Required scenario checks

| Scenario | Expected outcome |
| --- | --- |
| First method, no presets | Name-only save works; product setup provides the next action. |
| Empty library while configuring a product | Create for this product without losing the draft or secretly creating global data. |
| One method, one location, one size | Minimal form; no redundant selection controls in the buyer flow. |
| Printing on front and embroidery on sleeve | Independent valid sizes/prices; no meaningless cross-method options. |
| Same "Small" name, different method dimensions | Distinct stable IDs and understandable contextual labels. |
| Six locations and twelve sizes | Bounded, filterable product pricing; focused phone editing rather than an enormous matrix. |
| Eighty-character names, translated text, RTL | Wrapping, correct inline direction, accessible full names, no hover-only access. |
| A free decoration and one missing price | Zero stays free; missing does not become free or silently offered. |
| Library renamed, deleted or duplicated after import | Product draft, live revision and historical order remain independent. |
| Two staff editing, or a save times out | Conflict or same-command recovery; no duplicate template or lost draft. |
| Currency changed after a reusable amount was saved | No conversion or reinterpretation; skip mismatched amounts and require price review. |
| Existing preset references removed from a product | Confirm affected draft choices, clean references, retain historical revisions. |
| Artwork changed from tall raster to wide vector | Preserve aspect ratio; recheck size and method compatibility. |
| Placement differs by garment variant | Review actual override; no inferred production fit from a shared preview. |
| Same artwork reused across methods | Shared asset remains usable where compatible; method assignment validates its own requirements. |
| Deferred or expired artwork | Accurate actionable order state and production-sheet warning. |
| Catalog at its cap or malformed saved defaults | Explicit recovery; no silent truncation, guessed settings or partial import. |
| Import fails after a library read or during a draft save | Apply the local import atomically; no half-created method/size references. |

## Implementation sequence

1. **Product method workflow first.** Group locations, decoration sizes and final prices around one method. Add direct recovery for missing choices, the product-local creation path and safe bulk price entry. Add the server-derived offered-choice projection to the buyer contract and consume it before enabling method-specific size offerings. This gives merchants useful improvements with the current economic model.
2. **Richer reusable methods and real sizing.** Deliver the dedicated library editor, short customer explanation, optional physical-size presets, product area dimensions, fit review and versioned geometry projection together. Include duplication and explicit copy behavior. Extend database/HTTP contracts, product import and versioned presentation readers. Existing name-only entries and preview-only geometry remain readable; do not infer their physical dimensions from pixels or unrelated products. Retain immutable orders. Add draft-only source provenance for new copies without introducing live dependencies. Do not release the physical preset controls ahead of their sizing support.
3. **Enforceable requirements and scoped options.** Deliver artwork restrictions only with product resolution, buyer behavior and server enforcement. Then consider internal production instructions and correctly scoped decoration options, including any variant-specific eligibility genuinely needed. Keep unsupported settings out of ordinary forms until that work exists.

Do not add global base-price inheritance, quantity tiers, setup fees, pricing by ink count, artwork conversion, automatic digitization, customer post-order upload or synchronized mass updates as incidental UI work. Those require separate product and backend decisions. The initial release also does not need a generic rule builder, nested settings tabs or a universal method taxonomy.

Use additive migrations and strict versioned contracts. Keep any new template-owned child records under tenant ownership and shop-erasure cleanup. Import/default resolution should have one typed implementation shared by the product editor and tests. Do not duplicate geometry or money rules in UI handlers. A draft import is all-or-nothing; publication still resolves the existing final price table and snapshots.

Relevant verification is catalog persistence/auth/version/idempotency, pure import/reference handling, product price availability, presentation compatibility, and a small set of browser workflows on desktop and phone. Run geometry or purchase regression tests when the corresponding physical-size or enforced-artwork behavior actually changes. A documentation proposal does not justify rerunning the application suite.

## Research and review

- Shopify's official [Settings template](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/settings) groups related settings and uses the host Save Bar for unsaved changes. Its [Save Bar contract](https://shopify.dev/docs/api/app-home/v2.0-rc/app-bridge-web-components/save-bar) documents save/discard integration. These informed the proposed editor, not an unverified claim about private admin components.
- The logged-in Shopify shipping-profile create page was inspected read-only on desktop and at 390 px. The current Insignia library/create dialog and Legacy method route/schema were also inspected. No Shopify configuration was saved.
- Printful's [embroidery preparation guidance](https://help.printful.com/hc/en-us/articles/50263985175953-How-should-I-prepare-my-design-for-embroidery) distinguishes technique-dependent artwork preparation and product-specific limits. Its numeric requirements belong to that provider and are not universal defaults for Insignia.
- Printify's [design guide](https://printify.com/guide/design-guide/) directs users to product-specific requirements. It supports keeping garment fit and print-area review in product configuration rather than assuming one global method setting fits every garment.
- An independent Luna review challenged the extra settings, identified the shared-size geometry and buyer-response limitations, and confirmed that existing priced tuples can represent method-specific availability. It recommended deferring reusable prices until explicit product-cell application exists. A second sizing pass favored physical presets delivered with product area dimensions over exposing relative percentages in the library. This proposal adopts those points.

Status: researched and reviewed proposal. No method feature, schema migration, buyer contract change or deployment was implemented by this document.
