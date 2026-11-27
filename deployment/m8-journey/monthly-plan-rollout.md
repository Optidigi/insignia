# Shopify monthly plans

The [entitlement candidate](monthly-plan-entitlement-policy-candidate.json) maps three Shopify App Pricing handles. It is a release input. The production Compose file records the deployed policy.

| Shopify handle | Display name | Provider billing | Insignia access |
| --- | --- | --- | --- |
| `insignia-free` | Insignia Free | Free | Draft and preview, one selected product for publication and new storefront quotes, required artwork before checkout, individual order artwork |
| `insignia-standard` | Insignia Standard | USD 49.99 every 30 days | Multi-product catalog, placement and decoration pricing, reusable methods, individual order artwork and production tools |
| `insignia-pro` | Insignia Pro | USD 69.99 every 30 days | Standard plus artwork after checkout, setup copying across products, batch artwork ZIP downloads and production sheets |

In Shopify Partner Dashboard, open **Distribution → Manage listing → Published languages → Pricing content**. Configure Free as free and the paid prices as monthly. Verify the exact handles against the Partner observation and each listing locale's descriptions. Keep any subscribed legacy annual contract readable through its actual effective period. Removing the annual option from Shopify's current selector is a provider plan change.

Qualify the migrated and rebuilt release on the allocated dev store before enabling the policy for merchants. Verify the exact $0 provider observations for the Free, Standard, and Pro handles. Shopify's accepted price and plan changes must be read back through the application, including scheduled versus effective downgrades. Check each tier's storefront and merchant controls and repeat the $30 reviewer purchase through checkout.

## Downgrade and publishing

The first successful Free publication command reserves its product under the current installation lock. When a published catalog already exists, the owner selects its Free product from Products. An owner can also select the product when Shopify reports a pending change to Free. While the paid tier remains effective, the choice has no effect on new buyer access.

Once Free is effective, a product outside the selection may keep its Shopify publication and customization requirement. New customization is unavailable until the owner chooses that product, upgrades, or explicitly changes the product's availability in Shopify. This preserves the required-customization guard. Existing signed carts, their terms, previous orders, and retained artwork stay on their original paths. The selected product remains private to the merchant installation.

When Pro access ends, the storefront requires artwork for new designs. The merchant can update and republish existing product setups with the artwork-later setting disabled. Already-issued cart authorization, retained order artwork, and the secure upload paths used to complete outstanding orders retain their existing scope and expiry.

## Evidence

Capture Free → Standard → Pro and both downgrade steps, the effective handle, Shopify's pending change and cycle, plan features in merchant UI, and Shopify charge history as exposed on the allocated dev store. A $0 test contract qualifies the plan transitions and authorizations. The receipt should identify the contract as a no-charge development subscription.
