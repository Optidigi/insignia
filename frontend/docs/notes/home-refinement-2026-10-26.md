# Home refinement

Superseded by the [native-reference correction](home-native-correction-2026-10-26.md). The owner rejected this refinement's metrics, guide and explanatory captions; its earlier passing review did not establish reference fidelity.

26 October 2026. The owner liked Home V1's clean layout, loading and empty states, and asked to preserve the delivery workflow while adding statistics, dismissible guidance and an explicit recent-order limit.

## Presentation and behavior

Home adds a compact Customization activity section for the last 30 store-calendar days, including today. Orders, original customized item quantities and distinct products use the same non-test, non-cancelled order cohort. About these numbers explains the definitions. There are no invented revenue, growth or conversion figures. Loading, unavailable and restricted statistics are independent from the work sections.

Getting started explains product configuration, theme connection and testing the customer flow. Dismiss removes this educational section, with a small restore action at the end of Home. It does not complete setup, dismiss current artwork work or change Shopify settings. The reading preference uses browser storage scoped to a validated shop domain. It survives revisits in that browser. It is not synchronized across staff or devices. Blocked storage leaves the guide usable without claiming persistence. App Bridge's Admin User API provides no staff identifier, so the implementation does not invent one.

Recent customized orders remains limited to five. When additional orders exist, a visible caption states the displayed limit beside the owning View all orders destination. An explicit preview case places an older order requiring artwork above five newer completed orders. A separate case shows three of eight artwork tasks and retains access to all orders. The real list contract cannot distinguish precise merchant interventions from customer waiting, expiry or deletion, so it still supplies no fabricated task queue.

## Data and scope

The preview reuses the application presentation with explicit synthetic activity and task facts. Existing authenticated reads remain unchanged. In the application container, statistics appear only if the existing order read returns the complete collection and the period's test metadata is known. A paginated recent slice never becomes a global total. Larger collections require a future complete aggregation contract before live metrics can appear. This refinement does not add that backend work.

The introductory guide supplements the existing first-product empty state rather than competing with it. Pending storefront setup remains independent. Product, order and storefront editing stay on their owning pages.

## Sources and saved workflow

The [saved UI delivery skill](../../../.agents/skills/insignia-ui-delivery/SKILL.md) records the source research, explicit state design, actual rendering, independent review, corrections and verification that produced the first Home result. AGENTS.md links it for future substantial merchant UI work. Its observed failures explain the native slot, grid, alignment, copy, fact and focus mistakes that earlier passes exposed.

This refinement follows the [Shopify metrics composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/metrics-card), the selected Polaris 2.0 RC component contract, [Shopify content guidance](https://shopify.dev/docs/apps/design/content), the [Checklist Design dashboard](https://www.checklist.design/web-app/dashboard) and [onboarding](https://www.checklist.design/web-app/onboarding) checklists, and [Vercel's Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). The previous [native app research](home-native-app-observations-2026-10-26.md) remains the basis for Home's compact work overview. General design sources supplement Shopify, rather than changing the app's native language.

## Verification

The final gallery contains 33 Home scenarios with 81 captures: desktop and 390 px for all scenarios, plus 15 checks at 320 px. The full review gallery contains 171 states and 341 desktop/phone images. Latest changes leads with the refined operating Home, guidance and older-work examples.

Seven focused source/preference tests, two actual-container browser workflows and the complete gallery interaction workflow pass. The gallery workflow checks overflow, failed-read recovery, native product-handoff failure, guide dismissal and persisted revisit, visible keyboard focus after restore, surviving pending setup/older work, the recent-five caption and statistics definitions. Strict admin-test types, scoped Biome, the 156-file Astro check/build and pinned official Polaris validations pass.

Actual rendering exposed a native section behavior that validation did not catch: on phones Polaris moved the first secondary action into overflow even when it was only an icon. Getting started now keeps Dismiss in the header and the persistent Show/Hide control in the body. A further spacing pass placed Hide beside the setup action in the expanded footer, so the bullets start at the normal card inset. Both the parent and the independent reviewer inspect real captures; see the [Sol review](home-refinement-sol-review-2026-10-26.md).

The local Home server and gallery were refreshed. Local application source and synthetic preview remain separate from native Shopify deployment and owner acceptance.
