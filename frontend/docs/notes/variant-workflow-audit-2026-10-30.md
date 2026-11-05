# Variant workflow robustness audit

30 October 2026. Research and audit only; no application source was changed. This pass covers the polished merchant preview in `apps/web/test/admin/support/placement-*`, the persisted merchant/configuration and geometry contracts, and the sibling customer prototype. The task began with substantial unrelated dirty UI work; it was preserved.

Checklist: [Web app Single Item Detail](https://www.checklist.design/web-app/single-item-detail).

I read the current variant-photo, model, persona, and UI guidance notes and inspected the source. I also opened the named `127.0.0.1:62168` preview in an isolated, read-only Chromium session at 1440 × 1000 (light appearance) for the `variant-many` state. That capture is temporary at `/tmp/variant-workflow-audit-many.png`; no preview controls were changed. This is not a new dark, phone, or native-Shopify visual pass.

## Checklist pass

| | Item | Why |
|---|---|---|
| 🟢 | **Clear title or identifier** — The name, ID, or primary label of the item, shown prominently at the top of the screen | The captured preview shows the product title in the Shopify page heading; the editor source supplies `product.title` to `s-page`. |
| 🟢 | **Status indicator (if applicable)** — A clear signal of the item's current state (active, pending, completed, archived). _Tip: Colour-blind users can't distinguish status by colour alone, so include a text label alongside the colour indicator to ensure it's readable_ | The editor renders text status such as `Draft`, `Draft changes`, and `Preview published`; variant rows also use text labels such as `Image needed`, `Check alignment`, and `Image unavailable`. This source and capture do not establish contrast in the Shopify host. |
| 🟢 | **Key details section** — The most important attributes of the item surfaced prominently, with secondary details available below or in a sidebar. _Tip: It’s critical to exercise hierarchy here and consider what details matter more than others, and how can they be effectively grouped_ | The captured three-panel editor groups views and placements, the garment canvas, and selected-view settings; the settings also expose the photo option grouping, per-group image status, and count of real variant records in that group. |
| 🟢 | **Edit action** — A clear way to modify the item's details, either inline or via an edit mode | The editor has direct controls for photo grouping, image assignment, shared image choice, and photo-specific alignment. The underlying workflow also has save, publish, undo, and redo actions. |
| 🟡 | **Related items or activity** — Associated records, linked content, or a history of changes related to the item. _Tip: An activity log showing who did what and when is highly valued in collaborative products_ | Views and placements are visible related records, and local Undo/Redo is available. There is no durable who/when activity history in this preview. |
| 🟢 | **Breadcrumb or back navigation** — A way to return to the list or parent context | The editor shows a back control and a `Products` breadcrumb. |
| ⚪ | **Destructive actions** — Delete or archive options, available on the detail screen but kept visually separate from the primary actions. _Tip: Establish friction by visually separated this from other settings and having typed confirmation for irreversible actions_ | Insignia edits product setup, while Shopify owns the product record and its deletion/archive lifecycle. View and placement removal is confirmed separately; adding product deletion here would cross that ownership boundary. |

## Findings

### P1 — Grouped photo assignment is a polished preview model, not a persisted product capability

The group authoring model is in test support: [placement-variant-photos.mts:1](../../../apps/web/test/admin/support/placement-variant-photos.mts#L1), and its sample catalog is synthesized by [placement-variant-photo-examples.mts:20](../../../apps/web/test/admin/support/placement-variant-photo-examples.mts#L20). Preview selection is URL/example scoped and its save bridge uses tab-local `sessionStorage` in [placement-preview-storage.mts:1](../../../apps/web/test/admin/support/placement-preview-storage.mts#L1) and [placement-preview-storage.mts:68](../../../apps/web/test/admin/support/placement-preview-storage.mts#L68). The preview grouping schema requires option and option-value IDs, but the current production catalog DTO exposes selected option `name`/`value` strings without those IDs at [catalog.ts:12](../../../packages/shopify/src/catalog.ts#L12) and [catalog.ts:80](../../../packages/shopify/src/catalog.ts#L80). The preview’s rename-stability test therefore proves stability only for supplied IDs, not a production group-to-option mapping.

The persisted `MerchantConfigEditor` supports a different model: one shared image plus exact Shopify-variant-ID image and artwork-area overrides. It says whether the selected variant has its own image/areas at [MerchantConfigEditor.tsx:961](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L961) and writes the selected exact variant ID at [MerchantConfigEditor.tsx:1648](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L1648). The test preview’s group assignments are not translated into that persisted geometry or Shopify records. The merchant cannot start grouped photo setup from actual Shopify option metadata in the persisted editor today.

**Repro:** open `/admin/products/15464675246464/config?__variant_example=variant-unassigned&variantImages=1`, assign a group photo, and save. The saved preview draft is query-keyed browser-tab state; the persisted editor remains on exact variant IDs and has no grouped assignment field. Treat the polished group workflow as preview evidence until a real option/group storage contract is added.

**Recommendation:** keep the boundary visible in delivery claims. A future integration must map groups to the exact live variant IDs they cover; do not infer a new Shopify cart, variant identity, or product-media mutation from this preview.

### P1 — The 100-entry exception limit is below Shopify’s 100+ use cases

Production geometry stores per-view images and per-placement rectangle exceptions by exact `variantId` at [geometry.ts:24](../../../packages/visualizer/src/geometry.ts#L24). Validation rejects more than 100 image overrides per view or more than 100 rectangle overrides per placement at [geometry.ts:153](../../../packages/visualizer/src/geometry.ts#L153). The buyer catalog separately rejects products with more than 250 variants at [production.ts:449](../../../apps/web/src/server/buyer/production.ts#L449), and a single design accepts at most 32 selected real variant IDs at [buyer.ts:10](../../../packages/contracts/src/v1/buyer.ts#L10).

Shopify currently supports up to 2,048 variants and three options per product, and notes that some apps may not support more than 100 variants ([Shopify: Adding variants](https://help.shopify.com/en/manual/products/variants/add-variants)). Shopify product media is limited to 250 items and each variant can have one assigned image ([Shopify: Adding images to product variants](https://help.shopify.com/en/manual/products/product-media/add-images-variants)). These are platform limits; Insignia’s 100/250/32 limits are separate implementation limits.

This does **not** mean every product with more than 100 variants fails. A shared image and geometry can cover many SKUs, and a product with fewer than 100 explicit exceptions stays within the current geometry contract. The failure is a product with more than 100 distinct variant-specific image exceptions in one view, or more than 100 distinct per-variant area exceptions on one placement. Grouped photo assignment would reduce the authoring rows, but it cannot help production until the group-to-variant mapping is persisted.

**Repro:** construct 101 exact variant image entries for a single view, or 101 rectangle overrides on one placement, then call `validateGeometry`; validation throws `invalid view` / `invalid variant overrides`. A read-only 128-variant probe below confirms the preview group model itself accepts a larger catalog; it does not change this production validator.

**Recommendation:** do not raise limits without a persistence, performance, quote, and customer-resolution plan. Surface the actual per-view/per-placement override caps before an edit is rejected. If the product needs more than 100 exceptions, design and test compressed group-native persistence rather than expanding each group into unbounded SKU entries.

### P1 — Photo groups cannot express material-dependent methods, physical limits, or prices

The polished editor groups image and photo-alignment behavior only. `resolveVariantPhotoView` chooses an image and optional rectangle for a group at [placement-variant-photos.mts:264](../../../apps/web/test/admin/support/placement-variant-photos.mts#L264), while the product’s methods and sizes remain on the shared placement in [placement-workflow-preview.tsx:1576](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L1576). The production contract scopes allowed methods/steps and pricing by placement/method/step; it has no Shopify-variant eligibility dimension in [pricing-config.ts:28](../../../packages/contracts/src/v1/pricing-config.ts#L28) and [pricing-config.ts:51](../../../packages/contracts/src/v1/pricing-config.ts#L51).

**Repro:** create a product with `Material = Steel/Polymer`, group photos by Material, and assign different images. Both groups still inherit the same method/size/price setup. A photo group cannot make a process unavailable for Polymer or change its price. This matters for non-apparel products where material/model changes decoration capability or physical limits.

**Recommendation:** state the common-method/common-price constraint in readiness or product copy and reject a setup when one shared configuration is not valid for every real variant. Do not present image grouping as material-aware production configuration. A separate variant eligibility/pricing contract is a later product-model change.

### P2 — Duplicating a placement drops same-view group alignment exceptions

`duplicatePlacement` clones the shared placement rectangle and settings at [placement-workflow-model.mts:179](../../../apps/web/test/admin/support/placement-workflow-model.mts#L179). The editor then updates only the view list at [placement-workflow-preview.tsx:710](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L710); it does not copy the group’s `placementRects` entry to the new placement ID. The resolver uses a group rectangle only when that new ID is present, otherwise it falls back to the shared rectangle at [placement-variant-photos.mts:293](../../../apps/web/test/admin/support/placement-variant-photos.mts#L293).

**Repro:** set a group’s existing placement area to center X `60%` while the shared base is `50%`, duplicate that placement in the same view, then preview that group. The original remains at `60%`; the duplicate resolves to `50%` because its ID has no group exception. A one-off model probe reproduced this.

**Recommendation:** when duplicating a placement within the same view, copy each existing group’s rectangle override to the new placement ID, preserving the group’s review state. Keep cross-view placement copy independent: the destination photo may need a different alignment, and the editor already tells the merchant to adjust it. Add a regression that checks both cases.

### P2 — Compound group labels and search hide some of the real variant scope

The model computes a unique group key from option/value IDs but displays only the selected values joined with ` / ` at [placement-variant-photos.mts:169](../../../apps/web/test/admin/support/placement-variant-photos.mts#L169). A group row shows that value label and a variant count at [placement-variant-photo-panel.tsx:371](../../../apps/web/test/admin/support/placement-variant-photo-panel.tsx#L371). Search filters only `group.label` at [placement-variant-photo-panel.tsx:129](../../../apps/web/test/admin/support/placement-variant-photo-panel.tsx#L129), not member variant titles or unselected option values.

**Repro:** choose `Model + Material` grouping. Rows show value pairs such as `Model 04 / Steel`, not `Model: Model 04 · Material: Steel`. The count distinguishes image groups from SKUs, but a sparse group’s actual capacity/size members are not visible and searching for a member’s value or SKU cannot find its group.

**Recommendation:** display compound values with their option names and make search cover the member variant labels/option values when real catalog data is available. Keep a visible count labeled as Shopify variants so group rows are never presented as cart lines or SKU identities.

### P2 — The customer prototype hardcodes colour × size presentation

The sibling prototype’s `configSchema` requires `colors[]` with a hex value and treats `sizes[]` as the second quantity axis at [config.ts:42](../../../../designer-prototype/src/config.ts#L42). Quantity state is keyed as `color:size` at [designer-state.ts:216](../../../../designer-prototype/src/designer-state.ts#L216); the picker and review call the row `Garment colour` and `Items by colour and size` at [color-picker.tsx:59](../../../../designer-prototype/src/color-picker.tsx#L59) and [review-panel.tsx:98](../../../../designer-prototype/src/review-panel.tsx#L98). Finish, material, model, and arbitrary Shopify option sets therefore do not have truthful customer-facing labels in this prototype.

**Recommendation:** a small presentation-only extension could supply a row label and a `swatch` versus named-choice display mode while reusing the existing row × size matrix for non-colour demos. That would improve labels, not add arbitrary Shopify variant support. Compound/sparse options still need a host-supplied mapping from the chosen option tuple to the exact Shopify variant ID, price, and availability. Shopify owns the real product page, selected variant, cart, and checkout; the prototype explicitly has no cart integration in [README.md](../../../../designer-prototype/README.md).

### P2 — Existing “many” browser case is 96 variants, not 100+

The preview fixture creates 24 colours and four sizes at [placement-variant-photo-examples.mts:22](../../../apps/web/test/admin/support/placement-variant-photo-examples.mts#L22) and [placement-variant-photo-examples.mts:61](../../../apps/web/test/admin/support/placement-variant-photo-examples.mts#L61): 24 × 4 = 96 actual variants. The browser flow checks search and keyboard selection of the last colour group at [placement-variant-photos-browser.test.mts:384](../../../apps/web/test/admin/placement-variant-photos-browser.test.mts#L384); it does not test 100+ rendered variants. A separate 140-variant sparse model test now exercises stable membership and geometry across Model × Material × Capacity, but this does not qualify the rendered editor at that size. The fit scenario uses synthetic apparel values and the earlier note explicitly says its reused colour photos are a layout fixture, not fit photography ([variant-photo editor note](variant-photos-editor-v1-2026-10-27.md#L23)).

**Recommendation:** add a realistic >100 rendered case before calling the large-catalog UX qualified. Avoid increasing option or assignment caps merely to make a stress fixture pass.

## Safe behavior already established

- Groups contain only combinations present in `variants`; each group retains the underlying variant IDs. Existing tests cover sparse Colour/Fit combinations, a tumbler with Finish/Material/Capacity, and an exact ID count ([placement-variant-photos.test.mts:215](../../../apps/web/test/admin/placement-variant-photos.test.mts#L215), [line 318](../../../apps/web/test/admin/placement-variant-photos.test.mts#L318)).
- Assignments are deliberate and manual. Bulk selection applies the chosen image only to selected groups; a shared image must be explicitly selected. Missing images do not silently fall through to an unrelated colour, and missing/failed images block local publication. No automatic filename matching/orientation was reintroduced.
- Shared geometry is the default; a group rectangle overrides it only for that group. Base edits preserve existing exceptions, and movement-area coordinates follow the photo-specific rectangle ([placement-variant-photos.test.mts:473](../../../apps/web/test/admin/placement-variant-photos.test.mts#L473)). This audit found no geometry scope bug in the `Shared artwork area` / `Adjust for …` behavior.
- Duplicating a **view** copies its group image assignments and remaps photo-specific rectangle keys to cloned placements ([placement-workflow-model.mts:298](../../../apps/web/test/admin/support/placement-workflow-model.mts#L298)); the corresponding test passes. Cross-product setup copy intentionally clears source imagery and makes target views require fresh images/alignment ([placement-setup-copy.mts:58](../../../apps/web/test/admin/support/placement-setup-copy.mts#L58)). These are snapshots, not live links.
- Customer preview resolves the currently selected appearance into one static view snapshot and strips `variantPhotos` before opening the sibling prototype at [placement-workflow-preview.tsx:2239](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L2239). This is correct for the current local preview boundary; it is not a buyer variant matrix or Shopify cart round trip.

## Checks run

- Focused pure model suites run during this audit: `placement-variant-photos.test.mts`, `placement-workflow-model.test.mts`, and `placement-setup-copy.test.mts` — **45 passed** on the repository-pinned Node 24.21.0 runtime. A separate 140-variant test was subsequently added and reported passing by the parent agent; it was not part of this audit run.
- One-off read-only model probe: a 16-model × 4-material × 2-capacity drinkware catalog (128 actual variants) grouped by Model + Material into 64 groups, preserving two exact variant IDs per group. It reproduced the same-view duplicate placement override loss and verified that 101 exact image overrides are rejected by the current geometry validator. This was a standalone probe, not a new checked-in test or UI/browser qualification.

## Source notes

- Existing variant scope research: [model and production boundary](color-variant-model-research-2026-10-27.md), [non-colour stress cases](color-options-stress-review-2026-10-27.md), [photo workflow robustness](variant-photos-robustness-and-polish-2026-10-27.md), and [manual assignment review](variant-photo-manual-design-sol-2026-10-27.md).
- Shopify platform references: [Adding variants](https://help.shopify.com/en/manual/products/variants/add-variants) and [Adding images to product variants](https://help.shopify.com/en/manual/products/product-media/add-images-variants).
