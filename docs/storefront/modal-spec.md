# Modal spec (Storefront)

This document describes what the storefront logo customization modal must do, independent of implementation.

This spec is written to support parallel work:

- Canonical contracts (endpoints, schemas, verification) live in `docs/core/`.
- This file describes UX/state/ownership and links to canonical contracts rather than duplicating them.

## Launch & ownership

- The modal is launched from the product page via a Theme App Extension **app block** button.
- The merchant MUST be able to control:
- Where the button appears (theme editor placement).
- The button label text (block setting).

## UX flow

Wizard sequence: **Upload → Placement → Size → Preview → Review**.

### 1) Upload

- Accept `.svg`, `.png`, `.jpg`.
- Max upload size: 5MB.
- Buyer can choose **Logo later** (defers artwork upload).

SVG safety:

- SVG uploads are allowed but MUST be sanitized server-side.
- Canonical policy: [`../core/svg-upload-safety.md`](../core/svg-upload-safety.md)

Logo later placeholder:

- If the buyer selects “Logo later”, the modal MUST still render a placeholder logo in the size/preview renderer.
- Placeholder behavior is defined by the config response:
  - If merchant configured a placeholder logo image, use that.
  - Otherwise render bold text `LOGO`.
- Placeholder is duplicated across all selected placements.

Behavior:

- If “Logo later” is chosen, the order MUST be marked as `artworkStatus = PENDING_CUSTOMER` (or equivalent) so the merchant can see the missing artwork in the dashboard.

UI details (v2):

- An or-divider is rendered between the upload zone and the “logo later” card (empty state only; hidden once a file is uploaded).
- Method cards show price with a “per placement” sub-label and a circle-check/radio indicator for the selected method.
- Mobile helper text is shown below the logo-later card.
- Upload zone uses `IconCloudUpload`.

### 2) Placement

- Buyer selects one or more print locations (“placements”).
- Placement names are merchant-defined and may be arbitrary strings.

Pricing display:

- Each placement MAY have a price.
- If placement price is 0, the UI MUST NOT show a currency amount for that placement (treat as “free”).
- If placement price is > 0, show the price for that placement.

UI details (v2):

- A method badge with a sparkles icon showing the selected method name is displayed above the placement list.
- Zero-cost selected placements display “Included” in green instead of “+$0.00”.

### 3) Size (per placement)

- The buyer sets a size level for each selected placement.
- This tab uses a canvas preview (Konva implementation) showing the logo positioned on a garment mockup.

Size control — 4 conditional states (v2):

- **State A (slider)**: 1 position selected, 3 or more size steps — range slider with tick marks; supports pointer drag and keyboard.
- **State B (cards)**: 1 position selected, exactly 2 size steps — radio cards showing name, dimensions, and price.
- **State C (multi)**: 2 or more positions selected — position tabs with done/active/pending states; each tab renders slider (3+ steps) or cards (2 steps) for that position.
- **State D (preview-only)**: all selected positions have ≤1 size step — reassurance card shown; step pill label changes to “Preview” with an eye icon.

Pricing by size:

- Each step MAY adjust the price (merchant-defined per placement).
- If all step adjustments are zero, size affects preview only.

Missing preview assets / missing placement geometry:

- If a placement does not have preview geometry for the current view, the UI MUST still allow choosing the size step, but SHOULD hide the canvas preview for that placement.
- If no preview images are available for the product (no usable view assets), the size tab SHOULD render without mockup preview and the Preview tab SHOULD be hidden.

Logo overrides (future-friendly, but in-scope behavior):

- Default: one logo is used for all placements.
- The buyer MAY override the logo for a specific placement during sizing via a small “Change logo for this placement” control.
- If changed, that override applies only to that placement.

### 4) Preview

- Show the garment across all available views (front/back/left/right/etc.) using the rendering pipeline assets.
- The buyer can review how the configured placements look across views.

### 5) Review

- Show an order summary of selected placements and their prices.
- Buyer selects quantities per garment size (B2B style), e.g. 3×M, 4×L, 3×XL.
- Total quantity is the sum of all size quantities.

Pricing rule:

- The configured unit price (base garment + placement prices + step adjustments, if any) is multiplied by total quantity.

UI details (v2):

- Artwork section: if `logo.type === "later"`, an amber "Upload after purchase" badge is shown.
- B2B quantity steppers: one row per Shopify variant size (`ProductVariantOption`). Unavailable variants render as disabled with a "Sold out" label.
- Gradient total bar: background gradient #1E3A8A → #2563EB with breakdown text below the total.
- Add to cart button: green, labeled "Add to Cart — $price", with a cart icon.
- Back navigation: rendered as a text link (not a button).
- Cart integration: one /prepare call per size variant with qty > 0; items are batched into a single /cart/add.js call; per-slot cart-confirm follows.

## Mockup views & color variants (MVP)

For MVP, the merchant provides manual per-color assets:

- Merchant uploads/selects view images per color variant.
- Storefront uses the selected variant to choose the correct view image(s).

Notes:

- The storefront MUST NOT block purchase if preview assets are incomplete; it should degrade gracefully.
- The merchant SHOULD be able to select existing images from Shopify product media as inputs (not only upload new files).

## Integration requirements

- All storefront→backend calls go through the Shopify App Proxy and MUST be verified server-side.
- Non‑Plus pricing uses the variant pool flow (`prepare` → AJAX cart ops → `cart-confirm`).

## Canonical references

- Storefront config contract: [`../core/storefront-config.md`](../core/storefront-config.md)
- Placement editor contract: [`../core/placement-editor.md`](../core/placement-editor.md)
- SVG upload safety: [`../core/svg-upload-safety.md`](../core/svg-upload-safety.md)
- Storefront API contract: [`../core/api-contracts/storefront.md`](../core/api-contracts/storefront.md)
- Variant pool overview: [`../core/variant-pool/overview.md`](../core/variant-pool/overview.md)
- Integration guide: [`integration-guide.md`](integration-guide.md)

## Deferred decisions / open work

Open items tracked in: [`../notes/open-work.md`](../notes/open-work.md)
