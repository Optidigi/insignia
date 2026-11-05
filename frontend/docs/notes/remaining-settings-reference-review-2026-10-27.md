# Remaining Settings reference review

Reviewed 27 October 2026. This is a presentation and copy review of Billing and App permissions against current Shopify primary references and the saved rendered captures. No app, backend, billing, permission, or store changes made.

## Shopify references

The current [App Home Settings template](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/settings) groups related options in sections, uses each section's heading and subheading for context, and nests status/action items as their own sections. Shopify's [Account connection composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/account-connection) puts the service name, connection status, and action together. These are useful structural references, though Insignia's Billing and Permissions pages report access and subscription state rather than edit settings or connect a third-party account.

Current [Shopify App Pricing guidance](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) keeps plan selection and approval in Shopify. The May 2026 [pricing update](https://shopify.dev/changelog/posts/shopify-app-pricing-charge-for-usage-recurring-subscriptions-or-both) says Shopify's app settings show a billing card with current plan, status, usage charges, and upcoming changes. Insignia's own Billing page therefore earns its place by explaining the current subscription's effect on Insignia and linking to Shopify. It should not become a second plan picker.

Shopify's current [Scopes API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api) separates checking app scopes from requesting declared optional scopes. Shopify's [staff permissions guide](https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions) says app permissions in Shopify Admin do not change permissions configured through an app. The Insignia page needs separate rows for app scopes, staff access, and the order owner requirement.

## Billing

The current active, trial, discount, pending-change, cancellation, inactive, unverified, service-error, denied, and expired captures use one compact card. In active states the plan name and status sit in the section header, the rate is the dominant fact, dates or discount details follow, and the Shopify action comes last. This is a sensible read-only adaptation of Shopify's status/name/action grouping. The 390 px captures keep the price and action clear. Inactive and unverified states explain which Insignia actions are unavailable. The saved unverified capture now distinguishes the unknown billing result from a confirmed inactive subscription; the earlier wording issue is fixed.

**P3 copy cleanup, corrected after review.** The reviewed service-error capture repeated "Try again" in both the banner body and adjacent button. The delivery pass removed that instruction from the body and retained the button, then rebuilt, reran the Billing regression and regenerated the captures. Source: [MerchantBilling.tsx](../../../apps/web/src/islands/MerchantBilling.tsx#L81-L95). Current rendered evidence: [desktop error](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-billing-error.png) and [mobile error](../../../../.artifacts/admin-popup-review-2026-10-24/settings/mobile/settings-billing-error.png).

I found no other high-confidence Billing hierarchy or action-placement issue. The visible "Insignia Standard" name is the current recognized plan in the saved state, not the undecided future Free-plus-two-paid catalog. The plan selection reference remains an external Shopify example.

## App permissions

The three rows represent distinct checks: product configuration access combines app scopes with the acting staff member's access; checkout setup uses optional read-only scopes; orders and artwork require the store owner's account and Shopify order access. Three rows are justified. They remain scannable in the desktop and 390 px captures, with each badge aligned to its row. When an optional scope is missing, the page explains the blocker before the consent buttons. The actions remain grouped after the checks without splitting the card or prompting on page load. I would not collapse these states or remove the separate permission information.

Rendered examples: [desktop allowed](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-permissions-allowed.png), [desktop product scope missing](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-permissions-product-missing.png), [desktop checkout scope missing](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-permissions-missing.png), [desktop staff view-only](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-permissions-view-only.png), and [mobile allowed](../../../../.artifacts/admin-popup-review-2026-10-24/settings/mobile/settings-permissions-allowed.png).

## Evidence limits

This Luna review used saved desktop and 390 px mobile captures, including simulated error and access states. The delivery pass subsequently added 320 px captures for Billing and App permissions; Sol's separate final pixel review covers the revised narrow layouts. These images show the local Polaris/App Bridge preview, not a live installed merchant app in Shopify Admin. They establish what the saved pages render, not native host behavior or owner acceptance.
