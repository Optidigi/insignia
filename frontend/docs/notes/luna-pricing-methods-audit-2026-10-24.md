# Methods, decoration pricing, and reuse audit

24 October 2026. Product/workflow audit of the Methods and product-configuration boundary. This is a read-only review of source, the local Methods/product editor preview, existing screenshots, and the current pricing specification. No implementation or store data was changed.

The important distinction is that the settings route is the application contract; the richer Methods workflow and placement editor are local preview work. Consolidating around the richer workflow is worthwhile, but it must keep each product's final method × placement × decoration-size prices as independent draft data. A library edit supplies defaults to future snapshots. It must never behave as live pricing inheritance. Changing existing product drafts needs a separate reviewed operation.

## Findings

### 1. High — the reusable defaults shown in Methods do not reach real product setup

**Task/repro.** Create a reusable method with a fixed default price or description in the richer Methods workflow, then add that method to a product through the actual Settings product editor. Compare the imported product method and its price table with the reusable method.

**Observed evidence/path.** Production `MethodTemplate` is only `{ id, name, version }` in [MethodLibrary.tsx](../../../apps/web/src/islands/MethodLibrary.tsx#L14), [admin contracts](../../../apps/web/src/server/admin/contracts.ts#L30), and [method-catalog.ts](../../../packages/database/src/repositories/method-catalog.ts#L4). [MerchantConfigEditor.tsx](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L1701) copies the selected name into a fresh product method ID and says to configure prices and print areas later. In the preview, the method form has `explanation`, `pricing`, and `amount` fields ([method-configuration.mts](../../../apps/web/test/admin/support/method-configuration.mts#L5)); the preview's import helper copies a subset into its product editor ([placement-method-library.mts](../../../apps/web/test/admin/support/placement-method-library.mts#L29)). The Methods overview screenshot shows fixed prices and product-specific pricing alongside product assignment: [index-resource-list.png](../../../../.artifacts/admin-popup-review-2026-10-24/methods/desktop/index-resource-list.png). This is a real integration gap, not evidence that the production catalog already owns those fields.

**User impact.** A merchant setting up several similar products must re-enter repeated method defaults, and the richer Methods page can suggest a price is already in effect when the real product editor received only a name. Because the imported product ID is fresh and no source-template ID/version is retained, matching products back to a reusable template by name would be ambiguous after local renames or duplicate names. It also blocks trustworthy usage summaries and a safe review of changed defaults.

**Smallest recommended change.** Give a reusable template a versioned snapshot payload, including its optional fixed starting amount. Retain `sourceTemplateId` plus `sourceVersion` on each product copy as provenance, not as a live link. When a product has matching price cells, offer a one-time **Fill these prices** action that names the exact method × placement × size cells before copying the amount. Persist only the resulting final cell values; future cells do not inherit it. Product-priced methods still require their own final cell entries. Existing drafts keep their prices after a library edit. If the merchant later chooses **Review and apply defaults**, show each affected draft and exact before/after cells, preserve product-specific edits, and require an explicit apply. Published revisions and accepted orders remain snapshots.

**Source principle.** Shopify's [resource-list pattern](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/resource-list) supports browsing and selecting similar resources in a compact, task-oriented list. [Memorisely's hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) supports keeping a method's reusable defaults and its real product-use context close enough to scan. [Checklist's data-table checks](https://www.checklist.design/web-app/data-table) support useful row context and accurate counts; they do not justify showing usage counts that cannot be traced.

**Preview/integration qualification.** This is the main consolidation gap. Production currently has a names-only API and inline product-specific setup. The default payload, source provenance, and reviewed existing-draft update action would require a deliberate contract/schema addition. The current Lean spec requires a final per-product table and prohibits indirect revision mutation ([implementation plan §3.1 and §3.5](../../architecture/implementation-plan.md#L152)); it does not require live inheritance or automatic propagation.

### 2. Medium — the preview's optional method description is dropped when imported

**Task/repro.** Write a method description in the richer Methods editor, then select that method in the placement editor and inspect the imported product method snapshot.

**Observed evidence/path.** The method editor saves `explanation` in the library model ([method-workflow-preview.tsx](../../../apps/web/test/admin/support/method-workflow-preview.tsx#L215)) and exposes a `Description (optional)` field. But [availablePlacementMethods](../../../apps/web/test/admin/support/placement-method-library.mts#L29) constructs the product choice with only `id`, `name`, `pricing`, and `amount`; the strict product `EditorMethod` schema also has no description field ([placement-workflow-model.mts](../../../apps/web/test/admin/support/placement-workflow-model.mts#L99)). The real product editor stores the method name, not a method description. The preview export/search can read the explanation, but the product import cannot carry it.

**User impact.** A merchant can spend time writing useful method guidance and then lose it at the point where the product copy is created. The library and product configuration do not establish whether that text is internal guidance or buyer-facing copy, so its scope is unclear even before import.

**Smallest recommended change.** Decide the field's audience. If it is only a library note, label it that way and keep it out of customer-facing product setup. If it should guide buyers, carry an optional customer-description field through the product draft and published snapshot, and verify that the buyer choice actually displays it. Do not present a saved library field as imported product content until the snapshot contains it.

**Source principle.** [Memorisely's hierarchy guidance](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) supports making related information and its role clear. This finding is grounded in the observed dropped field; the source does not prescribe whether method descriptions should be buyer-facing.

**Preview/integration qualification.** The description field and importer are local preview-only. Production `MethodTemplate` and product method contracts do not currently expose this description, so this should be resolved as part of the richer-method integration rather than inferred from preview copy.

### 3. Medium — a first product with no methods takes an unnecessary trip to the library

**Task/repro.** Start configuring a product whose placement has no methods. In the richer preview's chooser, follow the only provided action, **Save draft and open library**, create or assign a method, then return to the saved product and reopen the same placement chooser.

**Observed evidence/path.** The checked first-product screenshot shows an empty modal with one route to save and leave the editor: [round2-first-shop-zero-eligible.png](../../../../.artifacts/workflow-round2-2026-10-24/round2-first-shop-zero-eligible.png). The bridge notes document the return-to-exact-placement flow in [admin-method-bridge-and-workflow-audit](admin-method-bridge-and-workflow-audit-2026-10-24.md). The real [MerchantConfigEditor](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L1787) already has an **Add method** action for a product-specific method, so the preview's empty state requires a context switch for work that the application can do in place.

**User impact.** A merchant using one-off methods must save, leave the product, create a store-level resource, assign a product, navigate back, and select it before finishing placement and prices. This adds steps and encourages a store-wide template when the merchant may only need a method on one product.

**Smallest recommended change.** In the empty chooser, offer two explicit outcomes: **Add to this product** (create a product-local method and continue with this placement) and **Create reusable method** (save and open the library, then return to the same placement). Keep the reusable path, but do not make it the only way past an empty list.

**Source principle.** [Zander's progressive-disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) supports showing controls in the context where the task needs them while keeping relevant information findable. The [Checklist modal checklist](https://www.checklist.design/design-system/modal) supports explicit action labels that state the outcome and destination; [Shopify's resource-list pattern](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/resource-list) supports selecting among reusable resources, but does not require a library detour for a product-local method.

**Preview/integration qualification.** The long round-trip is present in the local preview's empty-state flow. The real product editor already supports direct product-specific creation, although it does not yet have the preview's richer placement chooser or a connected richer library.

## Scenarios checked

- Read the actual production Methods data shape and product import path; distinguished those from `apps/web/test/admin/support/method-*` preview models.
- Inspected the rich Methods index, template editor, product picker, empty first-product chooser, and placement price editor screenshots at desktop scale.
- Checked a product placement with three decoration sizes: Medium is **Not offered** (blank), Large is €14.75, and Small is **Free** (€0). The preview correctly distinguishes missing price from zero; preserve that behavior. See [pricing-embroidery-size-list.png](../../../../.artifacts/workflow-round2-2026-10-24/pricing-embroidery-size-list.png).
- Read the current product/revision and Lean price rules in implementation-plan §§3.1 and 3.5. The final tuple is method × placement × decoration-size; a missing value is unavailable, and explicit zero is free.
- Read the requested Shopify, Memorisely, Zander, and Checklist sources for the limited principles cited above. They inform presentation and interaction patterns; the Insignia contract and observed flows determine the product recommendations.

## Ideas rejected

- Do not silently update existing product drafts or published revisions when a library method changes. New defaults are copied into new snapshots; updating old drafts needs an explicit reviewed action with a diff.
- Do not infer usage counts or update targets by matching method names. Add source-template provenance before presenting template usage summaries.
- Do not treat a tag match or a library assignment as a configured product placement. A product still needs its own selected method, location/placement, size choices, and final prices.
- Do not add a live global price fallback, method base plus hidden location/size surcharges, per-order setup fees, or quantity/stitch/color rules. The current Lean price contract does not express those safely.
- Do not collapse blank and zero-price states; the checked editor presents the distinction clearly and it matches the pricing contract.

## Qualification

The screenshot and browser evidence is from the local loopback preview. The prior workflow report records local test results, but this audit did not rerun those tests. No Shopify product, production configuration, order, or storefront data was written or changed. These findings identify product and integration work; they do not imply that the local preview is already production-backed.
