# Frontend flow and loading recheck

29 October 2026. A fresh check of the designed customer customizer and admin pages. This is local frontend verification, not Shopify integration, deployment or owner acceptance.

## Ownership and coverage

The selected customer frontend is `../designer-prototype`, including light/dark themes. It is an Insignia customizer opened from Shopify. Shopify owns the product page, cart and checkout. Its `/product` route remains a labelled developer-only host preview. The separate `apps/storefront` integration UI was not used as a customer design reference or added to the design gallery.

| Area | Checks |
|---|---|
| Customer customizer | Empty/sample configurations, artwork/size/review steps, colours and positions, quantities and validation, uploads and recovery, nested dialog dismissal, undo, close/reopen, history, add/update and unchanged-edit Done. Classic and long content at 1440/390/320 in both themes; all 13 configured scenarios exercised by the maintained browser suite. |
| Home | First-use and operating states, guide dismissal retaining a useful action, metrics linking to Orders, recent work and product setup links, independent panel recovery. |
| Products and product setup | Search/filter/pagination and return context, view/placement setup, manual variant photos, methods/prices, copy/reuse, save/discard/publication and interrupted/stale recovery. |
| Methods | Library/product pricing separation, staged assignments and modal cancellation, save/discard and navigation, mobile/large selections, defaults not silently repricing existing product setups. |
| Orders and artwork | Triage/search/pagination, current-row navigation, order context and historical pricing, replacement/preview/download/export, unavailable/expired artwork and retry behavior. |
| Settings | Hub destinations, permission checks, billing handoff and recovery, storefront setup and product-test context. Shopify-owned actions remain handoffs; returning alone does not establish success. |
| Loading | Initial cold paint, native runtime ready with data still pending, loaded/error recovery, known columns/cards/fields/row shapes and phone wrapping. Data-dependent list lengths and conditional banners remain unknown until reads finish. |

The broad suite and independent walkthroughs cover these paths. This is not a claim that every possible merchant catalogue or native theme has been tested.

## Findings fixed

1. Colour and position searches updated only on blur. The shared native Preact search field now uses the input event. New browser regressions type and clear without leaving the field.
2. Quantity totals and validation also waited for blur. The quantity field now dispatches input immediately. Fractions, over-limit values and clearing stay editable and are validated without prematurely clamping customer input.
3. Review's Edit quantities action removed its focused button without assigning focus to its destination. It now focuses and reveals the first enabled quantity field, consistent with the existing artwork edit action.
4. Products cold loading stacked its identity cells and changed row height sharply when Polaris defined. Explicit fallback grid tracks retain the horizontal checkbox/image/title arrangement.
5. Generic fallback CSS replaced declared skeleton dimensions with unrelated shared sizes. A small shared `AdminSkeletonBar` wrapper preserves actual declared widths/heights before and after native readiness across tables, forms and order details.
6. Methods setup reserved one generic card instead of its three known sections and unboxed summary; mobile list loading also omitted known metadata lines. The placeholders now follow those structures and reserve the known explanatory text wrapping.
7. Methods first paint triggered a reproducible pinned Polaris `ScrollBox` constructor error. Only the loading placeholder now uses the existing app-owned scroll container. The loaded native control and vendor runtime are unchanged. A regression checks that upgrading the loading shell produces no browser errors.
8. Settings child loading headings were boxed although native headings sit outside their cards. Permissions/Billing/Storefront now follow the known heading/card arrangement. Fixed descriptions reserve their expected phone lines; no new async work is invented for static pages.
9. Home used product-thumbnail placeholders for text-only order rows. Its explicit product/order variants now follow their actual identity/metadata/status layouts. An external heading's bars also remain visible before Polaris defines.
10. Order detail reserved the wrong primary/aside widths and a boxed support card. It now follows the measured native Page with aside, including unboxed customized-item/payment groups and phone stacking. Exact product/line counts are not inferred.
11. Final responsive comparisons found different Products and Orders identity-column widths during loading. The placeholders now reuse the real pinned columns and responsive product identity classes, including hiding thumbnails on narrow tables. Direct focus and Tab cannot enter the decorative loading scrollports.

Every behavioral correction was first reproduced. New public browser tests cover typing before blur and focus. Loading tests compare real rendered native/loaded geometry, not just tag counts or a copy of the implementation's constants.

One old Orders toolbar test assumed three direct `s-box` children at the same top coordinate. The reusable bar wrappers and intentionally different bar heights made that a structural assertion rather than the required visual contract. It now requires all three visible placeholders, equal vertical centres and non-overlapping columns. Its meaningful visibility/containment assertions remain.

## Sources and independent review

[Shopify's SkeletonPage guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/skeleton-page) calls for stable known page structure, pending-region feedback and checks of loading/error/empty/recovery together. The installed App Home skill and project pins select Polaris 2.0 RC with matching types. Measurements use that exact runtime and the actual loaded Insignia composition.

Checklist Design's Loading, Settings, Modal, Multi-step form and relevant upload/cart-flow checklists supplied completeness questions. Account/security, product-page cart navigation and checkout remain Shopify responsibilities rather than missing Insignia screens. [Vercel's interface guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) supplied live feedback, focus, semantic navigation, recovery and narrow/long-content checks. They do not override Shopify component or ownership rules.

The independent [customer audit](customer-flow-recheck-2026-10-29.md), [loading audit](admin-loading-recheck-2026-10-29.md) and [final Sol review](frontend-recheck-sol-review-2026-10-29.md) record their exact evidence and scope. The final review challenged the real loaded composition, including Home orders, Methods phone wrapping and native order aside geometry, rather than approving parity with the old pending placeholders.

## Verification record

The initial maintained `test:frontend` run passed 656 merchant/artwork/customer checks and 69 integration-buyer checks, with zero failures and 62 explicit environment-gated skips. It also passed the selected customer build and 62 configuration/model checks, merchant/integration builds, effective strict compiler coverage, source coverage and style. Its artifacts preceded the final loading source corrections; those changes receive a new build and targeted checks rather than being represented as part of that earlier candidate.

After the input/focus corrections, the selected customer public model/browser suite passed all 19 checks. Independent corrected-state walkthroughs across both themes and all three widths found no remaining material customer issue. The audit retains 68 captures, scripts, receipts and failing-before-fix logs.

The final merchant build passed. The rebuilt loading suite passed all nine checks, including real loaded-table comparisons at the responsive boundary. All 126 cold, native/pending and loaded captures have no document overflow or browser errors. The final list changes received 18 fresh captures and four additional Products/Orders regressions, all passing. Earlier affected merchant checks passed 29, with two Home checks also passing. Strict source/test compiler checks, source coverage and pinned Polaris validation passed. Scoped style checks report only three existing CSS warnings.

After restarting the owned preview against the final build, a fresh ten-route admin walkthrough found no browser errors or document overflow. The gallery contains 309 states and 530 available images; Latest changes shows 40 reviewed entries. Every image returned HTTP 200, and obsolete Insignia cart/product-return entries remain excluded. Loading captures now use the rebuilt candidate. These counts include historical designed states and do not imply every historical screenshot was recaptured this turn.

Evidence roots:

- `/Users/pc/Development/Insignia/.artifacts/frontend-recheck-2026-10-29/`
- `/Users/pc/Development/Insignia/.artifacts/customer-flow-recheck-2026-10-29/`
- Final loading and independent intermediate-width evidence are preserved in the first directory.

## Remaining boundaries

No additional Insignia cart/product-return page or speculative Settings feature is warranted. The selected customer UI still needs real host/bootstrap and cart adapter wiring. That work must supply verified application outcomes, pending/error/uncertain-result recovery, Shopify edit re-entry and native trigger focus/drawer behavior. Native Shopify/cart/checkout qualification and the existing separate merchant presentation gate remain distinct from this local pass.
