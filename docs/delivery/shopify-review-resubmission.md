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
in Designer Review, the native cart and checkout. Stop at checkout for the candidate walkthrough.
Use the recorded AW Bogus orders as evidence of order ingestion on AW. Repeat opening the Designer in an unsupported Market and
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
15,360-byte budget. All 17 CDN assets matched the build.

The USD fixture completed three mobile Lighthouse pairs. The control blocked the exact AW asset
prefix. The theme and the app's inline Liquid markup still rendered.

| USD Lighthouse medians | Score out of 100 | LCP | TBT | CLS |
| --- | ---: | ---: | ---: | ---: |
| AW assets loaded | 62 | 5,508 ms | 642 ms | 0 |
| AW assets blocked | 66 | 5,223 ms | 611 ms | 0 |
| Loaded minus blocked | −4 points | +285 ms | +31 ms | 0 |

LCP was higher with AW assets loaded in all three pairs. Score and TBT moved in both directions.
The samples in the first pair started 5 minutes 9 seconds apart because of the quiet-host wait.
The highest recorded one-minute load during the accepted samples was 3.45. Lighthouse recorded no
slow-load warnings. The receipts are in `~/tmp-insignia/release-AW/perf/runs/aw-4CkaaE/` and
`aw-X99Ox7/`. An isolated EUR Lighthouse series still needs storefront access.

### Deploy AX validation

Shopify version `1268027162625` became the sole Active version on 26 November. See
[deployed identities](state.md#deployed-identities) for the runtime and database schema.
All 17 Shopify CDN assets matched the qualified build. The Function modules matched AW.

| Native fixture | Items | Customization | Signed cart and checkout subtotal |
| --- | --- | --- | --- |
| USD reviewer fixture, 2 items | $20.00 | $10.00 | $30.00 |
| Netherlands QA fixture, 2 items | €40.00 | €10.00 | €50.00 |

Both buyers uploaded the same synthetic SVG, reviewed the split price, and added the signed line
to Shopify's cart. Both stopped at checkout without placing an order or paying. Both carts were
verified empty after cleanup. The Netherlands result qualified EUR v2 for AX.

The disposable USD QA fixture returned to **Published** after a placement label change.
The Netherlands QA fixture showed **Unavailable for this selection** before artwork when its M
variant had zero stock. Restoring the original 500 units cleared the sold-out hint.
The USD reviewer storefront opened Designer in a signed-out session using the fixture password.
The owner account opened the embedded merchant editor. Shopify reviewer-account access is still
unverified. The AX receipts are in `/srv/data/saas/insignia/releases/review-readiness-849a38e1`.

### Deploy AY validation

The 27 November backend rollout of `254da5c0` kept Shopify version `1268027162625` and both
Function modules. The Foundation build matched the 17 qualified AX theme assets and both Wasm
files byte for byte. The verifier, web and worker passed startup checks. Web and worker independently
read the same fresh release record for each of the USD and EUR fixtures. Roles, application schema
75, queue schema 48 and purchase facts matched the pre-deploy checkpoint. The web guest artwork
route returned its expected 401 for an unverified request and logged the refusal through journald.
Worker startup records also reached journald. The four error-level startup summaries reflected
held uninstall and privacy obligations reproduced from the pre-deploy checkpoint. Those obligations
remain open.

The native merchant and buyer walkthroughs on AY and the 48-hour logging baseline remain open.
The AX walkthrough above is evidence for its original backend and the same Shopify assets.

### Deploy AZ validation

Main `7c70ae29` kept Shopify version `1268027162625` and both Function modules. The exact
Foundation artifacts matched AY's 17 qualified theme assets and both Wasm files. The verifier,
web and worker were healthy by `11:47:43Z`. Post-deploy roles, ACLs, application schema 75,
queue schema 48 and protected purchase facts matched the restore-verified checkpoint.

Web and quiesced worker-role reads matched fresh release evidence for the USD and EUR fixtures.
An initial extra reader reached the worker's four-connection role limit while the running
worker held its two configured pools. The repeated read while quiesced passed and the worker
resumed healthy. The pre-deploy checkpoint reproduced the worker's four held-obligation
summaries. The AZ verifier scanned the same 1,011 phases in a median of 1,383 ms over
three warm read-only scans. The AY serial scan measured 1,761 ms in the earlier comparison.
These numbers cover settlement scanning.

Stable-name journal queries returned both AY and AZ container records for web and worker.
The query covered roughly eleven hours and contained two guest artwork timing events. The
48-hour baseline and native merchant, duplicate-product, blank EUR Setup, and USD/EUR
checkout walkthroughs remain open before resubmission.

### Deploy BA validation

[#688](https://github.com/Optidigi/insignia/pull/688) merged as `e73f2a69`. The
[#689 binding](https://github.com/Optidigi/insignia/pull/689) merged as `c4375cb3` with the same
tree and parents as Runtime `46004394586`. Production is healthy on the new web, worker and
verifier images. Application schema 75, queue schema 48, roles and protected purchase facts matched
the restore-verified checkpoint. The worker reported the held privacy and uninstall obligations
tracked on AZ.

Shopify confirmed `1269249933313` as sole Active in the 60-version inventory. Both cart Functions
still match AX byte for byte. A live USD product page loaded the new asset prefix. Fetching all
17 assets in that browser returned HTTP 200 and matched the staged SHA-256 for each file. Web and
worker independently read the same fresh release evidence for each of USD and EUR by
`13:25:05Z`, about 19 minutes after candidate creation began. EUR v2 now uses the BA version.

- **USD buyer.** Uploaded the test SVG and reached a $25.00 quote. After reloading, the Designer
  offered the saved design and fetched the artwork preview successfully. One signed v3 line
  reached Shopify checkout at $25.00.
- **EUR buyer.** Uploaded the test SVG, received a €25.00 quote and reached Shopify checkout at
  €25.00 with one signed v3 line.
- **Merchant.** The live Products list showed `Published` and `Shopify: Active` separately
  for the USD test product.

No payment was submitted. Both test carts were empty at the end. The native duplicate-product
refusal and blank EUR Setup checks, the 48-hour log baseline, isolated EUR Lighthouse and
reviewer access remain open.

### BA validation round 1

Round 1 started on 27 November. Shopify readback still showed version `1269249933313` as sole Active.
The running BA image and Compose identities matched the deployment record. Foundation and
Runtime had passed on the release tree.

- A signed-out browser opened the exact USD reviewer product `10645326954779`, added artwork
  and reviewed two units at $15.00 each. Shopify checkout showed $30.00 with one signed line.
  A separate 390-pixel viewport passed keyboard open, Escape and focus return.
- The EUR fixture reached checkout at €25.00. Switching NL to DE retained the signed cart
  line and blocked checkout until review. After the buyer accepted the €25.00 total again,
  the cart carried a replacement authorization and checkout opened normally. Canada returned
  the country-or-currency explanation before artwork entry. No payment was submitted.
  Both test carts were empty at cleanup, and the EUR session returned to NL.
- The retained EUR duplicate `16266402726218` showed the Insignia-field support refusal and
  closed publish review without a Retry prompt. It had no effective publication or durable
  publication operation before or after the test.
- New labelled Shopify Draft fixture `16269466141002` reached the inherited-defaults pause.
  The unsaved banner cleared, and the image measurement, placement and €5.00 price survived
  reload. The first successful publish took 11,644 ms. Republish after a placement label edit
  took 9,202 ms. These are individual native timings. The Shopify product remains Draft.
- Shopify's current-installation readback showed `read_orders` and no `read_all_orders` on both
  the USD reviewer and EUR hardening test shops. The focused local buyer and merchant suites
  passed 40 tests. All 315 Function replays passed against the deployed Wasm. Peak instruction
  count was 8.51 million against 11 million, and peak linear memory was 1,600 KiB.

Receipts are on the operator host under `~/insignia-qa/runs/2026-11-27-ba-round1.J33L9D`.
The Function receipt is in `~/insignia-qa/runs/2026-11-27-ba-functions.0MUegl`.

Round 1 is open. Independent merchant access reached Shopify sign-in. The 48-hour journal window
has yet to elapse, and a dedicated EUR Lighthouse profile still needs storefront access.
Round 2 starts after the required checks close.

### Deploy BB release validation

The combined Designer and merchant fixes passed Foundation and Runtime on main `81434785`.
All 17 staged theme assets matched that qualified storefront build. The inactive version readback
matched BA outside the theme assets, including both Function binaries and scope configuration.
The binding [#695](https://github.com/Optidigi/insignia/pull/695) merged as `658fab8a`, with the
same tree and parents as Runtime `46047054191`. Both isolated checkpoint restores matched
schema 75, queue schema 48, roles, ACLs, protected purchase facts and queue jobs. Live readback
matched the protected facts after the backend rollout.

Shopify showed `1269561884673` as sole Active in the exact 61-version inventory at `18:21:50Z`.
EUR v2 changed only its active-version reference. Web and worker independently agreed on
fresh release records for both test stores by `18:22:12Z`. All seven Insignia containers were healthy.
The rollout used no migrations or grant changes.

### Deploy BB native QA

The focused run exercised the exact USD reviewer fixture. Two signed units reached Shopify
checkout at $30.00. The EUR fixture reached checkout at €25.00. The Netherlands-to-Germany
switch blocked the old authorization until the buyer reaccepted €25.00. Canada showed the
expected restriction before artwork entry. Both carts were verified empty.

Both broad rounds used BB. In each round the USD shopper reached checkout at $69.00 with two
signed lines for three items, and verified an empty cart after cleanup. Both first-time merchants
published fresh, labelled Insignia setups while the Shopify products stayed Draft.
Returning-merchant checks confirmed save and reload, republish, the copy thumbnail fallback,
configured-destination protection, and the expected refusal without stale retry advice.
No payment or order was submitted.

Round 2 reopened the retained refusal fixture before the previous unprepared request had
expired. Publish was disabled for the specified 10-minute window. The reopened editor gave
no reason during that window. After expiry, Publish became available, and the expected refusal
reproduced with no effective publication or durable operation. Track the missing explanation
as a UI follow-up. The existing publication guard behaved as specified.

No 503 or confirmed functional regression surfaced in the sampled traffic. Preview could
not attribute resource 401s or a single stalled checkout reentry click that succeeded on the
next attempt. The live artwork picker name remained unverified in Preview. Four isolated
buyer recovery tests and 14 browser accessible-name cases passed on the exact BB assets.
Native fault recovery, successful copying to a disposable destination and populated method-default
inheritance were outside the demonstrated coverage.

Independent reviewer access, the 48-hour log baseline, and isolated EUR Lighthouse were open
at the end of these BB rounds. See the later [EUR Lighthouse results](#deploy-bb-isolated-eur-lighthouse)
and [BD validation](#deploy-bd-native-validation) for current evidence.
The private receipts are in the operator's BB focused and broad QA run directories.

### Final reviewer walkthrough and billing retest

On 27 November, two more runs on BB took the exact USD reviewer fixture through artwork
upload, one signed line with two $15.00 units, and $30.00 Shopify checkout. Checkout reentry
worked in both runs. One Preview action needed a second click. The available request trace
did not establish a cause. Both carts were verified empty. No payment or order was submitted.
The owner session opened product Setup and the Insignia Orders search. Independent reviewer
access is still unverified. Insignia requires Shopify's store-owner role for Orders and
artwork, so a regular staff invitation would leave those screens untested.

On the disposable billing dev store, Standard switched from annual to monthly and back
to annual. Shopify explicitly marked both approvals free to test. Both the embedded Billing
screen and Shopify's installed-app settings showed the effective cadence at zero cost.
Shopify's current charges page showed a zero running total. The store finished on its
original annual test plan. Paid charge history and Shopify's treatment of same-plan cadence
switches under requirement 1.2.3 remain open.

### Deploy BB isolated EUR Lighthouse

On 27 November, a dedicated signed-out visitor profile on the EUR hardening storefront
completed three mobile loaded/blocked Lighthouse pairs per page. The live CDN matched
all 17 qualified BB assets. All 18 accepted runs completed without Lighthouse slow-load warnings.

| Page | Weight | Loaded | Assets blocked | Difference |
| --- | ---: | ---: | ---: | ---: |
| Home | 17% | 91 | 91 | 0 |
| Product | 40% | 78 | 80 | −2 |
| Collection | 43% | 91 | 91 | 0 |
| Weighted | 100% | 85.8 | 86.6 | −0.8 |

The local comparison was within Shopify's 10-point benchmark. Blocking the exact BB
asset prefix preserved the theme and app's inline markup, so this comparison measures
the loaded assets' impact. Shopify's before-and-after install test can capture other changes.
The private receipt and run summaries are under the final BB QA performance run directory.

### Deploy BC billing validation

Main `9387f43b` supplied the qualified images from Runtime `46076790812`. Foundation's second
attempt passed after the first runner's package-mirror failure. The database checkpoint
restored with matching protected records, and the Free product migration passed on that
restore before it was applied. Application schema 76 and queue schema 48 are live.
Protected purchase facts, ACLs and the Shopify Active app version `1269561884673` matched.

Shopify's plan selector exposed Free, Standard and Pro with monthly paid pricing only.
The draft English listing read back the names and plan features. The disposable
`insignia-billing-qa-1126` store moved from its legacy annual development contract to monthly
Standard, then Pro, Standard, Free and Standard. Approval screens showed no-charge test
terms. Insignia's effective plan and the monthly Standard and Pro amounts matched Shopify.
Free became effective on the test store and the Billing screen exposed the Free product
choice. The store finished on monthly Standard. No payment, reinstall or order was needed.

The exact USD reviewer fixture reached Shopify checkout at $30.00 with two $15.00 units
on one signed v3 line. The cart was verified empty after cleanup. The live transition test
did not exercise publishing on Free, Pro batch production, or a deferred paid-to-Free
change. Those cases have supporting local checks and remain separate from this provider receipt.

### Deploy BD native validation

On 28 November, [#702](https://github.com/Optidigi/insignia/pull/702) replaced only web
with main `f9e09522` from [Runtime run 46151931497](https://github.com/Optidigi/insignia/actions/runs/46151931497).
The CI archive and native image matched manifest `sha256:e400ce77f3d2118e50aadd28fdb759d54f8243215b7937a3b4d644b0611a17ea`.
The restore-verified checkpoint matched live schema 76, queue schema 48, roles and protected
purchase facts after both rounds. Shopify version `1269561884673` and the existing EUR binding
continued to serve signed checkout. The web service was healthy and public liveness returned 200
at 14:05 UTC. The prior web image is in verified off-host custody.

Two sequential owner-session rounds on rewrite-dev opened the exact direct editor URL that had
failed on BC. Direct navigation, reload, Free publication of the selected disposable product
and refusal of the second product all worked. Each round switched Standard → Free → Pro →
Standard through Shopify's no-charge test approval. Each already-signed USD reviewer cart
still reached checkout at USD 30.00 after downgrading to Free. Pro artwork-later reached checkout
at USD 25.00 in both rounds. Both Pro exports prepared two pages for historical test orders #1020
and #1021, and Standard still showed the historical order as Paid with batch tools disabled.
The EUR hardening product separately reached checkout at EUR 25.00 using the same deployed web.

QA restored monthly Standard and the fixture settings, emptied both storefront carts, and
stopped before payment. A sample of 879 structured web records contained no application request
failure events and one expected Free-tier entitlement denial. The two rounds do not verify an
independent Shopify reviewer login or the full 48-hour journal window.

## Other review items

| Requirement | Verified and remaining evidence |
| --- | --- |
| 1.1.9 Buyer consent | AX showed the item subtotal, customization subtotal and quote before **Add to cart** in USD and EUR. The signed cart and native checkout subtotals matched. The expired quote browser regression requires a new acceptance when terms change. Shopify has yet to confirm how it classifies Insignia's Cart Transform price under the fee guidance. |
| 1.2.2 Billing lifecycle | On 26 November, the new Basic dev store `insignia-billing-qa-1126` declined Standard and Insignia showed **No active subscription** with a link back to plan selection. The store approved the $0 annual plan, uninstalled, and reinstalled. Shopify retained the trial with cancellation scheduled. The merchant reapproved via **Manage plan in Shopify** and the cancellation notice cleared. Shopify showed €0/year after trial. The disposable store remains installed on the $0 plan. No payment or order was made. The dev-host receipt is in `~/insignia-qa/runs/2026-11-26-billing-lifecycle.QJ2UbX/receipt.md`. |
| 1.2.3 Plan changes | BC verified distinct Free, Standard and Pro switches in both directions through Shopify's plan selector, with effective Insignia readback and no reinstall. Shopify marked the approvals no-charge on the dev store. The owner has no billed installation for paid invoice evidence. See [BC billing validation](#deploy-bc-billing-validation). |
| 3.2.1 Older order scope | The active scope baseline excludes `read_all_orders`. The 19 November fresh installation verified the required grant and recent orders. BA readback on 27 November confirmed `read_orders` without `read_all_orders` on the two tested shops. The older EUR review installation was outside that readback. |
| 2.1.1 Customized product | Version `1265289363457` passed the reviewer fixture through Bogus order #1015 and the Canada explanation on 25 November. The AW validation is tracked above. |
| 4.5.4 and 4.5.5 Access | On 24 November the listing form showed the app-account exemption selected. The private instructions observed then directed reviewers through Shopify admin and included storefront access and the expected cart total. On BD the owner session completed the merchant walkthrough. Confirm that the private instructions describe the current Free, Standard and Pro plans and that the reviewer's Shopify identity can access the merchant steps. |

## Release record

1. Run the required foundation and runtime checks, including the browser and buyer HTTP regressions.
2. Follow the [runtime release procedure](../../deployment/m5-runtime/README.md#deploy-next).
   Check that the active Shopify version, runtime release profile and EUR qualification match.
   Verify Shopify serves the actual extension assets and obtain fresh Function admission.
3. Attach current evidence for the purchase path, scope, billing and independent reviewer access.
   Record the exact released versions and fixture used in delivery state. Use the Partner Dashboard
   to resubmit after owner review and once the evidence is complete.

Automatic shop erasure is live. The [delivery state](state.md#deployed-identities) records live
completion and isolated restore evidence. Three historical drafts remain on hold because later
installations share those rows. The [retention decision](shopify-erasure-retention.md) defines
what may remain.
