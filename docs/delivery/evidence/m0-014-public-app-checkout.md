# M0-014 Public-app checkout proof — execution record

Status: **PREVIEW_AND_DRAFT_FIXTURES_READY / LIVE_CHECKOUT_NOT_RUN**. This record
distinguishes direct reads, bounded setup, local replays and native checkout
evidence. Two draft products, their single initial stock, app-owned policy,
one development preview and two owned Functions have been created. Publication,
cart, order and lifecycle tests remain pending.

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
M0-013, apart from this isolated extension config. The [actual CLI preview
bundle](../../../spikes/m0-014/evidence/preview-bundle-identity.json) contains
base64 modules whose decoded executables match both reviewed hashes byte for
byte. Admin readback binds the Transform Function ID
`01a0e9cd-647d-76b2-bc74-3bad0579eeff` and Validation Function ID
`01a0e9cd-647d-7e48-8e64-76e2ca69dcb9` to the exact app, handles and
API `2026-07`. The preview's provider version GID and a platform-side binary
hash are unavailable; the local bundle proves the CLI upload input, not
independent Shopify storage bytes.

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
The first PR CI attempt also exposed an off-store configuration mistake:
`shopify app config validate` with the real named config requested Shopify
authentication on an unauthenticated runner. The suite now validates the
named config locally with `tomllib` and builds Functions through a separate
synthetic default config; the remote preview still uses the explicitly named
new-app config. Local full-suite replay passed after this correction. The
corrected CI head is pending.

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
private key was generated in an owner-only directory outside Git for this
run; it must be deleted on cleanup. The captured-input provenance must be
verified by the operator;
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
After the owner restarted it and signed in, the operator directly observed
the exact Admin store and the Optidigi Partner app's **Draft** App Store review
page. The Dev Dashboard's Distribution link leads to the App Store listing,
consistent with the prior Public designation; no listing was submitted.
The native Payments page showed an incomplete Shopify Payments setup and no
active real provider. The operator opened Shopify's built-in **Test payment
gateway**, whose detail says no transaction fees, activated it under the
explicit M0-014 permission, and verified **Active** plus **Deactivate** after
reload. No real-provider setting was changed. Admin Locations showed one
active **Shop location**, URL ID `120998986011`. The browser disconnected
after these reads; storefront, cart, checkout and fulfillment remain pending.

## Bounded development setup

The [direct setup receipts](../../../spikes/m0-014/evidence/) cover the
fixed-target Admin reads, mutation results and readback. `shopify app dev
--path spikes/m0-014/rust --config m0-014-public --store
insignia-rewrite-dev.myshopify.com --no-update` reached Ready at
20:55:48 UTC, preserved the released `insignia-1` version and original
`https://example.com` app URL, and auto-granted only the nine config scopes
within the prompt's ceiling. Readback returned the exact app/shop/installation,
the two new Function handles above, one active Shop location
`gid://shopify/Location/120998986011`, and no app-owned Cart Transform or
Validation before activation. This app-scoped API cannot establish absence of
another app's objects.

An exact-handle preflight returned both intended handles and all `m0-014`
tagged products absent. Two `productSet(synchronous:true)` calls created
Product A `gid://shopify/Product/10485042479387` and Product B
`gid://shopify/Product/10485042839835` as **DRAFT**, with exactly three real
physical variants at USD 20.00. A's Small/Large IDs are
`54061591232795` / `54061591265563`; B's required probe is
`54061592281371`. Shopify reported tracked, shipping-required, oversell
`DENY`, and one initial available/on-hand allocation of **64 / 200 / 8** at
the designated Shop location, zero committed. The total **272** is exactly
the authorized initial ceiling. No inventory compensation or reset has run.

Before metadata, the app-owned shop config and both product anchors were null.
One `metafieldsSet` with `compareDigest:null` created the 278-byte public
config and four product anchors under namespace `app--429028933633`; the
private Ed25519 key remains outside Git with directory mode 0700 and file
mode 0600. Direct readback matched generation
`4f8dd164cc8c48199a94cea5da11be4c`, key ID `60014`, optional A and
required B, while both products stayed DRAFT. The app-owned Cart Transform
`gid://shopify/CartTransform/190251291` and Validation
`gid://shopify/Validation/203948315` were then created with zero user errors.
Fresh Admin readback shows the intended Function IDs, Transform
`blockOnFailure:true`, Validation `enabled:true` and `blockOnFailure:true`.
No live Function input projection or checkout has yet been observed.
`python3 -B spikes/m0-014/scripts/check-live-setup.py` passed against 14
hashed, nonsecret setup receipts, two Draft products, three variants, 272
initial units and two owned Functions. This checker verifies saved receipt
consistency; it does not attest Shopify independently.

## Live execution and residue

See [the resource manifest](../../../spikes/m0-014/evidence/resource-manifest.json)
for IDs, setup stock and each pending case. Both fixtures are **DRAFT and
unpublished**; no cart, checkout or order was created. The active development
preview, owned Functions, metadata, stock and private key are current setup
residue requiring bounded completion or cleanup. The retained App Pricing
draft, meter, subscription and M0-012 register were not used. Orders
#1001–#1006 and legacy resources were not touched. No complete gate,
protocol adoption or production activation is asserted.
