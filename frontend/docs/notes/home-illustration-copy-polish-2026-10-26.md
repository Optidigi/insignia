# Home illustration and copy review

26 October 2026. Read-only source and pixel review for the Home polish pass. Application implementation belongs to the main agent. This note records candidates, not an illustration library or a reuse-license finding.

## Reviewed evidence

Read `AGENTS.md`, the admin UI guidance, the saved `insignia-ui-delivery` workflow, Shopify's `shopify` skill and `polaris-app-home` reference. Searched public Shopify developer documentation with the installed toolkit for App Home `2.0-rc`. Read HomeGettingStarted, HomeActivity and MerchantHome. Inspected the supplied desktop operating and first-use captures, phone test invitation, and 320px first-use capture under `.artifacts/admin-popup-review-2026-10-24/home` in the workspace parent.

The current public v2 homepage URL redirects to `latest`, now labeled v2.0. Treat that composition as public guidance, not proof of the project's pinned RC component support. The installed toolkit returned the older setup-guide example for the explicit `2.0-rc` search. No generated component code requires validation in this research-only task.

## Illustration candidates actually inspected

### Paint roller and paint can

[Actual SVG](https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg). 102 by 100 viewBox. Visually inspected after rendering with macOS Quick Look. It is orange paint with purple outlines on a pale abstract backdrop. It contains no checkout UI, theme screenshot, control labels, or app miniature.

Published in the [App Home setup guide example](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/setup-guide), at a maximum inline size of 80px alongside expanded step content. The same image is used for several puzzle setup tasks there, with inconsistent alt labels. Its original context is explicit in Shopify's archived [callout-card default example](https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/pages/examples/callout-card-default.tsx), which pairs it with checkout styling.

This is the strongest current-example candidate for a small product-customization setup illustration. It conveys making or customizing, but does not explain artwork placement or theme connection. If used, keep it at the right of an expanded setup step on wide layouts and omit it when it crowds the 320px text. Use empty alt text when the adjacent task already carries its meaning. Do not label it as a demonstration of Insignia. It is a weaker choice for theme connection and testing because those actions do not involve styling the checkout. Do not repeat it on every step.

### File or document

[Actual PNG](https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png). 250 by 250 including generous transparent space. Visually inspected. A white document carries a small amber image block and pale grey text strokes, against a pale circular backdrop. It has no identifiable app UI or product screenshot.

Published in Shopify's archived [default empty-state example](https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/pages/examples/empty-state-default.tsx) for incoming inventory, and [full-width file-upload empty-state example](https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/pages/examples/empty-state-with-full-width-layout.tsx) for images and documents. These are primary published examples, although the React implementation is archived and should not be copied into the Preact app.

Possible use is a small decorative record motif above the proven no-orders state. It relates to records/artwork, but its literal meaning is a file, not an order. It adds no testing instruction. Use only if it improves the actual empty composition; the heading and action already communicate the task. Do not replace a real pending-work message with it. Do not reuse it as a product thumbnail.

### Puzzle callout, rejected

[Actual PNG](https://cdn.shopify.com/static/images/polaris/patterns/callout.png). 438 by 244. Visually inspected. It is a large blank puzzle piece and a pixel character over a pale puzzle-shaped panel. The alt descriptions in published examples do not accurately describe all its visible details.

Published in [App Home callout card](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/callout-card) and [resource index](https://shopify.dev/docs/api/app-home/latest/patterns/templates/resource-index) examples. Its puzzle subject is wrong for Insignia customization setup, theme connection, tests, and orders. Reject despite its official provenance. The puzzle template images from the media card and homepage are unsuitable for the same reason.

No reviewed primary page establishes a blanket license for these CDN assets. The evidence establishes that Shopify publishes and uses the specific assets in developer examples. This note makes no broader licensing claim.

## Best concrete copy and quality-of-life changes

1. Shorten the product step description to `Set artwork areas, decoration options and prices, then publish.` The current sentence occupies five lines in the supplied 320px capture before its action. The shorter wording retains all setup tasks and aligns with the draft variant's vocabulary. Keep the no-products variant distinct because creating a Shopify product comes first.
2. Make actions predict their actual destinations. The guide's `Test a product` and no-orders `Test a customization` both link to `/admin/settings/storefront`, not a product. Use `Open test instructions` while that remains the destination, unless the owning page actually launches the test directly. The test description can be `Add a design to a published product, then review and edit it in the cart.` The theme step can be `Connect your theme`, with `Open theme setup`, since its description already names theme configuration rather than connecting a separate sales channel. Verify the owning settings page's heading before choosing that label.
3. Give the numbers more hierarchy than the metric labels. In the supplied desktop operating image, metric value `43` and the dotted-underlined label have nearly the same apparent size, while the tiny sparkline sits at the far edge of a long empty cell. The label should remain compact contextual help, with a larger value and the chart grouped near it. Retain native label/help behavior and the definition popover. This is a composition finding, not a reason to add another explanatory caption.

## Additional concrete observations

- The guide has useful manual completion, next-step expansion, dismissal restoration, and focus-return handling. Preserve them. A collapsed guide in the operating capture still consumes a separate progress line plus title line; a compact header with progress beside the title can reduce that idle height.
- `HomeActivity` formats numbers with a module-level `Intl.NumberFormat()` and outputs raw `YYYY-MM-DD` daily rows. Match the admin locale when available and format daily dates consistently with the rest of Home. This matters only when those help details are opened.
- The visible period is configurable through `statistics.periodLabel`, but the help text always says the last 30 calendar days. The current model contract is 30 store-calendar days, so this is not evidence of a present data error. Keep the period and definition together if period selection is added later.
- The unavailable statistics state offers no recovery action. Do not invent a local Retry button unless the adapter supports reloading statistics; leave recovery work with its owning integration.
- Keep no-order imagery limited to proven absence. Established stores with a zero period still need activity context, while pending artwork work must remain visible independently.

## Source guidance that affected the decision

The [current public homepage pattern](https://shopify.dev/docs/api/app-home/latest/patterns/templates/homepage) places whole-card actions in the section header, progress in the supplemental slot, and setup items directly in divided rows. It asks for brief instructions. This supports shortening the guide and reducing its idle height, but does not establish that new latest-only slot properties exist in the pinned RC.

Shopify's [empty-state guidance](https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/empty-state) makes the graphic optional. Its action and explanation carry the meaning. The illustration decision should therefore be one relevant visual where it helps, not an asset quota across every empty or expanded state.

The primary legacy [CalloutCard implementation](https://github.com/Shopify/polaris-react-archive/blob/main/polaris-react/src/components/CalloutCard/CalloutCard.tsx) uses empty alt text for its decorative illustration. Its old component code is evidence about presentation intent, not a component migration recommendation.
