# Audit fixes interaction review

25 October 2026. Independent Sol review. I did not implement these changes. This is a focused follow-up to the [Checklist Design product audit](checklist-design-product-audit-2026-10-25.md), covering the identified table-context and copy/recovery fixes. It is not a second full product audit.

## Scope and evidence

I read `AGENTS.md`, the admin UI guidance, current state, the affected specification sections, and the current source for `AdminResourceTable`, `AdminValueSummary`, Products, Orders, Methods index/product picker and `ReadinessPermissions`. I used the installed Checklist Design Data Table and Search Results bundles for frozen columns, selection, result identity and empty-state recovery. Shopify App Home guidance takes precedence over the supplementary Vercel interface rules.

The inspected runtime selects `polaris-2.0-rc.js`; the type dependency is exactly `@shopify/polaris-types` 2.0.0-rc.3. The official [versioned Table contract](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/layout-and-structure/table) offers auto/list layouts and explains click delegation as a pointer affordance with a real interactive target retained for keyboard users. The implementation deliberately owns native table/scroll/sticky structure while retaining Polaris controls. The [Shopify layout](https://shopify.dev/docs/apps/design/layout) and [content](https://shopify.dev/docs/apps/design/content) guidance support clear column context and actionable, accurate recovery. The current [Vercel interface rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) supplement this with semantic HTML, visible focus, sticky-focus clearance and long-content checks.

Source and regression-design review establish the following:

- The named native scroll section has a keyboard focus stop and visible focus rule. The table keeps explicit column headings. Products and Orders opt into sticky identity; Methods retains its prior column layout. Sticky identity uses logical inline positioning, an opaque Canvas background and the same hover/selection tint as the remaining cells.
- The product identity switches from 400px to 144px when the table container is narrow, hides the thumbnail there, and retains the selection checkbox and real resource link. Long names retain their existing clipping/reveal path.
- The focus handler reads the composed event path, skips the identity cell and overlay internals, and asks the scrollport to reveal controls behind the sticky column. This avoids moving the table merely because focus enters its summary popover.
- Row click delegation ignores links, native controls, Polaris controls and overlays in the composed path. Checkbox changes and summary-button activation therefore have their own interaction paths; a real resource link remains available for keyboard navigation.
- Product method/location summaries name the product. Orders method summaries name the order. The full value list wraps labels and retains bounded scrolling.
- Methods fixed-price summaries state the per-placement, per-garment unit, including valid zero prices. Product-specific and missing-price states do not imply an unsupported numeric basis.
- Picker empty-catalog guidance offers an available Cancel recovery and says unavailable assignments remain selected. This wording accurately permits the visible Clear selection action to change the pending selection, followed by the separate Select commit. Search/selected-only empty results offer Show all products, which clears the query and facets without changing selected IDs. The primary Select action remains disabled when the selected set is unchanged; an intentional clear remains an actual change.
- Product-access copy distinguishes the effective server `canRead`/`canEdit` result from the app-scope grant. It does not present an app grant as proof that the current staff account can edit.

I inspected the new 320px regression's assertions for pinned identity width, focused summary clearance, Enter/open, Escape/focus return, product context and checkbox/navigation isolation. Existing focused tests also cover long-title tooltips, bounded summary scrolling, selection focus restoration, picker unchanged/unavailable assignments and empty recovery. Reading a test is not a claim that I independently ran it.

## Rendered and interaction checks

I inspected the fresh desktop and 390px gallery captures for Products method summary, Methods index, empty-catalog product picker and view-only permissions. I also inspected the supplemental 320px Products/Orders scrolled tables, product-location summary and view-only permissions capture. The product-specific summary title is visible at desktop and phone widths. Methods price-unit copy fits its desktop table and phone resource-list composition. The picker has a neutral empty message, visible retained-assignment count, disabled unchanged Select and available Cancel. The permission capture clearly places View only beside the current account's access while separately reporting app grants.

After the final preview restart, I independently used a new Chrome tab on loopback port 62168 at 320×700. I observed the following live:

- Products summary opened with Enter, displayed the hoodie name and all three locations, and stayed fully opaque/readable after opening. Escape closed it and restored focus to its trigger.
- Selecting the hoodie row checkbox stayed on Products. Clear selection restored focus to the header checkbox. Tab then reached the clipped product link and its full-name tooltip; the next Tab revealed the Methods summary button fully beyond the pinned identity column.
- Orders' named columns region accepted keyboard focus with a visible ring. Repeated Right-arrow input reached the far-end Customized items column while order numbers #1042 through #1049 and their checkboxes remained visible.

The live Orders demo contained one method per order, so I did not exercise an Orders multi-method popover. I reset my viewport override and closed only my new review tab. No global demo reset or account writes occurred.

The root agent reports all five final focused workflows and three gallery suites passing, with the project strict type check and Astro build passing. These are reported verification results, separate from my own source and live checks. The regenerated gallery contains 123 states and 245 images; I inspected the selected scope above, not every capture.

## Findings and disposition

Ready for owner review of this fix scope. I found no remaining P1/P2/P3 implementation issue in the examined final states. The phone identity/context issue is addressed in the observed Products and Orders tables, and the copy/recovery changes match the source behavior.

The initial focus-reveal handler used a physical left-edge comparison. I raised the mismatch with logical sticky positioning during review. The final handler selects the correct edge from computed direction. I inspected the root agent's supplemental `checklist-fixes/proof.json`, which records a Products RTL blur/refocus check with the trigger clear of the pinned column. That is a targeted Products result, not proof of full RTL or Orders RTL behavior.

The initial `checklist-fixes/products-location-summary-320.png` caught a translucent opening-animation frame. The root agent recaptured it after the overlay's explicit `aftershow` event. I inspected the replacement: the popover is opaque and readable, with the full hoodie name, Print locations heading and all three locations visible. This evidence cleanup is closed; no application change was needed.

An earlier live attempt reached Interface unavailable because the running preview retained old compiled asset references after a rebuild. The final restarted preview loaded successfully. This was a preview lifecycle issue, not an audit-fix finding. Chrome DevTools MCP could not acquire its separate browser profile; CUA supplied the live interaction evidence above. I did not modify application code, alter the user's existing Chrome tabs, grant permissions or run a build/full test suite.

Native Shopify host appearance, physical mobile keyboard behavior, VoiceOver/NVDA, zoom and full RTL behavior remain outside this review. Owner visual acceptance and release approval remain separate. Evidence is under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/{orders-settings,methods,settings,checklist-fixes}`.
