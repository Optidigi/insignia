# Plan: Storefront Canvas Zoom-to-Placement

> **Status:** Approved by user on 2026-04-24. Decisions recorded in §9. Ready for implementation.

> **Blocker flagged up front:** The task description said the storefront canvas is "Konva-based." It is not. `app/components/storefront/NativeCanvas.tsx:6-11` is explicit: "Uses plain Canvas API (NOT Konva — Konva is admin-only)". `react-konva` is imported only in `app/components/PlacementGeometryEditor.tsx` (admin). No `drag/rotate/resize of the logo on the canvas` exists on the storefront — the customer cannot transform the logo; `NativeCanvas` renders a static composite. The rest of this plan is written against the actual code, not the inaccurate task brief. See **Open questions #1** — before implementation we should confirm the zoom feature is still wanted given that the storefront canvas is non-interactive.

---

## 1. Summary

Zoom the storefront product-image canvas so the currently-selected (or currently-highlighted) placement zone occupies roughly 20% of the visible canvas and is centered. The change is a **presentational transform layered on top of the existing draw pipeline** in `NativeCanvas.tsx` — we multiply the product-image draw rect by a `zoomScale` and add an `offset`, both derived from the active placement's percent-space geometry, then animate changes with `requestAnimationFrame` (single source of truth for the canvas anyway — CSS transforms on the canvas element would blur the bitmap). It re-targets dynamically when the customer selects a different placement, switches views, or advances from Placement to Size, and clamps to keep the product image covering the frame.

## 2. Current state

### Canvas render pipeline (read in full before editing)

- **Not Konva.** The storefront canvas is plain Canvas 2D in `app/components/storefront/NativeCanvas.tsx:98-383`. The only Konva usage in the repo is the admin placement editor (`app/components/PlacementGeometryEditor.tsx`, confirmed via grep for `react-konva` — 3 hits: the admin editor, `package.json`, `package-lock.json`).
- **Canvas sizing.** `NativeCanvas` fits the loaded product image into a `MAX_CANVAS_DIM = 700` square preserving aspect (`NativeCanvas.tsx:96`, `:131-140`). `canvasDims.w/h` become the `<canvas width/height>` attributes. CSS then scales the element to `max-width: 100%; height: auto;` inside the frame (`NativeCanvas.tsx:328-330, 380-381`).
- **Product image placement inside the bitmap.** The `draw()` function computes `scale = min(canvas.width / productImg.naturalWidth, canvas.height / productImg.naturalHeight)` and centers the image at `(px, py)` with size `(pw, ph)` (`NativeCanvas.tsx:173-183`). Logo overlays are drawn relative to `(px, py, pw, ph)` using each placement's `centerXPercent / centerYPercent / maxWidthPercent / maxHeightPercent`, multiplied by `scaleFactor` (`NativeCanvas.tsx:216-246`). **This is the single extension point for the zoom — apply the zoom transform to `(px, py, pw, ph)` and every logo draws correctly without further changes.**
- **Frame shell.** `app/components/storefront/PreviewCanvas.tsx:165-234` renders the `.insignia-canvas-frame` (square by default, `4:3` when image aspect > 1.3 per `PreviewCanvas.tsx:22`). `overflow: hidden` on the frame (`storefront-modal.css:789`) means we can safely blow the drawn content past the aspect-ratio box; it will be clipped by the frame, not the modal.
- **Mount locations.**
  - `PlacementStep.tsx:98-108` — embedded step canvas (hidden on desktop via `storefront-modal.css:1801`).
  - `SizeStep.tsx:277-288` — embedded step canvas (also hidden on desktop).
  - `PreviewSheet.tsx:119-127` — mobile bottom-sheet preview.
  - `CustomizationModal.tsx:1030-1044` — persistent desktop left-panel preview, gated by `isDesktopViewport` (hook at `:206-216`).
  - `ReviewStep.tsx` does **not** render `PreviewCanvas` at all. On mobile, the Review footer exposes a button that opens `PreviewSheet` (`CustomizationModal.tsx:1168`, `ReviewStep.tsx` has no `PreviewCanvas` import). On desktop the persistent panel keeps showing the preview.

### Placement coordinates (DB → wire)

- **DB:** `prisma/schema.prisma:196-215` (`ProductView`, with `placementGeometry Json` at `:203` and `calibrationPxPerCm Float?` at `:205`), `:221-243` (`VariantViewConfiguration.placementGeometry Json`), `:249-266` (`PlacementDefinition`). Geometry JSON shape documented at `schema.prisma:229` — `{ centerXPercent, centerYPercent, maxWidthPercent }` (plus optional `maxHeightPercent`).
- **Projection to wire:** `app/lib/services/storefront-config.server.ts:340-382` builds `geometryByViewId` per placement, merging `ProductView.placementGeometry` with `VariantViewConfiguration.placementGeometry` based on `sharedZones` (`schema.prisma:204`). Output shape at `storefront-config.server.ts:19-26`.
- **Client type:** `app/components/storefront/types.ts:6-12` (`PlacementGeometry`) and `:20-35` (`Placement.geometryByViewId`).
- **Canvas consumption:** `PreviewCanvas.tsx:113-134` maps `geometryByViewId[currentView.id]` + the placement's selected `stepIndex` → `CanvasPlacement[]` fed to `NativeCanvas`.

### Which placement to zoom toward — state model already in place

- `PlacementSelections = Record<placementId, stepIndex>` (`types.ts:115`) — the "customer picked this" set. May have 0, 1, or more entries.
- `highlightPlacementId` — an *existing* prop on `PreviewCanvas` (`PreviewCanvas.tsx:29`) that `SizeStep` already passes (`SizeStep.tsx:281`). In Size, one placement at a time is "active" (`SizeStep.tsx:171`). **This is the exact signal we want for "zoom target in Size step."**
- In Placement step, there is no single highlighted placement — customers multi-select. `PlacementStep.tsx:136-140` does switch the desktop `viewId` on row hover, but does not emit a highlighted id. We would need to extend it.

### Existing animation conventions

- CSS tokens: `--insignia-dur-fast: 120ms`, `--insignia-dur-med: 200ms`, `--insignia-ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)` at `storefront-modal.css:84-87`.
- `prefers-reduced-motion: reduce` override blocks exist at `storefront-modal.css:555, 1915` — must add ours alongside.

## 3. Proposed design

### 3.1 Math

Inputs (all per draw):
- `pw, ph` — product image rendered size at zoom = 1, already computed at `NativeCanvas.tsx:177-178`.
- `px0, py0` — product top-left at zoom = 1 (`NativeCanvas.tsx:179-180`, centered in canvas).
- `cw = canvas.width`, `ch = canvas.height`.
- Target placement geometry in percent: `{ cx, cy, mw, mh }` where `mh = maxHeightPercent ?? maxWidthPercent`.
- Visible-canvas shorter edge: `S = min(cw, ch)` — "visible viewport" is the canvas drawing buffer, and the frame has `aspect-ratio: 1/1` (or 4/3 for wide) so this is well-defined.
- Target fraction of viewport that the placement occupies: `TARGET_FRAC = 0.20`.

**Definition chosen** (justified): "placement is ~20% of the canvas" means *the longer of placement.widthPx or placement.heightPx* equals `TARGET_FRAC × S` (the shorter canvas edge). This is the most forgiving definition for anisotropic zones like "sleeve" (tall & narrow) and for square frames — it guarantees the placement is never cropped by the shorter axis and never smaller than 20% on that axis. Alternative definitions (area, min of w/h, always width) were rejected: area makes a 5%×80% sleeve zone look wrong, min-of-w/h makes a wide rug-label unreadable at 20%, width-only breaks for tall zones.

Unclamped compute:
```
placementWpx_at1 = (mw / 100) * pw        // placement width at zoom = 1
placementHpx_at1 = (mh / 100) * ph
targetPx         = TARGET_FRAC * min(cw, ch)
zoomScale        = targetPx / max(placementWpx_at1, placementHpx_at1)
zoomScale        = max(1, zoomScale)      // never zoom OUT below 1×
// placement center in canvas space at zoom = 1
cxCanvas_at1     = px0 + (cx / 100) * pw
cyCanvas_at1     = py0 + (cy / 100) * ph
// After zoom, placement center must land at canvas center. Product top-left:
pwZoomed         = pw * zoomScale
phZoomed         = ph * zoomScale
pxZoomed         = (cw / 2) - zoomScale * (cxCanvas_at1 - px0)
                 = (cw / 2) - ((cx / 100) * pwZoomed)
pyZoomed         = (ch / 2) - ((cy / 100) * phZoomed)
```

**Clamping rule.** Goal: the product image always covers the canvas frame fully when zoomed (no empty margins inside the frame). When `zoomScale >= 1` *and* the product is larger than the canvas on each axis, constrain the offsets so the product edges never move inside the canvas edges:
```
pxZoomed = clamp(pxZoomed, cw - pwZoomed, 0)   // right edge ≥ cw; left edge ≤ 0
pyZoomed = clamp(pyZoomed, ch - phZoomed, 0)
```
If `pwZoomed < cw` (product narrower than canvas — happens only when `zoomScale` was `1` and product aspect doesn't fill), fall back to centered (current behavior). Clamping favors "keep the product on screen" over "keep placement perfectly centered" — when placement sits near the edge, it slides toward its real position in the zoomed image, which is what customers expect.

**Zoomed-out state (no placement selected, Placement step with 0 selections).** `zoomScale = 1`, `px = px0`, `py = py0` — exactly the current render.

### 3.2 State model — where the zoom lives

**Canvas bitmap transform, not CSS transform.** Rationale:
1. CSS transform on `<canvas>` blurs the raster on zoom (our canvas is ~700 px wide; at 5× zoom that's visibly soft).
2. The canvas already redraws on every placement/view change — adding a zoom target does not add redraw triggers.
3. Logo overlays must zoom with the product image *exactly*. Because logos are computed from `(px, py, pw, ph)` already (`NativeCanvas.tsx:216-246`), modifying those four values zooms everything coherently. A CSS transform would need a second transform path for the logo, doubling the code.

**Prop contract.** Add `zoomTarget?: { placementId: string | null; fraction?: number }` (default `fraction = 0.20`) threaded from `CustomizationModal` → `PreviewCanvas` → `NativeCanvas`. `NativeCanvas` resolves the target geometry itself from its `placements` array (`placementId` lookup). When `placementId == null`, zoom out.

**Who sets zoomTarget.** Single source of truth: `CustomizationModal` keeps `zoomTargetPlacementId: string | null` in state. Rules:
- `step === "placement"`: `zoomTargetPlacementId = hoveredPlacementId ?? lastTappedPlacementId ?? firstSelectedPlacementId ?? null`. Mobile (no hover) fallback: last tapped.
- `step === "size"`: `zoomTargetPlacementId = activePlacement.id` — derived from `SizeStep`'s internal `activeIndex`. Since `SizeStep` already owns this, expose via a new `onActivePlacementChange` prop (or lift `activeIndex` into the shell). Lifting is cleaner and avoids a second state path.
- `step === "upload"`: `null` (no placements chosen yet).
- `step === "review"`: `null` on desktop persistent panel; `PreviewSheet` also `null` (shows whole product). Justification: Review is about totals/quantities; a zoomed preview misleads users about what ships. If UX wants the last-active placement here, it's a one-line change.

### 3.3 Animation

**`requestAnimationFrame` tween inside `NativeCanvas`**, not CSS, not react-konva (we're not using Konva). Keep one ref `animStateRef = { from, to, startTs, duration }` and one running rAF id. Each `draw()` uses the current interpolated `(zoomScale, px, py)`. When `zoomTarget` changes:
1. Snapshot current interpolated values as `from`.
2. Compute new target values from the new placement.
3. Start a rAF loop that re-invokes `draw()` on every tick for `duration` ms.

**Duration: 240 ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`** (matches `--insignia-ease-out` / `--insignia-dur-med`). Rationale: 200 ms is the existing medium token used for tab underlines (`storefront-modal.css:224-225`), but a spatial transform feels snappier at the top of the range; 240 gives the ease-out curve room to decelerate visibly without dragging. <200 looks like a jump cut, >300 feels laggy — 240 is inside the "direct manipulation" band.

**Reduced-motion.** When `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, snap instantly (set `duration = 0`). Implemented with `useSyncExternalStore` or a one-line check inside the effect. Mirrors the existing pattern at `storefront-modal.css:555, 1915`.

## 4. Files to change

| File | Change | Load-bearing? | Risk |
|---|---|---|---|
| `app/components/storefront/NativeCanvas.tsx` | Add `zoomTarget?: { placementId: string \| null; fraction?: number }` prop. Add rAF tween state. Compute `(zoomScale, px, py)` each frame from current tween progress. Apply clamp. All logo draws already use `(px, py, pw, ph)` so they inherit the zoom with zero other changes. | **Yes** — storefront modal UX flow (CLAUDE.md:25, ARCHITECTURE_REVIEW_BRIEF.md:31). | Medium: the draw path is hot; a bug renders wrong geometry or flickers. Mitigate by keeping the old codepath as the `zoomScale === 1` branch. |
| `app/components/storefront/PreviewCanvas.tsx` | Add passthrough `zoomTargetPlacementId?: string \| null` prop. Forward to `NativeCanvas` as `zoomTarget`. | **Yes** — same subsystem. | Low — prop passthrough only. |
| `app/components/storefront/PlacementStep.tsx` | Add `onZoomTargetChange?: (id: string \| null) => void` prop. Emit on row hover (desktop) / row tap (mobile). Pass `zoomTargetPlacementId` to `PreviewCanvas`. | **Yes** — storefront step file. | Low — additive, does not alter selection semantics. |
| `app/components/storefront/SizeStep.tsx` | Either (a) expose `onActivePlacementChange` prop so the shell can observe `activePlacement.id`, or (b) accept `zoomTargetPlacementId` derived from shell and lift `activeIndex` to shell. Choice: **(a)** — minimal blast radius, `activeIndex` stays local. | **Yes** — storefront step file. | Low — additive. |
| `app/components/storefront/CustomizationModal.tsx` | Add `zoomTargetPlacementId` state. Wire the new callbacks from `PlacementStep` / `SizeStep`. Pass to the persistent desktop `PreviewCanvas` (`:1033-1043`) and the mobile `PreviewSheet` (`:1064-1071` — propagate as new prop, default `null`). | **Yes** — modal shell. | Medium — this is the file the brief forbids redesigning. We are *adding* state, not restructuring flow. Change should read as ~15 lines. |
| `app/components/storefront/PreviewSheet.tsx` | Accept and forward `zoomTargetPlacementId` to its `PreviewCanvas`. | **Yes**. | Low. |
| `app/components/storefront/storefront-modal.css` | No changes needed — clipping is already handled by `overflow: hidden` on `.insignia-canvas-frame` (`:789`). Only exception: if we ever want a CSS-side visual hint (e.g. a subtle inner-glow while zoomed), add a `[data-zoomed="true"]` selector. Recommend **no CSS changes in phase 1**. | **No**. | — |
| `app/components/storefront/ReviewStep.tsx` | **No change** — ReviewStep renders no canvas. | — | — |

**Files explicitly not touched:** anything under `app/routes/apps.insignia.*`, `app/lib/services/storefront-config.server.ts`, `prisma/schema.prisma`. This is a pure client-side presentation change; the wire contract already carries everything we need.

**Load-bearing subsystem call-out (CLAUDE.md:25).** Five of the seven modified files are inside `app/components/storefront/` which is explicitly load-bearing. Per CLAUDE.md, this plan must be approved before implementation begins, and implementation must end with typecheck + lint green + Playwright-verified screenshots (rule 4 and 5).

## 5. Edge cases

1. **Placement near the image edge.** Handled by the clamp in §3.1 — product's opposite edge stays pinned to the frame, placement shifts off-center.
2. **Very small placement (e.g. `maxWidthPercent = 3`).** `zoomScale` can become very large. **Cap at `MAX_ZOOM = 8`** (logo raster resolution dies beyond that given `MAX_CANVAS_DIM = 700`). Above cap, placement will be slightly larger than 20% of viewport — acceptable.
3. **Very large placement (e.g. `maxWidthPercent = 80` on a rug).** `zoomScale` would be <1; §3.1's `max(1, ...)` clamp keeps us at 1× = current render. Placement already fills the view; zooming out makes no sense.
4. **No placement selected.** `zoomTargetPlacementId = null` → draw at `zoomScale = 1`, `px = px0`, `py = py0`. Exactly the current render — no regression risk on Upload step.
5. **Switching views mid-flow.** `PreviewCanvas.tsx` re-mounts `NativeCanvas` on `currentView.id` change (key at `:193`: `${currentView.id}:${retryKey}`). The new `NativeCanvas` instance starts at the target zoom instantly (no "from" state). Acceptable — view switch is already a hard swap in today's UX.
6. **Image still loading.** Guard: if `!loaded` or `!productImgRef.current`, bail early (already done at `NativeCanvas.tsx:168`). First draw after load uses the target zoom with *no* animation (no "from" to animate from) — we treat first-draw as "snap to target."
7. **Image aspect ≠ canvas aspect.** Already handled — `(px0, py0)` letterboxes the product inside the canvas. The zoom math is expressed in canvas-pixel space (`px0`, `pw`, etc.), so letterboxing is transparent to the zoom computation.
8. **Accessibility — `prefers-reduced-motion: reduce`.** Snap instantly (duration = 0). See §3.3.
9. **Dynamic placement change while tween in flight.** New target interrupts — re-snapshot current interpolated values as `from`, start fresh tween to the new `to`. No queue.
10. **Multiple selected placements (Placement step, common).** Shell picks one as `zoomTargetPlacementId` per §3.2 rules (hover → last-tapped → first-selected). Ambiguity on the first render with multiple pre-selections from draft — see Open question #2.
11. **Geometry missing for current view.** `geometryByViewId[currentView.id]` can be `null` (`storefront-config.server.ts:378`). When the resolved zoom target has no geometry on the visible view, do not zoom — the customer has presumably just swiped to a side view that doesn't own this placement. Snap back to `zoomScale = 1`.
12. **Retry / load error.** `loadState === "error"` → `NativeCanvas` is not mounted (`PreviewCanvas.tsx:175`). No zoom concern.
13. **Mobile viewport.** The frame is `aspect-ratio: 1/1` (or 4/3) and `max-width: 100%`. `cw`/`ch` (the backing bitmap) are `canvasDims.w/h`, not CSS px. Math is in bitmap pixels → scale-to-CSS via `height: auto` preserves the effect. No special mobile branch.

## 6. Testing plan

### Manual (required)
1. Upload step → canvas un-zoomed.
2. Advance to Placement step. Desktop: hover each placement row → canvas zooms/re-centers on that placement, no jump cut. Mobile: tap → zoom.
3. Placement at extreme edge (configure a test zone with `centerXPercent: 5, maxWidthPercent: 8`): verify product image clamps to left edge without a visible empty band.
4. Tiny zone (`maxWidthPercent: 2`): verify the 8× cap kicks in, no layout jitter.
5. Large zone (`maxWidthPercent: 70`): verify `zoomScale === 1`, no regression.
6. Advance to Size step with 2+ selected placements. "Continue" advances the active placement (`SizeStep.tsx:176-180`); canvas should re-zoom to each in turn.
7. On Size step, switch view dots in the canvas frame — if the new view owns the active placement (admin: Left Chest + Back: Left Chest), zoom should retarget; if not, canvas snaps to un-zoomed.
8. Go back to Placement from Size → zoom state re-initializes from hover/selection rules.
9. Review step on desktop: persistent panel shows un-zoomed (current behavior preserved).
10. `prefers-reduced-motion: reduce` (OS setting or Chrome devtools emulation): every re-target is instantaneous, no rAF animation visible.
11. Touch-swipe view navigation on mobile: zoom does not interfere with `PreviewCanvas`'s touch handlers (`PreviewCanvas.tsx:87-99`).
12. Screenshots per CLAUDE.md rule 4 (JPG format per rule at CLAUDE.md:164).

### Playwright (if practical)
- Stub `/apps/insignia/config` with a fixture that has three placements at front-center, front-edge, and back-center.
- Assert: hovering each placement row triggers one `requestAnimationFrame` cycle (via `window.performance.now()` spy) and the canvas buffer pixel at center matches the pre-computed expected rgba within tolerance. (This is more expensive than it sounds — practical fallback: visual regression screenshots per state.)
- Assert reduced-motion path by overriding `matchMedia` in `page.addInitScript`.

## 7. Rollout

Single PR — scope is ~7 files, all additive, all in one subsystem. No feature flag needed: the "no target selected" code path is the current render, so regression risk is bounded by code review quality. No migration, no API change, no Shopify surface change.

**Roll back when:**
- Any report of a cropped or misaligned logo on the storefront.
- Canvas flicker on placement change (rAF loop leaking / not cancelled on unmount).
- Mobile swipe gesture breaks because of the new math.

Git revert is sufficient — no data or backend state to unwind.

## 9. Approved decisions (locked on 2026-04-24)

All open questions have been resolved by the user. These override any conflicting guidance in earlier sections — when in doubt, follow this section.

1. **Feature proceeds as a preview enhancement.** Storefront canvas remains non-interactive. No Konva introduction.
2. **20% is measured against the canvas frame**, not the product image. Definition: the larger of `(placement.widthPx, placement.heightPx)` equals `0.20 × min(canvas.w, canvas.h)`. Rationale: user's stated goal is "print areas easier to see on mobile, especially small zones on big products" — canvas-based math gives a consistent visual size regardless of image letterboxing. Supersedes the reviewer's counter-suggestion.
3. **Review step zooms too.** The persistent desktop panel and the mobile `PreviewSheet` both honor `zoomTargetPlacementId` on Review. §3.2's "null on review" rule is replaced with: "on review, use the last active placement from Size step; if none, the first selected placement from `config.placements` order."
4. **Draft restore: un-zoomed until user interacts.** When `loadDraft` populates multiple placements, `zoomTargetPlacementId = null` until hover/tap/activePlacement-change fires. Prevents surprise on reload.
5. **Desktop Placement step: zoom on hover.** `onMouseEnter` on the placement row sets `zoomTargetPlacementId`; `onMouseLeave` does NOT clear it (prevents flicker between rows). For keyboard users, `onFocus` mirrors `onMouseEnter`. On mobile, tap-to-select also sets the zoom target.
6. **Duration: 200 ms, reuse `--insignia-dur-med`.** Use `cubic-bezier(0.2, 0.8, 0.2, 1)`. Do not introduce a new `--insignia-dur-zoom` token.

### Must-fix items from reviewer (folded into implementation scope)

- **MF-1** `targetPx = TARGET_FRAC × min(cw, ch)` (canvas shorter edge — per decision #2). Define `placementPx = max((mw/100) × pw, (mh/100) × ph)`. `zoomScale = max(1, targetPx / placementPx)`. Cap: `zoomScale = min(zoomScale, MAX_ZOOM=8)`.
- **MF-2** Per-axis clamp. Apply `pxZoomed = clamp(pxZoomed, cw - pwZoomed, 0)` only when `pwZoomed > cw`; else center horizontally: `pxZoomed = (cw - pwZoomed) / 2`. Same rule for Y. This fixes the inverted-interval bug when the product is letterboxed on one axis.
- **MF-3** `SizeStep` integration uses a **callback**, not lifting. Add `onActivePlacementChange?: (placementId: string | null) => void`. Emit via `useEffect` keyed on `activePlacement?.id` so `tryAdvance` and manual navigation both flow through one code path. Do NOT lift `activeIndex`.
- **MF-4** `PlacementStep.tsx` gets a new `onZoomTargetChange?: (id: string | null) => void`. Desktop: `onMouseEnter` + `onFocus` emit the row's placementId. Mobile: when the row's selection toggles on (`toggleSelection` adds it to the set), emit that id. `onMouseLeave` does nothing (no flicker).
- **MF-5** First-paint behavior promoted to its own edge case: `animStateRef.current === null → snap` (no rAF). Guard in the tween effect: only start a tween if `from` exists; otherwise set `to` directly and skip rAF.

### Additional guardrails

- **iOS Safari background-tab rAF**: if `delta > duration × 2`, snap to `to` and cancel the tween. Prevents frame-jump when tab resumes.
- **rAF cleanup**: every effect that schedules a rAF must cancel it on unmount (`return () => cancelAnimationFrame(id)`).
- **Keyboard accessibility**: placement rows must have `tabIndex={0}` if not already. Verify in implementation.
- **Review step reset**: when advancing from Size → Review, the shell's `zoomTargetPlacementId` is set to the last active placement (decision #3), not cleared.
- **Analytics (nice to have, not blocking)**: emit `zoom_retargeted { from, to, duration }` through `onAnalytics` if the hook exists in scope. If adding it requires wiring through new props, skip — not worth the diff expansion.

### Superseded sections

§3.1, §3.2, §3.3, §5 and §8 are all still readable for context, but where they conflict with §9, §9 wins. In particular: the claim in §3.2 that "Review gets no zoom" is superseded.

---

## 8. Open questions (closed — see §9)

1. **Is this feature still wanted?** The task description assumes a Konva-based draggable logo; the actual storefront canvas is static Native 2D, and the customer has no way to adjust position. With that baseline, zooming provides a "show the customer what their logo looks like on this specific spot" effect, but it cannot assist a transform interaction (because there isn't one). Recommend confirming scope before implementing — or, if the real intent is *"make the storefront canvas editable like the admin's Konva one"*, that is a much larger project and should be brainstormed separately.
2. **Zoom target when multiple placements are pre-selected from draft.** `loadDraft` (`CustomizationModal.tsx:399-406`) can restore several. Pick first-in-`config.placements`-order (canonical order used elsewhere, e.g. `ReviewStep.tsx:73`) or leave un-zoomed until the user hovers? Recommendation: un-zoomed until interaction, matches "no surprises on restore."
3. **Review step zoom behavior.** The prompt explicitly asks whether Review zooms. My recommendation is no (rationale in §3.2). Confirm.
4. **TARGET_FRAC value.** The brief says "roughly 20%." 20% of the *shorter canvas edge* against the *longer placement edge* is my pick. If the desired feel is "placement is prominent but product still legible," 20% is right. If the desired feel is "pop the placement," bump to 30%. Tunable single constant.
5. **Hover behaviour on mobile for Placement step.** Mobile has no hover. Should tap-to-select also set the zoom target, or should we add a separate "tap to preview" affordance? Recommendation: tap-to-select sets the target (same action), no second UI needed.
