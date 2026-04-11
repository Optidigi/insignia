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

### 2) Placement

- Buyer selects one or more print locations (“placements”).
- Placement names are merchant-defined and may be arbitrary strings.

Pricing display:

- Each placement MAY have a price.
- If placement price is 0, the UI MUST NOT show a currency amount for that placement (treat as “free”).
- If placement price is > 0, show the price for that placement.

### 3) Size (per placement)

- The buyer sets a size level for each selected placement.
- This tab uses a canvas preview (ConvaJS implementation) showing the logo positioned on a garment mockup.

Size control:

- A stepped slider with N steps (merchant-defined).
- The default/starting step is merchant-defined per placement.
- Each step has a merchant-defined label (free text), e.g. “Small/Normal/Big” or “5×5 cm / 10×10 cm / 15×15 cm”.

Pricing by size:

- Each step MAY adjust the price (merchant-defined per placement).
- If all step adjustments are zero, size affects preview only.

Missing preview assets / missing placement geometry:

- If a placement does not have preview geometry for the current view, the UI MUST still allow choosing the size step, but SHOULD hide the canvas preview for that placement.
- If no preview images are available for the product (no usable view assets), the size tab SHOULD render “slider only” (no mockup preview) and the Preview tab SHOULD be hidden.

Multi-placement sizing:

- If multiple placements are selected, the buyer sizes them one-by-one via “Next placement”.
- If multiple placements are visible on the same view, the preview SHOULD render all selected placements, but MUST clearly highlight the placement currently being edited.

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
