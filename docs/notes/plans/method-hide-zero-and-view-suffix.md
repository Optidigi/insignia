# Plan: `hidePriceWhenZero` for DecorationMethod + drop " view" suffix

## 1. Summary

Two unrelated storefront-UX tweaks, bundled because they share one admin-focused area and one i18n touch. Change 1 mirrors the existing `PlacementDefinition.hidePriceWhenZero` pattern onto `DecorationMethod`, so merchants can opt a method's price card into showing "Included" (green badge) instead of "+€0.00" when the effective method fee is zero. Change 2 is a one-line template-literal edit in `PlacementStep.tsx` to render "Voorkant" instead of "Voorkant view" under each placement row.

## 2. Scope & files

### Change 1 — DecorationMethod.hidePriceWhenZero

Schema / migration
- `prisma/schema.prisma` — add field on `DecorationMethod` (model spans lines 124–145).
- `prisma/migrations/<timestamp>_add_hide_price_when_zero_to_decoration_method/migration.sql` — new migration file.

Server / service layer
- `app/lib/services/methods.server.ts` — add `hidePriceWhenZero` to `CreateMethodSchema` and `UpdateMethodSchema`; include in create/update payload in `createMethod` and `updateMethod`. Zero backend pricing math changes.
- `app/lib/services/storefront-config.server.ts` — add `hidePriceWhenZero: boolean` to `DecorationMethodRef` type; include it in the projection inside the `methods` map.

Admin UI
- `app/routes/app.methods.$id.tsx` — render a Polaris `Checkbox` under the base-price `TextField` in the Pricing `AnnotatedSection`, include in state/save/discard/action flow.
- `app/routes/app.methods._index.tsx` — optional single-line indicator; see §11.

Storefront client
- `app/components/storefront/types.ts` — add `hidePriceWhenZero: boolean` to `DecorationMethodRef`.
- `app/components/storefront/UploadStep.tsx` — update method-card price rendering to gate on the flag.
- `app/components/storefront/storefront-modal.css` — add a rule mirroring the existing `[data-included="true"]` pattern for the method-card price element.

Tests
- `app/lib/services/__tests__/storefront-config.server.test.ts` — extend `MOCK_METHOD` with `hidePriceWhenZero: false`.

### Change 2 — drop " view" suffix

- `app/components/storefront/PlacementStep.tsx:157` — change
  `const ownerLabel = ownerView ? \`${viewName(ownerView)} view\` : null;`
  to
  `const ownerLabel = ownerView ? viewName(ownerView) : null;`

No other user-facing " view" suffix exists on storefront labels (verified):
- `PreviewCanvas.tsx` renders just `activeDisplayedView.name || capitalize(activeDisplayedView.perspective)` — no suffix.
- `SizeStep.tsx` — no user-facing string with " view".
- `ReviewStep.tsx` — no matches.
- `i18n.ts` has `viewNavPrev: "Previous view"` and `viewNavNext: "Next view"` — `aria-label` strings for chevron nav; leave untouched.

## 3. Schema / migration

Prisma field, inserted alongside `basePriceCents` in the `DecorationMethod` model:

```
hidePriceWhenZero Boolean @default(false)
```

Position: immediately after `basePriceCents` (line 128), mirroring the placement layout at schema.prisma:253-254.

Migration timestamp: strictly greater than the latest existing `20260426000000_drop_placement_step_method_price`. Use:

- Path: `prisma/migrations/20260427000000_add_hide_price_when_zero_to_decoration_method/migration.sql`

Migration SQL:

```sql
-- AlterTable
ALTER TABLE "DecorationMethod" ADD COLUMN "hidePriceWhenZero" BOOLEAN NOT NULL DEFAULT false;
```

Existing rows: safe — `NOT NULL DEFAULT false` backfills to current behaviour.

## 4. Admin UI changes

File: `app/routes/app.methods.$id.tsx`.

Copy: **"Hide price when €0"** (Checkbox label). Help text: **"Show 'Included' instead of +€0.00 on the storefront when the price is zero."**

Placement: inside the Pricing `Layout.AnnotatedSection` Card, immediately after the base-price `TextField`. Wrap the `TextField` and new `Checkbox` in a `BlockStack gap="400"`.

State integration:
- `const [hidePriceWhenZero, setHidePriceWhenZero] = useState(method.hidePriceWhenZero);`
- Extend `hasChanges` `useMemo` with `if (hidePriceWhenZero !== method.hidePriceWhenZero) return true;`.
- Extend `handleDiscard` with `setHidePriceWhenZero(method.hidePriceWhenZero);`.
- Extend save `FormData` with `formData.append("hidePriceWhenZero", hidePriceWhenZero ? "true" : "false");`.
- In `action`, read `const hidePriceWhenZero = formData.get("hidePriceWhenZero") === "true";` and pass to `updateMethod`.

Save-bar: existing `ui-save-bar#method-save-bar` already triggers on `hasChanges` — no wiring changes.

## 5. Storefront UI changes

File: `app/components/storefront/UploadStep.tsx`, method-card price rendering.

Logic gate: **`method.hidePriceWhenZero === true && effectivePriceCents === 0`** → render `t.v2.placement.included`. `effectivePriceCents` is already resolved server-side via `effectiveMethodPriceCents(method.basePriceCents, productConfigMethod.basePriceCentsOverride)` — the storefront receives already-resolved `basePriceCents`.

Styling reuse: add a rule mirroring `storefront-modal.css:1006-1008`:

```css
.insignia-method-card-price[data-included="true"] {
  color: var(--insignia-success);
}
```

Behaviour matrix:

| flag | effective price | rendered |
|------|-----------------|----------|
| true | 0 | "Included" (success green) |
| true | > 0 | "+€X.XX" (current accent) |
| false | 0 | "€0.00" (current behavior) |
| false | > 0 | "+€X.XX" |

## 6. Storefront config projection

- `app/lib/services/storefront-config.server.ts` — `DecorationMethodRef` type: add `hidePriceWhenZero: boolean;`.
- Same file, method projection inside `getStorefrontConfig`: add `hidePriceWhenZero: m.decorationMethod.hidePriceWhenZero,`.

Client type mirror: `app/components/storefront/types.ts` `DecorationMethodRef` — add matching field.

## 7. i18n

`t.v2.placement.included` = "Included" / "Inbegrepen" / etc. — already exists for all 8 locales.

**Decision: reuse `t.v2.placement.included`.** Identical word, identical badge idiom; no new i18n key needed.

No translation file changes required for Change 1. No i18n changes at all for Change 2.

## 8. Data migration

None. New column defaults to `false`. Existing rows retain today's behaviour.

## 9. Testing

Required:
- `npx prisma migrate dev` to apply the new migration locally.
- `npm run typecheck`.
- `npm run lint`.
- `npm run test` (or equivalent) — `storefront-config.server.test.ts` mock extension only.

Visual verification:
1. Admin → Methods → open a method → toggle "Hide price when €0" → save → confirm persistence after refresh.
2. Storefront modal → method card with `basePriceCents = 0` and flag on → should render "Included" in success green.
3. Same method with per-product override → effective price > 0 → should render "+€X.XX".
4. Same method with flag off and `basePriceCents = 0` → should render "€0.00" (unchanged).
5. Storefront placement step → placement row sub-label should say "Voorkant" not "Voorkant view".

## 10. Edge cases

- **Per-product method override** (`ProductConfigMethod.basePriceCentsOverride`): resolved server-side; flag is on the method itself. Matrix: flag=true base=500 override=0 → "Included"; flag=true base=0 override=300 → "+€3.00"; flag=false base=0 → "€0.00".
- **Placement-method price overrides** (`PlacementDefinitionMethodPrice`): unrelated (placement fees, not method base fees).
- **Multi-method products with auto-select**: UploadStep auto-selects when there's exactly one method; badge renders consistently pre- and post-selection.
- **0-decimal currencies** (JPY etc.): `formatCurrency` produces locale-correct "0"; "Included" bypasses the path.
- **Variant-pool / cart pricing**: untouched. Display-only change.

## 11. Open questions

**Q:** Should the method-list index page surface the flag visually?

**Recommendation: skip.** Adds table clutter for niche value. Merchants who care open the detail page anyway. One-line Badge add later if needed.

## 12. Reviewer must-fixes (folded into implementation scope)

### MF-1 — Explicit Zod types for both schemas

`app/lib/services/methods.server.ts` — add to BOTH `CreateMethodSchema` and `UpdateMethodSchema`:

```ts
hidePriceWhenZero: z.boolean().optional(),
```

`CreateMethodSchema` has existing `.optional().default(false)` chains; follow the local convention there. `UpdateMethodSchema` uses plain `.optional()` — do that. Do NOT also "fix" the pre-existing `customerDescription` missing-from-schema inconsistency; that's out of scope for this change.

### MF-2 — Explicit spread-style in `updateMethod`

In `app/lib/services/methods.server.ts`'s `updateMethod` body, the existing pattern spreads conditional fields. Add the same shape for the new flag:

```ts
...(parsed.hidePriceWhenZero !== undefined && { hidePriceWhenZero: parsed.hidePriceWhenZero }),
```

Prevents accidental `undefined` writes that would NULL the value.

### MF-3 — Use inline-ternary, not IIFE, in UploadStep

Match the existing pattern from `PlacementStep.tsx:200-209`. Final target shape:

```tsx
<span
  className="insignia-method-card-price"
  data-included={m.hidePriceWhenZero && fee === 0 ? "true" : undefined}
>
  {m.hidePriceWhenZero && fee === 0
    ? t.v2.placement.included
    : fee === 0
    ? formatCurrency(0, config.currency)
    : formatPriceDelta(fee, config.currency)}
</span>
```

No function allocation, matches existing style, easier to diff.

### MF-4 — CSS specificity override for selected method card

`storefront-modal.css` line ~745 has:

```css
.insignia-method-card[data-state="selected"] .insignia-method-card-price {
  color: var(--insignia-text-strong);
}
```

This wins specificity over `.insignia-method-card-price[data-included="true"]`, so the Included green would be overridden to grey/strong when a method is selected — exactly wrong. Add a higher-specificity override:

```css
.insignia-method-card-price[data-included="true"] {
  color: var(--insignia-success);
}
.insignia-method-card[data-state="selected"] .insignia-method-card-price[data-included="true"] {
  color: var(--insignia-success);
}
```

Both rules go next to the existing `.insignia-method-card-price` block (around line 745) or in the already-used `[data-included]` region (around line 1006). Place near 745 for proximity to the conflicting rule.

### MF-5 — Rollout-safety note

Column is additive with `NOT NULL DEFAULT false`. Live rollout during traffic is safe: existing rows backfill to `false`, preserving current "+€0.00" display; new column is never read for pricing math (display only).
