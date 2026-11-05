# Luna scenario-skeptic review: product setup, Methods, preview, and Orders

24 October 2026. Independent product review of the revised local merchant preview. I focused on whether the changed flows carry the right product and price state, whether staged work can leak on Cancel, and whether production handoff context survives into Orders.

## Verdict

I found one material product-setup gap in the earlier build: a merchant could not reprice an existing fixed-price product copy after the reusable default changed. The current build adds a product-scoped **Edit price** action, and I verified its Cancel/Done behavior and the resulting customer-preview price. The earlier one-off-method detour and Orders handoff-context gaps are also addressed in the local preview. I found no unresolved blocker in those revised flows.

The rich Methods workflow remains a local preview, not the production persistence and inheritance contract. Treat that as an open integration gate, not as evidence that production Methods now imports reusable prices or tracks template lineage.

## Findings and status

### P2 fixed: existing fixed-price copies can now be repriced deliberately

The earlier product manager showed a copied fixed amount as read-only. That was inconsistent with the intended snapshot model: changing a library default must not silently alter existing products, but merchants still need a way to change an existing product’s price.

In the current 390 px product editor, **Edit Printing price** opens a compact editor explaining that the amount applies to every placement using Printing on this product and leaves other products and library defaults unchanged. I changed the staged amount from €5.00 to €9.50, cancelled, reopened the editor, and confirmed it remained €5.00. I then applied €9.50 with **Done**, saved the local draft, and opened Customer preview. The Right chest option showed `+€9.50`; both print sizes showed `+€9.50`; Printing showed `From €9.50`.

The primary implementer reports the focused `fixed product prices can be edited explicitly, cancelled and saved without repricing other products` browser regression passed at desktop and 390 px, including invalid-price rejection, Cancel, Done, reload persistence, and another product remaining at €5.00 ([test](../../../apps/web/test/admin/placement-workflow-browser.test.mts#L4708)). The behavior is product-scoped and explicit; no library default, other product, or published snapshot is silently rewritten.

### P2 resolved: one-off method creation stays staged until Done

On a 390 × 844 phone viewport with the 18-method setup, the chooser keeps search and filter controls above a bounded method list and keeps **Cancel** and **Done** visible at the bottom. **Add method** opens a compact form rather than another full-size chooser. The name field says the method is only added to this product; the next screen makes blank prices **Not offered** and zero **Free**.

I entered `Audit vinyl`, entered €3.50 for one size, then cancelled. The manager closed, the placement still showed its original six enabled methods, and **Save draft** remained disabled. The staged method and price did not leak. A separate isolated first-product walkthrough completed the successful one-off path without visiting the reusable library; the primary implementer’s focused browser test covers the current successful path.

### Confirmed snapshot behavior: availability and defaults do not rewrite copies

I removed Superfunny hoodie from Printing’s manual library availability and saved the local method. Its existing Right chest copy remained selected at €5.00 in the product chooser. I also changed a library default from €5.00 to €9.99 in an isolated preview tab; the existing hoodie product copy stayed at €5.00. This matches the editor’s copy-on-add wording and the intended separation between future eligibility/defaults and existing product snapshots.

The Methods index now labels actual **Products using** separately from the secondary available count. Usage can exceed availability after a product is removed from the library assignment: the product keeps its existing copy. Do not treat that as stale usage data or “repair” it by removing saved product methods.

### Resolved: Orders repeats Test and artwork-hold context at export

The Orders list now marks test orders. On #1043, the order detail showed **Paid**, **Artwork needed**, and **Test**. Opening **Download artwork** showed **Test order**, a **Check before production** section with `#1043: artwork needed`, and the note that one placement would be left out. I did not trigger the ZIP download. Keeping the download available is appropriate for a test or review task because the handoff warning and omitted placement are visible at the decision point.

### Mobile product identity: source fix present, final capture pending

Before the final source adjustment, the 390 px **No product images** state showed a generic first-view guide while the host header clipped the title to `Ontwerp je eigen Sup…`. The T-shirt, hoodie, and polo names share that prefix, so the garment type was not visually recoverable on first use. The current source adds the full product title in subdued text above the generic guide when no product image exists ([placement-workflow-preview.tsx](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L2363)). This is the smallest appropriate correction; a new native 390 px capture after the final server restart is still pending, so I am recording it as source-confirmed rather than visually requalified.

The large chooser and its Add method and fixed-price editors fit in the tested phone viewport without crowded controls or clipped actions. The primary implementer subsequently tightened fixed-price form padding; the final capture after that adjustment is pending, so I have not requalified that last visual change. Shopify’s [layout guidance](https://shopify.dev/docs/apps/design/layout) and [content guidance](https://shopify.dev/docs/apps/design/content), plus Memorisely’s [visual-hierarchy discussion](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and Zander Whitehurst’s [progressive-disclosure discussion](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX), support checking information priority, grouping, and phone density. They inform presentation; they do not define Insignia’s price or snapshot contract.

### Scope gate: production Methods integration is still separate work

Production `MethodTemplate` remains `{ id, name, version }`, and the production product editor still asks merchants to configure product prices separately. The richer fixed-price defaults, availability counts, and local product snapshots live under `apps/web/test/admin/support/method-*` and the loopback preview. This review does not qualify production persistence, source-template provenance, buyer quote integration, Shopify publication, or order pricing. The production contract gap remains documented in the [pricing Methods audit](luna-pricing-methods-audit-2026-10-24.md).

## Rejected findings

- Do not propagate a library price or availability change into existing product copies. The current text and observed behavior agree that defaults are copied when added; the explicit product-level editor handles intentional repricing.
- Do not flag `2 available` and `3 using` as inconsistent. Availability answers what can be added now; usage counts retained product snapshots.
- Do not require a reusable library method for a one-off product setup. Product-local creation is a valid short path, and its Cancel behavior is isolated from the draft.
- Do not add another movement-copy confirmation. The copy review now says artwork and enabled customer-movement areas are copied and asks merchants to review both against each target image. Existing destination review remains the right safety step.
- Do not disable artwork retrieval for a test or held order. Repeating Test and hold context beside the export action gives the merchant a clear handoff decision while preserving legitimate review access.

## Walkthrough and limits

I used a separate hidden in-app-browser tab against the loopback preview at `127.0.0.1:62168`, including a 390 × 844 viewport. I did not use or modify the owner’s Chrome tabs. The preview stores demo state in the browser tab; I saved one local product draft to verify that Customer preview reflected the changed product snapshot. The primary implementer reports passing coverage for 18 Methods workflows, six distinct placement workflows, two template import/recovery checks, two canonical routing/navigation checks, and two archive workflows; these are reported suite results, not individually rerun in this independent walkthrough. I did not publish, check out, send a ZIP, or write to Shopify or a production system.

The reference pattern review is not a human usability study. Local browser behavior and source inspection do not establish Shopify-hosted composition acceptance or production integration. The final phone captures for the no-image title and fixed-price padding adjustments remain pending as noted above.

## Primary implementer follow-up

The final desktop/phone gallery captures completed after this independent review. The implementer visually checked the [full no-image product title](../../../../.artifacts/admin-popup-review-2026-10-24/editor/mobile/unconfigured-editor-no-images.png) and the [inset fixed-price form](../../../../.artifacts/admin-popup-review-2026-10-24/editor/mobile/fixed-product-method-price.png). This closes the capture-pending status in the report above; it does not imply an additional native Shopify or independent reviewer observation.
