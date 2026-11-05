# Color and product-option workflow review

27 October 2026. Decision research for merchant photo setup and the buyer's variant flow. No application changes, rendered design, or visual approval are part of this note.

## Evidence and guidance

The production editor already has four sections: Product rules, Images and print areas, Prices, and Review and publish. In Images and print areas, the merchant chooses a view, then either uses the shared image or selects a full product variant and adopts its Shopify image. Placement geometry can also have a full-variant override. The preview resolves a variant image first and falls back to the shared image. See [MerchantConfigEditor.tsx](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L361) and [geometry.ts](../../../packages/visualizer/src/geometry.ts#L24).

The newer placement workspace is a loopback-only exploration. It has product views and print areas but no option-value mapping. Its customer preview adapter supplies one placeholder "Product image" color and one placeholder size. That is unfinished integration, not a design defect. The production buyer still carries real Shopify variant IDs and availability, but its projection exposes each variant as a label instead of structured product options. The polished prototype has color groups and preserves quantities while switching preview photos, but it does not establish Shopify option mapping or checkout integration. The two current-state notes describe these boundaries: [configurator research](color-variant-configurator-research-2026-10-27.md) and [model research](color-variant-model-research-2026-10-27.md).

Shopify's current product model supports option values with IDs and optional swatches, and variants hold combinations of those values. The app currently requests only option names and text values for variants, not option/value IDs or swatches, and the buyer projection drops even those names and values. Option-group authoring therefore needs catalog and buyer projection work as well as controls. See Shopify's [ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant) and [ProductOptionValue](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductOptionValue) references and the current [catalog query](../../../packages/shopify/src/catalog.ts#L7).

Shopify says to keep each object form on its own page, disclose conditional detail in context, avoid large modal forms, use the contextual Save Bar, and adapt visual editors to narrow screens. That supports adding this to the existing product editor, not making a fifth setup section or a color wizard. Shopify's [forms and saving](https://shopify.dev/docs/apps/design/user-experience/forms) and [layout](https://shopify.dev/docs/apps/design/layout) guidance govern the merchant controls and copy. The [current content guidance](https://shopify.dev/docs/apps/design/content) says to use plain language and avoid repeating the same information.

I read the installed Checklist Design index and audit instructions, then chose its Web app Multi-step Form, Saving Changes, and Adding to Cart checklists. The tables below audit source-observable behavior in the existing product editor and buyer customizer only. They do not qualify appearance. The option-group UI has no rendered state to assess.

### Checklist Design: Web app Multi-step Form

| | Item | Why |
|---|---|---|
| 🟢 | **Progress indicator** — A clear visual showing how many steps exist and which one the user is currently on. | The editor shows "Step N of 4" and a section selector. |
| 🟢 | **Step heading and context** — A clear title and brief context for each step, so users know what they are being asked to provide. | Each step has a label and its own section heading, including Images and print areas. |
| 🟢 | **Field grouping** — Each step containing only fields that belong together logically. | Product rules, images and print areas, prices, and review each have a separate stage. |
| 🟡 | **Step-level validation** — Validation happening at each step before the user proceeds, not surfaced all at once at the end. | Invalid price and dimension entries prevent saving. Incomplete drafts remain saveable and can proceed to review by design, so unresolved setup needs a clear review state. |
| 🟢 | **Back navigation** — The ability to return to a previous step to review or change answers without losing subsequent progress. | Back and Continue change the visible stage while the draft stays in editor state. |
| 🟢 | **Save and resume** — The ability to save progress and return to the form later. | The versioned draft is saved separately from publication and reopens on the product route. |
| 🟢 | **Final review step** — A summary of all entered information before final submission, giving the user a chance to review and edit. | Review and publish is already the fourth stage. |

### Checklist Design: Saving Changes

| | Item | Why |
|---|---|---|
| 🟢 | **Show action that enables change** — There should be an action to enable information to be updated; automatically editable is also acceptable. | The merchant edits a draft directly. |
| 🟢 | **Disable save action until changes are made** — An action should be visible as a source of confirming changes to be saved; it can start disabled. | The Save Bar can save only a dirty, valid draft. |
| 🟢 | **State changes to active once a change is made** — Changing the button state to active brings the user's attention to the action. | The dirty state and Save Bar activate after an edit. |
| 🟢 | **Action changes to loading state when pressed** — Show that the save is in progress on that action. | The editor reports "Saving changes…" and disables competing edits while saving. |
| 🟢 | **Notify changes have been saved** — Inform the user that the details are saved. | The editor reports "Draft saved" and "All changes saved." |

### Checklist Design: Adding to Cart

| | Item | Why |
|---|---|---|
| 🟡 | **Outline variant selection for product** — Make clear which details must be picked before adding an item to cart. | The buyer can set quantities for real variants and sees availability, but the production DTO does not expose the option axes needed for grouped photo choices. |
| 🟢 | **Primary action on product page is add to cart** — Make Add to cart the most prominent final action. | The customizer reviews the signed price proposal, then offers a priced Add to Cart action. |
| 🟢 | **Feedback once added** — Confirm that the item was added. | The customizer reports "Customized cart updated." after the cart mutation succeeds. |
| 🟢 | **Link to cart view** — Give the buyer a route to the cart. | The applied state exposes Go to cart. |

The [Vercel web-design-guidelines skill](../../../.agents/skills/web-design-guidelines/SKILL.md) is installed in the project. I read it and fetched its current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md); labels, focus, inline errors, keyboard access, narrow layouts, and long values are useful supplemental checks. Shopify still governs the Polaris components and sentence-case merchant copy. No Memorisely or Zander Whitehurst skill package exists in the searched project or user skill directories. I opened their public [visual hierarchy post](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and [progressive disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX). They support grouping related controls and revealing secondary choices in context; neither dictates Insignia's data model.

Three current competitor help sources show where collapsing concepts causes trouble. [Customily](https://help.customily.com/articles/9628015600-setting-up-product-images-in-your-product-base) says a shared print area depends on similar image size and layout, and asks users to inspect it on each image. [Zakeke](https://zakeke.zendesk.com/hc/en-us/articles/360015501299-Variants-Detailed-guide-on-setting-them-up-for-your-customizable-product) supports variant images, variant-specific print areas, and removing a particular variant/side combination. [Teeinblue](https://support.teeinblue.com/en/article/custom-variants-printarea-5plxay/) maps variants to production print areas with different output dimensions and requires a mapping for every variant when enabled. These are examples of product choices, not recommendations to copy their full matrices.

## Recommendation

Use Shopify option-value tuples to group product photos. Do not create a Color-only domain concept. The merchant chooses the option axes that actually change the product image, then maps an image to each value tuple. The common case is one option such as Color, with each value's photo reused across every Size variant. If Fit and Material both change the photo, the group key can be `Color=Black + Fit=Relaxed`; for a case it might be `Material=Leather + Finish=Matte`. If those options do not change the image, they do not belong in the image group. A product with only one visual appearance keeps the current shared image behavior.

In the existing editor, put one product-level control inside **Images and print areas**, in the existing **Product views** section beside the view selector and before **Live preview**. Label it "Photos vary by" and show Shopify's actual option names. Let the merchant choose one option first; expose "Add another option" only when a second dimension also changes the photo. For the selected view, show one image row for each actual value or value tuple. Keep those assignments in the existing view image details. Do not add another section, page, progress step, duplicated "Color" heading, or mapping modal.

The preview should name the selected group and its image source. For example, `Front · Color: Black · Shopify variant image`. Show "Shared image" when the group inherits the default. Use Shopify's actual swatch when it supplies one. Otherwise show the option value and product thumbnail. Never guess a swatch from an English name or tint a source photo to simulate a variant.

Keep three behaviors separate:

1. **Photo assignment.** An option-value tuple chooses the product photo for a view. Unmapped tuples can deliberately use the shared view photo, and the preview must say that it is shared.
2. **Photo alignment.** Placement geometry starts shared. If the selected crop or garment shape puts the print area in a different place, the merchant can adjust the print area for that option tuple. Show that this is an alignment override. A changed photo alone does not prove that the same rectangle is aligned. A broken explicitly selected image should show an error and recovery, not silently fall back to the shared photo.
3. **Production rules.** Physical dimensions, method eligibility, decoration sizes, and prices have separate meaning. Current Insignia pricing and eligibility scopes are product, placement, method, and decoration size. They do not vary by color or variant. Keep those controls out of the photo workflow. Do not imply that selecting a different Fit, Material, or Finish changes allowed methods or physical bounds unless the product contract is expanded to represent that rule.

The common path stays inside the current sequence: Product rules, Images and print areas, Prices, Review and publish. A merchant adds views, chooses the photo-changing option values, assigns the photos, and checks each group's preview. Shared geometry remains the default; only a visibly misaligned group needs a print-area exception. The existing draft Save Bar and explicit Publish action remain the change boundary.

On the buyer side, show the selected Shopify option names and values alongside the image preview. The chosen tuple changes the preview photo; the actual variant IDs continue to drive quantities, availability, base prices, and cart lines. Reuse entered quantities when the buyer switches preview groups. Keep mixed colors or finishes with the same artwork in one design group. A different logo or decoration setup is a separate design. For phones, use labelled option controls and a single scrollable quantity list grouped by the chosen image options. Do not require a wide variant matrix or swatch-only controls.

## Trade-offs and open questions

Option-value tuples avoid repeating the same image for every size and keep the language useful for Finish, Material, Fit, and Case. They require the app to read stable Shopify option/value IDs, resolve image groups against current variants, and expose selected option data to the buyer. The current schema maps media and placement geometry by full variant ID. Keeping only that model is less work, but makes a Color × Size product repeat every photo mapping and risks its 100 override entries per view limit. A tuple mapping is a real model change, not a new label for the existing selector. The model should support tuples; the common editor path should start with one option and reveal a second only when needed.

The first product should keep the present shared-image default. Existing saved images and geometry must not change when a merchant opens the editor. Shopify variant photos can be offered as explicit choices, then previewed and saved into a new draft. Removed or renamed option values should surface as unresolved mappings. New values should either visibly inherit the shared image or require a photo choice according to the merchant's saved fallback rule. Never remap by matching a translated label. Draft save conflicts keep the current reload/review path, and publication stays separate. Existing accepted orders retain their historical images and geometry.

Specific questions to resolve before implementation:

- Which first products require a second image-changing option such as Color + Fit? Keep tuple support in the model, then use those products to decide whether the second-axis control belongs in the first UI release.
- Should an unmapped tuple be allowed to use the shared photo at publication, with a visible warning, or should some products require an explicit image for every tuple?
- Which real products have option-specific physical print dimensions or method/size eligibility? Those need a separate product-contract decision. Image grouping cannot stand in for production rules.
- How should a new Shopify option value appear when a product's catalog changes after publication: shared-image fallback, held publication, or an explicit mapping task?

For first use, a single-variant product should never show option-group controls. A product with no photos should keep the current "Add a product image in Shopify" recovery. Catalog load failure must remain distinct from an empty option list. Failed image loads need Retry or a way to choose another image while preserving the saved mapping. Local uploads are not required for this workflow; if added, use the installed Uploading Media checklist for limits, progress, per-file outcomes, retry, and deletion. Keep existing products on their saved shared image and geometry until the merchant explicitly edits and publishes a draft.

This note recommends a model and flow. It does not qualify mobile pixels, full Shopify authentication, product edits in a live store, or owner acceptance. Those require the actual implementation and rendered states.
