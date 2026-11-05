# Persona walkthrough: cafe aprons with a late logo

Date: 2026-10-27

## Scenario

A first-time merchant sells one-size printed aprons to cafes. The final logo is not ready, so the merchant wants to accept orders and add artwork later. One customer needs two independent designs in the same purchase.

## Path and outcome

I started at the local admin Home and followed **Configure product** to Products. The admin catalogue has a hoodie, polo, and T-shirt, but no apron, so I used the hoodie as an explicitly named apparel analogy.

On its configured draft, I selected Right chest and enabled **Allow orders without artwork**. The editor says, "When enabled and published, customers can order before artwork is ready. You can add the artwork to the order after purchase." **Save draft** confirmed the change was saved in this browser tab. The Publish setup dialog said, "Local preview only. Shopify isn't updated." I published that preview.

I then used the footer's developer-only **Setup example → First product · no methods** to check a clean start. Products showed three unconfigured products. The hoodie opened with 0 views and 0 placements. I added its Front image and a placement, then opened **Manage methods → Choose methods**. The picker offered Printing at €5.00 and let me edit its product-specific price. The same picker also offered **Add method**. I created a temporary "Cafe apron print" method and entered €5 for Standard to check the next step. The price form opened in the same flow, and the method appeared on the placement with its price. That label and amount were local test inputs, not merchant pricing advice. I enabled artwork-later, saved the draft, and published the local preview.

In Orders, sample #1043 showed Paid and Artwork needed, with "1 placement needs artwork." The Production sheet said "Hold: artwork needed." I attached the supplied public sample image to the missing placement in the local demo. The order changed to Artwork complete, the placement showed Attached, and the artwork hold disappeared from the worksheet. The worksheet still said "Physical size not configured."

Sample #1046 confirms that two designs can appear as separate groups in one purchase: Design 1 has quantity 2 and Design 2 has quantity 3. Both are complete in this sample. The separate buyer fixture at `http://127.0.0.1:5173/?scenario=one-size-apron&example=accordion` showed Natural cotton, Charcoal, and Olive green, then a Quantities step with One size and **+ Add colour**. Its Review step listed Upper chest and Lower front artwork. Those are two placements within one design, not two independent designs. The buyer fixture is not connected to the admin draft.

I clicked **Reset demo** after the walkthrough. The UI confirmed **Demo reset**, restoring the local product drafts and order fixtures, including the temporary one-view setup and #1043 artwork attachment. I confirmed #1046 returned to its original sample state, with Design 2 artwork marked Replaced. This was local preview work; no Shopify records or checkout were used. I closed only the two tabs I created.

## What worked

- The empty product path has no method-assignment loop. A merchant can add a product view and placement, select an existing method and set a product price, or add a product-only method and enter its price in the next panel.
- The artwork-later switch says what changes for customers and what the merchant can do after purchase.
- Payment and artwork status are separate. A paid order can still show Artwork needed, with a placement-level Attach artwork action and an order-level production hold.
- The apron buyer fixture shows the colour, one-size, quantity, and review steps. It did not require guessing whether those controls existed.

## Finding

1. **Artwork complete is not the same as production ready.** Before attachment, #1043 clearly showed Artwork needed and its sheet said Hold: artwork needed. After attachment, the order said Artwork complete and the artwork hold disappeared, while the sheet still said Physical size not configured. Source confirms that the artwork status checks for current, unexpired artwork on every placement; it does not check physical production dimensions ([status logic](../../../apps/web/src/shared/artwork-status.ts#L15), [worksheet details](../../../apps/web/src/shared/production-sheet-render.ts#L458)). The UI does not call the order ready for production, but the worksheet has no overall readiness label. Keep Artwork complete scoped to artwork, and show a separate production-readiness state or the remaining production conditions. That adds another status to maintain, but avoids treating file availability as production approval. I did not infer that missing physical dimensions block this order; the worksheet only says they are not configured.

## Observed and unverified boundaries

- **Observed local admin UI:** the hoodie editor, local Save/Publish preview, Orders #1043 and #1046, worksheet, and local artwork attachment.
- **Observed separate buyer fixture:** one-size apron colours, quantity, review, and two artwork placements. This does not establish how the admin artwork-later setting behaves in a real storefront.
- **Not verified:** a real customer ordering without artwork, checkout, or one order containing two independent apron designs where only one awaits artwork. #1046 shows two independent designs, but both are complete. The admin **Customer preview** is labelled "Current draft" and is preview-only, not full checkout.
- **Prototype boundary:** the local Save/Publish actions state that Shopify remains unchanged. The artwork upload, sample orders, and buyer fixture are synthetic local data.

## Evidence

Screenshots are in `/Users/pc/Development/Insignia/insignia/.artifacts/persona-audit-2026-10-27/logo-later/`:

- [Product artwork-later control](../../../.artifacts/persona-audit-2026-10-27/logo-later/01-product-artwork-later.png)
- [Apron quantity step](../../../.artifacts/persona-audit-2026-10-27/logo-later/02-apron-quantity-step.png)
- [Order #1043 artwork needed](../../../.artifacts/persona-audit-2026-10-27/logo-later/03-order-artwork-needed.png)
- [Production hold](../../../.artifacts/persona-audit-2026-10-27/logo-later/04-production-hold.png)
- [Attach-artwork dialog](../../../.artifacts/persona-audit-2026-10-27/logo-later/05-attach-artwork-dialog.png)
- [Order #1043 after attachment](../../../.artifacts/persona-audit-2026-10-27/logo-later/06-order-artwork-complete.png)
- [Worksheet after attachment](../../../.artifacts/persona-audit-2026-10-27/logo-later/07-production-sheet-after-attach.png)
- [Fresh product with a method and price](../../../.artifacts/persona-audit-2026-10-27/logo-later/08-first-product-method-price.png)
- [First product published in preview](../../../.artifacts/persona-audit-2026-10-27/logo-later/09-first-product-published-preview.png)
- [Order #1046 with separate designs](../../../.artifacts/persona-audit-2026-10-27/logo-later/10-order-two-designs.png)
