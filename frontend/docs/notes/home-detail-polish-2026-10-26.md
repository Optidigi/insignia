# Home detail polish

26 October 2026. Local Home presentation refinement following the owner's request for closer Shopify metric treatment, copy review, quality-of-life improvements and relevant official illustrations. This supersedes the earlier rounded metric-band choice. It does not establish deployment or owner acceptance.

## Sources and actual observations

Read the project admin guidance and UI delivery workflow, the installed Shopify skill with its App Home topic, Checklist Design's Dashboard and Onboarding material, and [Vercel's current Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Shopify remains the design and component authority. The installed runtime is `polaris-2.0-rc.js` with `@shopify/polaris-types@2.0.0-rc.3`; native component validation uses that same version.

Inspected the live native Orders metric strip read-only and saved only its header and metric area, without order or customer records. Reference capture: `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/superfunny-orders-metrics.png`. Scoped DOM inspection established an unboxed shared strip, internal period segment, 13 px semibold labels with 16 px line height and -0.13 px tracking, a 2 px dotted `rgb(192,192,192)` border, and 80 by 20 px charts. The previous generic dotted text decoration produced a denser rule. Home now follows those measured details. Chart colours are app-owned visual approximations, not claims about private Shopify tokens. No internal native classes or shadow styles are copied.

Native Orders links metrics to real reports. Insignia has no corresponding analytics report page; its native clickable instead opens a metric definition and daily data, with an Orders destination. Hover/focus gives the concise definition. The accessible aggregate name includes the visible value and available comparison, avoiding an action-only name that hides the count from keyboard users.

## Changes

- Replaced the rounded metric section and external heading with an unboxed period-plus-two-metric strip. Compact charts use a common zero baseline and scale for current and previous periods. Two measures answer distinct questions, customized orders and original customized item quantity. The phone layout preserves legibility at 320 px instead of squeezing counts, deltas and charts into narrow columns.
- Last 7 days derives from the complete 30-day daily collection and compares with the adjacent prior week. The 30-day comparison uses a complete previous cohort from the existing read response. A cursor-limited source does not establish totals. Unknown previous test metadata hides the comparison alone; a zero previous baseline produces no invented growth percentage. There is no new API or backend aggregation feature. Preview cohorts remain explicit synthetic data.
- Moved current artwork work above onboarding and start the guide collapsed when actual work exists. Completing all three manual guide steps now collapses it and announces `Getting started complete`; keyboard focus returns to the visible disclosure. Manual acknowledgments still do not publish products or verify theme setup.
- Recent orders are real full-row native links, with compact phone status beside the order identity. Long product names keep overflow disclosure. The Product drafts destination becomes reachable sooner on phones. Native navigation semantics preserve keyboard and modified-click behavior.
- Shortened setup copy and used truthful destinations: `Connect your theme`, `Open theme setup` and `Open test instructions`. Formatted metric dates and quantities through Intl instead of raw ISO rows.
- Aligned the route skeleton with the unboxed metric composition.

## Illustration decision

Reviewed three actual official assets with provenance in [the illustration and copy research](home-illustration-copy-polish-2026-10-26.md). The puzzle asset has the wrong subject; the file empty-state graphic does not explain an order or the first setup action. Both are omitted.

Used the [paint roller and can](https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg) from Shopify's published setup/callout examples only in the expanded theme step. It suggests theme appearance, rather than pretending to demonstrate Insignia or the merchant's storefront. It is decorative, empty-alt, 80 px square on desktop, and omitted on phones to keep the action clear. The real asset was visually inspected before inclusion. This is recorded public-example provenance, not a blanket asset licensing assertion. Captures wait for image decoding so the gallery does not show a misleading blank illustration slot.

## Verification and review

The independent Sol source/pixel reviewer directly compared native and implementation captures. It caught the aggregate accessibility name before final validation. The final review found no material visual blocker across operating, first-use, many-task, completed-guide, long-content and metric-definition states at desktop, 390 px and selected 320 px widths. See [review and evidence](home-metric-polish-review-2026-10-26.md).

Passed 11 focused model, source, storage, period and chart tests; two Home container/browser workflows; the Home gallery workflow across 35 scenarios and 87 captures, including period selection, daily data, guide progress/undo/dismiss/restore/completion focus, task priority, broad order-row navigation, recovery and product-creation fallback. Strict admin test types, scoped Biome, Astro's 160-file check/build and pinned Shopify component validation pass. Read-only CUA inspection independently verified the 7-day menu totals and loaded illustration. Formal screenshots are under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/home/`.

The first gallery run exposed a test locator mismatch for native menu items, corrected to the native menuitem role. An early illustration capture ran before its lazy image decoded; an explicit decode wait corrected the evidence. Neither is concealed by a fixed sleep. The regenerated gallery leads with Home. Local preview only, with intended richer complete-data states still explicit scenarios where bounded production reads cannot establish those facts.
