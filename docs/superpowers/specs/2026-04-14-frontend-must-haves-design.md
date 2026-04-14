# Frontend Must-Haves — Design Spec

> **Date**: 2026-04-14
> **Scope**: 6 bugs, 4 distinct fixes (issues 1+2+3 share root cause)

## Fix A: ZonePricingPanel local state (Issues 1, 2, 3)

**Problem**: `ZonePricingPanel.tsx` submits form data via `useSubmit()` on every keystroke (debounced 300ms). This triggers React Router revalidation, causing full iframe reload. Additionally, numeric inputs use `type="number"` which displays locale-specific decimal separators (`0,` instead of `0.`).

**Fix**: 
- Convert all inputs to controlled local state (`useState`)
- Remove `debouncedSubmit` — use the existing `<ui-save-bar>` pattern (already used on the parent view editor page) to batch changes
- Change `type="number"` to `type="text"` with `inputMode="decimal"` and `pattern="[0-9]*[.,]?[0-9]*"` for locale-safe numeric input
- Parse input with comma-to-dot normalization: `parseFloat(val.replace(",", "."))`
- Only submit when user clicks Save (via the save bar) or on blur with dirty check
- Card expand/collapse remains click-only (no submit)

**Files**: `app/components/ZonePricingPanel.tsx`, `app/routes/app.products.$id.views.$viewId.tsx`

## Fix B: Image management link (Issue 4)

**Problem**: `<a href="/app/products/${id}/images">` in view editor drops Shopify embedded session token on navigation, triggering OAuth re-auth.

**Fix**: Replace `<a href>` with React Router `<Link to>`. Import `Link` from `react-router`.

**File**: `app/routes/app.products.$id.views.$viewId.tsx` (line ~1488)

Also fix the same issue in `app/routes/app.products._index.tsx` (line ~387) where `<a href="/app/methods">` has the same problem.

## Fix C: Theme editor deep link (Issue 5)

**Problem**: `addAppBlockId=${apiKey}/customize-button` in the theme editor URL auto-installs a new block every time the merchant clicks the link.

**Fix**: Change the URL to just open the theme editor without auto-adding:
```
https://${shopDomain}/admin/themes/current/editor?template=product
```
Remove `addAppBlockId` and `target` parameters. The merchant can manually add the block if it's not there already.

**File**: `app/routes/app.settings.tsx` (line ~108)

## Fix D: Theme editor preview visibility (Issue 6)

**Problem**: The Liquid block has `{% if product.metafields.insignia.enabled == "true" %}` which hides the button in theme editor preview where the product doesn't have the metafield set.

**Fix**: Add an `{% else %}` block that shows a placeholder visible only in the theme editor:
```liquid
{% else %}
  <div class="insignia-customize-block" {{ block.shopify_attributes }}>
    <div class="insignia-customize-button" style="opacity: 0.5; pointer-events: none; text-align: center; padding: 12px;">
      {{ block.settings.button_label }} (preview — enable Insignia on this product to activate)
    </div>
  </div>
{% endif %}
```

**File**: `extensions/insignia-theme/blocks/customize-button.liquid`
