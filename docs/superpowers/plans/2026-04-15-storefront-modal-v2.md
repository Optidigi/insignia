# Storefront Modal v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the customer-facing storefront modal to match the Pencil v2 designs — new step 1 layout (or-divider, method cards), method badge on step 2, conditional size UI (slider/cards/tabs/preview-only), redesigned review with per-size B2B quantities, total bar gradient, artwork section, and swipe-dismissable preview sheet.

**Architecture:** Pure frontend + CSS changes for steps 1-3 and the preview sheet. Step 4 B2B quantities require a backend addition (fetching sibling variant sizes from Shopify) and cart integration changes. The slider for step 3 is a new input component (range slider snapping to discrete steps). All changes are in `app/components/storefront/` and the config service.

**Tech Stack:** React 18, custom CSS (no Tailwind, no Polaris), CSS custom properties (`--insignia-*`), Canvas API (NativeCanvas), Shopify Admin GraphQL API 2026-04, TypeScript strict.

**Design source:** `docs/designs/storefront-modal-v2.pen` (parsed as JSON — 14 named frames, 4 steps, desktop + mobile, step 3 has 4 states A-D).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/components/storefront/icons.tsx` | Modify | Add missing Lucide-style icons (IconSparkles, IconMapPin, IconMaximize2) |
| `app/components/storefront/i18n.ts` | Modify | Add ~20 new translation keys across all 8 locales |
| `app/components/storefront/types.ts` | Modify | Add `ProductVariantOption` type, extend `StorefrontConfig` with `variants` |
| `app/components/storefront/storefront-modal.css` | Modify | ~200 lines of CSS additions/changes (or-divider, method cards v2, slider, total bar gradient, B2B qty, preview sheet navigation) |
| `app/components/storefront/UploadStep.tsx` | Modify | Add or-divider, redesign method cards (price + "per placement" label, circle-check/radio), mobile helper text |
| `app/components/storefront/PlacementStep.tsx` | Modify | Add method badge (sparkles icon), "Included" green text for zero-cost selected placements |
| `app/components/storefront/SizeStep.tsx` | Rewrite | 4-state conditional UI: A=slider (3+ sizes), B=cards (2 sizes), C=multi-position tabs+slider, D=preview-only |
| `app/components/storefront/ReviewStep.tsx` | Rewrite | Artwork section, B2B per-size quantity steppers, gradient total bar, Add to Cart with price, back as text link |
| `app/components/storefront/PreviewSheet.tsx` | Modify | Navigation arrows as semi-transparent circles, swipe-to-dismiss on drag handle |
| `app/components/storefront/CustomizationModal.tsx` | Modify | Change quantity state from `number` to `Record<string, number>`, pass variant options to ReviewStep, step pill label change for State D |
| `app/lib/services/storefront-config.server.ts` | Modify | Fetch sibling variant sizes from Shopify, add to config response |

---

## Task 1: Icons — Add Missing Lucide-Style SVGs

**Files:**
- Modify: `app/components/storefront/icons.tsx`

This task adds the icons the design requires that don't exist yet. All icons follow the existing pattern: stroke-based, viewBox 0 0 24 24, configurable size prop.

- [ ] **Step 1: Add IconSparkles**

```tsx
// Add after IconShoppingCart (line 160)
export function IconSparkles({ size = defaults.size, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}
```

- [ ] **Step 2: Add IconMapPin (alias for IconPlacement to match Lucide naming)**

The existing `IconPlacement` is already a map-pin. Add an alias:

```tsx
export const IconMapPin = IconPlacement;
```

- [ ] **Step 3: Add IconMaximize2 (alias for IconSize)**

```tsx
export const IconMaximize2 = IconSize;
```

- [ ] **Step 4: Run checks**

```bash
npm run typecheck && npm run lint
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/storefront/icons.tsx
git commit -m "feat(storefront): add IconSparkles + Lucide aliases for design v2"
```

---

## Task 2: i18n — Add New Translation Keys

**Files:**
- Modify: `app/components/storefront/i18n.ts`

Add new keys needed by the redesigned components. English is canonical; other locales get English text with `/* TODO: translate */` markers.

- [ ] **Step 1: Add new keys to `en` locale**

Add these keys to the English translations object:

```typescript
// In upload section, add:
laterSubtitle: "We'll use a placeholder for now",
laterHelperMobile: "You can upload your logo from your order status page after checkout.",
orDivider: "or",
perPlacement: "per placement",

// In placement section, add:
included: "Included",

// In size section, add:
logoSize: "Logo size",
setSizeForPlacement: "Set the size for this placement",
chooseLogoSize: "Choose your logo size",
adjustSizePerPosition: "Adjust the size for each placement position",
previewTitle: "Preview your logo",
previewSubtitle: "Happy with the placement? Continue when ready.",
allSetTitle: "All set — logo placed successfully",
allSetBody: "Your logo has been positioned on the product. Hit Continue to review your order.",
allSetBodyMobile: "Your logo has been positioned. Tap Continue to review your order.",
preview: "Preview",

// In review section, add:
orderSummary: "Order Summary",
reviewSubtitle: "Review your customization before adding to cart",
artwork: "Artwork",
logo: "Logo",
uploadAfterPurchase: "Upload after purchase",
orderQuantities: "Order Quantities",
quantitiesBySize: "Quantities by Size",
items: "items",
total: "Total",
orderTotalLabel: "Order total",
perItem: "per item",
addToCartWithPrice: "Add to Cart",

// In footer section, add:
estimatedTotal: "Estimated total",
```

- [ ] **Step 2: Copy keys to all 7 other locales (nl, de, fr, es, it, pt, pl)**

For each locale, add the same keys with English values + `/* TODO: translate */` comments.

- [ ] **Step 3: Run checks**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add app/components/storefront/i18n.ts
git commit -m "feat(storefront): add v2 translation keys for all steps"
```

---

## Task 3: Types — Add Variant Options to StorefrontConfig

**Files:**
- Modify: `app/components/storefront/types.ts`
- Modify: `app/lib/services/storefront-config.server.ts`

The B2B per-size quantity feature needs the modal to know what size variants exist for the product. Add a `variants` array to `StorefrontConfig` and fetch it from Shopify.

- [ ] **Step 1: Add types**

In `types.ts`, add before `StorefrontConfig`:

```typescript
export type ProductVariantOption = {
  id: string;       // Shopify GID (gid://shopify/ProductVariant/...)
  title: string;    // e.g. "Small", "Medium / Blue"
  sizeLabel: string; // Extracted size option value, e.g. "S", "M", "L"
  priceCents: number;
  available: boolean;
};
```

Add to `StorefrontConfig`:

```typescript
export type StorefrontConfig = {
  // ... existing fields ...
  variants: ProductVariantOption[];
};
```

- [ ] **Step 2: Update storefront-config.server.ts — fetch sibling variants**

In `getStorefrontConfig`, extend the existing `getVariantDetails` GraphQL query to also fetch sibling variants with size options:

```graphql
query getVariantDetails($id: ID!) {
  productVariant(id: $id) {
    price
    product {
      title
      variants(first: 50) {
        nodes {
          id
          title
          price
          availableForSale
          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
}
```

Then build the `variants` array from the response:

```typescript
const variantNodes = variantData?.data?.productVariant?.product?.variants?.nodes ?? [];
const variants: ProductVariantOption[] = variantNodes.map((v) => {
  const sizeOption = v.selectedOptions?.find((o) =>
    /^size$/i.test(o.name)
  );
  return {
    id: v.id,
    title: v.title,
    sizeLabel: sizeOption?.value ?? v.title,
    priceCents: Math.round(parseFloat(v.price) * 100),
    available: v.availableForSale ?? true,
  };
});
```

Include `variants` in the returned config object.

- [ ] **Step 3: Validate GraphQL with Shopify Dev MCP**

Use `mcp__shopify-dev-mcp__validate_graphql_codeblocks` to validate the updated query.

- [ ] **Step 4: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add app/components/storefront/types.ts app/lib/services/storefront-config.server.ts
git commit -m "feat(storefront): add variant options to StorefrontConfig for B2B quantities"
```

---

## Task 4: CSS — Phase 1 (Steps 1-2 Styles)

**Files:**
- Modify: `app/components/storefront/storefront-modal.css`

Add CSS for the or-divider, redesigned method cards, method badge, and updated placement tile styles.

- [ ] **Step 1: Add or-divider styles**

```css
/* Or-divider between upload zone and logo-later card */
.insignia-or-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
.insignia-or-divider-line {
  flex: 1;
  height: 1px;
  background: var(--insignia-border);
}
.insignia-or-divider-text {
  font-size: 12px;
  color: #9CA3AF;
  font-weight: normal;
}
```

- [ ] **Step 2: Update method card styles for v2 design**

Update `.insignia-method-card` to match the design: 68px height, 14px gap, price area with "per placement" sub-label, circle-check icon for selected state, empty circle for unselected.

```css
/* Method card v2 — update existing rules */
.insignia-method-card {
  /* ... keep existing flex/border/radius ... */
  min-height: 68px;
  padding: 0 16px;
  gap: 14px;
}
.insignia-method-price-area {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.insignia-method-price-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--insignia-text);
}
.insignia-method-price-label {
  font-size: 10px;
  font-weight: normal;
  color: var(--insignia-text-secondary);
}
.insignia-method-indicator {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.insignia-method-indicator[data-selected="true"] {
  background: var(--insignia-primary);
}
.insignia-method-indicator:not([data-selected="true"]) {
  border: 1.5px solid #D1D5DB;
  background: white;
}
```

- [ ] **Step 3: Add method badge styles**

```css
/* Method badge — shown on placement step */
.insignia-method-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  background: var(--insignia-primary-light);
  border: 1px solid var(--insignia-primary);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--insignia-primary);
  margin-bottom: 4px;
}
```

- [ ] **Step 4: Update placement tile for "Included" text**

```css
.insignia-placement-tile .price[data-included="true"] {
  color: #16A34A;
  font-weight: 600;
  font-size: 12px;
}
```

- [ ] **Step 5: Add mobile method card adjustments**

In the `@media (max-width: 480px)` block:

```css
.insignia-method-card {
  min-height: 56px;
  padding: 0 14px;
}
```

- [ ] **Step 6: Add mobile helper text style**

```css
.insignia-upload-helper-text {
  font-size: 11px;
  color: var(--insignia-text-secondary);
  line-height: 1.4;
  margin-top: 4px;
}
/* Desktop: hide mobile helper text */
@media (min-width: 1024px) {
  .insignia-upload-helper-text {
    display: none;
  }
}
```

- [ ] **Step 7: Run checks**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add app/components/storefront/storefront-modal.css
git commit -m "style(storefront): add CSS for steps 1-2 v2 design"
```

---

## Task 5: CSS — Phase 2 (Step 3 Slider + States)

**Files:**
- Modify: `app/components/storefront/storefront-modal.css`

Add CSS for the range slider with tick marks, position tabs (State C), and preview-only reassurance card (State D).

- [ ] **Step 1: Add slider styles**

```css
/* Size slider — used for 3+ sizes (State A) and multi-position (State C) */
.insignia-size-slider-card {
  background: var(--insignia-bg-subtle);
  border: 1px solid var(--insignia-border);
  border-radius: var(--insignia-radius);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.insignia-size-display-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.insignia-size-display-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--insignia-text);
}
.insignia-size-display-dim {
  font-size: 14px;
  color: var(--insignia-text-secondary);
}
.insignia-size-display-price {
  font-size: 14px;
  font-weight: 600;
  color: var(--insignia-primary);
}

/* Slider track */
.insignia-slider-wrap {
  position: relative;
  height: 44px;
  touch-action: none;
  user-select: none;
}
.insignia-slider-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 6px;
  background: var(--insignia-border);
  border-radius: 3px;
  transform: translateY(-50%);
}
.insignia-slider-fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 6px;
  background: var(--insignia-primary);
  border-radius: 3px;
  transform: translateY(-50%);
  transition: width 150ms ease-out;
}
.insignia-slider-thumb {
  position: absolute;
  top: 50%;
  width: 26px;
  height: 26px;
  background: white;
  border: 2px solid var(--insignia-primary);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  cursor: grab;
  transition: left 150ms ease-out;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  z-index: 1;
}
.insignia-slider-thumb:active {
  cursor: grabbing;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
}

/* Tick marks */
.insignia-slider-ticks {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding: 0;
}
.insignia-slider-tick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  background: none;
  border: none;
  padding: 4px 8px;
}
.insignia-slider-tick-mark {
  width: 2px;
  height: 6px;
  background: #D1D5DB;
  border-radius: 1px;
}
.insignia-slider-tick[data-active="true"] .insignia-slider-tick-mark {
  background: var(--insignia-primary);
}
.insignia-slider-tick-label {
  font-size: 11px;
  font-weight: 500;
  color: #9CA3AF;
}
.insignia-slider-tick[data-active="true"] .insignia-slider-tick-label {
  color: var(--insignia-primary);
  font-weight: 700;
}
```

- [ ] **Step 2: Add position tabs for State C (multi-position)**

```css
/* Position tabs — used for multi-position sizing (State C) */
.insignia-position-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.insignia-position-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--insignia-border);
  background: white;
  color: #9CA3AF;
  cursor: pointer;
  transition: all var(--insignia-transition);
}
.insignia-position-tab[data-state="done"] {
  background: #F0FDF4;
  border-color: #16A34A;
  color: #16A34A;
  font-weight: 600;
}
.insignia-position-tab[data-state="active"] {
  background: var(--insignia-primary-light);
  border-color: var(--insignia-primary);
  color: var(--insignia-primary);
  font-weight: 700;
}
.insignia-position-tab[data-state="pending"] {
  color: #9CA3AF;
}
.insignia-position-tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--insignia-border);
}
```

- [ ] **Step 3: Add reassurance card for State D (preview only)**

```css
/* Reassurance card — State D (single size / preview only) */
.insignia-reassurance {
  background: var(--insignia-bg-subtle);
  border: 1px solid var(--insignia-border);
  border-radius: var(--insignia-radius);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.insignia-reassurance-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.insignia-reassurance-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--insignia-text);
}
.insignia-reassurance-body {
  font-size: 12px;
  color: var(--insignia-text-secondary);
  line-height: 1.4;
}
```

- [ ] **Step 4: Mobile adjustments for slider and tabs**

```css
@media (max-width: 480px) {
  .insignia-size-slider-card {
    padding: 20px;
    gap: 12px;
  }
  .insignia-size-display-name {
    font-size: 16px;
  }
  .insignia-position-tab {
    height: 30px;
    padding: 0 10px;
    font-size: 11px;
  }
}
```

- [ ] **Step 5: Run checks**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add app/components/storefront/storefront-modal.css
git commit -m "style(storefront): add CSS for step 3 slider, position tabs, and reassurance card"
```

---

## Task 6: CSS — Phase 3 (Step 4 + Preview Sheet)

**Files:**
- Modify: `app/components/storefront/storefront-modal.css`

- [ ] **Step 1: Add artwork section styles**

```css
/* Artwork section in review summary */
.insignia-review-artwork-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #FEF3C7;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #D97706;
}
```

- [ ] **Step 2: Add B2B quantity section styles**

```css
/* B2B per-size quantity section */
.insignia-qty-section {
  border: 1px solid var(--insignia-border);
  border-radius: var(--insignia-radius);
  overflow: hidden;
}
.insignia-qty-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  height: 44px;
  background: var(--insignia-bg-subtle);
}
.insignia-qty-section-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--insignia-text);
}
.insignia-qty-section-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--insignia-primary-light);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--insignia-primary);
}
.insignia-qty-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  height: 48px;
  border-top: 1px solid var(--insignia-border);
}
.insignia-qty-row-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}
.insignia-qty-row-stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--insignia-border);
  border-radius: 6px;
  overflow: hidden;
}
.insignia-qty-row-stepper .insignia-qty-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--insignia-bg-subtle);
  border: none;
  cursor: pointer;
  color: #374151;
  font-size: 14px;
}
.insignia-qty-row-stepper .insignia-qty-btn:disabled {
  color: #9CA3AF;
  cursor: default;
}
.insignia-qty-row-stepper .insignia-qty-val {
  width: 44px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--insignia-border);
  border-right: 1px solid var(--insignia-border);
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.insignia-qty-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  height: 44px;
  background: var(--insignia-bg-muted);
  border-top: 1px solid var(--insignia-border);
  font-size: 14px;
  font-weight: 700;
  color: var(--insignia-text);
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .insignia-qty-section-header {
    height: 40px;
    padding: 0 12px;
  }
  .insignia-qty-section-title {
    font-size: 13px;
  }
  .insignia-qty-row {
    height: 42px;
    padding: 0 12px;
  }
  .insignia-qty-total-row {
    height: 40px;
    padding: 0 12px;
    font-size: 13px;
  }
}
```

- [ ] **Step 3: Redesign total bar with gradient**

Replace the existing `.insignia-review-total-bar` styles:

```css
.insignia-review-total-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  height: 80px;
  background: linear-gradient(180deg, #1E3A8A 0%, #2563EB 100%);
  border-radius: var(--insignia-radius);
  margin-top: 16px;
}
.insignia-review-total-bar .label {
  font-size: 13px;
  font-weight: normal;
  color: #DBEAFE;
}
.insignia-review-total-bar .breakdown {
  font-size: 12px;
  color: #93C5FD;
  display: block;
  margin-top: 2px;
}
.insignia-review-total-bar .amount {
  font-size: 26px;
  font-weight: 700;
  color: white;
}
```

- [ ] **Step 4: Update footer "back" as text link on review step**

```css
.insignia-review-back-link {
  background: none;
  border: none;
  color: var(--insignia-text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 8px;
}
.insignia-review-back-link:hover {
  color: var(--insignia-text);
}
```

- [ ] **Step 5: Update preview sheet navigation arrows**

```css
/* Preview sheet navigation — semi-transparent circles */
.insignia-preview-sheet-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.8);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  color: #374151;
  transition: background var(--insignia-transition);
}
.insignia-preview-sheet-nav:hover {
  background: rgba(255, 255, 255, 0.95);
}
.insignia-preview-sheet-nav[data-dir="prev"] {
  left: 8px;
}
.insignia-preview-sheet-nav[data-dir="next"] {
  right: 8px;
}
```

- [ ] **Step 6: Run checks**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add app/components/storefront/storefront-modal.css
git commit -m "style(storefront): add CSS for step 4 B2B quantities, gradient total bar, and preview sheet nav"
```

---

## Task 7: UploadStep — Redesign Per v2 Design

**Files:**
- Modify: `app/components/storefront/UploadStep.tsx`

Changes:
1. Add "or" divider between upload zone and logo-later card (only when `logo.type === "none"`)
2. Redesign logo-later card: title + subtitle + chevron
3. Redesign method cards: show price with "per placement" label, circle-check/circle indicator
4. Add mobile helper text below logo-later card
5. Use `IconCloudUpload` instead of `IconUpload` in the upload zone
6. Use `IconCircleCheck` for selected method indicator

- [ ] **Step 1: Update imports**

```tsx
import { IconCheck, IconChevronRight, IconCloudUpload, IconCircleCheck } from "./icons";
```

Remove `IconScissors` and `IconUpload` imports (no longer used in this file).

- [ ] **Step 2: Redesign upload zone icon**

In the upload zone JSX, replace `<IconUpload size={32}` with `<IconCloudUpload size={32}`.

- [ ] **Step 3: Add or-divider and redesign logo-later card**

Replace the existing logo-later section (the `{!hasLogo && (` block around line 268) with:

```tsx
{/* Or-divider + Logo later — only shown when no logo */}
{logo.type === "none" && (
  <>
    <div className="insignia-or-divider">
      <div className="insignia-or-divider-line" />
      <span className="insignia-or-divider-text">{t.upload.orDivider}</span>
      <div className="insignia-or-divider-line" />
    </div>
    <button
      type="button"
      className="insignia-logo-later-card"
      onClick={onLogoLater}
    >
      <div className="insignia-logo-later-info">
        <div className="insignia-logo-later-title">{t.upload.laterTitle}</div>
        <div className="insignia-logo-later-subtitle">{t.upload.laterSubtitle}</div>
      </div>
      <IconChevronRight size={18} style={{ color: "#9CA3AF", flexShrink: 0 }} />
    </button>
    <p className="insignia-upload-helper-text">{t.upload.laterHelperMobile}</p>
  </>
)}
```

- [ ] **Step 4: Redesign method cards**

Replace the method card JSX in the `.map` block with the v2 layout:

```tsx
<button
  key={method.id}
  type="button"
  className="insignia-method-card"
  data-selected={isSelected ? "true" : undefined}
  role="radio"
  aria-checked={isSelected}
  tabIndex={0}
  onClick={() => onMethodChange(method.id)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onMethodChange(method.id);
    }
  }}
>
  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>
      {displayName}
    </div>
    {displayDescription && (
      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
        {displayDescription}
      </div>
    )}
  </div>
  <div className="insignia-method-price-area">
    <span className="insignia-method-price-value">
      +{formatCurrency(method.basePriceCents, config.currency)}
    </span>
    <span className="insignia-method-price-label">{t.upload.perPlacement}</span>
  </div>
  <div
    className="insignia-method-indicator"
    data-selected={isSelected ? "true" : undefined}
  >
    {isSelected && <IconCircleCheck size={18} style={{ color: "white" }} />}
  </div>
</button>
```

Remove the `insignia-method-icon-wrap` element and `IconScissors` — no longer in design.

- [ ] **Step 5: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add app/components/storefront/UploadStep.tsx
git commit -m "feat(storefront): redesign UploadStep — or-divider, method cards v2, mobile helper text"
```

---

## Task 8: PlacementStep — Add Method Badge + "Included" Text

**Files:**
- Modify: `app/components/storefront/PlacementStep.tsx`

Changes:
1. Add method badge showing selected decoration method name with sparkles icon
2. Replace "+$0.00" with "Included" (green) for selected zero-cost placements
3. Update step heading text to match design

- [ ] **Step 1: Accept new props**

Add `selectedMethodId` to `PlacementStepProps`:

```tsx
type PlacementStepProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  onPlacementSelectionsChange: (s: PlacementSelections) => void;
  onContinue: () => void;
  selectedMethodId: string | null;  // NEW
  t: TranslationStrings;
};
```

Update the destructured params accordingly. Also update `CustomizationModal.tsx` to pass `selectedMethodId` to `<PlacementStep>`.

- [ ] **Step 2: Add method badge JSX**

After the step heading, add:

```tsx
{/* Method badge */}
{selectedMethodId && (
  <div className="insignia-method-badge">
    <IconSparkles size={14} />
    <span>{config.methods.find(m => m.id === selectedMethodId)?.name ?? ""}</span>
  </div>
)}
```

Import `IconSparkles` from `./icons`.

- [ ] **Step 3: Update placement tile price display**

Change the `priceText` logic and the price element:

```tsx
const selected = placementSelections[p.id] !== undefined;
const isIncluded = selected && p.basePriceAdjustmentCents === 0;
const priceText = isIncluded ? t.placement.included : `+${fmt(p.basePriceAdjustmentCents)}`;

// In JSX:
<div className="price" data-included={isIncluded ? "true" : undefined}>
  {priceText}
</div>
```

- [ ] **Step 4: Update step heading text**

```tsx
<p className="insignia-step-heading-title">{t.placement.title}</p>
<p className="insignia-step-heading-sub">{t.placement.subtitle}</p>
```

Ensure `placement.title` is "Where to place your logo" and `placement.subtitle` is "Select one or more placement locations" in i18n (update if different from current values).

- [ ] **Step 5: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add app/components/storefront/PlacementStep.tsx app/components/storefront/CustomizationModal.tsx
git commit -m "feat(storefront): add method badge and Included text to PlacementStep"
```

---

## Task 9: SizeStep — Rewrite with 4 Conditional States

**Files:**
- Modify: `app/components/storefront/SizeStep.tsx`

This is the most complex visual change. The step 3 UI now has four states:

| State | Condition | UI |
|-------|-----------|------|
| A | 1 position, 3+ sizes | Slider with tick marks |
| B | 1 position, 2 sizes | Radio cards (existing style) |
| C | 2+ positions | Position tabs + slider per position |
| D | all positions have ≤1 size | Preview-only reassurance card (auto-skips if ALL ≤1) |

- [ ] **Step 1: Determine the current state**

Add state detection logic at the top of the component:

```tsx
type SizeState = "slider" | "cards" | "multi" | "preview";

function getSizeState(
  selectedPlacements: typeof selectedPlacementIds,
  allSingle: boolean
): SizeState {
  if (allSingle) return "preview";
  if (selectedPlacements.length > 1) return "multi";
  const stepCount = selectedPlacements[0]?.steps.length ?? 0;
  if (stepCount === 2) return "cards";
  return "slider"; // 3+
}
```

- [ ] **Step 2: Build the slider sub-component**

Create a local `SizeSlider` component inside `SizeStep.tsx`:

```tsx
function SizeSlider({
  steps,
  activeIndex,
  onIndexChange,
  currency,
}: {
  steps: PlacementStep[];
  activeIndex: number;
  onIndexChange: (i: number) => void;
  currency: string;
}) {
  const fillPercent = steps.length <= 1 ? 0 : (activeIndex / (steps.length - 1)) * 100;
  const thumbPercent = fillPercent;

  return (
    <div className="insignia-size-slider-card">
      <div className="insignia-size-display-row">
        <span className="insignia-size-display-name">{steps[activeIndex]?.label}</span>
        <span className="insignia-size-display-dim">
          {steps[activeIndex]?.scaleFactor}x
        </span>
        {steps[activeIndex]?.priceAdjustmentCents !== 0 && (
          <span className="insignia-size-display-price">
            +{formatCurrency(steps[activeIndex].priceAdjustmentCents, currency)}
          </span>
        )}
      </div>

      {/* Slider track */}
      <div
        className="insignia-slider-wrap"
        role="slider"
        aria-valuenow={activeIndex}
        aria-valuemin={0}
        aria-valuemax={steps.length - 1}
        aria-label="Logo size"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onIndexChange(Math.min(activeIndex + 1, steps.length - 1));
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onIndexChange(Math.max(activeIndex - 1, 0));
          }
        }}
      >
        <div className="insignia-slider-track" />
        <div className="insignia-slider-fill" style={{ width: `${fillPercent}%` }} />
        <div
          className="insignia-slider-thumb"
          style={{ left: `${thumbPercent}%` }}
        />
      </div>

      {/* Tick marks */}
      <div className="insignia-slider-ticks">
        {steps.map((step, i) => (
          <button
            key={i}
            type="button"
            className="insignia-slider-tick"
            data-active={i === activeIndex ? "true" : undefined}
            onClick={() => onIndexChange(i)}
            aria-label={step.label}
          >
            <div className="insignia-slider-tick-mark" />
            <span className="insignia-slider-tick-label">
              {step.label.charAt(0).toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Important**: Also add pointer/touch drag support to the slider track. Use `onPointerDown` on the track wrapper to calculate the nearest tick index from the pointer position:

```tsx
const sliderRef = useRef<HTMLDivElement>(null);
const handlePointerDown = (e: React.PointerEvent) => {
  const rect = sliderRef.current?.getBoundingClientRect();
  if (!rect) return;
  const onPointerMove = (moveEvent: PointerEvent) => {
    const x = moveEvent.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const idx = Math.round(pct * (steps.length - 1));
    onIndexChange(idx);
  };
  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  };
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  // Initial click position
  const x = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  onIndexChange(Math.round(pct * (steps.length - 1)));
};
```

Add `ref={sliderRef}` and `onPointerDown={handlePointerDown}` to the `.insignia-slider-wrap` div.

- [ ] **Step 3: Build position tabs for State C**

In the main `SizeStep` return, when `sizeState === "multi"`:

```tsx
{/* Position tabs */}
<div className="insignia-position-tabs">
  {selectedPlacementIds.map((p, i) => {
    const isDone = i < currentPlacementIndex;
    const isActive = i === currentPlacementIndex;
    const state = isDone ? "done" : isActive ? "active" : "pending";
    return (
      <button
        key={p.id}
        type="button"
        className="insignia-position-tab"
        data-state={state}
        onClick={() => setCurrentPlacementIndex(i)}
      >
        {isDone && <IconCheck size={14} />}
        {isActive && <IconMapPin size={14} />}
        {!isDone && !isActive && <div className="insignia-position-tab-dot" />}
        <span>{p.name}</span>
      </button>
    );
  })}
</div>

{/* Slider for current position */}
{currentPlacement.steps.length >= 2 && (
  <SizeSlider
    steps={currentPlacement.steps}
    activeIndex={stepIndex}
    onIndexChange={setStepIndex}
    currency={config.currency}
  />
)}
```

- [ ] **Step 4: Build reassurance card for State D**

```tsx
{/* State D: Preview only — reassurance card */}
{sizeState === "preview" && currentPlacement && (
  <>
    <div className="insignia-position-badge">
      <IconMapPin size={14} />
      <span>{t.size.position} 1 {t.size.of} 1 · {currentPlacement.name}</span>
    </div>
    <div className="insignia-reassurance">
      <div className="insignia-reassurance-top">
        <IconCircleCheck size={16} style={{ color: "var(--insignia-primary)" }} />
        <span className="insignia-reassurance-title">{t.size.allSetTitle}</span>
      </div>
      <p className="insignia-reassurance-body">{t.size.allSetBody}</p>
    </div>
  </>
)}
```

- [ ] **Step 5: Wire up the main render with state switching**

Restructure the component return to use `sizeState`:

```tsx
const sizeState = getSizeState(selectedPlacementIds, allSingle);

return (
  <section aria-labelledby="size-heading">
    <h2 id="size-heading" className="visually-hidden">{t.size.sizeLabel}</h2>

    <div className="insignia-step-heading">
      <p className="insignia-step-heading-title">
        {sizeState === "preview" ? t.size.previewTitle : t.size.logoSize}
      </p>
      <p className="insignia-step-heading-sub">
        {sizeState === "preview" ? t.size.previewSubtitle
         : sizeState === "multi" ? t.size.adjustSizePerPosition
         : sizeState === "cards" ? t.size.chooseLogoSize
         : t.size.setSizeForPlacement}
      </p>
    </div>

    {/* Position badge for single-position states */}
    {sizeState !== "multi" && selectedPlacementIds.length <= 1 && (
      <div className="insignia-position-badge">
        <IconMapPin size={14} />
        <span>{t.size.position} 1 {t.size.of} 1 · {currentPlacement.name}</span>
      </div>
    )}

    {sizeState === "slider" && (
      <SizeSlider steps={currentPlacement.steps} activeIndex={stepIndex} onIndexChange={setStepIndex} currency={config.currency} />
    )}

    {sizeState === "cards" && (
      /* Keep existing card UI from current code, wrapped in insignia-size-cards */
      <div className="insignia-size-cards" role="group" aria-label={t.size.sizeLabel}>
        {currentPlacement.steps.map((step, i) => {
          const isSelected = i === stepIndex;
          return (
            <button key={i} type="button"
              className={`insignia-size-card${isSelected ? " insignia-size-card--selected" : ""}`}
              onClick={() => setStepIndex(i)}
              aria-pressed={isSelected}
            >
              <div className="insignia-size-card-info">
                <span className="insignia-size-card-name">{step.label}</span>
                <span style={{ fontSize: 12, color: isSelected ? "var(--insignia-primary)" : "#6B7280" }}>
                  {step.scaleFactor}x{step.priceAdjustmentCents === 0 ? " · No extra charge" : ` · +${formatCurrency(step.priceAdjustmentCents, config.currency)}`}
                </span>
              </div>
              <div className="insignia-method-indicator" data-selected={isSelected ? "true" : undefined}>
                {isSelected && <IconCheck size={12} style={{ color: "white" }} />}
              </div>
            </button>
          );
        })}
      </div>
    )}

    {sizeState === "multi" && (
      /* Position tabs + slider rendered above */
    )}

    {sizeState === "preview" && (
      /* Reassurance card rendered above */
    )}
  </section>
);
```

- [ ] **Step 6: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add app/components/storefront/SizeStep.tsx
git commit -m "feat(storefront): rewrite SizeStep with 4 states — slider, cards, multi-position tabs, preview-only"
```

---

## Task 10: ReviewStep — Rewrite with B2B Quantities + Artwork

**Files:**
- Modify: `app/components/storefront/ReviewStep.tsx`
- Modify: `app/components/storefront/CustomizationModal.tsx`

This task:
1. Adds artwork section with "Upload after purchase" badge
2. Replaces single quantity stepper with per-size B2B quantity section
3. Redesigns total bar with gradient background
4. Changes "Add to Cart" button to green with cart icon + price
5. Changes "Back" to text link
6. Updates footer breakdown text

- [ ] **Step 1: Change quantity state in CustomizationModal**

In `CustomizationModal.tsx`, change the quantity state from `number` to `Record<string, number>`:

```tsx
// Replace: const [quantity, setQuantity] = useState(1);
// With:
const [quantities, setQuantities] = useState<Record<string, number>>(() => {
  // Initialize with 0 for each variant, except the current variant gets 1
  if (!config) return {};
  const init: Record<string, number> = {};
  for (const v of config.variants) {
    init[v.id] = v.id === `gid://shopify/ProductVariant/${variantId}` ? 1 : 0;
  }
  return init;
});
```

Update the `totalQuantity` calculation:

```tsx
const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);
```

Pass `quantities` and `setQuantities` to `ReviewStep` instead of `quantity` and `onQuantityChange`.

- [ ] **Step 2: Update ReviewStep props**

```tsx
type ReviewStepProps = {
  config: StorefrontConfig;
  selectedMethodId: string;
  placementSelections: PlacementSelections;
  logo: LogoState;
  quantities: Record<string, number>;        // NEW — per variant
  onQuantitiesChange: (q: Record<string, number>) => void;  // NEW
  // ... rest unchanged
};
```

- [ ] **Step 3: Add artwork section to summary card**

After the CUSTOMIZATIONS section, add:

```tsx
{/* ARTWORK section */}
<div className="insignia-review-divider" />
<span className="insignia-review-section-label">{t.review.artwork}</span>
<div className="insignia-review-line">
  <span className="insignia-review-line-name">{t.review.logo}</span>
  {logo.type === "later" ? (
    <span className="insignia-review-artwork-badge">
      {t.review.uploadAfterPurchase}
    </span>
  ) : (
    <span className="insignia-review-line-price">✓</span>
  )}
</div>
```

- [ ] **Step 4: Build per-size quantity section**

Replace the old quantity stepper with:

```tsx
{/* B2B per-size quantities */}
<div className="insignia-qty-section">
  <div className="insignia-qty-section-header">
    <span className="insignia-qty-section-title">{t.review.orderQuantities}</span>
    <span className="insignia-qty-section-badge">
      {totalQuantity} {t.review.items}
    </span>
  </div>
  {config.variants.map((variant) => {
    const qty = quantities[variant.id] ?? 0;
    return (
      <div key={variant.id} className="insignia-qty-row">
        <span className="insignia-qty-row-label">{variant.sizeLabel}</span>
        <div className="insignia-qty-row-stepper">
          <button
            type="button"
            className="insignia-qty-btn"
            disabled={qty <= 0}
            onClick={() => onQuantitiesChange({ ...quantities, [variant.id]: Math.max(0, qty - 1) })}
            aria-label={`Decrease ${variant.sizeLabel}`}
          >
            −
          </button>
          <div className="insignia-qty-val">{qty}</div>
          <button
            type="button"
            className="insignia-qty-btn"
            onClick={() => onQuantitiesChange({ ...quantities, [variant.id]: qty + 1 })}
            aria-label={`Increase ${variant.sizeLabel}`}
          >
            +
          </button>
        </div>
      </div>
    );
  })}
  <div className="insignia-qty-total-row">
    <span>{t.review.total}</span>
    <span>{totalQuantity} {t.review.items}</span>
  </div>
</div>
```

- [ ] **Step 5: Update total bar**

```tsx
<div className="insignia-review-total-bar">
  <div>
    <span className="label">{t.review.orderTotalLabel}</span>
    <span className="breakdown">
      {totalQuantity} × ({fmt(baseProductPriceCents)} + {fmt(totalFeeCents)} custom)
    </span>
  </div>
  <span className="amount">{fmt(totalCents)}</span>
</div>
```

- [ ] **Step 6: Update footer actions**

```tsx
<div className="insignia-review-actions">
  <button type="button" className="insignia-review-back-link" onClick={onBack}>
    ← {t.review.btnBack}
  </button>
  <button
    type="button"
    className="insignia-btn insignia-btn-success"
    disabled={totalQuantity < 1 || submitLoading || !priceResult?.validation?.ok}
    onClick={() => onPrepareAndAddToCart()}
  >
    <IconShoppingCart size={16} />
    <span>{submitLoading ? "Adding…" : `${t.review.addToCartWithPrice} — ${fmt(totalCents)}`}</span>
  </button>
</div>
```

Import `IconShoppingCart` from `./icons`.

- [ ] **Step 7: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add app/components/storefront/ReviewStep.tsx app/components/storefront/CustomizationModal.tsx
git commit -m "feat(storefront): redesign ReviewStep — B2B per-size quantities, artwork section, gradient total bar"
```

---

## Task 11: CustomizationModal — Step Pill Label Change for State D

**Files:**
- Modify: `app/components/storefront/CustomizationModal.tsx`

When ALL selected placements have ≤1 step (State D), the "Size" step pill should show "Preview" label with eye icon.

- [ ] **Step 1: Update step pill rendering**

In the step pills `<nav>`, find where step icons/labels are rendered. The current code already has partial support for this (checking `allSingle`). Update:

```tsx
const allSingle = config.placements
  .filter((p) => placementSelections[p.id] !== undefined)
  .every((p) => p.steps.length <= 1);

// In the step pills map:
const stepLabel = s.id === "size" && allSingle ? t.size.preview : t.steps[s.id];
const StepIcon = s.id === "size" && allSingle ? IconPreview : stepIcons[s.id];
```

- [ ] **Step 2: Run checks**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add app/components/storefront/CustomizationModal.tsx
git commit -m "feat(storefront): step pill shows Preview label/icon for single-size placements"
```

---

## Task 12: PreviewSheet — Navigation Redesign + Swipe-to-Dismiss

**Files:**
- Modify: `app/components/storefront/PreviewSheet.tsx`

Changes:
1. Navigation arrows become semi-transparent white circles positioned over the canvas
2. Add swipe-to-dismiss on the drag handle

- [ ] **Step 1: Update navigation button styling**

The CSS was already added in Task 6. Update the JSX to use the new class and position the buttons inside the preview area (`.insignia-preview-sheet-area`), not outside it:

```tsx
<div className="insignia-preview-sheet-area" style={{ position: "relative" }}>
  <NativeCanvas ... />

  {viewableViews.length > 1 && (
    <>
      <button
        type="button"
        className="insignia-preview-sheet-nav"
        data-dir="prev"
        disabled={currentIndex === 0}
        onClick={() => setCurrentIndex(i => i - 1)}
        aria-label="Previous view"
      >
        <IconChevronLeft size={18} />
      </button>
      <button
        type="button"
        className="insignia-preview-sheet-nav"
        data-dir="next"
        disabled={currentIndex === viewableViews.length - 1}
        onClick={() => setCurrentIndex(i => i + 1)}
        aria-label="Next view"
      >
        <IconChevronRight size={18} />
      </button>
    </>
  )}

  {/* Dot indicators */}
  {viewableViews.length > 1 && (
    <div className="insignia-preview-sheet-dots">
      {viewableViews.map((_, i) => (
        <button
          key={i}
          className="insignia-preview-sheet-dot"
          data-active={i === currentIndex ? "true" : undefined}
          onClick={() => setCurrentIndex(i)}
          aria-label={`View ${i + 1}`}
        />
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 2: Add swipe-to-dismiss on drag handle**

Add pointer event handling to the drag handle:

```tsx
const sheetRef = useRef<HTMLDivElement>(null);
const [dragY, setDragY] = useState(0);
const [isDragging, setIsDragging] = useState(false);

const handleDragStart = (e: React.PointerEvent) => {
  setIsDragging(true);
  const startY = e.clientY;
  const onMove = (moveEvent: PointerEvent) => {
    const delta = Math.max(0, moveEvent.clientY - startY);
    setDragY(delta);
  };
  const onUp = (upEvent: PointerEvent) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    const delta = upEvent.clientY - startY;
    setIsDragging(false);
    if (delta > 150) {
      // Dismiss threshold
      onClose();
    }
    setDragY(0);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
};

// Apply to the sheet element:
<div
  ref={sheetRef}
  className="insignia-preview-sheet"
  style={isDragging ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
>
  <div
    className="insignia-preview-sheet-handle-wrap"
    onPointerDown={handleDragStart}
    style={{ touchAction: "none", cursor: "grab" }}
  >
    <div className="insignia-preview-sheet-handle" />
  </div>
  ...
</div>
```

- [ ] **Step 3: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add app/components/storefront/PreviewSheet.tsx
git commit -m "feat(storefront): preview sheet nav circles + swipe-to-dismiss"
```

---

## Task 13: Integration — Cart Addition for Multiple Variants

**Files:**
- Modify: `app/components/storefront/CustomizationModal.tsx`

The B2B quantity feature means the cart addition needs to handle multiple variants. Currently, `prepareAndAddToCart` calls `/prepare` once and adds one item. With per-size quantities, it needs to call `/prepare` for each variant with qty > 0 and add multiple items.

- [ ] **Step 1: Update prepareAndAddToCart**

```tsx
const prepareAndAddToCart = async () => {
  setSubmitLoading(true);
  setSubmitError(null);
  try {
    // Filter to variants with qty > 0
    const activeVariants = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, qty]) => ({ variantId, qty }));

    if (activeVariants.length === 0) return;

    // Save draft and get price first (if not already done)
    if (!priceResult) {
      await saveDraftAndPrice();
    }

    // Prepare each variant
    const items: Array<{ variantId: string; quantity: number; properties: Record<string, string> }> = [];
    for (const { variantId: vId, qty } of activeVariants) {
      const prepRes = await fetch(proxyUrl("/apps/insignia/prepare"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customizationId,
          variantId: vId,
        }),
      });
      if (!prepRes.ok) throw new Error("Failed to prepare order");
      const prepData = await prepRes.json();
      const props = buildInsigniaProperties(prepData);
      items.push({ variantId: prepData.slotVariantId, quantity: qty, properties: props });
    }

    // Add all items to cart
    await addCustomizedToCart(items);

    // Confirm
    for (const item of items) {
      await fetch(proxyUrl("/apps/insignia/cart-confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customizationId, slotVariantId: item.variantId }),
      });
    }

    // Redirect to cart
    window.location.href = "/cart";
  } catch (e) {
    setSubmitError(e instanceof Error ? e.message : "Something went wrong");
  } finally {
    setSubmitLoading(false);
  }
};
```

- [ ] **Step 2: Update addCustomizedToCart to accept multiple items**

This function currently adds a single item. Update it to batch-add:

```tsx
async function addCustomizedToCart(
  items: Array<{ variantId: string; quantity: number; properties: Record<string, string> }>
) {
  const payload = {
    items: items.map((item) => ({
      id: item.variantId.replace("gid://shopify/ProductVariant/", ""),
      quantity: item.quantity,
      properties: item.properties,
    })),
  };
  const res = await fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to add to cart");
}
```

- [ ] **Step 3: Run checks**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add app/components/storefront/CustomizationModal.tsx
git commit -m "feat(storefront): multi-variant cart addition for B2B per-size quantities"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run full check suite**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
All must pass.

- [ ] **Step 2: Start dev server and visual verification**

```bash
pg_ctl -D "$(scoop prefix postgresql)/data" start
npx shopify app dev --config insignia-demo
```

Open the storefront modal in Chrome and verify:
- Desktop (1280px+): all 4 steps render correctly
- Mobile (390px): all 4 steps render correctly
- Step 3 slider: tick marks clickable, thumb draggable, keyboard arrows work
- Step 4 per-size steppers: increment/decrement, total updates
- Preview sheet: swipe-to-dismiss, navigation arrows
- Add to Cart: button shows price, adds correct items

- [ ] **Step 3: Commit any fixes**

- [ ] **Step 4: Final commit with all changes verified**

```bash
git add -A
git commit -m "chore(storefront): final v2 design verification and cleanup"
```
