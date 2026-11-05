# Home native-reference correction

26 October 2026. The owner rejected the first Home refinement. Its clean spacing and data checks did not compensate for the wrong composition: plain statistics, a bullet-list guide and explanatory captions unlike the supplied references. This note supersedes that refinement's design conclusion.

## References actually inspected

Read the saved Search & Discovery and Forms screenshots at readable scale. Opened Shopify's current setup-guide page in the browser, inspected its rendered iframe and DOM, and read the version-matched composition example. The example has task completion, separate expansion, a progress summary and a task action. It is not a prose list.

After the owner requested Superfunny's Orders page, opened `superfunny-kleding/orders` read-only in Chrome. Inspected its metric strip and the DOM of the Orders metric link. The measured metric content was 44 px high with 13 px text. The shared strip uses small right-side charts, dotted definition labels, compact values and a shared period control. Saved only the header/metrics crop as `superfunny-orders-metrics.png` in the local research artifacts. No order, customer, theme, app permission or production setting was changed.

Home keeps a single native section around its metric band, following the Forms and documented metrics composition. Superfunny Orders itself uses an unboxed full-width strip above its index. Home has a smaller page and fewer metrics, so it does not copy the six-column index or add a period picker without a supported period query.

Primary sources: [Shopify setup guide](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide), [metrics composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/metrics-card), [Homepage template](https://shopify.dev/docs/api/app-home/latest/patterns/templates/homepage), [Shopify content](https://shopify.dev/docs/apps/design/content), [Dashboard checklist](https://www.checklist.design/web-app/dashboard), [Onboarding checklist](https://www.checklist.design/web-app/onboarding), and [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Checklist items were read from the installed skill. Shopify governs native composition and copy. Memorisely/Xander skills were not found in the installed/project skill directories; this pass does not attribute invented guidance to them.

## Final choices

- One compact shared metric band shows customized orders and customized items. Period-wide distinct products was removed from Home because it added less operational value and required explaining a different daily aggregation. The model still retains that fact for a future appropriate view.
- Small charts accompany the two volume totals when a complete daily series exists. Missing series does not become a flat zero. A real zero period with older order history remains different from a proven first-use state. Chart geometry preserves zero and constant nonzero values.
- Metric labels open contextual definitions and optional daily values. The visible exclusion sentence and recent-five caption are removed. Recent customized orders and View all orders use the familiar native overview pattern; older supported artwork work remains independent of the recent slice.
- The setup guide has manual completion rings, persistent progress, an independent chevron for each task, one expanded subdued task and its concrete action. Its custom round inputs retain native checkbox keyboard semantics. The header's two native buttons use an ordinary in-card row, avoiding the section-action overflow found earlier.
- Guide progress records the merchant's acknowledgments, not publication or theme authority. Dismissal is independent of completion and can be reversed. Browser storage is validated and scoped to the shop. Actual theme work remains discoverable when the guide is dismissed or acknowledged; an optional customer test is not repeated in a second task card.

## Initial states

| Known state | Home leads with | Deliberate omissions |
| --- | --- | --- |
| No Shopify products | Add your first product inside the guide; existing native product-creation handoff and recovery | Statistics, empty Orders card, duplicate product hero |
| Product exists, no configuration | Configure a product | Statistics and empty Orders card |
| Saved draft, no orders | Finish product setup with the real product name and Continue setup | Duplicate draft continuation card and statistics |
| Published product, storefront setup pending | Connect your storefront step | Repeated full setup card and zero metrics |
| Storefront ready, customer test pending | Test a customization step | Second test invitation row |
| Setup completed, no orders | Collapsed completed guide and No customized orders yet with a useful test action | Empty charts and invented performance |
| Existing order history | Compact metric band, supported current work, recent orders and drafts | First-use dashboard assumptions |

An empty recent page with a cursor is not absence; the adapter still rejects it. Restricted or failed reads do not become a first-use state. Live activity still requires the existing purchase read to be complete; this work adds no aggregation backend. The preview uses explicit synthetic daily facts whose totals agree with the series.

## Review and verification

The independent Sol reviewer compared implementation images directly against Search & Discovery, Forms and the new Superfunny strip. That comparison caught a repeated customer-test row, which was removed. Source checks and automated behavior are separate from native similarity, owner acceptance and release approval. Final checks pass: nine focused source/storage/chart tests, two actual-container browser workflows, the full 35-scenario gallery workflow with 87 captures and 17 selected 320 px checks, strict admin-test types, scoped Biome across 20 affected files, the 159-file web check/build and version-matched Polaris validation for the band, guide, Home composition and route skeleton. The gallery includes six distinct initial/no-order stages. The workflow checks their single relevant action, omission of empty metrics/Orders cards, native creation busy/failure, guide progress/revisit/reversal, dismissal/restoration focus, older work and metric definitions/daily values. The reviewer inspected all six initial stages at desktop/390 and selected 320 captures. This does not claim every state was independently checked at 320 or that native deployment is complete.

The saved UI delivery skill now requires that direct reference comparison. It also distinguishes data-integrity rules from copy that belongs on the merchant page. The previous review's no-material-finding conclusion did not establish the requested design fidelity. Latest changes leads with the shared-band operating state and then the initial-stage progression. The complete gallery now has 173 states and 345 desktop/phone images, plus selected narrow proofs.
