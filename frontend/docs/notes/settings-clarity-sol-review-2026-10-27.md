# Settings clarity independent review

27 October 2026. Independent Sol review of the privacy utility, remaining Settings source, Shopify requirements, and actual replacement captures. The owner rejected the prominent initiation card. The final revision removes it, restores the two-column request table, and moves optional explanation into native About data requests help. I found no concrete visual defect in the inspected replacement states. This is a bounded utility UX verdict, not approval of a complete privacy workflow or owner acceptance.

## The requirement and the page are different decisions

Shopify requires compliance webhooks and providing the requested app-held customer data to the store owner. It does not require an app-authored Settings page or inbox. [Shopify privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)

Shopify's own customer-data request starts from Customers, a customer profile, then More actions > Request customer data. The merchant provides the requested data to the customer. Shopify documents its own profile/export and owner-email behavior; that does not establish notification or delivery of Insignia's portion. [Shopify merchant guide](https://help.shopify.com/en/manual/privacy-and-security/privacy/processing-customer-data-requests)

The current Insignia page is a manual retrieval implementation. `MerchantPrivacy.tsx` reads received requests, obtains their order links, and downloads available retained JSON. Separate order pages provide retained artwork. Reads remain owner-authorized; downloads do not send files to the customer, mark fulfillment, or erase data. The existing route is the current export capability and should not be removed before a replacement exists.

## Why the added instructions did not solve the task

The rejected Start a request in Shopify card led with creating a request in another product. Insignia's actual responsibility begins when it receives that request. The card, additional column and explanatory text made the workaround easier to describe without resolving its operational gaps:

- The inspected page has no evidenced notification or attention mechanism for newly received requests. A quiet Settings inbox can hide work with a deadline.
- The DTO exposes a request ID and order references, without a customer locator. Available orders offer a real route to the original order; zero-order and unmatched requests have no evidenced request-to-customer lookup. Shopify documentation does not establish that the API request ID is a customer-profile locator.

These are delivery and correlation dependencies. More instructional UI cannot close them. Do not invent customer fields, a completed state, or a notification claim.

## Smallest honest current-source experience

The final revision preserves the authorized export utility with Request/Due rows, order references, per-order Download data and View order. Its normal page now names the source and purpose in one heading and sentence. Selected-request guidance identifies the files as Insignia's available contribution to the owner's customer response. Optional native help explains the separate app-data contribution, Shopify initiation path and manual response. No new request creation control appears in the normal content. This is a defensible temporary retrieval tool, not a complete privacy workflow.

Before presenting a complete V1 workflow, decide how the owner learns about requests, safely identifies their customer, receives the export, and handles requests without matched orders. A request-specific secure export link with owner notification and an exception path is a possible target architecture, not an existing capability or an approved implementation.

## Other Settings observations

The four existing destinations cover supported V1 tasks. Checklist Design's installed Settings, Empty State and Data Table checklists supplied applicability lenses, not a reason to add profile, security, notifications, search, bulk actions or preference controls without an owning feature.

Storefront activation proves presence in the published theme, not coverage of every product template or a successful buyer journey. Luna's proposed P1 should be bounded to a P2 clarity/coverage issue. The final source uses explicit published-theme wording and a reminder to check used product templates. Shopify supplies example placement identifiers, not a documented parsing grammar; do not infer a regex classifier or gate the manual preview on it. [Shopify App API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api)

Billing refreshes on mount in the inspected component. Whether returning from Shopify retains that document needs host observation before declaring a stale-state defect. Permissions already separates app grants from staff authority and requests consent explicitly.

## Pixel evidence and its limits

I opened the actual expanded Shopify index-table reference at `.artifacts/settings-clarity-2026-10-27/shopify-index-table-reference.png`, then twelve replacement privacy captures under `.artifacts/admin-popup-review-2026-10-24/settings`: desktop and 390px requests; desktop hover; desktop, 390px and 320px help, empty and detail. The rejected initiation-card images are superseded. A final follow-up also inspected the 320px populated list.

Native framing, row dividers, rounded full-row hover and narrow wrapping had no concrete visual defect in the inspected captures. Removing the instruction card lets the actual request task lead. Optional help preserves the explanation without making it the normal page. At 320px the help body needs scrolling to its final response section while footer actions remain visible. The root agent reports a passing real-body-scroll check reaching that section with Done still visible. Detail content continues below the viewport normally. No private shadow styling was needed.

These observations establish the visible composition of the replacement utility. They do not establish that Shopify requires the page, that the delivery architecture is complete, or that the owner accepts the revised product shape. Notification and customer correlation remain open. I made no application changes and did not repeat the root agent's browser tests.


## Final small-state follow-up

I opened the added 320px populated privacy list, all three refreshed storefront active captures, and desktop/390px Billing unverified captures. No concrete visual defect appeared. The narrow request list keeps its labels, dates and links readable. Storefront now explicitly limits Added to the published theme and asks the merchant to check used product templates. Billing's warning names verification failure rather than implying a confirmed inactive subscription; its recovery and Shopify handoff remain visible. The root agent reports passing privacy, modal-scroll and Billing heading assertions. These bounded checks do not close request notification or customer correlation, and do not establish owner acceptance or a complete workflow.
