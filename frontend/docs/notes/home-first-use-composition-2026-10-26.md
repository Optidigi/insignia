# Home first-use composition and guide priority

26 October 2026. The owner found the no-Shopify-products Home too empty and asked whether getting started belongs before or after metrics. This refinement supersedes the previous sparse first-use composition and the incomplete-guide-after-metrics choice.

## Evidence and decision

Reopened the actual no-products desktop capture alongside the previously observed native Search & Discovery and Flow first-use captures under `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/`. Search & Discovery visibly places its incomplete setup guide before search and recommendation analytics. Flow has a creation explanation and real resource/news content. Its templates/news do not establish content that Insignia has.

Freshly read [Shopify's App Home and onboarding guidance](https://shopify.dev/docs/apps/design/user-experience/app-home-page), the [Homepage example](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/homepage), and [Setup guide composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide). The example puts setup before metrics; Shopify does not impose one universal ordering across all app states. Its guidance supports useful status/actions and brief onboarding that conveys the app's benefits. Checklist Design's bundled Dashboard and Onboarding checklists support orientation, a first action, progress and completion. These do not justify decorative filler or an empty analytics grid.

Decision: current artwork tasks take precedence; a visible unfinished guide follows, above metrics. Completed optional guidance is collapsed after metrics. Dismissed guidance stays dismissed and restorable. Proven pre-order Home states explain the product-to-order journey while real activity is absent.

## Implementation

First-use now has a short `Make your products customizable` introduction, its existing actionable three-step guide, and a substantive `From design to production` section. The latter explains customer artwork choices, cart review and merchant artwork/production preparation. It supplies the missing connection between setup and the eventual order work. It uses supported native image/cart/print glyphs with short copy, three columns on desktop and icon/text rows on phones. There is one prominent Add product or Configure product action. No new model, backend feature, invented stats, example orders, synthetic artwork, news feed or extra required step.

The downstream explanation remains across the proven no-order stages, including after guide dismissal. It disappears once orders supply actual Home content. The welcome is specific to first product setup. Loading, restricted and failed reads are not mistaken for an empty shop.

The reviewer caught two issues before the final pass. Phone grid stretch made native icon backgrounds into tall pillars; explicit start alignment fixes their actual rendering. The existing product-panel hiding condition also kept Add product hidden after all three manual guide checkboxes were checked with no product created. Panel hiding now requires an incomplete guide, so manual completion cannot erase the actual missing-product action. Guide acknowledgment remains separate from resource facts.

## Verification

The final gallery workflow passes across 35 scenarios and 90 desktop/phone/selected 320 px captures. Checks include actual DOM order for incomplete and complete guidance, broad row navigation, period selection, recovery, first actions, guide completion focus across its changed position, dismissal/restore, and no-products manual completion retaining Add product. The first added order assertion failed because its test first dismissed the shop-scoped guide and then expected it visible on the next page; the test now restores the actual persistent preference before making that independent assertion.

Scoped Biome, strict admin-test TypeScript, Astro's 160-file check/build and pinned Polaris 2.0-rc component validation pass. The [independent Sol source/pixel review](home-first-use-composition-review-2026-10-26.md) compared the native and implementation captures and found no remaining material issue in scope after corrections. Gallery Latest changes now leads with no products, first product setup and operating Home. Local source and synthetic preview states only; owner acceptance and deployment remain separate.
