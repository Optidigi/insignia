# First product setup walkthrough

This was an AI walkthrough, not human usability evidence. On 24 October 2026, I used a separate Chrome tab (835132943) against the local preview at `127.0.0.1:62168`. I selected the fixture labeled `First product · no methods` / `Unconfigured product`, then configured one Front view and a left-chest logo artwork area for `Ontwerp je eigen Superfunny hoodie`. I saved the local browser draft. No Shopify store or production data was changed.

## What I could complete

The fixture chooser made the empty starting point identifiable. On the hoodie, `Views & placements` showed `0 views · 0 placements` and `No views configured. Choose product images to create views.` `Add view` opened a picker whose copy said each selected image becomes a view. I selected Front, then renamed the generated `View 1` to `Front`. Renaming was a small pause in this scenario. Generic names are intentional: product media does not reliably identify garment sides, and the owner previously requested editable generic defaults.

I added a placement named `Left chest logo`. The Artwork area inspector explained that the area sets maximum artwork size and starting position, and that 100% refers to the area rather than garment dimensions. The default box was broad; `Draw area` mode said `Drag across the garment to define this placement’s artwork area.` I drew the chest area directly on the garment preview. The resulting 12% width, 9.4% height and center coordinates were visible. This was understandable without technical knowledge. My first attempts to fill the numeric size fields did not visibly move the outline, so I switched to drawing; I did not verify whether that was a field issue or an interaction-tool artifact.

`Save draft` confirmed `Draft saved in this browser tab.` That accurately described the local-only persistence. The three screenshots capture the fixture/product list, the configured placement and the publish check:

- [Product fixture](../../../../.artifacts/workflow-audit-2026-10-24/first-shop-01-products.png)
- [Front view and placement](../../../../.artifacts/workflow-audit-2026-10-24/first-shop-02-placement.png)
- [Publish setup check](../../../../.artifacts/workflow-audit-2026-10-24/first-shop-03-publish-check.png)

## First-method blocker

The placement inspector showed `No decoration methods yet. You can save this placement as a draft.` and a `Manage methods` link. That link opened the global method catalog. I found `Printing`, a `€5.00` fixed-price method marked `Ready`; it was already associated with other products. Returning to the new placement still exposed no method picker. Source review clarified that `Choose a decoration method` was warning text included in the placement row’s accessible name, not a separate picker action. The `Manage methods` page offered no observed way to assign that method back to this placement.

Clicking `Publish` opened `Finish setup before publishing` with `Front · Left chest logo: Choose at least one method.` Its `Review placement` action returned me to the same placement. I could not complete method assignment or publish. This is a workflow blocker in the local preview because its placement-to-method integration is missing. It should not be read as evidence that the production Shopify integration has the same gap. The visible error names the missing requirement, but its recovery action loops back without exposing the method assignment path. Shopify says core setup should be clear and errors should make their remedy obvious; task errors should give immediate feedback near the affected work and persist until resolved ([Built for Shopify: Helpful](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements), [Messages and feedback](https://shopify.dev/docs/apps/design/user-experience/alerts)).

A new `Choose a decoration method` action near the inspector top would not have changed my outcome. The inspector already had the Methods section plus `Manage methods`, but no connected assignment path. A top jump could help once a working selector exists lower in a long inspector. In this preview, another jump to the empty section would add expectation without repairing the missing connection.

## Canvas policy verdict

For this single-view, single-placement job, showing only the selected placement is calm and easy to read. I had no competing outlines to quiet. The `Draw area` instruction was direct, and showing the new outline alone while drawing did not slow this first setup. Replacing the default box hid its former boundary; this was harmless while sizing a new chest placement, but editing an established area without a locked prior outline could remove a useful position reference. A faint old boundary seems useful for that replacement step only. I did not exercise a multi-placement overview, movement editing, measurement, or customer preview, so this run cannot validate those visibility policies.

## Shopify guidance applied

Shopify recommends progressive disclosure for conditional forms and individual pages for object definitions, which fits a product-specific setup with clear stages rather than one large settings form ([Forms and saving](https://shopify.dev/docs/apps/design/user-experience/forms)). Its App Home guidance describes setup-guide compositions with progress tracking and collapsible onboarding steps; the empty-state component should explain why a list is empty and offer the next action ([Apps in App Home](https://shopify.dev/docs/apps/build/app-home), [Polaris web components](https://shopify.dev/docs/api/app-home/v2.0/web-components)). The no-view prompt did this well. The no-method state had a catalog link but no working attach path in this local preview. Shopify also requires live previews for visual customization; the garment canvas served that role during area drawing ([Built for Shopify: Visible previews](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)).
