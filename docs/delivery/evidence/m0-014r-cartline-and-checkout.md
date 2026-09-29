# M0-014R CartLine correction and checkout continuation

Status: **LOCAL_CORRECTION_VERIFIED; LIVE_CONTINUATION_PENDING**. This is the
new R-run record. The [original stopped M0-014 record](m0-014-public-app-checkout.md)
and its failed local checkout differential remain historical and unchanged.
The [principal's PR #19 review](../PR-019-principal-review.md) is an external
CHANGES_REQUESTED verdict at base/effective merge base
`7222a96ff2b0408d0fbfe0803835d24acfd463b7`, reviewed head
`317a4030032b565053b2a4b8032803246ba39ed7`. No native GitHub review
was posted. PR #19 remains draft and unmerged.

## Corrected local candidate

The only Function behavior change is the CartLine-specific grammar in
`spikes/m0-014/rust/capacity.rs`: canonical suffix `/0` joins the existing
positive decimal and bounded UUID forms. Empty, leading-zero multi-digit,
wrong-kind, malformed UUID and over-width values still reject. The target
uses its actual CartLine ID; variant/market GID parsing, Ed25519, whole-set
verification, member indices, exact money, policy and capacity are unchanged.
Transform/Validation tests now exercise the full targets with a
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
bound in the [106-row current-artifact matrix](../../../spikes/m0-014/evidence/m0-014r/local/current-artifact-matrix.json).

| Target | Raw SHA-256 / bytes | Final upload-input SHA-256 / bytes |
|---|---|---|
| Transform | `35edec3e82f291530912b7bf338520cc1b90ac253006e400952e3753af2059d5` / 182,048 | `2a4f85c58a91df4d3536bf6811f46f2264827136d84d7181d42f63ecd9e1d176` / 179,121 |
| Validation | `ee418455b52c5835968dc43479cf06bd367658a185fc055fe0bd44b01a73f16b` / 183,646 | `c0795b0ece75539dcb44abe27010e4a279a25d54daa3b16b22bd52b0e2f9103b` / 180,663 |

`bash spikes/m0-014/scripts/check-local.sh` passed with the established
project-local Zig host linker and Node 24.21.0: 9 current TS tests; 13
Authorization, 19 Transform and 25 Validation native Rust tests;
fmt/clippy; 152 historical rows; 88 old pinned M0-014 rows; and 106 corrected
artifact-bound rows. Corrected captured Validation accepts both simulated
checkout steps at 2,723,570 instructions and 17 output bytes. The 10+190
and 32+168 zero-based synthetic rows remain below the 8.8 million instruction
and 16,000-byte reference on both targets. Thirty-three buckets reject;
10,000 physical units stay bounded. These are local runner measurements;
stack peak remains unknown. CLI Function build repeated the exact final
bytes, but platform-side uploaded storage hash/version GID is not yet known.

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
These reads establish the starting state; no R-run Shopify mutation has
occurred. The one-operator attempt register is outside Git with mode 0600.

Fresh restricted Spec/security reviews and final clean source commit precede
conditional live mutation. Remaining native cases, cleanup and final-head CI
will be appended without relabeling this local result as checkout success.
