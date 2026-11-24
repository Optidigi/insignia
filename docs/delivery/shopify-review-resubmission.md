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

### Native country switch on 24 November

On active Shopify release `1263405170689`, the disposable `insignia-network-qa` store started in
the Netherlands (EUR). The Complete Snowboard, Ice variant `54050604384592`, reached the Shopify
cart at €699.95 with one signed customization line. Shopify's localization form changed the
same session to Canada while keeping EUR. Shopify emptied the cart. The Designer config returned
422 and showed the country-or-currency explanation before collecting artwork. Returning to the
Netherlands left the cart empty. The disposable theme's Insignia embed was restored to its
original disabled state.

Shopify offered no stock for this variant in Canada. The native result therefore leaves open
whether a signed line can survive a switch between Markets that both stock it. All 66 local
authorization, transform and validation tests passed, including checkout rejection for the
wrong country or Market.

### Native QA wave on 24 November

The exact review fixture completed a second authorized test-gateway order on active release
`1263405170689`. Designer, cart and checkout agreed on $30.00 for two units. Shopify confirmed
$38.00 with shipping and Insignia recorded #1012, paid, with one binding, quantity 2,
$15.00 per unit and retained design. Double-clicking **Add to cart** produced one signed line.
The narrow browser restored the artwork and quantities after reload. All 15 storefront CDN
assets matched the qualified build.

The independent Canada run returned 422 with the correct explanation in the DOM. A theme rule
that hides empty elements hid the shadow-DOM wrapper, including the explanation and Close button.
The regression applies that rule in a browser and requires the visible message and functional
Close button. The fix was activated in Shopify version `1264361504769` on 24 November.
The live Canada retest showed the explanation and Close button. Closing returned focus to
**Customise**, with no artwork workspace or cart change. The reviewer fixture also verified one
signed line for two items and $30.00 in checkout on the recovered runtime.
All five snowboard variants were unavailable in Canada, so the same-stock check remains open.

The independent reviewer pass reached $30.00 in Designer Review. Shopify's connection verification
screen blocked Admin before sign-in. The merchant walkthrough needs an explicit Admin entry point
and a native rerun. Local billing QA also reproduced loss of **Manage plan in Shopify** while the
subscription read returns 503. The action returned after a successful retry.

In the owner session, Billing showed $0 development terms and opened Shopify's Standard plan
selector. Order #1012 showed $38.00 paid, two items and complete artwork. The billing outage fix
passed in a local browser with a simulated provider failure. The signed-out reviewer journey still
needs independent merchant-admin proof.

The live retest also found that Tab focused the sticky **Customise** button below the viewport.
The storefront regression verifies that Tab skips it off screen and reaches it when visible.
Shopify activated the fix in version `1264667197441` on 24 November. Live keyboard and buyer
retests on that version are in progress.

## Other review items

| Requirement | Verified and remaining evidence |
| --- | --- |
| 1.2.3 Plan changes | **Settings → Billing → Manage plan** opens Shopify's selector for Standard at $49.99 every 30 days or $449.99 per year with identical features. Both no-charge switches passed on 23 November. On 24 November, Shopify admin **Settings → Apps → Insignia** showed **Insignia Standard · $0/month** on rewrite-dev. The owner confirmed there is no eligible billed installation for paid invoice evidence. Shopify's acceptance of switching billing periods under this requirement is open. |
| 3.2.1 Older order scope | The active scope baseline excludes `read_all_orders`. The 19 November fresh installation verified the required grant and recent orders. The old EUR review installation may still show a historical grant. |
| 4.5.4 and 4.5.5 Access | On 24 November the listing form showed the app-account exemption selected. The saved private instructions direct reviewers through Shopify admin and give the test storefront, access instructions, expected cart total and both prices. The storefront path passed earlier in a signed-out session. Access to the merchant admin using the reviewer's own Shopify account remains unverified. |

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
