# Shopify review resubmission

Shopify paused review until 25 November 2026. The release running during the reported failure was
Shopify version `1257303638017` with web deploy AL and worker/verifier deploy AK. See
[deployed identities](state.md#deployed-identities) for live release status.

## 2.1.1 Customized product unavailable

On 23 November the web service recorded 42 quote proposal failures at the primary Market check.
On the same shop and product, three Philippines-context quotes reached Shopify carts. Fifteen quotes
immediately following US-context configuration reads returned HTTP 503. Another product on that shop
had 15 more such 503s. A second shop had 11 503s following Philippines-context configuration reads.
The logs do not record the two Market IDs for a failed request.

The old implementation reports an unequal storefront and Admin primary Market ID as a server
outage. A controlled regression reproduces that error even when country and currency otherwise
match. The target behavior is a localized unsupported-Market explanation when opening the Designer.
Quote proposal, acceptance and renewal continue to verify the buyer country, Market and currency.
Compare the actual IDs and response on an owned two-Market development fixture before attributing
the reviewer’s precise request to the mismatch.

For the release proof, use the exact store, product, variant, placement and price you will give the
reviewer inside Shopify. From a clean buyer session, choose quantity 2 and verify the unit price
is the expected Shopify base price plus the customization surcharge. Verify the same line total
in Designer Review, the native cart and checkout, then place an authorized test-gateway order and
verify the matching order in Insignia. Repeat opening the Designer in an unsupported Market and
verify it explains the restriction before collecting artwork. Check that changing Market with an
existing customized cart cannot bypass validation.

## Other review items

| Requirement | What to verify before resubmission |
| --- | --- |
| 1.2.3 Plan changes | **Settings → Billing → Manage plan** opens the Shopify plan selector. On 23 November rewrite-dev showed only Insignia Standard, with development terms at $0. Owner decision on 23 November: Standard at $49.99 every 30 days or $449.99 annually, with identical features. Qualify both choices through Shopify approval, return to the app, effective access and Shopify charge history. Enable annual pricing after the app recognizes the annual subscription. |
| 3.2.1 Older order scope | Verify the active release and a fresh installation request only the required scopes. Demonstrate recent orders with `read_orders`. The released scope baseline excludes `read_all_orders`. The old EUR review installation may still show a historical grant. |
| 4.5.4 and 4.5.5 Access | Start from a signed-out browser with third-party storage blocked. Follow the submission instructions with the dedicated reviewer account, login details and any storefront password supplied in Shopify’s private submission fields. Walk every step with that access, including billing and checkout. Confirm there is no live verification challenge. Keep the access valid after publication. |

## Release record

1. Run the required foundation and runtime checks, including the browser and buyer HTTP regressions.
2. Follow the [runtime release procedure](../../deployment/m5-runtime/README.md#deploy-next).
   Check that the active Shopify version, runtime release profile and EUR qualification match.
   Verify Shopify serves the actual extension assets and obtain fresh Function admission.
3. Attach current evidence for the purchase path, scope, billing and independent reviewer access.
   Record the exact released versions and fixture used in delivery state. Use the Partner Dashboard
   to resubmit after the pause ends and the evidence is complete.

Shop erasure remains a release gate. The [retention decision](shopify-erasure-retention.md) defines
what may remain. Qualify the genuine callback, database and object erasure, and isolated backup
restore before recording completion.
