# Plan: Storefront Canvas View-Switch Cue

> **Status:** Approved by user on 2026-04-24. Decisions recorded in §11. Ready for implementation.

## 1. Summary

When hovering a placement row forces a view change, the current `key={currentView.id}:${retryKey}` pattern in `PreviewCanvas.tsx:223` remounts `NativeCanvas`, causing a flash of empty background and a re-download of the product image. The proposed fix is a **CSS cross-fade between two stacked `NativeCanvas` layers inside the existing `.insignia-canvas-frame`**, driven by a small outgoing-view snapshot that the frame keeps alive for one `--insignia-dur-med` (200 ms) transition, layered with a **brief view-name chip** (aria-live: polite) as the intentionality cue. No animation library, no new tokens, no changes to the shipped zoom tween's math — zoom state belongs to the *incoming* canvas only; the outgoing one is frozen.

## 2. Current behaviour and why it is jarring

- **Remount mechanism.** `app/components/storefront/PreviewCanvas.tsx:223` — `<NativeCanvas key={`${currentView.id}:${retryKey}`} …>`. Any change to `currentView.id` unmounts/remounts, wiping the component's internal `loaded`/`error`/`canvasDims` state plus `currentZoomRef`/`animStateRef`/`rafIdRef`.
- **Image-load flash.** On mount, `NativeCanvas.tsx:269-310` sets `loaded=false` and only flips to `true` when the `<img>` finishes downloading. During that window the component returns the skeleton `<div>` at `NativeCanvas.tsx:659-675` (`background: #f9fafb`, `aspect-ratio: w/h`). The frame simultaneously applies `data-state="loading"` (`PreviewCanvas.tsx:191, 199`) which swaps the frame background to `var(--insignia-bg-subtle)` per `storefront-modal.css:798-800` and renders the `.insignia-canvas-status` "Loading…" label (`PreviewCanvas.tsx:242-246`). Net visual: canvas content vanishes, frame greys, a tiny text label appears, then the new image pops in — three jumps in ~50–500 ms.
- **Hover trigger.** `app/components/storefront/PlacementStep.tsx:143` resolves `ownerView`, then at `:156-170` `onMouseEnter`/`onFocus` call `onDesktopActiveViewChange(ownerView.id)` and `onZoomTargetChange(p.id)` in that order. These flow to `CustomizationModal.tsx:1136-1140` via `setDesktopActiveViewId` and `setZoomTargetPlacementId` — two independent `useState` setters, so React batches them, but the view swap alone is enough to cause the remount.
- **Why the zoom does not cover the flash.** The zoom tween (`NativeCanvas.tsx:476-611`) cannot run during the image-load window because `useEffect` bails early on `!loaded` (`:490-491`). So when the view changes, the incoming canvas enters `loaded=false`; the tween only starts after the image resolves, which is *after* the user already saw the flash.

## 3. Options considered

1. **Cross-fade two canvas layers.**
   - Pro: matches the existing "smooth, quiet" modal aesthetic; works inside `overflow: hidden` on `.insignia-canvas-frame` (`storefront-modal.css:789`); uses only `opacity` transitions, composited cheaply.
   - Pro: if the outgoing canvas is kept as a frozen DOM element (no redraw loop), the fade costs one compositor pass, not a double Canvas re-render.
   - Con: needs an image preload strategy to have something to fade *into*; otherwise it's "old fades out to grey, grey fades to new" = two fades of a flash.
2. **Slide between views.**
   - Pro: natural alignment with existing mobile swipe gesture (`PreviewCanvas.tsx:97-109`).
   - Con: direction ambiguity. Swiping gives a user-supplied direction; hover does not. Picking a direction (e.g. next-view-in-array = left-to-right) divorces the motion from the placement geography (hovering "Rug" = back may slide either way depending on view ordering). Reads as random.
   - Con: can actively fight an in-flight swipe: if a user is mid-drag on mobile and a placement-row tap also triggers a view change, you get two conflicting slides.
3. **3D flip (CSS perspective).**
   - Pro: narratively strongest ("I'm turning the shirt around").
   - Con: kitschy for a checkout flow; adds 3D transform cost on low-end mobile; needs a back-face element (another canvas snapshot) — same engineering as cross-fade but louder.
   - Con: doesn't generalize to "Left sleeve" → "Right sleeve" which isn't a rotation of the same object at all.
4. **View-name chip alone.**
   - Pro: zero risk, cheapest diff, accessible (can live inside an aria-live region).
   - Con: does not remove the image flash. Users still see the canvas blink; the chip adds "oh, we changed view" but doesn't make the blink feel intentional.
5. **Dot indicator pulse.**
   - Pro: reuses existing `.insignia-canvas-dots` (`storefront-modal.css:835-851`); one CSS keyframe.
   - Con: dots live *below* the frame on step-context (`PreviewCanvas.tsx:271-284`), far from where the user's eye is (hovering a placement row on the right panel, watching the canvas). Low visibility.
   - Con: on desktop panel context, dots may be visible; on mobile bottom-sheet context they're cramped. Inconsistent.
6. **Directional swipe arrow overlay.**
   - Pro: same benefit as slide without committing to the whole motion.
   - Con: same direction-ambiguity problem. Arrow pointing *somewhere* implies a spatial relationship between views that doesn't necessarily exist.
7. **Combination: cross-fade + view-name chip.**
   - Pro: cross-fade removes the flash; chip names the new view; chip doubles as the aria-live announcement for screen readers; both respect reduced motion (chip still fades in, cross-fade collapses to instant swap).
   - Con: two concurrent animations to tune. Both use `--insignia-dur-med`, so they stay in sync; complexity is low.

## 4. Recommendation

**Primary: cross-fade two canvas layers. Secondary: a view-name chip (top-center, 1.5 s visibility) that also serves as the aria-live announcement.**

Why this wins for this app:
- **Customer-facing embedded modal.** The feel is "polished static preview," not "interactive 3D configurator." Cross-fade matches. Slide/flip over-promise interactivity that isn't there.
- **Zoom compatibility.** The zoom happens *inside* the incoming canvas. The outgoing canvas is frozen — its `currentZoomRef` holds whatever zoom it had when we snapshotted it. The incoming canvas runs its own first-paint zoom snap per MF-5 (`storefront-canvas-zoom-to-placement.md:195`). Two canvases never race on zoom state because only the incoming one is alive.
- **Reduced motion fallback degrades cleanly.** No cross-fade, instant swap, chip still appears (static, no fade). Dot pulse isn't reduced-motion-friendly (pulse *is* motion); cross-fade is because `opacity 0→1` with `transition: none` is just "swap."
- **Chip as double-duty a11y.** One `role="status"` / `aria-live="polite"` element satisfies screen-reader and visual needs with one DOM node. Does not require a focus trap change — it's a status message, not focusable.
- **Slide rejected** because hover-triggered direction is arbitrary. Arrow overlay rejected for the same reason. Flip rejected as too loud for checkout.

## 5. Proposed design — exact mechanics

### 5.1 Two-layer cross-fade in `PreviewCanvas`

**DOM structure (replaces the single `<NativeCanvas>` at `PreviewCanvas.tsx:222-240`):**

```
.insignia-canvas-frame
  .insignia-canvas-layer[data-role="outgoing"]   (absolutely positioned, opacity 1 → 0)
    <NativeCanvas key={outgoingKey} …frozen props…/>
  .insignia-canvas-layer[data-role="incoming"]   (absolutely positioned, opacity 0 → 1)
    <NativeCanvas key={currentKey} …live props…/>
  .insignia-canvas-viewchip (top-center, aria-live)
```

Both layers are `position: absolute; inset: 0;`. The frame already centers via flex (`storefront-modal.css:785-796`); each layer re-creates centering internally with `display: flex; align-items: center; justify-content: center;`. The `<canvas>` inside `NativeCanvas` renders with `max-width: 100%; height: auto` (`NativeCanvas.tsx:683`) so both layers size identically.

**State model (new in `PreviewCanvas`):**

- `const [displayedView, setDisplayedView] = useState(currentView)` — what the "incoming" layer renders.
- `const [outgoingView, setOutgoingView] = useState<View | null>(null)` — the frozen old layer, or `null` when no transition is in flight.
- `const outgoingLoadStateRef = useRef<LoadState>('ready')` — snapshot of the prior load state so we don't fade *from* a grey loading shell.
- A `useEffect` keyed on `currentView.id` detects a view change. If the new view's image is already preloaded (§5.3) AND the previous layer was `ready`, start a transition: set `outgoingView = previousDisplayedView`, set `displayedView = currentView`, schedule a `setTimeout(() => setOutgoingView(null), 200)` matching `--insignia-dur-med`. If the image is not preloaded OR previous layer was not `ready`, skip the cross-fade and fall through to today's behaviour (remount) — honest about the limit of the cue (per constraint 8).

**Key strategy:**

- Incoming layer: `key={`${displayedView.id}:${retryKey}`}` — remounts only when `displayedView` actually changes, not on every parent render.
- Outgoing layer: `key={`${outgoingView.id}:outgoing:${transitionId}`}` where `transitionId` is a counter bumped per transition. This gives each outgoing snapshot a unique identity so back-to-back transitions don't collapse keys.

**Freezing the outgoing canvas:**

- Render the outgoing `<NativeCanvas>` with the same props it had *before* the switch, but with `zoomTarget` omitted so its tween effect won't re-run. (The rAF already paused at the end of its last tick; its `currentZoomRef` holds the final value; the `<canvas>` bitmap is intact because React preserves the DOM node until unmount.)
- To ensure no re-draw, also suppress the outgoing layer's `onLoadStateChange`/`onImageMeta`/`onLogoMeta` callbacks (pass `undefined`) so it can't feed back into parent state and trigger a re-render that touches its props.
- Critically: the `<canvas>` element on the outgoing layer is *untouched after mount.* Its bitmap survives until React removes the element. The 200 ms window is well under any GC pressure.

**Zoom state transfer: none.** Decision: the incoming canvas does its own first-paint snap (MF-5). Rationale: the zoom target may not even exist on the outgoing view (that's often *why* the view switched). Trying to animate the zoom across the fade would require projecting geometry between views, which doesn't have a consistent semantic. The fade itself hides the zoom-snap discontinuity.

**CSS (new, added after `storefront-modal.css:851`):**

```
.insignia-canvas-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity var(--insignia-dur-med) var(--insignia-ease-out);
}
.insignia-canvas-layer[data-role="outgoing"] { opacity: 0; pointer-events: none; }
.insignia-canvas-layer[data-role="incoming"] { opacity: 1; }
.insignia-canvas-layer[data-entering="true"]  { opacity: 0; }   /* incoming at t=0 */
```

The `[data-entering="true"]` state is applied for one frame (via `requestAnimationFrame`) then removed — standard "mount at opacity 0, next frame flip to 1" pattern.

### 5.2 View-name chip

- One element inside `.insignia-canvas-frame`, positioned `top: 12px; left: 50%; transform: translateX(-50%);` so it sits above both canvas layers without overlapping the prev/next arrows (which are at `top: 50%`).
- Content: the view's `name` if present else capitalised `perspective` (same rule as `PreviewCanvas.tsx:50-52` `capitalize`). Always prefixed with an `IconRefresh`/`IconShirt` or nothing — prefer text-only for localisation simplicity.
- Trigger timing: appears when the view-change effect fires. Fades in 120 ms (`--insignia-dur-fast`), visible 1200 ms, fades out 200 ms. Driven by a `setTimeout` chain stored in a ref, cancelled on rapid successive view changes (the chip text updates in place and the visibility timer resets).
- `role="status"` `aria-live="polite"` on the chip so screen readers announce the view name. Do *not* use `aria-live="assertive"` — that would interrupt placement-row announcements mid-read.
- CSS: a new `.insignia-canvas-viewchip` class; background `rgba(255,255,255,0.95)`, padding `4px 10px`, border-radius `999px`, same `box-shadow: var(--insignia-shadow-sm)` as `.insignia-canvas-nav`. Opacity transition via `--insignia-dur-fast`/`--insignia-ease-out`.
- Reduced motion: opacity changes kept (they are not motion per the MDN definition), but no CSS keyframe animation. Just two discrete states: visible or not. Add to the reduced-motion block at `storefront-modal.css:1915-1948` if needed (likely not — `opacity` transitions are generally accepted under reduced motion; confirm with user in Open Questions).

### 5.3 Image preloading

**Preload all view images up-front once the config loads.** In `PreviewCanvas.tsx`, add a `useEffect` keyed on `availableViews` that creates an off-DOM `new Image()` for each `v.imageUrl` and attaches no handlers (the browser caches by URL). When `NativeCanvas` later constructs its own `new Image(); img.src = imageUrl` at `NativeCanvas.tsx:273, 303`, the HTTP cache resolves the fetch synchronously or near-synchronously, and the `onload` fires the same tick or next microtask.

Why this is safe:
- The storefront modal typically has 2–4 views with presigned R2 URLs. Preloading is 2–4 extra HTTP requests at mount — negligible bandwidth, warms the cache for inevitable navigation anyway.
- Doesn't change the tainted-canvas note (`NativeCanvas.tsx:8-10`); still no CORS headers, still no `toDataURL`.
- If a preload 404s, nothing breaks — the actual `NativeCanvas` load will also 404 and hit its `onerror` path (`NativeCanvas.tsx:297-302`). Cross-fade suppresses itself in that case (`outgoingLoadStateRef !== 'ready'`).

**Honesty clause.** During the very first navigation after the modal opens, before preloads have resolved, the cross-fade downgrades to "outgoing fades to empty, then new image arrives." We accept this. It's strictly no worse than today (the flash is still there the first time), and it's imperceptible on warm cache after the first view.

## 6. Files to change

| File | Lines | Change | Load-bearing? |
|---|---|---|---|
| `app/components/storefront/PreviewCanvas.tsx` | 195-288 | Restructure frame to hold two `.insignia-canvas-layer` children; add `outgoingView` / `transitionId` state; add preload `useEffect`; add chip element + timer ref. | **YES** — per `CLAUDE.md`, storefront modal is load-bearing. |
| `app/components/storefront/storefront-modal.css` | add after 851 (canvas layer + chip classes); update 1915-1948 (reduced-motion block) | New classes `.insignia-canvas-layer`, `.insignia-canvas-viewchip`; reduced-motion override to set `transition: none` on layers and chip. | **YES** — same subsystem. |
| `app/components/storefront/NativeCanvas.tsx` | 253, 659-675 | No functional change. Verify: when rendered with `onLoadStateChange={undefined}` (outgoing frozen), no unexpected side effects. Also confirm the skeleton div at 659-675 does not appear on an already-loaded outgoing layer — it won't, because `loaded` is local state and remains `true`. | **YES**. |
| `app/components/storefront/PlacementStep.tsx` | 156-170 | No change. The hover handler already fires `onDesktopActiveViewChange` which the new PreviewCanvas interprets correctly. Optional: add `aria-describedby` wiring to the chip's id if we want keyboard users to hear it through the row's label instead of via `aria-live`. Defer to Open Questions. | **YES** but untouched. |
| `app/components/storefront/SizeStep.tsx` | 206-211 | No change. It uses the same `onDesktopActiveViewChange`. | **YES** but untouched. |

## 7. Edge cases

1. **Rapid hover flicker across three views (A → B → C in 50 ms).**
   - Effect: the view-change `useEffect` fires twice in quick succession. First transition (A→B) starts; its `setTimeout` is still pending when B→C fires.
   - Handling: store the timeout id in a ref; on a new transition, clear the old timeout, set `outgoingView = displayedView (which was B)`, set `displayedView = C`. The A snapshot is replaced by B snapshot in the outgoing slot; A's DOM is unmounted immediately. Visually: B fades out, C fades in. A is skipped. This is the right behaviour (the user's hand moved; they don't want to see A again).
   - Chip: text updates in place, visibility timer resets. No stacking.
2. **Swipe-in-flight + hover-driven view switch.** Swipe is mobile-only (`PreviewCanvas.tsx:97-109`); hover is desktop-only. They cannot collide in the same viewport. (Tap-to-select on mobile emits `onZoomTargetChange` but does *not* change view — view only changes when there's a placement-owning rule. Worth verifying: see Open Q 2.)
3. **Placement exists on multiple views (shared zones).** `PlacementStep.tsx:143` picks the first view where `geometryByViewId[v.id] != null`. Today's behaviour: deterministic based on `config.views` ordering. The cue inherits the same determinism; no new behaviour needed. If the customer hovers a shared-zone placement while already on a valid view, `ownerView.id === currentView.id` and no transition fires — correct.
4. **View image 404.** Outgoing `onerror` state is already cached in `outgoingLoadStateRef`. If it was `'error'`, we don't cross-fade from it; we fall through to the error UI in the incoming layer (`PreviewCanvas.tsx:205-220`). If the *incoming* image 404s, the incoming canvas reports `'error'` via its `onLoadStateChange`; the frame swaps to `data-state="failed"` and shows the retry button. The outgoing layer should be unmounted immediately in that case to prevent "failed UI layered on top of a stale working canvas" weirdness — add an effect: if incoming state becomes `'error'`, clear `outgoingView`.
5. **Reduced-motion users.** `transition: none` on both layers → incoming appears opacity-1 instantly, outgoing is removed on next tick. Chip still renders (static, no fade). aria-live announcement still fires. No functional loss.
6. **SSR / first paint.** The modal is client-only (checked via `isDesktopViewport` hook at `CustomizationModal.tsx:206-216`). On first paint there is no outgoing view; `outgoingView === null` → only the incoming layer renders, identical to today's single-canvas behaviour.
7. **Retry button.** `PreviewCanvas.tsx:211-219` bumps `retryKey`, changing the incoming layer's `key` and remounting it. We should *not* treat retry as a view change — no cross-fade. Guard: only transition when `displayedView.id` changes, not on `retryKey` change.
8. **Same view re-fired (hovering two rows that share a view).** View id unchanged → no cross-fade, no chip. Only zoom re-targets. Already handled by the "only transition on id change" guard.
9. **Keyboard `onFocus` path.** Same as `onMouseEnter`. Chip announcement via `aria-live` ensures screen reader users hear "Back" when tabbing onto the "Rug" row. Visual chip appears for sighted keyboard users too.
10. **Modal focus trap.** The chip is not focusable (no `tabindex`), not a button, not interactive. Focus trap unaffected.

## 8. Accessibility

- **Announce-the-change.** The `.insignia-canvas-viewchip` element carries `role="status"` `aria-live="polite"` and its text content is the view name. On update, most screen readers re-announce. Testing target: NVDA + Firefox, VoiceOver + Safari iOS.
- **Keyboard parity.** `PlacementStep.tsx:165-170` already handles `onFocus`. The cue fires identically. No new bindings needed.
- **Focus trap.** Unchanged. Chip and outgoing layer both non-focusable.
- **Reduced motion.** Described in §5.2; chip opacity toggles remain because they're not perceived as "motion" in the WCAG 2.3.3 / reduced-motion sense, but we provide an override to kill the `transition` regardless (user explicitly flagged this constraint).
- **Color contrast.** Chip background `rgba(255,255,255,0.95)` + existing text colour tokens. Verify the chip's text meets 4.5:1 against both a light product shot and a dark one; if not, add `box-shadow: var(--insignia-shadow-sm)` (already in the spec) plus a subtle `border: 1px solid var(--insignia-border)` for separation on light backgrounds.

## 9. Testing plan

**Manual (local dev, desktop + mobile emulator):**
- Hover across all placement rows; confirm smooth cross-fade, no flash after first navigation.
- First-time navigation (cold cache): confirm fallback is no worse than today.
- Rapid hover A→B→C→A; confirm chip settles on correct final view, no stuck fade.
- Reduced motion on (OS-level): confirm instant swap + chip still appears.
- 404 one view's image in DevTools → hover to trigger it; confirm error UI renders cleanly over cleared outgoing layer.
- Mobile swipe between views; confirm cross-fade fires for swipe-initiated view changes too (same code path).
- Keyboard tab through placement rows; confirm chip text updates and (with screen reader on) announcement fires.
- Zoom into a placement, then hover a row that owns a different view; confirm the zoom snaps correctly in the new view's first paint (no zoom animation across views — matches §5.1).

**Playwright candidates (add to existing storefront modal test file if one exists; else skip — Open Q):**
- "Hovering a placement row in a different view swaps the canvas and shows a view-name chip." Assert chip text matches owner view name; assert chip disappears after ~1.5 s.
- "Reduced-motion preference is respected" — set `prefers-reduced-motion: reduce` via `page.emulateMedia`, assert the two canvas layers do not both exist concurrently (outgoing is cleaned up within one tick).
- "Zoom state is not shared between incoming and outgoing canvases" — hover row A (view 1), then row B (view 2 with a tiny zone), snapshot canvas bitmaps to confirm zoom appears on incoming only. Likely too brittle for Playwright; mark as manual.

## 11. Approved decisions (locked 2026-04-24)

All open questions resolved by user. These override any conflicting guidance in earlier sections — §11 wins when in doubt.

### UX decisions
1. **Cross-fade only. No view-name chip.** Ship the minimum viable cue. §5.2 (chip) is superseded and should not be implemented. Mobile aria-live announcements are deferred — placement row context is sufficient for screen readers.
2. **Freeze the frame's `aspect-ratio` during transitions.** When a transition starts, lock the `.insignia-canvas-frame` to whatever `data-aspect` it currently shows. On transition end, re-evaluate against the incoming view's `ImageMeta`. Prevents wobble when front (1:1) and back (4:3) have different aspects. Use a new `data-transitioning="true"` attribute on the frame; a small inline style or CSS rule keeps the ratio stable while that attribute is present.
3. **Zoom-active → un-zoomed uses a longer fade (300 ms) instead of 200 ms.** When the incoming view has no geometry for the current `zoomTargetPlacementId` (so the incoming canvas's zoom will snap to scale=1), extend the cross-fade to 300 ms. This reads as a single motion rather than two racing ones. Introduce a `--insignia-dur-slow: 300ms` CSS token *or* drive this via inline `transitionDuration` on the layer; the token is cleaner and survives review.
4. **`PreviewSheet` (mobile bottom-sheet) inherits the behaviour automatically.** It already renders `PreviewCanvas`, so no mobile-specific wiring is needed. Swipe-between-views will cross-fade identically to desktop hover.

### Reviewer must-fix items (all folded into implementation scope)
- **MF-1 Freeze outgoing draw-relevant props.** On transition start, snapshot `placements`, `highlightedPlacementId`, `sizeMultiplier`, `logoUrl`, `logoUrlByPlacementId`, `zoomTarget` into a `useRef` keyed per-transition. Pass the snapshot to the outgoing `<NativeCanvas>`. The incoming layer receives live props. This prevents parent re-renders from triggering `draw()` on the frozen layer.
- **MF-2 A→B→C initial-opacity snapshot.** On transition start: `const currentOpacity = parseFloat(getComputedStyle(incomingEl).opacity)`. When promoting the current incoming layer to the outgoing slot mid-fade, its starting opacity for the fade-out must be `currentOpacity`, not `1`. Apply this via inline `style.opacity` on the outgoing element BEFORE the CSS transition fires, then let the transition carry it to 0. Use a `requestAnimationFrame` to ensure the inline style lands before the transition begins.
- **MF-3 Reduced-motion kills the cross-fade layers.** In the `prefers-reduced-motion: reduce` block (`storefront-modal.css:1915-1948`), add `.insignia-canvas-layer { transition: none; }`. Functional behaviour: incoming appears instantly, outgoing is removed on next tick. No chip to worry about (cut per decision 1).
- **MF-4 Unmount outgoing on incoming-error.** When incoming `onLoadStateChange` fires `"error"`, clear any pending `setTimeout` and set `outgoingView = null` immediately. Prevents "failed UI layered over a stale working canvas" visual glitch.
- **MF-5 Verify R2 Cache-Control headers before relying on preload.** Read `app/lib/storage.server.ts` to check whether presigned URL generation sets cacheable headers. If R2 responses lack `Cache-Control` (likely — presigned URLs typically don't), the preload is a no-op and cross-fades fall back to "outgoing fades to grey, new image loads." Two options in that case:
    - (a) Add `Cache-Control: private, max-age=3600` to the presigned URL policy.
    - (b) Accept that the first navigation to each view is the "current flash" behaviour; subsequent navigations benefit from the browser's image cache (most browsers cache images regardless of Cache-Control for short periods).
  Implementation must check and report the finding. If (a), flag it as a separate task — changing R2 cache policy could have implications beyond this feature.

### Additional guardrails (not reviewer-flagged but worth codifying)
- **Retry button must not cross-fade.** Guard the transition `useEffect` on `displayedView.id !== currentView.id`, not on any dep that includes `retryKey`.
- **Frame's `overflow: hidden`** already present on `.insignia-canvas-frame` (`storefront-modal.css:789`) — do not alter.
- **Zoom tween cleanup** on outgoing layer: the rAF is already cancelled in the unmount cleanup at `NativeCanvas.tsx:600-607`. When the outgoing `<NativeCanvas>` eventually unmounts at the end of the fade, its rAF is cancelled cleanly. No leak.
- **Transitioning flag ref cleanup**: the timer ref must be cleared on `PreviewCanvas` unmount. Otherwise a late-arriving `setOutgoingView(null)` fires on an unmounted component.

### Superseded sections
§5.2 (view-name chip) is fully cut. §7.9 (keyboard onFocus) still applies but the "chip text updates" part is dropped. §8 (Accessibility) — the chip-based aria-live announcement is gone; accept the deferred-a11y tradeoff per decision 1. §10 (Open questions) are all closed.

---

## 10. Open questions (closed — see §11)

1. **Chip visibility duration.** 1.5 s feels right but is a taste call. Shorter (800 ms) is less intrusive; longer (2.5 s) ensures screen readers on slow settings get through the announcement. Recommendation: 1500 ms. Confirm.
2. **Does tap-to-select on mobile change the view, or only the zoom target?** `PlacementStep.tsx:84-106` calls `onZoomTargetChange` but not `onDesktopActiveViewChange`. If mobile taps do *not* change view, the cue only runs on desktop hover + mobile swipe. Is that the intent, or should mobile tap also route through `onDesktopActiveViewChange` (which would need to stop being "desktop-prefixed" in naming)?
3. **Chip position.** Top-center (my recommendation) vs. top-left (less overlap with the canvas product, matches many dashboard patterns). Top-left is easier to miss with the eye when the user is focused on the right-side placement list.
4. **Playwright coverage.** Does a storefront-modal e2e file already exist, and should this cue be tested there, or is a manual QA pass sufficient given the visual-only nature of the change? (I did not search the tests folder for this plan; flag for implementation session.)
