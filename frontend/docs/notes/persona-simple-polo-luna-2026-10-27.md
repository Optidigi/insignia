# Persona walk-through: simple embroidered polo

Date: 2026-10-27

## Scenario

Luna is a first-time Insignia merchant who knows Shopify products. She wants a polo in three colours and standard garment sizes, with one left-chest embroidery position where customers upload a logo.

## Path and outcome

Started at `http://127.0.0.1:62168/admin/home`, followed **Configure product** to Products, and opened sample-catalog product `15468473450880`, "Ontwerp je eigen Superfunny polo" (`/admin/products/15468473450880/config`). This was an existing sample draft with four views, six placements, Printing and Embroidery, and two decoration sizes. I treated that as inherited sample state, not a new-product default.

I removed the extra Front placements and Back, Left side, and Right side views, then disabled Printing. The editor showed one Front view, one Left chest placement, Embroidery, and two decoration sizes. I saved the draft, then used **Publish preview**. The dialog said "Local preview only. Shopify isn't updated." The editor confirmed "Published in preview. Your Shopify store is unchanged."

**Outcome:** the requested one-placement, embroidery-only setup saved and published in the local preview. The customer preview showed the same single Left chest position and Embroidery method. I opened the artwork upload dialog and recorded its supported file types and size limit, but did not supply a file. This session did not reach a Shopify product page, cart, or checkout.

## What worked

- The sample polo was easy to find from the Products list. It showed the setup status, decoration method, placement, and a count of 11 variants.
- The editor made the artwork area adjustable and explained that decoration sizes are not garment sizes.
- The local-only publish confirmation clearly separated preview publication from Shopify changes.
- The customer preview offered PNG, JPG, or SVG uploads up to 5 MB.
- Orders showed payment and artwork status, decoration method, and customized item count. A missing-artwork order had **Jump to missing artwork** and an **Attach artwork** action.
- An existing polo order exposed artwork preview/download and an A4 production sheet. The sheet says to use the original artwork files for production.

## Findings

1. **P2, customer size label.** With Printing disabled and Embroidery selected, the buyer preview still called the size choices "Print size." The options were "Standaard" at €15 and "Groot" at €17.50. This is observed in the local preview. Source inspection found the storefront customizer uses the method-neutral label "Decoration size" (`apps/storefront/src/customizer.tsx:999,1032`), so the preview wording does not match that source. Use the same method-neutral label in the preview and storefront. The tradeoff is one shared term across methods instead of method-specific labels.
2. **P2, variant check is unavailable here.** The product list exposed only "11" variants; the customer preview showed one blue Front image and no colour or garment-size selectors, quantity, or cart. I could not verify the requested three colours or standard size range in this local flow. Add those Shopify variant choices to the customer preview, or make clear that the preview only tests artwork controls. A fuller preview depends on Shopify variant and theme data.
3. **P3, price basis is unclear to the buyer.** The preview showed `+€15.00` and size prices but no "per item" cue. The merchant editor says embroidery pricing is per item at the placement. Add a per-shirt cue or a quantity-aware total in the customer flow. That adds copy or price-state detail, but makes group orders easier to estimate.
4. **P3, preview state wording.** After the editor confirmed "Published in preview," the customer tab still said "Customer preview · Current draft." I could not tell from that label whether it showed the published preview or a draft. Use a label that names the preview state. This is a small copy change but needs to distinguish published preview from later edits.

## Limits

The customer file upload was not completed, so file validation and the preview after a logo upload remain untested. The customer tab was an admin preview, not a real storefront session. The order list contained test orders; I saw artwork readiness and a production PDF, not live fulfillment or production progress. The existing polo order used `Blauw / L × 6`; that does not establish the complete variant range.

## Evidence

UI states observed:

- Products: `http://127.0.0.1:62168/admin/products`
- Polo setup: `http://127.0.0.1:62168/admin/products/15468473450880/config`
- Customer preview after local publish: `http://127.0.0.1:5173/?adminPreview=fe745195-498e-471f-b3c5-51f44f7c35c5&adminOrigin=http%3A%2F%2F127.0.0.1%3A62168`
- Orders: `http://127.0.0.1:62168/admin/orders`
- Order #1044: `http://127.0.0.1:62168/admin/orders/10000000-0000-4000-8000-000000000103`
- Order #1043: `http://127.0.0.1:62168/admin/orders/10000000-0000-4000-8000-000000000102`

Screenshots are in `/Users/pc/Development/Insignia/.artifacts/persona-audit-2026-10-27/simple-polo/`:

- `products-simple-draft.png`, before editing the inherited sample setup
- `products-published-one-placement.png`, published local setup and 11-variant count
- `polo-published-preview.png`, editor confirms one view and one placement, preview only
- `customer-one-placement-after-publish.png`, buyer preview with one placement and Embroidery
- `customer-upload-modal-after-publish.png`, upload types and 5 MB limit
- `orders-overview-test-orders.png`, eight test orders and artwork/payment statuses
- `order-1044-paid-artwork-complete.png`, paid polo order with a provided artwork file
- `order-1044-production-sheet.png`, A4 sheet and production note
- `order-1043-attach-artwork.png`, missing-artwork attachment controls and file limits
