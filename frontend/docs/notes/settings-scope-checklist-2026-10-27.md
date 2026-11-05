# Settings V1 scope: independent completeness review

27 October 2026. This is a source audit of the Settings hub and its real subpages, not a rendered-layout review. I applied Checklist Design's Web app Settings and Billing checklists, plus Contacting support because the product currently tells merchants to contact support. I did not make visual claims; the merchant UI is still owner-unaccepted ([implementation plan](../../architecture/implementation-plan.md#L395-L412)).

## Recommendation

Keep Settings as a short directory for four real tasks: **Storefront setup**, **App permissions**, **Billing**, and **Customer data requests**. Remove **Decoration methods** from this directory: Methods already has a first-level navigation link, and the old `/admin/settings/methods` route redirects to the same canonical `/admin/methods` page ([Settings rows](../../../apps/web/src/islands/MerchantSettings.tsx#L3-L44), [app navigation](../../../apps/web/src/components/AdminNavigation.astro#L1-L8), [route map](../../architecture/implementation-plan.md#L405-L412)). The current “Customization” group also misplaces App permissions. Keep only group labels that clarify the remaining tasks; do not preserve a label just to house one redundant shortcut.

Each retained destination has a distinct source-backed job:

- **Storefront setup** checks two published-theme extension states, hands changes to Shopify's theme editor, and keeps a separate customer-flow test. Shopify owns placement and Save; Insignia must not claim the theme was saved or the whole storefront is ready ([StorefrontSetup.tsx](../../../apps/web/src/islands/StorefrontSetup.tsx#L108-L180), [scope and limitations](storefront-setup-v1-2026-10-26.md#L27-L45)).
- **App permissions** distinguishes product access, checkout setup consent, and owner/staff access to orders. Keep the explicit, separate consent actions and clear denied, missing, or unknown states. This screen checks access; it does not invite staff, edit roles, or replace Shopify's complete permission list ([ReadinessPermissions.tsx](../../../apps/web/src/islands/ReadinessPermissions.tsx#L207-L300), [product-truth review](settings-product-truth-review-2026-10-25.md#L9-L15)).
- **Billing** shows verified subscription facts and opens Shopify for plan management. Shopify hosts selection and approval. The integrated backend remains one Standard recurring contract; the proposed Free plus two paid tiers have undecided names, prices, and entitlements, so do not turn them into live choices or invented benefit cards ([MerchantBilling.tsx](../../../apps/web/src/islands/MerchantBilling.tsx#L49-L64), [current commercial truth](settings-product-truth-review-2026-10-25.md#L33-L43), [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)).
- **Customer data requests** is a real low-frequency inbox for Shopify-supplied requests and authorized order/design exports. Keep it separate from Orders because it owns a compliance request; do not make it a privacy-policy editor, deletion center, or “mark fulfilled” control ([MerchantPrivacy.tsx](../../../apps/web/src/islands/MerchantPrivacy.tsx#L292-L327), [request/export actions](../../../apps/web/src/islands/MerchantPrivacy.tsx#L441-L511), [product-truth boundary](settings-product-truth-review-2026-10-25.md#L29-L31)).

Do not add account profile, password/2FA, notification, theme-appearance, timezone, team-management, API-key, integration, or account-deletion settings without a real Insignia-owned state and use case. Shopify owns merchant identity, authentication, staff roles, app payment, and uninstall; no such Insignia preference or team model appears in these routes. A customer-data export is not account deletion. Product configuration, price, placement and publication stay in Products/editor; Orders remains the owner of purchased-order work ([implementation map](../../architecture/implementation-plan.md#L401-L412)).

One real completeness gap is support recovery. Billing and the unavailable page say “Contact support,” but the source exposes no support destination or contact method ([MerchantBilling.tsx](../../../apps/web/src/islands/MerchantBilling.tsx#L232-L239), [unavailable page](../../../apps/web/src/pages/admin/unavailable.astro#L9-L18)). If a canonical support destination is configured, wire one small **Help & support** link into Settings and make those recovery messages actionable. Until then, do not invent an email, chat, response-time promise, or a Help Center screen; avoid dead-end “contact support” wording where the merchant cannot act.

## Checklist Design audit

The item wording and order below follow the bundled [Web app Settings checklist](https://www.checklist.design/web-app/settings). This source review can establish the controls and ownership present in code, not their visual quality.

| | Item | Why |
|---|---|---|
| 🟡 | **Structure** — Organising settings controls into logical categories e.g. account, notifications, security, billing. | The hub groups five links, but Methods duplicates the global destination and App permissions sits under “Customization.” Keep the four real tasks and make the grouping match their work. |
| ⚪ | **Account details** — The fields where users update their name, email address, and profile photo | The hub is for Insignia settings; the Shopify account owns merchant identity. |
| ⚪ | **Security details** — The ability to change the password,  two-factor authentication and other security information | Shopify owns sign-in and account security; Insignia has no credential controls. |
| ⚪ | **Notification preferences** — Controls for which notifications the user receives and through which channel, grouped by type (product updates, reminders, billing) | No Insignia notification channels or saved notification preferences exist in the reviewed surface. |
| 🟢 | **Billing** — Managing payment method, upgrading or cancelling a payment — this could also be a preview of this information with a link directly to the billing page if separate | The hub links to a separate subscription summary, which displays confirmed facts and hands plan management to Shopify. |
| ⚪ | **Additional preferences (if applicable)** — Language, timezone, date format, and appearance settings like dark mode | The source has no Insignia preference store; do not create controls for browser/Shopify presentation settings. |
| ⚪ | **Danger zone** — Destructive actions like account deletion, clearly separated from the rest of settings | Insignia does not own Shopify account/store deletion or app uninstall here. Privacy export is not erasure; destructive platform actions remain with Shopify. |

The following rows follow the [Web app Billing checklist](https://www.checklist.design/web-app/billing). Existing product-truth review found the same provider boundary; this pass independently checked the current source.

| | Item | Why |
|---|---|---|
| ⚪ | **Payment method on file** — The current card or payment method linked to the account, shown with masked details | This page has no card data; Shopify owns payment details and billing management. |
| ⚪ | **Add or update payment method action** — A way to enter a new card or change the current one | Do not collect payment details in Insignia; use Shopify's hosted management route. |
| 🟡 | **Next billing date and amount** — When the next payment will be taken and for how much | The page shows the recurring base rate, trial end/current period, and provider discount metadata. The DTO does not establish an exact next-charge amount/date, so no net charge should be calculated locally. |
| ⚪ | **Invoices and receipts** — A list of past charges with the ability to download a PDF invoice for each. | Shopify owns subscription charges and invoices; Insignia has no local invoice source. |
| ⚪ | **Tax and VAT (if applicable)** — Applicable tax or VAT shown on invoices and billing history | This is a subscription summary, not an invoice/tax-history surface. Leave tax facts to Shopify's actual charge records. |
| ⚪ | **Failed payment recovery** — Clear messaging and recovery instructions when a payment attempt has failed | The current provider view has no verified failed-payment fact. Inactive or unverified status must not be presented as payment failure. |
| ⚪ | **Billing contact email** — The email address where invoices and billing notifications are sent | Billing contact and notifications belong to Shopify; this surface has no such data. |

I also applied the [Contacting support flow](https://www.checklist.design/flows/contacting-support) to existing recovery copy. All three items are missing in source: there is no contact link, no real contact method, and no expectation/information guidance. The single fix is to make an existing support channel actionable once its destination is known; a new support product is not justified. The [User Management checklist](https://www.checklist.design/web-app/user-management) and [Saving changes flow](https://www.checklist.design/flows/saving-changes) are not applied: there is no Insignia invite/role-management surface and these Settings routes are summaries, reads, consent, or Shopify handoffs rather than saved local preference forms.

## Evidence and limits

Primary sources: [Settings hub](../../../apps/web/src/islands/MerchantSettings.tsx), [canonical navigation](../../../apps/web/src/components/AdminNavigation.astro), [merchant implementation map](../../architecture/implementation-plan.md#L395-L420), [Settings product-truth review](settings-product-truth-review-2026-10-25.md), and [Storefront setup V1](storefront-setup-v1-2026-10-26.md). The prior [Settings checklist audit](checklist-settings-pending-audit-2026-10-25.md#L74-L100) reviewed screenshots for subpages but had no current Settings landing-page capture; this note adds an independent source-level scope critique, not a visual acceptance result. No UI or product behavior was changed and no tests were run.
