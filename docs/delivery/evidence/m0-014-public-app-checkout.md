# M0-014 Public-app checkout proof — execution record

Status: **LOCAL_PREPARATION / LIVE_CHECKOUT_NOT_RUN**. This record distinguishes
direct reads and local replays from native store evidence. The single remote
operator has made **no M0-014 Shopify mutation** so far; fixture, preview,
Function activation, cart, order and lifecycle results remain pending.

## Reviewed input and merge

The principal's external [PR #18 verdict](../PR-018-principal-review.md) covered
base/effective merge base `662a78cd27507d8a2f1eaa976f1c644c93edd1be`
and head `72f47577ac8563923aff2bd277484c44392eb92c` with all seven named
final-head workflows passing. The owner delegated that exact normal merge.
Immediately before merging, GitHub still reported `main` at the base,
the same head and merge base, and the passing workflows. `gh pr merge 18
--repo Optidigi/insignia --merge` used the repository's normal merge route.
Remote `main` became `7222a96ff2b0408d0fbfe0803835d24acfd463b7`;
its parents are the approved base and head in that order, and its tree
`9c7c372ae6e9c4b1180d710f56a55edda909d03e` equals the reviewed head
tree. The M0-014 branch starts at that remote merge. No native approval was
created on behalf of the principal.

## Exact local executable and regression

The approved PR #18 CI artifact `10993075828` was downloaded again from
GitHub. Archive SHA-256
`2257e3b87c9bcfc3dd0c42ca2c41da163bfd62eb90b2e3bdfc41982486b6c71e`
matched the principal's reviewed archive. The supplied independent offline
checker passed archive integrity, 152 row bindings, 58 valid signed
statements, eight ordinary controls and eight same-input comparisons.
Its checks do not independently execute Wasm or attest a live Shopify input.

The two CI executables retained under `spikes/m0-014/artifacts` are Transform
`cebca846a17013a42dc590c18069ef5d9f0432452eb702d29bc46bbc1985590b`
and Validation
`93148de17900a68732712ce687393ec920f903e55649115f23b9aa3b667a4ebd`.
The new named development config targets client
`1443cf6d03d39edae7c101a943c5c684` and unique extension handles/UIDs.
`shopify app config validate` passed. Local CLI Function builds with
`wasm_opt=false` produced files with those exact hashes. Source, query,
schema, Cargo manifest and capacity guard compare byte-identically to
M0-013, apart from this isolated extension config. The CLI preview/upload
path, Function IDs/version IDs and any platform-side hash are **not yet
observed**.

`bash spikes/m0-014/scripts/check-local.sh`, with the established pinned
Rust 1.98.1, Zig host linker, Node 24.21.0, pnpm 12.6.0 and Shopify CLI 4.8.2,
passed canonical TS golden vectors, M0-013 admission, native Rust
fmt/clippy/tests, retained 152-row replay, eight fixture bridge/binding tests,
and all 88 candidate rows against the exact CI executables. The local
10+190 and 32+168 results are Transform 7,978,310 / 8,432,228 and
Validation 8,253,444 / 8,585,447 instructions respectively; output bytes
are 3,446 / 10,992 Transform and 17 / 17 Validation. These are **synthetic
runner** metrics, not live platform counters. Stack peak remains unknown.
The first full-suite attempt failed because `cargo` was not on that shell's
PATH; the explicit isolated Rust environment passed. Generated M0-013
measurement files were restored to their tracked historical bytes.

The fixture-only issuer uses actual real variant IDs and a trusted operator
readback seam; its synthetic small case allocates `1 × 30.34 + 2 × 30.33 =
91.00`, plus one ordinary 20.00 unit for 111.00 pre-discount. A 33-bucket
proposal rejects before signing. The bridge requires fresh owner-only
captured Function inputs and a fixed-target authenticated Admin read before
issuing; it checks app/shop/installation, 2+1 active fixture variants,
20.00 prices, policy/config/key consistency, presentment, line counts,
quantities, existing carrier absence and conservative byte bounds. It now
rejects duplicate CartLine IDs and any line-order/identity/quantity difference
between the two Function captures. For the small case it emits the observed
2-unit, 1-unit and ordinary line assignments; symlink routes into Git for
private keys or signed output are rejected. The focused final Spec and security
reviews found no remaining local code blocker before bounded setup. A fresh
private key is generated outside Git only for the live run and deleted on
cleanup. The captured-input provenance must be verified by the operator;
the bridge itself cannot attest Shopify origin or later buyer cart edits.

## Direct read-only new-app state

At 28 September 2026 UTC, pinned Admin GraphQL `2026-07` through the
existing new-app CLI installation returned app
`gid://shopify/App/429028933633`, exact client, shop
`gid://shopify/Shop/105501393179`, domain
`insignia-rewrite-dev.myshopify.com`, installation
`gid://shopify/AppInstallation/1054356963611`, USD, timezone
`America/New_York`, plan `Basic App Development`, `partnerDevelopment:true`,
and existing grants `read_products` and `write_products`. Product search
`tag:m0-014` returned zero nodes. The app-owned shop public-config key was
null. The fixed product/policy read query compiled and returned no GraphQL
errors against two nonexistent ID controls. `locations` returned
`ACCESS_DENIED`, confirming that `read_locations` reauthorization is needed
before location setup. Shopify CLI listed only the existing initial active
`insignia-1` released version; no M0-014 release was made.

The T3 collaborative browser initially reported no desktop automation host.
After the owner restarted the desktop app, it attached; shared tab `tab_1`
opened the Admin URL and redirected to Shopify Log in. The owner was asked to
sign in directly in the shared tab and keep credentials out of chat. Current
authenticated Admin and storefront access are still pending. The prior
Public/Draft Partner observation is historical;
current distribution, Bogus provider, native cart/checkout and fulfillment
remain unobserved until the browser is available.

## Live execution and residue

See [the resource manifest](../../../spikes/m0-014/evidence/resource-manifest.json)
for the exact two-product/three-variant/one-location and one-order/four-unit
ceilings and each pending case. No new M0-014 product, metadata, key, Function,
preview, cart or order has been created at this checkpoint. The retained
App Pricing draft, meter, subscription and M0-012 register were not used.
Orders #1001–#1006 and legacy resources were not touched. No complete gate,
protocol adoption or production activation is asserted.
