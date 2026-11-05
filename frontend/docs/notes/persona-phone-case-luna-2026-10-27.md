# Luna persona walkthrough: phone case

**Verdict:** The tested shopper flow reads as a phone-case customizer, not an apparel form reused badly. The product is named **Phone case**, the only placement is **Back**, and quantity entry shows **One size**. I saw no “garment” wording in the customer UI. The common Artwork → Quantities → Review steps fit this one-logo product without making the shopper choose a case size they do not have.

## Attempted path

Started at `http://127.0.0.1:5173/?scenario=phone-case&example=accordion`, a local schematic fixture. In Artwork, I moved the back logo left with the arrow controls until the allowed edge, reset it, opened the replacement-artwork dialog, and closed it. I set quantity to 1, opened Review, expanded the price, used **Edit quantities**, went back to Artwork, and closed the customizer to return to the product page. I reopened the designer, dragged the logo up to the top of the dashed area, reset its position, and returned to the product page again.

The product page explicitly says the preview is schematic rather than a product photo or calibrated manufacturing template. After leaving, it says the design is not in the cart yet. No live cart, checkout, or Shopify draft was involved.

## What worked well

- Product, placement, and step names stayed concrete: **Phone case**, **Back**, **Artwork**, **Quantities**, **Review**.
- The single colour and single case size remained simple. Quantity entry showed one **One size** row; no redundant case-size matrix appeared.
- Customer movement worked with both arrows and direct drag. Artwork stayed inside the visible dashed rectangle; arrows announced when it reached an edge, and reset returned it to its default position.
- Review showed the selected back artwork, **Print · Small**, one silver one-size item, and a clear **€29.00** price. Expanding the total showed **€24.00 Item + €5.00 Back**. Edit quantities and Previous step returned to earlier stages, and closing the customizer returned to the product page.
- The replacement dialog exposed supported formats and a 5 MB limit, plus sample artwork.

## Material findings

1. **Camera clearance is a configured rectangle, not a camera-shaped mask.** In the fixture, the dashed movement rectangle sits below and to the right of the schematic camera island. Dragging to the rectangle’s top edge kept the logo clear of that island, so this placement is bounded safely when that rectangle is configured correctly. The inspected model stores movement area as center plus width/height and clamps the full artwork footprint to the resulting rectangular min/max edges; it does not represent an irregular exclusion. This is a limit of the inspected movement model, not a failure seen in this particular placement. See [phone-case scenario](../../../../designer-prototype/src/scenarios/phone-case.json), [geometry clamp](../../../../designer-prototype/src/position-geometry.ts), and [shopper movement controls](../../../../designer-prototype/src/inline-positioning.tsx).

2. **“Print size” is separate from case size.** The artwork panel offers Small, Medium, and Large print sizes with different prices, while the quantity step correctly says One size. The distinction was explicit in the UI. Keep the three choices if customers should resize their logo; if the merchant intends one fixed logo size too, reduce the allowed print sizes to that one choice.

## Unsupported and unverified

- **Observed and supported in this fixture:** one back placement, one case size, arrow and drag movement bounded by a rectangle, reset, quantity/review/return path, and visible price breakdown.
- **Not represented by the inspected movement model:** an arbitrary camera-island exclusion mask or other irregular safe shape. This walkthrough only establishes clearance for the supplied rectangular inset.
- **Unverified:** actual file selection/upload. I opened the replacement dialog but did not open the OS file picker or select a file. Real product photography, manufacturing calibration, live cart/checkout behavior, and Shopify effects were outside this prototype walkthrough.
- This is agent simulation, not human usability data or real checkout qualification. No app code was changed and no tests were run.

**Screenshot:** [returned product page](../../../../.artifacts/persona-audit-2026-10-27/phone-case/state.png). The requested file path is `state.png`; the screenshot API returned JPEG bytes, which were written unchanged.
