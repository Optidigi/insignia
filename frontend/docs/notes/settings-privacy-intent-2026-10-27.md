# Customer data utility and remaining Settings review

27 October 2026. The owner questioned the purpose and necessity of the Customer data requests screen, rejected the added initiation card, and asked for product reasoning before more visual polish. That correction supersedes the first pass's pixel-only approval.

## Requirement versus product choice

Shopify requires verified compliance webhooks and handling of data-access/redaction requests. Its [developer guide](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) says the app-held requested data must be provided to the store owner. It does not prescribe this Settings page, an email channel, a particular export format or an app-authored customer-delivery workflow. Shopify's [merchant instructions](https://help.shopify.com/en/manual/privacy-and-security/privacy/processing-customer-data-requests) start at Customers, the customer's profile, More actions, Request customer data. Shopify makes its own dataset available separately. This does not establish delivery of Insignia-held customization payloads.

Insignia currently has an owner-authorized request-specific export route. The request groups the requested order references and due date, and the detail can download its available Insignia JSON and link to retained artwork on the original order. A generic order export would lose that request scope. The export utility therefore remains available while it is the current retrieval path. Its existence does not make the general inbox a Shopify requirement or a finished merchant workflow.

The source does not implement app-request notifications, customer delivery, fulfillment tracking or a customer locator on this inbox. A request ID is not a customer name. Matching order links provide some context; zero-order/no-match requests have no equivalent customer path. **Owner notification and privacy-safe request/customer correlation remain unresolved product/integration work.** The UI must not disguise those gaps with instructions or fabricated fields. The current utility should not be presented as complete end-to-end compliance handling.

## Final UI changes

- Removed the rejected Start a request card and its prominent Customers CTA. Removed the added Orders index column. The normal two-column list leads with Requests from Shopify and one short sentence explaining the available Insignia exports.
- Added optional About data requests help through a native page action/modal. It explains the distinction between Shopify's export and Insignia's customization data, initiation in Shopify, the JSON/artwork split and the merchant's manual response. It does not create a request or imply that a download completes one.
- Request detail states that files are not sent automatically, names the available JSON content and points to the order for artwork. Zero-order wording explains the absence of downloadable Insignia order files without declaring the whole customer request complete.
- The Settings hub description now names the data-download purpose.

The actual expanded [Shopify Index table example](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/index-table) was inspected before choosing the hover treatment. Its rendered DOM has the same native 6px vertical/12px leading cell padding and 8px hover-corner rules as Insignia's current table. Native row hover was retained, not replaced by app CSS. Actual hovered desktop and phone captures verify the painted region. The readable reference is `/Users/pc/Development/Insignia/.artifacts/settings-clarity-2026-10-27/shopify-index-table-reference.png`.

## Other Settings findings

Two Luna Max agents independently reviewed Billing/permissions and Storefront/hub, followed by a Sol challenge and actual pixel review. The installed Checklist Design Settings, Billing, Data Table and onboarding lenses were applied against current sources and captures. Shopify owns account/payment/theme actions. No extra preferences or new Settings feature was justified.

1. **Fixed Billing's unverified-state heading.** Verification failure now says Billing status could not be verified, while a confirmed inactive state retains Subscription needs attention. The actual access consequence and Shopify management handoff are unchanged.
2. **Bounded Storefront's active copy.** Added to the published theme now explicitly asks the merchant to check the product templates used. The API's activation target is not parsed with an invented grammar, and manual preview remains available. The original Luna P1 was challenged and narrowed to a clarity/coverage issue; no demonstrated buyer failure justified new gating.
3. **Host-return billing freshness remains a qualification item.** Source loads on mount and the management link leaves the top frame. Whether a native host restores a stale document was not reproduced. Do not describe this as a confirmed defect or add lifecycle retries without a real case.

Independent evidence: [Sol reassessment and replacement review](settings-clarity-sol-review-2026-10-27.md), [Billing/access audit](settings-billing-access-clarity-2026-10-27.md), [Storefront audit](settings-storefront-clarity-2026-10-27.md), [owner-delivery investigation](privacy-owner-delivery-2026-10-27.md), and [utility reassessment](privacy-settings-utility-reassessment-2026-10-27.md). The initial screenshot-only no-defect observation is superseded by the owner's rejection. The replacement received a bounded utility UX review; it is not complete-workflow acceptance.

## Verification boundaries

The 160-file web build/check, strict admin-test types, scoped style and pinned Polaris 2.0-rc validators cover the changed components. Focused privacy tests preserve fresh complete per-order export assembly, no download on request opening, direct detail links, pagination, authorization clearing, unavailable/expired data and safe retry. Billing distinguishes inactive and unverified copy in its browser regression. The Settings, Storefront and hub galleries refresh the affected normal/error/empty/help states at desktop, 390px and selected 320px widths. The short-phone help body is explicitly scrolled to its final response guidance while native footer actions remain accessible.

Local application/preview changes only. No Shopify request was created, no customer data was collected for research, no email was sent, and no permission, billing, theme, retention or server-delivery contract was changed. Owner acceptance, native embedded qualification and deployment remain separate.
