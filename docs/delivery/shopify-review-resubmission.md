# Shopify review resubmission

Shopify paused review until 25 November 2026; the pause has ended and the owner resubmits. The release running during the reported failure was
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
Shopify activated the fix in version `1264667197441` on 24 November. On the exact reviewer
fixture, Tab skipped the off-screen button and reached it after scrolling it into view. Enter
opened the Designer and closing restored focus. Two items at $15.00 each produced one signed
line and a $30.00 checkout subtotal. The tester stopped before payment and emptied the test cart.
An independent pass reached the same $30.00 in Designer Review and verified merchant navigation,
order #1012 and both plan choices in the authenticated owner session. The clean buyer path passed.
Independent access to Shopify Admin remains unverified. The last full paid test order and the
Canada dialog retest are recorded above against their respective earlier releases.

### Remaining hardening

Hardening pass on 24–25 November: done. Keep the USD and qualified EUR primary-Market scope in the
[pricing specification](../architecture/implementation-plan.md#4-pricing-engine). Released in deploys
AS (version `1265206460417`, 24 Nov `23:05Z`), AT (version `1265289363457`, 25 Nov `00:50Z`) and AU
(web `91bc61b5`, 25 Nov `02:31Z`); see [deployed identities](state.md#deployed-identities). Evidence
folders are under `~/insignia-qa/runs/` on the dev host.

**Merged PRs.** #631 fault-injection tests; #632 publish timing log `publication_request_timing`;
#633 Vite optimizer cache flake; #634 `UNSUPPORTED_MARKET` refusal reasons and Market IDs in logs;
#635 and #642 cart adapter recovery after a refused add (#642 removed an unsafe single-line exception
after a native add.js 422 "Only 50 items were added…" landed 50 units); #636 Partner transient → 409
BUSY and a bounded acceptance/renewal lock; #638 unsupported-country cart repair (removal-first, a new
string in six languages, Escape closes repair views); #639 all buyer shop-lock waits bounded at 2 s →
409; #640 hourly held-row worker errors; #641 and #650 background release-record refresh during
publish (#650 fixed early timers that could skip it, also on the buyer path); #644 test; #647 provider
failure kind in buyer logs, GraphQL INTERNAL_SERVER_ERROR as BUSY, theme translations escaped once;
#645, #646, #648, #649 and #652 bindings and records.

**Version `1265289363457` on 25 November.** On reviewer fixture product `10645326954779` the storefront
loaded assets from `…/native-escape-once-bcb6cd16/`. Tab skipped the off-screen sticky **Customise**
and reached it when visible; Enter opened the Designer and Escape closed it with focus restored.
Review showed $15.00 per item and $30.00 total (proposal 200). The cart held one signed
`_insignia_line_v3` line, 2 × $15. Checkout showed $30 + $8 shipping = $38. Bogus test order #1015
(`K0ZFDZVTR`) read back in Insignia as Paid, Artwork complete, 2 × USD 15.00
(`2026-11-25-final-fixture.u5XSci`). The Canada cart notice rendered "Customization isn't
available…" with a literal apostrophe.

**Post-release run on `1265206460417` (deploy AS, 24 Nov `23:24–23:37Z`).** Fixture order #1014
(`P0IZPHZKP`). Canada product page: the Designer's 422 explanation before any buyer session.
An NL-signed line viewed from Canada blocked checkout; repair opened straight into removal, Escape
closed the confirmation and then the view, and removal emptied the cart. NL→DE repair re-signed at
€25 and checkout was clean. An over-stock add left no stuck state. USD flow passed. Billing showed
**Manage plan in Shopify**. Publishing an existing product took 9.3–10.1 s
(`2026-11-25-postrelease.Pw7aVc`).

**Fresh stores (24 Nov).**
- USD: on rewrite-dev, new product `qa-hardening-usd-2026-11-25` from setup to order #1013, $58.00
  (`XGJUAQ7PC`; `2026-11-25-usd.j83fWP`).
- EUR: fresh dev store `insignia-hardening-eu-1125` (Shopify test data; primary Market Netherlands
  including Germany; second Market Canada in EUR with a −5% catalog, shipping from
  "My Custom Location"). Insignia installed via OAuth with the €0 test plan; product
  `qa-hardening-eur-2026-11-25` set up and published; order #1001, €56.95 (`UE70GTJ5M`;
  `2026-11-25-eur.yMKsYe`). The owner keeps this store as the EUR/two-Market fixture.

**Market switch (24 Nov).** NL→DE (same primary Market): the cart kept the line, the surcharge
dropped, checkout was blocked and repair re-signed for DE. NL→CA: checkout was blocked and nothing
was signed in Canada (`2026-11-25-market-switch.Gr43af`). A fresh-context reviewer re-ran it
independently (`2026-11-25-independent-market.4tNmc8`). A Market-aware stock check is deferred (#637).

**Recovery R1–R7 (24 Nov, `2026-11-25-recovery.*`).** A dropped acceptance retried with the same key;
409 BUSY retried automatically; a dropped proposal offered Retry; an offline upload offered Try again;
a pre-cutover cart line was removed via repair; a tab closed mid-publish ended Published; a billing
API outage showed its message and Try again. The 13 Nov seeded expired-quote cart predated the
production cutover and was removed via repair, so native renewal of an owned expired quote remains
unverified.

**Performance.** Lighthouse on 25 Nov (`2026-11-25-lighthouse.eVpaqZ`): USD −7.0 points (above the
6-point pass, within Shopify's 10-point limit), EUR −1.5. Causes and fixes are tracked in #653.
Production first publish took 25–38 s before #641; republish 9.3–10.1 s after. Production logs only
reach back to container restarts, so a 48 h latency baseline needs persisted logs.

### Deploy AW validation

Shopify version `1267604848641` became active on 26 November. Deploy AW includes cart repair, storefront
polish, publish recovery, and the one-time dependency update. The app still uses Shopify API 2026-07.
Dependabot configuration is removed. pnpm stays at 12.16.1 for offline packaging, TypeScript stays on
6.0.3 for the compiler API, and pg-boss stays on queue schema 43 pending issue #670.

All 17 live Shopify CDN assets matched the qualified build. Web and the worker role read the same fresh
release evidence. A Netherlands test fixture passed artwork upload, a signed EUR cart, and checkout with
a EUR 50.00 subtotal. EUR v2 binds the exact active Shopify version and Function source. See
[deploy AW](state.md#deployed-identities) for the runtime identities and release receipts.

Both native rounds ran on AW with the same code and runtime profile. Fresh EUR qualification used
Shopify's **Add product** action after the duplicated fixture was diagnosed. Insignia recorded each
Bogus order below as Paid and Artwork complete.

| Round | Store and purchase | Signed cart subtotal | Paid total | Shopify order |
| --- | --- | --- | --- | --- |
| 1 | USD reviewer fixture | USD 30.00 | USD 38.00 | #1018 |
| 1 | USD fresh product | USD 50.00 | USD 58.00 | #1019 |
| 1 | EUR retained product | EUR 50.00 | EUR 56.95 | #1003 |
| 1 | EUR fresh product | EUR 25.00 | EUR 31.95 | #1004 |
| 2 | USD reviewer fixture | USD 30.00 | USD 38.00 | #1020 |
| 2 | USD fresh product | USD 50.00 | USD 58.00 | #1021 |
| 2 | EUR fresh product | EUR 25.00 | EUR 31.95 | #1005 |

**Publish timing.** Times run from the merchant's confirmation to durable activation. Both EUR rounds
first showed an inherited-defaults review warning and a conflicting unsaved-draft banner. Reloading
the current draft verified the saved values. The measurements start at the following confirmation.

| Store | Round 1 first | Round 1 republish | Round 2 first | Round 2 republish |
| --- | ---: | ---: | ---: | ---: |
| USD | 28.1 s | 16.9 s | 25.9 s | 15.2 s |
| EUR | 17.4 s | 12.0 s | 17.1 s | 11.7 s |

**Market switch and recovery.** Both EUR rounds confirmed one stocked variant in the Netherlands
and Germany primary Market and in the Canada Market. Round 1 used variant `64553686040906`.
Round 2 used variant `64580209279306` with 9 available at Shop location and 10 at My Custom Location.
The cart re-signed for Germany and reached clean checkout. Canada refused customization. Escape closed the confirmation and repair view, and confirmed
removal reached a fresh empty cart. Both rounds passed native over-stock retry, lost acceptance
response with same-key retry, 409 BUSY retry, dropped proposal, and upload retry. EUR publishes on blank
products activated about 2.5 s and 2.7 s after the admin tab closed.

**Fixture conflict.** The first EUR round initially used Shopify **Duplicate product**. The duplicate
had the same ready registration and policy metafields as its source and no effective Insignia
publication. Publication preparation returned `422 PUBLICATION_UNAVAILABLE` before a provider write.
The editor showed its unconfirmed-request Retry copy. The unprepared intent lapsed after ten minutes.
Both blank-product trials then passed. See [the recorded follow-ups](../backlog/README.md#aw-validation-findings).

**Coverage limits.** The USD reviewer fixture passed keyboard open, Escape, and focus return. Hover,
the small viewport, quiet ordinary-product eligibility, and the stable Customise control passed both
USD rounds. Native physical touch and renewal of an owned expired quote remain unverified. Chromium
and Firefox touch preparation and expired-offer renewal passed local tests. Normal EUR billing loaded
in both rounds. The automated 503 recovery test passed. T3 Preview could not inject the same fault in
the native cross-origin billing frame. Shopify challenged the round 1 USD fresh-product tab after
checkout. Cart emptiness was unverified in that tab. The other recorded carts were verified empty.

**Evidence custody.** Redacted run records on the dev host are under `~/insignia-qa/runs/`.
USD rounds use `2026-11-26-aw-round1-usd.F6UKBX` and `2026-11-26-aw-round2-usd.2z4FNC`.
EUR round 1 uses `2026-11-26-aw-r1-eur.kPc07W` and `2026-11-26-aw-r1-eur-clean.UMhwWA`.
EUR round 2 uses `2026-11-26-aw-r2-eur.0vRXfN`.

**AW storefront performance.** The idle USD and EUR product pages requested the same three AW
JavaScript files. They total 37,048 decoded bytes and 11,356 bytes when gzipped per file, below the
15,360-byte budget. All 17 CDN assets matched the build. No new Lighthouse series qualified.
The isolated USD profile reached the product, but the shared host did not meet the quiet-load threshold.
The EUR storefront opened from Shopify Admin. Its isolated Lighthouse profile still needs store access.
The retained Lighthouse scores are the 25 November baseline.

## Other review items

| Requirement | Verified and remaining evidence |
| --- | --- |
| 1.2.3 Plan changes | **Settings → Billing → Manage plan** opens Shopify's selector for Standard at $49.99 every 30 days or $449.99 per year with identical features. Both no-charge switches passed on 23 November. On 24 November, Shopify admin **Settings → Apps → Insignia** showed **Insignia Standard · $0/month** on rewrite-dev. The owner confirmed there is no eligible billed installation for paid invoice evidence. Shopify's acceptance of switching billing periods under this requirement is open. |
| 3.2.1 Older order scope | The active scope baseline excludes `read_all_orders`. The 19 November fresh installation verified the required grant and recent orders. The old EUR review installation may still show a historical grant. |
| 2.1.1 Customized product | Version `1265289363457` passed the reviewer fixture through Bogus order #1015 and the Canada explanation on 25 November. The AW validation is tracked above. |
| 4.5.4 and 4.5.5 Access | On 24 November the listing form showed the app-account exemption selected. The saved private instructions direct reviewers through Shopify admin and give the test storefront, access instructions, expected cart total and both prices. The storefront path passed earlier in a signed-out session. Access to the merchant admin using the reviewer's own Shopify account remains unverified. |

## Release record

1. Run the required foundation and runtime checks, including the browser and buyer HTTP regressions.
2. Follow the [runtime release procedure](../../deployment/m5-runtime/README.md#deploy-next).
   Check that the active Shopify version, runtime release profile and EUR qualification match.
   Verify Shopify serves the actual extension assets and obtain fresh Function admission.
3. Attach current evidence for the purchase path, scope, billing and independent reviewer access.
   Record the exact released versions and fixture used in delivery state. Use the Partner Dashboard
   to resubmit after the pause ends and the evidence is complete.

Automatic shop erasure is live. The [delivery state](state.md#deployed-identities) records live
completion and isolated restore evidence. Three historical drafts remain on hold because later
installations share those rows. The [retention decision](shopify-erasure-retention.md) defines
what may remain.
