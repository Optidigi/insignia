# Phase 2: Storefront Modal Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish 6 storefront UX issues: quantity selector cards, method card spacing, theme editor button visibility, dynamic canvas sizing, view auto-switching at size step, and placement step pricing.

**Architecture:** All changes target storefront components (custom CSS, no Polaris), the theme extension (Liquid), and the NativeCanvas (HTML5 Canvas). The storefront uses `--insignia-*` CSS custom properties and custom class names.

**Tech Stack:** React 18, HTML5 Canvas, Liquid (theme extension), CSS custom properties

---

## File Map

| Task | Files Modified |
|------|---------------|
| 1 (Qty cards) | `app/components/storefront/ReviewStep.tsx`, `storefront-modal.css` |
| 2 (Method gap) | `app/components/storefront/UploadStep.tsx`, `storefront-modal.css` |
| 3 (Theme button) | `extensions/insignia-theme/blocks/customize-button.liquid` |
| 4 (Canvas size) | `app/components/storefront/NativeCanvas.tsx` |
| 5 (View switch) | `app/components/storefront/SizeStep.tsx`, `app/components/storefront/SizePreview.tsx` |
| 6 (Pricing fix) | `app/components/storefront/CustomizationModal.tsx` |

---

### Task 1: Quantity selectors as responsive cards (Tweak 9)

**Files:**
- Modify: `app/components/storefront/ReviewStep.tsx:189-239`
- Modify: `app/components/storefront/storefront-modal.css:1697-1790`

**Problem:** Per-size quantity selectors are full-width rows, making the section very long (especially on mobile). Need card/box layout, max 3 per row.

- [ ] **Step 1: Replace row layout with card grid in ReviewStep.tsx**

Replace the `sizeVariants.map` block (lines 199-228) with a card grid layout:

```tsx
<div className="insignia-qty-grid">
  {sizeVariants.map((variant) => {
    const qty = quantities[variant.id] ?? 0;
    const unavailable = !variant.available;
    return (
      <div
        key={variant.id}
        className="insignia-qty-card"
        data-unavailable={unavailable ? "true" : undefined}
        data-active={qty > 0 ? "true" : undefined}
      >
        <span className="insignia-qty-card-label">
          {variant.sizeLabel}
        </span>
        {unavailable ? (
          <span className="insignia-qty-card-sold-out">{t.review.soldOut ?? "Sold out"}</span>
        ) : (
          <div className="insignia-qty-card-stepper">
            <button
              type="button"
              className="insignia-qty-btn"
              disabled={qty <= 0}
              onClick={() => setQty(variant.id, qty - 1)}
              aria-label={`Decrease ${variant.sizeLabel}`}
            >
              −
            </button>
            <span className="insignia-qty-card-val">{qty}</span>
            <button
              type="button"
              className="insignia-qty-btn"
              disabled={qty >= 999}
              onClick={() => setQty(variant.id, qty + 1)}
              aria-label={`Increase ${variant.sizeLabel}`}
            >
              +
            </button>
          </div>
        )}
      </div>
    );
  })}
</div>
```

Check `app/components/storefront/i18n.ts` — if `review.soldOut` doesn't exist, add it to all locales.

- [ ] **Step 2: Replace row CSS with card grid CSS**

In `storefront-modal.css`, replace the `.insignia-qty-row` block and add new card grid styles. Keep the `.insignia-qty-section`, `.insignia-qty-section-header`, `.insignia-qty-section-badge`, and `.insignia-qty-total-row` rules. Replace `.insignia-qty-row`, `.insignia-qty-row-label`, `.insignia-qty-row-stepper`, `.insignia-qty-btn`, `.insignia-qty-val` with:

```css
/* Quantity card grid — 3 per row desktop, 2 per row mobile */
.insignia-qty-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
}

@media (max-width: 480px) {
  .insignia-qty-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.insignia-qty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border: 1px solid var(--insignia-border);
  border-radius: var(--insignia-radius);
  background: var(--insignia-bg);
  transition: border-color var(--insignia-transition), background var(--insignia-transition);
}

.insignia-qty-card[data-active="true"] {
  border-color: var(--insignia-primary);
  background: var(--insignia-primary-light);
}

.insignia-qty-card[data-unavailable="true"] {
  opacity: 0.5;
  pointer-events: none;
}

.insignia-qty-card-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--insignia-text);
  text-align: center;
}

.insignia-qty-card-sold-out {
  font-size: 11px;
  color: #9CA3AF;
}

.insignia-qty-card-stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--insignia-border);
  border-radius: 6px;
  overflow: hidden;
}

.insignia-qty-card-stepper .insignia-qty-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--insignia-bg-subtle);
  border: none;
  cursor: pointer;
  color: #374151;
  font-size: 14px;
  padding: 0;
}

.insignia-qty-card-stepper .insignia-qty-btn:disabled {
  color: #9CA3AF;
  cursor: default;
}

.insignia-qty-card-stepper .insignia-qty-btn:hover:not(:disabled) {
  background: var(--insignia-bg-muted);
}

.insignia-qty-card-val {
  width: 36px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--insignia-border);
  border-right: 1px solid var(--insignia-border);
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  background: white;
}
```

- [ ] **Step 3: Run checks and commit**

Run: `npm run typecheck && npm run lint`
Commit: `fix(storefront): redesign qty selectors as responsive card grid`

---

### Task 2: Method card spacing (Tweak 10)

**Files:**
- Modify: `app/components/storefront/UploadStep.tsx:303`
- Modify: `app/components/storefront/storefront-modal.css` (`.insignia-method-card`)

**Problem:** Method cards in the radiogroup have no gap — they're visually glued together.

- [ ] **Step 1: Add flex column with gap to the radiogroup wrapper**

In `UploadStep.tsx`, line 303, change:
```tsx
<div role="radiogroup" aria-label="Decoration method">
```
to:
```tsx
<div role="radiogroup" aria-label="Decoration method" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
```

- [ ] **Step 2: Run checks and commit**

Run: `npm run typecheck && npm run lint`
Commit: `fix(storefront): add 10px gap between decoration method cards`

---

### Task 3: Theme editor button always visible (Tweak 12)

**Files:**
- Modify: `extensions/insignia-theme/blocks/customize-button.liquid`

**Problem:** The button is invisible in theme editor preview because the `{% if %}` on line 10 checks `product.metafields.insignia.enabled == "true"`. In theme editor preview, metafields may not be set. The `{% elsif request.design_mode %}` fallback exists but needs the `<style>` block too.

- [ ] **Step 1: Move the `<style>` block outside the condition**

Restructure the Liquid so the custom styles are rendered in BOTH production AND design mode. The simplest fix: move the `<style>` block to always render (not inside the conditional), and add `request.design_mode` to the main condition.

Replace the entire file content. The key change: line 10 becomes `{% if product and product.selected_or_first_available_variant and (product.metafields.insignia.enabled == "true" or request.design_mode) %}`. This removes the need for the separate `{% elsif request.design_mode %}` branch entirely — the production button renders in both production and preview, using the same `<style>` block. In design mode, the `href` is set to `#` with an `onclick="event.preventDefault();"` to prevent navigation.

```liquid
{% if product and product.selected_or_first_available_variant and (product.metafields.insignia.enabled == "true" or request.design_mode) %}
  {% assign product_numeric_id = product.id | split: '/' | last %}
  {% assign variant_numeric_id = product.selected_or_first_available_variant.id | split: '/' | last %}
  {% assign modal_url = '/apps/insignia/modal?p=' | append: product_numeric_id | append: '&v=' | append: variant_numeric_id %}

  <div class="insignia-customize-block" {{ block.shopify_attributes }}>
    <a
      href="{% if request.design_mode %}#{% else %}{{ modal_url }}{% endif %}"
      class="insignia-customize-button {% if block.settings.use_theme_style %}button btn{% endif %} {{ block.settings.custom_class }}"
      data-insignia-modal
      data-product-id="{{ product_numeric_id }}"
      data-variant-id="{{ variant_numeric_id }}"
      {% if block.settings.custom_id != blank %}id="{{ block.settings.custom_id }}"{% endif %}
      {% if request.design_mode %}onclick="event.preventDefault();"{% endif %}
    >
      {{ block.settings.button_label }}
    </a>
  </div>

  <style>
    /* ... existing style block unchanged ... */
  </style>
{% endif %}
```

Remove the old `{% elsif request.design_mode %}` branch entirely.

- [ ] **Step 2: Validate with Shopify Dev MCP**

Run: `mcp__shopify-dev-mcp__validate_theme` on the modified file.

- [ ] **Step 3: Run checks and commit**

Commit: `fix(theme): button always visible in theme editor preview`

---

### Task 4: Dynamic canvas sizing based on image (Tweak 13)

**Files:**
- Modify: `app/components/storefront/NativeCanvas.tsx:24-25,65-80,195-202`

**Problem:** Canvas uses fixed 440×560 dimensions. Should dynamically size based on the loaded product image's aspect ratio.

- [ ] **Step 1: Replace fixed constants with dynamic sizing**

In `NativeCanvas.tsx`:

1. Remove the fixed constants `CANVAS_W = 440` and `CANVAS_H = 560`.
2. Add a `MAX_CANVAS_DIM = 560` constant (maximum dimension in either direction).
3. Add state for dynamic canvas dimensions:

```typescript
const [canvasDims, setCanvasDims] = useState({ w: 440, h: 560 });
```

4. In the `img.onload` callback (around line 47), compute dimensions from the image's natural size:

```typescript
img.onload = () => {
  if (cancelled) return;
  productImgRef.current = img;
  // Compute canvas dimensions from image aspect ratio
  const aspect = img.naturalWidth / img.naturalHeight;
  let w: number, h: number;
  if (aspect >= 1) {
    // Landscape or square
    w = MAX_CANVAS_DIM;
    h = Math.round(MAX_CANVAS_DIM / aspect);
  } else {
    // Portrait
    h = MAX_CANVAS_DIM;
    w = Math.round(MAX_CANVAS_DIM * aspect);
  }
  setCanvasDims({ w, h });
  setLoaded(true);
  setError(false);
};
```

5. In the `draw` function, use `canvas.width` and `canvas.height` (which will be the dynamic values).

6. In the JSX, use dynamic dimensions:

```tsx
<canvas
  ref={canvasRef}
  width={canvasDims.w}
  height={canvasDims.h}
  className={className}
  style={{ maxWidth: "100%", height: "auto", borderRadius: "12px" }}
/>
```

7. Update the error/loading fallback containers to use `canvasDims` too.

- [ ] **Step 2: Run checks and commit**

Run: `npm run typecheck && npm run lint`
Commit: `feat(storefront): dynamic canvas sizing based on product image dimensions`

---

### Task 5: Auto-switch view at size step based on placement (Tweak 11)

**Files:**
- Modify: `app/components/storefront/SizeStep.tsx:237-238`
- Modify: `app/components/storefront/SizePreview.tsx:36-42`

**Problem:** When configuring a print area that belongs to the "Back" view, the canvas stays on whatever view was previously shown. It should auto-switch.

- [ ] **Step 1: Add `activeViewId` prop to SizePreview**

In `SizePreview.tsx`, add an optional `activeViewId?: string` prop. When provided and different from the current view, auto-switch to it:

```typescript
// After the viewIndex state declaration
useEffect(() => {
  if (!activeViewId) return;
  const idx = availableViews.findIndex((v) => v.id === activeViewId);
  if (idx !== -1 && idx !== viewIndex) {
    setViewIndex(idx);
  }
}, [activeViewId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Determine the correct view for the current placement in SizeStep**

In `SizeStep.tsx`, after `currentPlacement` is determined (line 238), derive the active view:

```typescript
// Find the view that contains geometry for the current placement
const activeViewId = useMemo(() => {
  if (!currentPlacement) return undefined;
  const viewIds = Object.keys(currentPlacement.geometryByViewId);
  // Return the first view with geometry for this placement
  return viewIds[0];
}, [currentPlacement]);
```

- [ ] **Step 3: Pass activeViewId to SizePreview**

In SizeStep.tsx, wherever `<SizePreview>` is rendered, add the `activeViewId` prop:

```tsx
<SizePreview
  config={config}
  placementSelections={placementSelections}
  logoUrl={logoUrl}
  sizeMultiplier={sizeMultiplier}
  showTabs
  activeViewId={activeViewId}
/>
```

Do this for ALL `<SizePreview>` instances in SizeStep (there may be multiple — desktop panel and mobile carousel).

- [ ] **Step 4: Run checks and commit**

Run: `npm run typecheck && npm run lint`
Commit: `feat(storefront): auto-switch view at size step based on placement`

---

### Task 6: Fix placement step pricing (Tweak 14)

**Files:**
- Modify: `app/components/storefront/CustomizationModal.tsx:162-169`

**Problem:** The footer `estimatedTotal` at the placement step includes size-step price (`pStep?.priceAdjustmentCents`). At the placement step, only placement base prices should be counted. Size pricing should only appear from the size step onward.

- [ ] **Step 1: Conditionally exclude step price at placement step**

In `CustomizationModal.tsx`, around line 162-169, change the `estimatedTotal` calculation:

```typescript
const estimatedTotal = (config?.baseProductPriceCents ?? 0)
  + (selectedMethod?.basePriceCents ?? 0)
  + Object.keys(placementSelections).reduce((sum, pid) => {
      const p = config?.placements.find(x => x.id === pid);
      const stepIdx = placementSelections[pid];
      const pStep = p?.steps[stepIdx];
      const placementPrice = p?.basePriceAdjustmentCents ?? 0;
      // Only include size-step price from the size step onward
      const stepPrice = (step === "size" || step === "review")
        ? (pStep?.priceAdjustmentCents ?? 0)
        : 0;
      return sum + placementPrice + stepPrice;
    }, 0);
```

- [ ] **Step 2: Run checks and commit**

Run: `npm run typecheck && npm run lint`
Commit: `fix(storefront): exclude size pricing from placement step total`

---

## Phase 2 Completion Checklist

After all 6 tasks:

- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS
- [ ] Run `npx vitest run` — PASS (45/45)
- [ ] Run `npm run build` — PASS
- [ ] Validate theme extension: `mcp__shopify-dev-mcp__validate_theme`
- [ ] Visual verification of storefront modal (all 4 steps)
- [ ] Visual verification of theme editor preview (button visible)
- [ ] **STOP and wait for user approval before Phase 3**
