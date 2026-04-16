# Phase 1: Admin View Editor UX Tweaks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 UX issues in the admin view editor: SaveBar method save, image badge count, accordion state persistence, Enter-to-submit, canvas whitespace, scrollbar cleanup, scale clamping, and drag-and-drop reordering.

**Architecture:** All changes target the admin product detail page (`app.products.$id._index.tsx`), the view editor page (`app.products.$id.views.$viewId.tsx`), and the pricing panel component (`ZonePricingPanel.tsx`). The drag-and-drop feature (Tweak 8) adds a new `reorder-placements` / `reorder-steps` action intent and uses `@shopify/polaris` DragHandle pattern with a lightweight sortable library.

**Tech Stack:** React 18, React Router 7, Shopify Polaris v13, Prisma, PostgreSQL, TypeScript

---

## File Map

| Tweak | Files Modified | Responsibility |
|-------|---------------|----------------|
| 1 | `app/routes/app.products.$id._index.tsx` | Wire SaveBar to also save methods |
| 2 | `app/routes/app.products.$id._index.tsx` | Fix image badge to count actual images, not total combos |
| 3 | `app/routes/app.products.$id.views.$viewId.tsx` | Persist accordion expanded state across revalidations |
| 4 | `app/routes/app.products.$id.views.$viewId.tsx` | Add Enter key handler to print area name input |
| 5 | `app/routes/app.products.$id.views.$viewId.tsx` | Remove bottom margin from canvas area |
| 6 | `app/routes/app.products.$id.views.$viewId.tsx` | Fix scrollbar on hint/calibration bar area |
| 7 | `app/components/ZonePricingPanel.tsx` | Clamp scale input 0-1 |
| 8 | `app/routes/app.products.$id.views.$viewId.tsx`, `app/components/ZonePricingPanel.tsx` | Drag-and-drop reordering for placements and sizes |

---

### Task 1: Wire SaveBar to save decoration methods (Tweak 1)

**Files:**
- Modify: `app/routes/app.products.$id._index.tsx:573-584` (handleSaveBasic)
- Modify: `app/routes/app.products.$id._index.tsx:675-678` (ui-save-bar)

**Problem:** The SaveBar's primary button calls `handleSaveBasic` which only submits `intent: "update-basic"` (name + products). Method changes tracked via `hasMethodChanges` are ignored by the SaveBar — they only save via the separate "Save methods" button calling `handleSaveMethods`.

**Fix:** When the SaveBar save is clicked, trigger both saves if both have changes. The cleanest approach: create a new `handleSaveAll` that calls both `handleSaveBasic` and `handleSaveMethods` as needed.

- [ ] **Step 1: Create handleSaveAll and wire to SaveBar**

In `app/routes/app.products.$id._index.tsx`, replace the SaveBar's onClick with a new combined handler.

Find `handleSaveBasic` (~line 573) and after `handleSaveMethods` (~line 593), add:

```typescript
const handleSaveAll = useCallback(() => {
  if (hasBasicChanges) {
    handleSaveBasic();
  }
  if (hasMethodChanges) {
    handleSaveMethods();
  }
  // If neither has changes but hasChanges is true (shouldn't happen), still clear
  if (!hasBasicChanges && !hasMethodChanges) {
    setHasChanges(false);
  }
}, [hasBasicChanges, hasMethodChanges, handleSaveBasic, handleSaveMethods]);
```

Then update the `<ui-save-bar>` (~line 675-678):

```tsx
<ui-save-bar id="product-detail-save-bar">
  <button variant="primary" type="button" onClick={handleSaveAll}>Save</button>
  <button type="button" onClick={handleDiscard}>Discard</button>
</ui-save-bar>
```

- [ ] **Step 2: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.\$id._index.tsx
git commit -m "fix(admin): wire SaveBar to save both basic info and methods"
```

---

### Task 2: Fix image badge to show actual image count (Tweak 2)

**Files:**
- Modify: `app/routes/app.products.$id._index.tsx:102-116` (loader badge queries)
- Modify: `app/routes/app.products.$id._index.tsx:854-898` (badge rendering)

**Problem:** The badge shows `${filled}/${total} images` where `total` is the count of all `VariantViewConfiguration` rows (all size×color combos, e.g. 84 = 12 sizes × 7 colors). But users assign one image per color per view, so seeing "7/84 images" is confusing. The denominator is misleading — it should reflect actual images uploaded.

**Fix:** Show just the image count: `${filled} image(s)`. Keep the tone logic (green for complete, warning for partial) which uses the existing `isComplete`/`hasPartial` flags based on `total`. The tone still communicates completion status without the misleading denominator.

- [ ] **Step 1: Update badge text**

In `app/routes/app.products.$id._index.tsx` (~line 888), change the Badge content:

```tsx
<Badge tone={isComplete ? "success" : hasPartial ? "warning" : undefined}>
  {filled === 0
    ? "No images"
    : `${filled} image${filled !== 1 ? "s" : ""}`}
</Badge>
```

The tone still indicates completion status (green = all VVC rows have images, warning = some do), but the text just shows the meaningful number.

- [ ] **Step 2: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.\$id._index.tsx
git commit -m "fix(admin): improve image badge to show clearer image count"
```

---

### Task 3: Preserve accordion state across revalidations (Tweak 3)

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx:1607` (ZonePricingPanel key prop)

**Problem:** `<ZonePricingPanel key={view.id} .../>` uses `view.id` as key, which is stable across revalidations (good). However, the `selectedPlacementId` state in the parent is React state at line 732 — this persists across revalidations since React Router reuses the component. The real issue is that when `stepFetcher` completes (add-step/delete-step), it calls `revalidator.revalidate()` which re-fetches the loader data. This should NOT reset the parent's `selectedPlacementId` since it's React state.

Let me check if the `addingZone` flow uses `submit` (full navigation) vs `useFetcher`. Line 999 uses `submit(formData, { method: "post" })` — this triggers a full navigation, which DOES reset state because the component re-renders with new loader data and React Router triggers `useNavigation`. But `submit` via `useSubmit` in React Router 7 does NOT remount the component — it only re-runs the loader.

The accordion state should already persist. If users report it doesn't, the likely cause is the `revalidator.revalidate()` call in ZonePricingPanel (~line 173) triggering a loader re-fetch that updates `viewPlacements`, which in turn changes the `placements` prop, causing re-render. But `selectedPlacementId` in the parent stays stable.

**The actual issue** is likely that after add-step, the newly added step is not visible until save + revalidate, and the revalidation causes the parent to re-derive `viewPlacements` from loader data. If the placement's step count changed, the ZonePricingPanel re-renders but the accordion should stay open since `selectedPlacementId` is parent state.

**Safeguard fix:** Use a ref to track the intended expanded placement so it survives any edge case where state gets reset.

- [ ] **Step 1: Add selectedPlacementId ref backup**

In `app/routes/app.products.$id.views.$viewId.tsx`, after state declaration (~line 732):

```typescript
const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
const selectedPlacementIdRef = useRef<string | null>(null);

// Wrap setter to also update ref
const handleSelectPlacement = useCallback((id: string | null) => {
  selectedPlacementIdRef.current = id;
  setSelectedPlacementId(id);
}, []);
```

Then after the revalidation effect (~line 852-856), add a restoration effect:

```typescript
// Restore accordion state after revalidation (safeguard against state loss)
useEffect(() => {
  if (selectedPlacementId === null && selectedPlacementIdRef.current) {
    // Check if the ref'd placement still exists in current data
    const stillExists = viewPlacements.some(p => p.id === selectedPlacementIdRef.current);
    if (stillExists) {
      setSelectedPlacementId(selectedPlacementIdRef.current);
    } else {
      selectedPlacementIdRef.current = null;
    }
  }
}, [viewPlacements]); // eslint-disable-line react-hooks/exhaustive-deps
```

Replace all `onSelectPlacement={setSelectedPlacementId}` with `onSelectPlacement={handleSelectPlacement}` in both the ZonePricingPanel and PlacementGeometryEditor.

- [ ] **Step 2: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.\$id.views.\$viewId.tsx
git commit -m "fix(admin): preserve accordion expanded state across revalidations"
```

---

### Task 4: Print area name input submits on Enter (Tweak 4)

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx:1634-1640` (TextField for new zone name)

**Problem:** The "New print area name" TextField has no `onKeyDown` handler, so pressing Enter does nothing.

- [ ] **Step 1: Add onKeyDown handler to TextField**

In `app/routes/app.products.$id.views.$viewId.tsx` (~line 1634), update the TextField:

```tsx
<TextField
  label="Name"
  labelHidden
  value={newZoneName}
  onChange={setNewZoneName}
  autoComplete="off"
  placeholder="e.g. Left Chest"
  onKeyDown={(e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newZoneName.trim()) {
      e.preventDefault();
      handleAddZone();
    }
  }}
/>
```

Note: Polaris `TextField` passes `onKeyDown` through to the underlying `<input>` — no wrapper needed.

- [ ] **Step 2: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.\$id.views.\$viewId.tsx
git commit -m "fix(admin): submit print area name on Enter key"
```

---

### Task 5: Remove canvas bottom margin (Tweak 5)

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx:1248-1253` (canvas area container)

**Problem:** The canvas area container has `padding: "16px 24px 8px"` which adds 8px bottom padding. Below it are two bars (hint bar and calibration bar) that have their own padding. The combination creates visible whitespace at the bottom.

- [ ] **Step 1: Remove bottom padding from canvas area**

In `app/routes/app.products.$id.views.$viewId.tsx` (~line 1248-1253), change the canvas area padding:

```tsx
<div style={{
  flex: 1, display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  padding: "16px 24px 0", overflow: "hidden",
}}>
```

Changed `"16px 24px 8px"` → `"16px 24px 0"`.

- [ ] **Step 2: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.\$id.views.\$viewId.tsx
git commit -m "fix(admin): remove canvas bottom margin in view editor"
```

---

### Task 6: Fix scrollbar on hint/calibration bar (Tweak 6)

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx:1159-1160` (left canvas column container)

**Problem:** The left column container (`flex: 1, display: "flex", flexDirection: "column", background: "#F3F4F6", minWidth: 0`) doesn't have `overflow: hidden`, so when the canvas + hint bar + calibration bar exceed the available height, a scrollbar appears on the column.

- [ ] **Step 1: Add overflow hidden to canvas column**

In `app/routes/app.products.$id.views.$viewId.tsx` (~line 1160), update the left column:

```tsx
<div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#F3F4F6", minWidth: 0, overflow: "hidden" }}>
```

This ensures only the main body area scrolls (via the right panel's `overflowY: "auto"`), not the canvas column.

- [ ] **Step 2: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.\$id.views.\$viewId.tsx
git commit -m "fix(admin): prevent scrollbar on canvas column in view editor"
```

---

### Task 7: Clamp scale value 0-1 (Tweak 7)

**Files:**
- Modify: `app/components/ZonePricingPanel.tsx:621-635` (scale TextField)
- Modify: `app/routes/app.products.$id.views.$viewId.tsx:437-438` (action handler parse)

**Problem:** The scale input is a free-form text field with no min/max validation. Values outside 0-1 are meaningless (scale 0 = invisible, scale 1 = full width of max zone).

- [ ] **Step 1: Add min/max/step to scale TextField and clamp on blur**

In `app/components/ZonePricingPanel.tsx` (~line 621-635), update the scale TextField:

```tsx
{hasMultipleSteps && (
  <TextField
    label="Scale"
    labelHidden
    type="number"
    min={0}
    max={1}
    step={0.05}
    value={
      stepScaleStrings[step.id] ??
      String(step.scaleFactor)
    }
    suffix="x"
    autoComplete="off"
    onChange={(val) => updateStepScale(step.id, val)}
    onBlur={() => {
      const raw = parseFloat(stepScaleStrings[step.id] ?? String(step.scaleFactor));
      if (!Number.isNaN(raw)) {
        const clamped = Math.max(0, Math.min(1, raw));
        updateStepScale(step.id, String(clamped));
      }
    }}
  />
)}
```

Changed `type="text"` to `type="number"`, added `min={0}`, `max={1}`, `step={0.05}`, and an `onBlur` handler that clamps the value.

- [ ] **Step 2: Clamp in action handler too**

In `app/routes/app.products.$id.views.$viewId.tsx` (~line 437-438), update the scale parse:

```typescript
const rawScale = parseFloat(formData.get("scaleFactor") as string ?? "1");
const scaleFactor = Number.isNaN(rawScale) ? 1.0 : Math.max(0, Math.min(1, rawScale));
```

Also update the same line in `batch-pricing-update` (~line 490):

```typescript
const rawScale = Number.isNaN(s.scaleFactor) ? 1.0 : Math.max(0, Math.min(1, s.scaleFactor));
```

- [ ] **Step 3: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/components/ZonePricingPanel.tsx app/routes/app.products.\$id.views.\$viewId.tsx
git commit -m "fix(admin): clamp scale value to 0-1 range with validation"
```

---

### Task 8: Drag-and-drop reordering for print areas and sizes (Tweak 8)

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx` (add reorder action intents)
- Modify: `app/components/ZonePricingPanel.tsx` (add drag handles and reorder UI)
- Create: none (use native HTML5 drag or minimal approach — no new library)

**Approach:** Both `PlacementDefinition` and `PlacementStep` already have `displayOrder` fields and are queried with `orderBy: { displayOrder: "asc" }`. We need:
1. Two new action intents: `reorder-placements` and `reorder-steps`
2. Drag handles on each print area header and each size row
3. Visual feedback during drag (opacity change, drop indicator)

We'll use a minimal approach with `DragHandleIcon` from Polaris and native HTML5 drag events (no external library needed for simple list reorder).

- [ ] **Step 1: Add reorder action intents to view editor**

In `app/routes/app.products.$id.views.$viewId.tsx`, before the final `throw new Response("Invalid intent")` (~line 690), add:

```typescript
if (intent === "reorder-placements") {
  const orderJson = formData.get("order") as string;
  if (!orderJson) {
    throw new Response("Missing order data", { status: 400 });
  }
  let order: string[];
  try {
    order = JSON.parse(orderJson);
  } catch {
    throw new Response("Invalid order JSON", { status: 400 });
  }
  // Update displayOrder for each placement
  for (let i = 0; i < order.length; i++) {
    await db.placementDefinition.update({
      where: {
        id: order[i],
        productView: { productConfig: { shopId: shop.id } },
      },
      data: { displayOrder: i },
    });
  }
  return { success: true, intent: "reorder-placements" };
}

if (intent === "reorder-steps") {
  const placementId = formData.get("placementId") as string;
  const orderJson = formData.get("order") as string;
  if (!placementId || !orderJson) {
    throw new Response("Missing data", { status: 400 });
  }
  let order: string[];
  try {
    order = JSON.parse(orderJson);
  } catch {
    throw new Response("Invalid order JSON", { status: 400 });
  }
  for (let i = 0; i < order.length; i++) {
    await db.placementStep.update({
      where: {
        id: order[i],
        placementDefinition: {
          id: placementId,
          productView: { productConfig: { shopId: shop.id } },
        },
      },
      data: { displayOrder: i },
    });
  }
  return { success: true, intent: "reorder-steps" };
}
```

- [ ] **Step 2: Add drag-and-drop to ZonePricingPanel**

In `app/components/ZonePricingPanel.tsx`, add drag state and handlers. This is the most complex change — see implementation notes below.

**Placement header rows** get a drag handle (Polaris `DragHandleIcon`) on the left. Dragging reorders placements. On drop, submit via fetcher.

**Size rows** within an expanded placement also get drag handles. Dragging reorders sizes within that placement.

Implementation approach:
- Track `draggedId` and `dragOverId` in state
- On `onDragStart`: set `draggedId`
- On `onDragOver`: set `dragOverId`, prevent default
- On `onDrop`: compute new order, submit via fetcher
- Visual: dragged item gets `opacity: 0.4`, drop target gets top/bottom border indicator

Add to props:
```typescript
// No new props needed — we'll use stepFetcher (already available) for reorder submits
```

Add state at top of component:
```typescript
const [draggedPlacementId, setDraggedPlacementId] = useState<string | null>(null);
const [dragOverPlacementId, setDragOverPlacementId] = useState<string | null>(null);
const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);
```

Add reorder submit helpers:
```typescript
const submitReorderPlacements = useCallback((newOrder: string[]) => {
  const fd = new FormData();
  fd.set("intent", "reorder-placements");
  fd.set("order", JSON.stringify(newOrder));
  stepFetcher.submit(fd, { method: "post" });
}, [stepFetcher]);

const submitReorderSteps = useCallback((placementId: string, newOrder: string[]) => {
  const fd = new FormData();
  fd.set("intent", "reorder-steps");
  fd.set("placementId", placementId);
  fd.set("order", JSON.stringify(newOrder));
  stepFetcher.submit(fd, { method: "post" });
}, [stepFetcher]);
```

On each placement header, wrap with drag attributes:
```tsx
<div
  draggable
  onDragStart={() => setDraggedPlacementId(p.id)}
  onDragEnd={() => { setDraggedPlacementId(null); setDragOverPlacementId(null); }}
  onDragOver={(e) => { e.preventDefault(); setDragOverPlacementId(p.id); }}
  onDrop={() => {
    if (draggedPlacementId && draggedPlacementId !== p.id) {
      const ids = placements.map(pl => pl.id);
      const fromIdx = ids.indexOf(draggedPlacementId);
      const toIdx = ids.indexOf(p.id);
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedPlacementId);
      submitReorderPlacements(ids);
    }
    setDraggedPlacementId(null);
    setDragOverPlacementId(null);
  }}
  style={{
    opacity: draggedPlacementId === p.id ? 0.4 : 1,
    borderTop: dragOverPlacementId === p.id && draggedPlacementId !== p.id ? "2px solid #2563EB" : undefined,
  }}
>
  {/* Add DragHandleIcon before the existing placement header content */}
  <div style={{ cursor: "grab", display: "flex", alignItems: "center", padding: "0 4px" }}>
    <Icon source={DragHandleIcon} tone="subdued" />
  </div>
  {/* existing header content */}
</div>
```

Same pattern for size rows within a placement.

- [ ] **Step 3: Add toast for reorder intents in the effect**

In `ZonePricingPanel.tsx` (~line 166-178), update the effect to handle reorder intents:

```typescript
if (intent === "reorder-placements") window.shopify?.toast?.show("Order updated");
else if (intent === "reorder-steps") window.shopify?.toast?.show("Order updated");
```

- [ ] **Step 4: Import DragHandleIcon**

At the top of `ZonePricingPanel.tsx`, add to the Polaris icons import:

```typescript
import { DragHandleIcon } from "@shopify/polaris-icons";
```

- [ ] **Step 5: Run checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/routes/app.products.\$id.views.\$viewId.tsx app/components/ZonePricingPanel.tsx
git commit -m "feat(admin): drag-and-drop reordering for print areas and sizes"
```

---

## Phase 1 Completion Checklist

After all 8 tasks:

- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS
- [ ] Run `npx vitest run` — PASS (45/45)
- [ ] Run `npm run build` — PASS
- [ ] Visual verification of view editor (accordion, canvas, drag-and-drop)
- [ ] Visual verification of product detail page (SaveBar, image badges)
- [ ] **STOP and wait for user approval before Phase 2**
