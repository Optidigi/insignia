# Product setup efficiency audit

24 October 2026. Product setup was reviewed from Products through first view, placement, decoration sizes, methods/prices, optional movement, copy, save/discard/publish, and customer preview. This review focused on merchant workflow and comprehension, not code quality.

The normal first-use path is understandable and the reviewed preview offers the necessary setup controls. I did not reproduce a critical blocker. Two workflow improvements remain: a phone title loses the product-type suffix, and the populated method picker has no direct route to the method library. Copying movement settings also deserves a clearer scope sentence, but the target-image review already protects the workflow; it is not an unsafe publish bypass.

## Findings

### P2 — Phone header hides which product is being configured

**Merchant task and reproduction:** On a phone, choose one of several similar catalog products and start its setup before adding a view. At 390 px wide, the header shows only `Ontwerp je eigen sup` from `Ontwerp je eigen superfunny T-shirt`; the hoodie and polo fixtures share the same visible prefix. In the no-images first-use state, the body only says “Add your first product view” and shows a generic illustration, so it does not restore the missing product identity.

**Observed evidence:** [phone first-use screenshot](</Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/unconfigured-editor-no-images.png>); product titles in `apps/web/test/admin/support/legacy-catalog.json`; preview header at `apps/web/test/admin/support/placement-workflow-preview.tsx:1794`.

**Impact:** A merchant managing similar apparel products can lose confidence that the correct product is open, especially before any product image exists. The risk is limited to product identification; the saved production editor was not tested.

**Smallest fix:** Preserve the distinguishing end of the title with middle truncation, or add a compact type label such as “T-shirt” beside the shortened title. Keep the full title available to assistive technology.

**Principle and scope:** Shopify’s [responsive layout guidance](https://shopify.dev/docs/apps/design/layout) says layouts should adapt to device size. Memorisely’s [visual-hierarchy post](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) recommends grouping and prioritizing related information. These guide the proposed treatment; the screenshot and common-prefix catalog titles are the product evidence. This is observed in the loopback preview only, under `apps/web/test/admin/support/placement-workflow-*`; the actual editor is `apps/web/src/islands/MerchantConfigEditor.tsx` and has a separate header.

### P3 — Adding a method is harder to discover after the chooser has entries

**Merchant task and reproduction:** A merchant already has eligible methods, opens a placement’s **Manage** action, and needs to add another store method or change the library. In the isolated desktop walkthrough, the dialog showed Printing and Embroidery with method selection and price editing, and only **Cancel** and **Done**. The library route exists only for the empty-library state, where **Save draft and open library** appears.

**Observed evidence:** Fresh isolated walkthrough on `http://127.0.0.1:62168`: unconfigured product → Add view → Front → Add placement → Manage methods. The populated chooser is implemented in `apps/web/test/admin/support/placement-method-manager.tsx:203–223`; its library action is conditional on `emptyLibrary`. The separate production editor has **Add method** under Product rules at `apps/web/src/islands/MerchantConfigEditor.tsx:1795`.

**Impact:** Choosing existing methods and setting prices is direct. A less frequent library-edit task requires leaving the product, saving the draft, finding Methods, and returning to the placement. This is friction and a discoverability gap, not a setup blocker; the existing empty-library bridge fixed the earlier first-product dead end.

**Smallest fix:** Add a secondary **Manage method library** action in the populated chooser that uses the existing save-and-return bridge and restores the exact product, view, and placement.

**Principle and scope:** Shopify’s [content guidance](https://shopify.dev/docs/apps/design/content) calls for clear labels and plain language. Zander Whitehurst’s [progressive-disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) supports revealing secondary controls by context while keeping relevant navigation easy to find. This observation concerns only the local preview’s placement chooser; it is not a defect in the production `MerchantConfigEditor` method flow.

### P3 — Copy scope sentence omits customer movement settings

The copy-placement dialog says it copies “the artwork area, sizes, methods and prices,” but copying also carries `movementRect` and `customPlacementAllowed` (`apps/web/test/admin/support/placement-workflow-model.mts:242–255` and `apps/web/test/admin/support/placement-setup-copy.mts:152`). The copy review shows artwork outlines, so an operator may not realize the customer movement boundary is also copied.

This is a **clarity improvement only**, not a missing safety step. Every copied target view has `needsAlignmentReview: true` (`placement-setup-copy.mts:170`); publication blocks unresolved alignment (`placement-publication.mts:76–77`); and the target inspector explicitly says “Check the artwork and movement areas against this image” when movement is enabled (`placement-workflow-preview.tsx:2413–2427`). The smallest improvement is to mention movement settings beside the copy action, without adding another confirmation. This is preview-only.

## What worked well

- The empty editor explains that a view is a product photo and that the next task is marking the artwork area. Its **Add view** action is visible on desktop and phone. The no-result image picker offers both **Show all images** and **Upload image**, so recovery is clear.
- The placement inspector explains that decoration sizes are artwork scale factors, not garment sizes. Its pricing copy distinguishes a blank value (**Not offered**) from zero (**Free**). The compact method chooser stages method and per-size prices until **Done**; **Cancel** leaves the selection untouched.
- Customer movement is optional and contextual. Enabling it reveals a movement-area control and explains that prices and sizes do not change. The movement boundary is not described as a print-safety guarantee, which matches the project’s scope.
- Copy review distinguishes independent drafts from the source and requires each target image/alignment review. The target inspector names movement areas when relevant.
- Save, discard, and publish have different labels and confirmation copy. The publish confirmation says it publishes the setup “as the preview,” that later edits remain draft, and that Shopify is not updated. Customer preview labels itself **Current draft**. These statements make the simulation boundary visible.
- Desktop keeps the image and contextual settings together; phone shifts to a single task-focused surface. Method prices and confirmation dialogs remain usable in the reviewed 390 px gallery states.

## Walkthrough and limits

I used a fresh, isolated in-app browser tab at `http://127.0.0.1:62168`, leaving the owner’s saved tab untouched. I selected the local unconfigured T-shirt example, opened its product setup, added the Front image as a view, added a placement, selected Printing and Embroidery, opened the movement-area task, opened Customer preview, and inspected the publish confirmation. The customer preview showed **Current draft** without saving. I cancelled publish and left the temporary draft unsaved; I did not click Save draft, Discard changes, or Publish, and no Shopify/store write occurred.

For mobile, I inspected the supplied 390 × 844 and 320 × 568 screenshot states; I did not run the fresh walkthrough at 320 px. Desktop gallery states include 1440 px. I did not draw and save a movement boundary in the fresh scenario, apply a copy, upload a file, test with a connected Shopify store, or exercise production persistence/authentication. The prior delivery notes report separate browser coverage for these flows, but those reports are not substitutes for this walkthrough. This is an AI review, not human usability testing.

The preview is a frontend exploration in `apps/web/test/admin/support/placement-workflow-*`. README and prior delivery notes state that its draft and publication are tab-local and that it does not write production product drafts or Shopify. The production editor is separate. Findings above are scoped accordingly.

## Useful rejected ideas

- Do not add a mandatory wizard for every view, placement, size, and price. The current flow keeps related editing in context, leaves movement optional, and gives experienced merchants direct access to objects and settings. Progressive disclosure is about context and findability, not nesting all work behind steps.
- Do not rename `View 1` automatically from the image. The README records the deliberate generic naming decision because product image metadata does not reliably identify front/back/side. The picker gives the merchant a visible image choice and the name remains editable.
- Do not force a second movement confirmation after copying. The destination image review is already required, its instruction calls out movement areas, and publish is blocked until the review is marked complete. Improve the copy scope sentence instead.
- The empty desktop has both a central **Add view** button and a persistent sidebar **Add view** action. This repeats an entry point, but the central action serves first use and the sidebar provides a stable expert shortcut after setup begins. I would not remove the persistent action based on a screenshot alone.

## Guidance reviewed

- [Shopify layout](https://shopify.dev/docs/apps/design/layout): adapt layouts to devices; two-column layouts suit visual editors that benefit from a real-time preview.
- [Shopify content](https://shopify.dev/docs/apps/design/content): use plain language, clear labels, and avoid duplicating content.
- [Shopify App Home](https://shopify.dev/docs/apps/build/app-home): App Home is the merchant surface for configuration, data, and workflows. I used this to scope the review to app behavior, not as evidence of a specific interaction requirement.
- [Memorisely visual hierarchy](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1): group and prioritize related content with layout, size, color, and proximity.
- [Zander Whitehurst progressive disclosure](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX): layer information based on user needs. The post’s comments also caution against hiding relevant information too deeply; this is a principle, not proof that a particular control must be present.
- [Checklist Design empty state](https://www.checklist.design/web-app/empty-state) and [modal](https://www.checklist.design/design-system/modal): contextual first-use explanation and action; clear dialog title and action labels. The Checklist pages returned no readable body in the browser renderer, so I verified their published checklist content from the site’s public content API. I use these as pattern prompts, not as proof of any issue.
