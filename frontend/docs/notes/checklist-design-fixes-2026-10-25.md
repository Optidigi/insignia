# Checklist Design audit fixes

25 October 2026. Implements the four accepted findings from the [designed-screen audit](checklist-design-product-audit-2026-10-25.md). The original audit remains the scope record. Unfinished homepage/Settings areas and the later first-time guide are outside this pass.

## Changes and reasons

Products and Orders keep their identity column visible during horizontal scrolling. Products uses a compact name/checkbox column on narrow containers and keeps thumbnails on wider screens. Table headings and existing selection/actions remain. Product method/location popovers also name their product; the shared Orders summary receives its order name. This addresses context loss without replacing the tables with cards.

The shared table uses a named, keyboard-focusable native scroll section around its existing semantic table. Only Products and Orders opt into the pinned column. Opaque cells prevent scrolled facts bleeding through. Logical scroll padding and a focus handler reveal controls that would otherwise sit under the identity column. The handler skips overlay internals and follows inherited text direction. Polaris continues to own the controls and overlays; this does not style its private shadow DOM.

The Methods overview states “per placement, per garment” beside valid fixed defaults, including zero prices. Product-specific and invalid/missing defaults keep their existing meanings. Both desktop columns and the explicitly labeled phone facts include the unit.

An empty assignment picker says to cancel, check products and staff access in Shopify, and reopen it. An empty supplied catalogue cannot establish that the shop has no products. Existing unavailable assignments “remain selected”; deliberately clearing and confirming selection still removes them. The change adds no speculative Create product or Refresh action.

Permissions leads with “Your product access” and separately labels “Insignia’s Shopify permissions.” A staff member's View only result is therefore distinct from the app's editing grant. No authorization or consent logic changed.

## Guidance actually used

Read the installed [Checklist Design skill](/Users/pc/.codex/skills/checklist-design/SKILL.md) and bundled Data Table and Empty State checklists, alongside the repository's [admin UI guidance](admin-ui-guidance-2026-10-20.md). The frozen-column and recovery items apply directly. Other checklist items were assessed in context rather than used as reasons to invent features.

Fresh Shopify research used [layout](https://shopify.dev/docs/apps/design/layout), [content](https://shopify.dev/docs/apps/design/content), the version-matched App Home helper and [sticky migration guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/sticky). The public table's mobile list transformation explains the existing app-owned table choice. Shopify supports narrowly scoped app-owned sticky behavior with overlap/focus checks; it does not mandate this particular column width. The current [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) supplied supplementary keyboard, focus-clearance and long-content checks. Prior Memorisely/Zander research remains context; no new claim is attributed to those sources here.

## Verification and independent review

The new 320px table regression first failed on lost identity, then exposed focused controls hidden under the initial pin. Both were corrected. Final focused checks pass for identity/focus, Enter/open, Escape/focus return, checkbox/navigation isolation, resize-aware name tooltips, default-price units, empty-picker recovery and effective permissions. Existing long-summary and Orders selection/export/header checks also passed during this pass. The tooltip fixture now uses a name measured to clip on phone and fit the deliberately bounded desktop column, preserving the overflow-dependent assertion.

All three gallery suites pass. The [gallery](http://127.0.0.1:62168/__preview/popup-review/) contains 123 states and 245 images, with 10 changed states first. Root inspection and independent reviews used regenerated desktop/390px images and supplemental actual 320px captures under `../.artifacts/admin-popup-review-2026-10-24/checklist-fixes`. One supplemental popover image caught its opening animation; it was replaced after `aftershow` and rechecked by both reviewers. Settings captures predate the final table edits but contain the final unchanged permissions source.

Astro diagnostics/build pass for 147 files, with zero diagnostics. Strict admin-test types and scoped Biome pass; the stylesheet retains three pre-existing skeleton warnings. Version-matched Polaris validation passes for the changed shared table/summary and the three copy components. Standalone Products/Orders validation retains imported-type/Array.at limitations; the actual project type checks pass. No full browser-suite claim is made.

Two independent GPT-6.1 Sol medium reviews cover [design](checklist-fixes-design-review-2026-10-25.md) and [interaction](checklist-fixes-interaction-review-2026-10-25.md). Their findings prompted narrower pinning, direction-aware focus checks and precise selection copy. The interaction reviewer independently exercised Products/Orders at 320px. Both conclude this scope is ready for owner review without remaining actionable implementation findings.

Products/Orders/shared components and permissions are application source. The richer Methods index/picker remains local workflow-preview code. No backend integration, account change, checkout, deployment or owner acceptance is claimed. Native Shopify-host, assistive-technology, dark appearance and broad zoom/RTL acceptance remain separate.
