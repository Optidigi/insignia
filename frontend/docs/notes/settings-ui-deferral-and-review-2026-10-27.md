# Settings UI deferral and remaining-page review

The owner deferred customer-data UI on 27 October. This supersedes the earlier four-destination Settings hub and manual-export inbox designs. It does not change backend privacy handling.

## Removed UI

- Removed the Customer data requests Settings entry, both page routes, the MerchantPrivacy island and its stylesheet.
- Retired its preview fixtures, gallery states and UI-only browser test. Old source files and captures are recoverable outside active source under `/Users/pc/Development/Insignia/.artifacts/retired-privacy-ui-2026-10-27/`.
- Updated shared navigation checks to cover the remaining destinations. Both retired page URLs now return 404. Webhook handling, authorized backend export routes, erasure and retention remain in place.

## Remaining page decisions

The Settings landing page keeps three padded native navigation rows: Storefront setup, App permissions and Billing. It follows the Interstitial nav pattern. No preference form or save bar is needed on a navigation page.

Billing uses a compact read-only status card, with the plan and status followed by price, relevant dates and the Shopify management action. This is a suitable adaptation of Shopify's Account connection composition. Shopify owns plan selection and approval. Removed repeated verification wording and the redundant retry instruction beside the retry button.

App permissions keeps three separate access checks because they answer different questions. The revised layout puts a short heading and status badge on one row, then gives explanatory text the full width. This follows the inspected Shopify Settings/Account connection examples and avoids squeezing phone paragraphs beside status badges. The missing-check prerequisite is stated once beside its action.

Storefront setup remains a task guide for theme activation, product templates and testing. Its current "Added to the published theme. Check the product templates you use." wording correctly limits the known status. No extra local theme editor, settings form or illustration was justified by this review.

## References and independent review

- [Shopify Settings template](https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings), inspected as a rendered public example and through its DOM.
- [Account connection composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/account-connection), used for the name/status/body/action relationship.
- [Theme extension UX guidance](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux), used to check the boundary between app guidance and the native theme editor.
- [Sol shape and actual-pixel review](remaining-settings-shape-review-2026-10-27.md), including 24 final desktop, 390 px and 320 px captures.
- [Luna source/state review](remaining-settings-reference-review-2026-10-27.md), with Shopify billing/access references and explicit evidence limits.

The review found no remaining material composition defect within the inspected scope. Native Shopify billing return freshness and embedded-host navigation still need qualification when that integration is exercised. This is an unverified behavior, not a reproduced layout bug or a reason to add refresh controls.

## Verification

Web type check/build and focused style checks pass. Settings navigation and retired-route checks, billing failure/retry behavior, shared navigation cancellation/late-read checks and strict hydration policy checks pass. Existing backend privacy request/role checks pass; the restricted merchant backend qualification remains opt-in and was skipped. Updated Settings/hub captures cover desktop, 390 px and 320 px. Pinned Polaris 2.0-rc validation passes for the changed merchant components.

The gallery excludes retired customer-data states and leads with the revised remaining Settings pages. This is a local preview delivery, not deployment, native-host acceptance or owner approval.
