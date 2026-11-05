# Optional customer movement in the product editor

The control belongs at Products → product → view → placement → Artwork area. It is off by default. A merchant can keep a fixed front placement and allow movement on a back placement without creating another product, method or global mode.

Six independent Luna xhigh reviews considered merchant setup, customer geometry, hierarchy, high-volume use, uncommon product shapes and failure recovery. They agreed on placement ownership. Reviews differed on a two-option choice list versus a switch. The existing native Polaris switch was retained because this is one optional boolean, the theme editor uses contextual switches, and the owner prefers that pattern. The public Switch guidance about saved forms was considered; this local editor keeps its existing explicit draft/save model.

## Implemented

- Moved the switch from the bottom Customer options section into Artwork area, after geometry and optional scale information and before Decoration sizes. Orders without artwork stays in Customer options.
- Fixed placements show only the switch and its short explanation. Enabling movement reveals the boundary status and action. Sizes and prices retain their existing meaning.
- Area needed, Area set and Review area distinguish missing bounds, valid bounds and an artwork area that no longer fits. Missing images offer Choose view image rather than an unexplained disabled action.
- The outline's existing setup warning now includes missing or invalid movement bounds. Drafts can save unfinished work; publication requires usable bounds. Disabling movement preserves the previous bounds for later reuse.
- Publication review focuses the corrective action and scrolls its measurable wrapper. Polaris component hosts can use display: contents and have zero layout bounds, so scrolling the host itself failed on phones. The regression checks the actual button against both the frame and outer viewport.
- Copy review explicitly asks merchants to check artwork and movement areas against the destination image.
- Missing-image and alignment warnings remain visible on collapsed view rows. Review view focuses the corresponding image or alignment action. Alignment copy also applies after image replacement rather than referring only to copied views.

## Scope decisions

Movement is geometry, not a decoration method or pricing tier. No product/global inheritance, extra navigation, bulk activation or mandatory ruler step was added. Large outlines reuse their existing search and setup warnings. Different products and views require deliberate boundary review after copying. No boundary is inferred from a garment silhouette, and a rectangular V1 does not claim to exclude pockets, seams, camera holes or other internal obstacles.

A movement area equal to the maximum artwork area is not automatically rejected. An approved size or aspect-fitted image can occupy a smaller footprint. Geometry validation must assess containment rather than assume equality means movement is impossible.

## Evidence and limits

All 38 relevant model, customer-option and publication checks and four focused browser workflows pass, with coverage at 1440, 390 and 320 px. Missing-image and alignment recovery also check actual focus and outer viewport visibility at 390 px. Strict admin-test TypeScript, scoped Biome and pinned Polaris 2.0 RC validation cover the edited source. Native browser review checks the original non-masking preview, including the mobile recovery action in the visible viewport. Screenshots are in `/Users/pc/Development/Insignia/.artifacts/admin-customer-positioning/`.

An early broad browser run was stopped because it exceeded this change's scope. It reported three untriaged failures around compact history actions, a method-price disclosure selector and Enter/name focus. Their relationship to this change has not been established; no claim of a clean full browser suite is made.

These changes remain in the local preview. Production configuration, signed quotes, checkout, orders and output are not wired by this pass. The masking fork and customer drag implementation were not changed.

## References

- The logged-in Shopify theme editor supplied the contextual setting and conditional-field reference. Its settings were inspected without saving changes.
- [Shopify App Home layout](https://shopify.dev/docs/apps/design/layout) supports grouping related settings beside the visual preview.
- [Polaris Switch](https://shopify.dev/docs/api/app-home/v2.0/web-components/forms/switch) and the pinned 2.0 RC validator define the control contract.
- [Polaris Choice list](https://shopify.dev/docs/api/app-home/v2.0/web-components/forms/choice-list) was considered for explicit fixed/movable modes.
- [Vercel interface guidance](https://vercel.com/design/guidelines) informed focus, conditional disclosure and real viewport checks.

## Compact control refinement

The owner found the separate left-aligned Edit movement area action awkward. Three independent Luna xhigh reviews compared a compact status/action row, a full-width control and an inline action. The compact row preserves the status without overemphasizing an occasional edit. It uses the native inline stack with space-between and centered alignment, matching Shopify's [badge and management-action example](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/inline-stack).

Movement area and its badge now stay together on the left, with Set or Edit at the trailing edge. Full accessible action names remain available. Missing images use No image and Choose image. Required guidance stays below the row; a configured area needs no extra paragraph. Removed the redundant margin above the boundary controls and stretched their row across the available width.

Native desktop and 320 px screenshots confirm the valid-state row fits. The two relevant browser workflows pass across desktop, 390 and 320 px, including editing, save/discard, retained boundaries and publication recovery. Scoped TypeScript, Biome and pinned Polaris validation pass. Evidence: `compact-movement-desktop.png` and `compact-movement-320.png` in the existing artifact directory. This is a presentation refinement, with no geometry or publication-policy change.

## Movement redraw error recovery

An invalid draw followed by a valid draw already cleared the local drawing error. A regression reproduced the reported stale state when publication review had also populated the placement's movementRect form error and page notice. The valid staged boundary cleared only the local error, leaving the earlier validation text visible until Done. A stale existing boundary followed by Save draft produced the same problem with the generic save warning.

Valid drawing now removes only the selected placement's resolved movementRect error. It clears the matching publication notice, or the generic save notice when that boundary was the sole blocking error. Other errors remain. The valid boundary stays staged until Done; Cancel still retains the original committed boundary, and missing/review status is derived from that boundary.

The regression also caught a retry trap after Escape on a first draw: with no movement draft, no redraw action was available. Stopped drawing now offers Draw movement area even without a draft. On phones retry also expands and returns to the canvas, just like the initial draw action.

Red failures were captured for stale publication text, the missing retry action and stale save text. All three focused browser workflows now pass, including direct/publish/save recovery at desktop and 390 px, plus existing switch/history/save/discard checks at 320 px. Scoped TypeScript, Biome and pinned Polaris validation pass. Native replay confirms an invalid boundary followed by a valid one clears the warning before Done. Evidence: `native-redraw-warning-cleared.png`. The owner's valid in-progress area was completed and saved locally before refreshing the preview.
