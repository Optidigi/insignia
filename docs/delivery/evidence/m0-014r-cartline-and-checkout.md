# M0-014R CartLine correction and checkout continuation

Status: **CORRECTION VERIFIED; BOUNDED LIVE CHECKOUT/LIFECYCLE OBSERVED;
200-LINE LIVE CAPACITY BLOCKED**. This is the
new R-run record. The [original stopped M0-014 record](m0-014-public-app-checkout.md)
and its failed local checkout differential remain historical and unchanged.
The [principal's PR #19 review](../PR-019-principal-review.md) is an external
CHANGES_REQUESTED verdict at base/effective merge base
`7222a96ff2b0408d0fbfe0803835d24acfd463b7`, reviewed head
`317a4030032b565053b2a4b8032803246ba39ed7`. No native GitHub review
was posted. PR #19 remains draft and unmerged.

## Corrected local candidate

The only Function decision change is the CartLine-specific grammar in
`spikes/m0-014/rust/capacity.rs`: canonical suffix `/0` joins the existing
positive decimal and bounded UUID forms. Empty, leading-zero multi-digit,
wrong-kind, malformed UUID and over-width values still reject. The target
uses its actual CartLine ID; variant/market GID parsing, Ed25519, whole-set
verification, member indices, exact money, policy and capacity are unchanged.
Both query projections now include the fixture-only
`_insignia_fixture_role` line property. This is necessary because Transform
and Validation expose different target-local IDs and equal-quantity lines do
not identify buyer intent. The local issuer requires the exact distinct
customized role set and quantity in both fresh inputs, null roles on ordinary
lines, compares roles independent of line order, and assigns members only by
the observed customized role. The v2 wire and signed economics do not include
the fixture property. Ordinary lines keep distinct Ajax-only probe properties
to prevent cart coalescing. Native pre/post cart role and member evidence
is summarized below. Transform/Validation tests now
exercise the full targets with a
[captured-input-derived fixture](../../../spikes/m0-014/evidence/m0-014r/local/captured-validation-provenance.json)
at `CHECKOUT_INTERACTION` and `CHECKOUT_COMPLETION` and with negative economic,
member, signature, key and context controls. The fixture preserves actual
signed quote, members, configuration, amounts, context and IDs from the
21:46:41 UTC native `CART_INTERACTION` log. Only the log envelope was removed
and the JSON serialization changed; the two checkout variants change only
`buyerJourney.step`. They are **local replays**, not observed live checkouts.
The prior pinned Validation binary still rejects this exact `/0` input at
both simulated checkout steps (539,340 instructions).

The new build uses pinned Rust 1.98.1, Shopify CLI 4.8.2 and its Function
trampoline 2.0.1, with `wasm_opt=false`. It builds M0-014 source in a fixed
isolated scratch path and verifies rebuilt bytes against separate retained
R artifacts. The original M0-013 source/binaries and M0-014 stopped-run
artifacts remain intact. Source, queries/schema and build script hashes are
bound in the [110-row R-run matrix](../../../spikes/m0-014/evidence/m0-014r/local/current-artifact-matrix.json):
109 rows use the corrected binaries and one separately named
historical-zero-rejection row uses the old Validation binary.

| Target | Raw SHA-256 / bytes | Final upload-input SHA-256 / bytes |
|---|---|---|
| Transform | `ebbf181923906186c48cb701b0c48e95d5283f0ed6a6b5e5f64d4a36d9d27276` / 182,215 | `28a6fb0dd8c4e4aef36a9f205496eca7633433f00e639143dd77afed581c9c60` / 179,279 |
| Validation | `acdecb609fc829515d35efd4e62c6e4ab6a31dab4c95d4771eaddbb43bb74f6b` / 183,813 | `ead48e5c78d694f860758504eb3dd8ac11c871d71b45e0b8b44dee83be359e5d` / 180,821 |

The first pre-review local pass used the earlier no-role query artifacts.
The first fresh Spec/security reviewers found positional role assignment;
the binder/query and table above are the corrected second candidate. The
second review found that 200-line replays omitted the new projected field.
A [preserved synthetic all-200-role run](../../../spikes/m0-014/evidence/m0-014r/local/all-roles-capacity-failure.json)
exceeded the 8.8 million instruction evaluation target in Validation at
32+168 (8,817,567). The issuer now projects roles
only on customized lines and requires null roles on ordinary lines; this
preserves member mapping while avoiding unnecessary query data. Four new
role-projected 200-line rows pass at 8,086,040/8,361,970 instructions for
10+190 and 8,554,214/8,708,703 for 32+168 (Transform/Validation). The
failed all-200-role measurement is retained separately and is not labelled a
passing matrix row. The corrected local suite passed with the established
project-local Zig host linker and Node 24.21.0: 11 current TS tests; 13
Authorization, 19 Transform and 25 Validation native Rust tests;
fmt/clippy; 152 historical rows; 88 old pinned M0-014 rows; and the 110-row
R-run matrix (109 corrected-artifact rows plus one old-binary rejection
control). The latest role-projected artifacts accept captured
Validation at both simulated checkout steps at 2,723,609 instructions and
17 output bytes. The 10+190
and 32+168 zero-based synthetic rows remain below the 8.8 million instruction
and 16,000-byte reference on both targets. Thirty-three buckets reject;
10,000 physical units stay bounded. These are local runner measurements;
stack peak remains unknown. CLI Function build repeated the exact final
bytes. The development preview bundle contained these exact final Wasm hashes;
platform-side storage hash/version GID is unavailable through supported
readback.

## Read-only live baseline before resumption

On 29 September 2026 UTC, pinned Admin GraphQL `2026-07` through the exact
installed app returned shop `105501393179`, installation `1054356963611`,
app `429028933633` and client `1443cf6d03d39edae7c101a943c5c684` on the
USD Basic development store. The same fixed-target read returned both owned
products ARCHIVED and unpublished, three real variants at USD20.00, Shop
location `120998986011` stock **64/200/8 available and on-hand, zero
committed**, no app-owned public config or product anchors, and no active
app-scoped Transform/Validation. The authenticated native Admin Orders page
listed no orders. The normal storefront home page opened in the shared
browser with country `US`; the built-in test gateway was inactive. Owner-only
untracked readbacks are retained under
`/home/serveradmin/.local/share/insignia-m0-014r/` (identity SHA-256
`b8162d478cd023207fa9950f3183ee83e4dcc32871d159a1f8ccd595a186e721`,
baseline SHA-256
`16c23a106010358f1493b5e1ff5bd5d2ea7fd120bf59def76dc557100455490f`).
These reads establish the starting state. The one-operator attempt register is
outside Git with mode 0600. The final pre-live clean source commit was
9c4e16b9162dbc5f4079c3b3112e5d47aea6e4ff. Fresh restricted Spec and
security reviews found no remaining blocking defect. The Spec reviewer could
not rerun path isolation in its read-only EROFS sandbox; the integrator ran
the full script successfully on the same commit. Earlier reviewer findings
on positional role assignment and projected-field capacity were corrected.
Local review does not replace principal approval.

## Actual live checkout and enforcement

Before activation, fixed-target reads confirmed the designated app/shop,
nine existing grants and the 64/200/8 inventory baseline. The operator
reused only the two existing products, three variants and Shop location. A
fresh key ID 60014 and generation 103abd89a0e54ce3b5e28bccec3a0a1b were
held outside Git. The two products were temporarily published, five exact
app-owned config/policy/registration metafields were created, and owned
Transform and Validation were enabled with blockOnFailure=true. The first
Transform object, gid://shopify/CartTransform/190316827, was removed only for
the wrong-price control. Replacement gid://shopify/CartTransform/190349595
was read back before continuation; Validation
gid://shopify/Validation/204046619 remained active. The built-in Test payment
gateway was explicitly Active on its detail page; no real provider setting
was changed.

The normal password-protected storefront held one ordinary Small unit at
USD20.00, two customized Small units at USD30.33 each, and one customized
Small at USD30.34. Three cart lines represented four physical units. The
[sanitized actual Ajax before/after mapping](../../../spikes/m0-014/evidence/m0-014r/live/small-cart-role-member-mapping.json)
shows each operator-assigned ordinary/customized role, probe, member and
price. Roles are buyer-visible fixture properties, not an independent trust
anchor: a coherent swap between otherwise identical one-unit lines in both
plain Function captures before signing can change which receives member
index 0. A regression records this accepted limitation. The observed cart
mapping supports this run's operator intent, while the signature and
Functions protect the resulting member set and money. Transform emitted two
lineExpand operations using its actual UUID CartLine
IDs. Native checkout showed USD111.00 pre-discount merchandise with free
shipping; direct Validation at CHECKOUT_INTERACTION had zero errors. With
only the owned Transform removed, native checkout recalculated to USD80.00
and the still-active Validation rejected it. Restoring Transform restored
USD111.00 and acceptance. A cart with a malformed member also rejected,
but it retained the USD80.00 base-price mismatch, so this live case does
not isolate member enforcement. Removing the invalid custom lines and
orphan quote repaired the ordinary optional
USD20.00 checkout. An unsigned Required fixture line rejected at
CHECKOUT_INTERACTION. Selected direct log hashes and observations are in the
[sanitized R-run evidence](../../../spikes/m0-014/evidence/m0-014r/live/live-observations.json),
which links tracked redacted direct Function inputs/outputs and raw
owner-only log hashes. Complete signed quote carriers are redacted in the
latest tracked captures; their SHA-256 values and raw source hashes remain.
The captured-input local replay fixtures in the current tree retain the
original stopped-run signed quote to reproduce its exact differential;
earlier draft commits also exposed live signed carriers. Those keys report
validity through 2026-09-30. The fixtures and Functions were removed and
the private keys deleted. No historical rewrite or revocation is claimed.

The single permitted Bogus purchase succeeded through normal checkout:
rewrite-dev order gid://shopify/Order/7487119458587, displayed as #1001
**in this separate rewrite development store**, four Small units, USD111.00
paid, zero shipping/tax/discount. It is distinct from protected legacy
staging order #1001. Native Admin read back the exact line amounts, quote
and member properties. Direct CHECKOUT_COMPLETION Validation used actual
CartLine IDs /0, /1 and /2, amounts 20.0, 60.66 and 30.34, and returned no
errors. Its [sanitized direct input/output](../../../spikes/m0-014/evidence/m0-014r/live/purchase-completion-validation.json)
is tracked; raw owner-only log SHA-256 is
5801b677bd272ee3fc286af261defe1f8ae0783475750670bb1822659f76e2f6.
The preview bundle's final Transform/Validation Wasm hashes matched the
locally tested upload-input artifacts above; platform-side storage hashes
were unavailable.

## Large-cart boundary and native lifecycle

The unpaid 10+190 and 32+168 attempts could not reach 200 lines on the
existing Large variant. Each accepted 50 distinct Large lines; a 51st Large
returned HTTP 422 with “The maximum quantity of this item is already in
your cart.” A 51st *total* line using the Small variant was accepted in the
first diagnostic cart. Large stock still read 200 available/on-hand, zero
committed, with inventory policy DENY. The cause is **undetermined**. No
200-line live checkout, Function input or pricing claim is made; both
diagnostic carts were cleared. The 200-line matrix above is local evidence.
No variant or inventory workaround was used.

For the small order, the native fulfillment form selected only the two-unit
USD30.33 customized bucket, quantity one, and displayed “1 item selected.”
Admin then showed exactly one USD30.33 customized unit in fulfillment
#1001-F1 from Shop location, with the other three unfulfilled. A native
Return selected only that fulfilled unit and created #1001-R1. Process and
refund showed one unit, calculated USD30.33 on the original Bogus payment,
and Restock at Shop location checked. The receipt showed Return closed,
USD30.33 refunded and that unit restocked. The T3 keyboard action failed on
Shopify's custom reason selector, so the operator set its underlying native
select to “Changed my mind” and dispatched change; the visible form showed
that value before submission, but the return receipt showed “Color.” That
reason-label discrepancy is preserved, with no cause asserted. It was not
used as monetary or restock evidence.

After partial fulfillment, the native menu had no Cancel order action. Its
Refund route selected the three remaining unfulfilled units at USD20.00 +
USD30.33 + USD30.34, calculated USD80.67, with Restock items checked. Admin
recorded three items refunded and three restocked at one location, then
auto-archived the order. Final order readback: USD111.00 paid, USD30.33 +
USD80.67 refunded, USD0.00 net, zero remaining items, Return closed. This
observes native calculated refund and release of the three unfulfilled
units; it is **not** labelled an explicit Cancel order/CANCEL event. A
fixed-target Admin GraphQL inventory read showed Small 64, Large 200 and
Required 8 available/on-hand, with zero committed at Shop location—the
baseline quantities. No manual stock or refund adjustment occurred. The
one-order/four-unit cumulative ceiling is exhausted.

## Final resource state and limitations

The guest Ajax cart returned zero items and no attributes. Both fixture
products were ARCHIVED with publishedAt null. All five R-run app-owned
metafields were deleted; final readback returned null
config/registration/policy. The two exact owned active Function objects
were deleted and current app-scoped lists were empty. The built-in test
gateway was deactivated; after Admin reload its detail displayed
“Reactivate.” The run's CLI preview stopped, the new private-key directory
was deleted, and Shopify retained the stopped development-preview record
and nine existing grants. No app dev clean was used. The fully refunded,
archived rewrite-dev test order remains as an audit record. Legacy staging
orders #1001–#1006 and billing resources were untouched.

The [sanitized R-run evidence](../../../spikes/m0-014/evidence/m0-014r/live/live-observations.json)
binds direct Function logs, owner-only readbacks, the operator register and
the high-line diagnostics by SHA-256. Raw logs and Admin readbacks remain
mode-0600 under /home/serveradmin/.local/share/insignia-m0-014r/ and are
not in Git. Live 200-line capacity, platform storage hash and an explicit
native CANCEL event remain limitations. No full gate pass, production
protocol/capacity adoption, production publisher, M1 or PR merge is claimed.
