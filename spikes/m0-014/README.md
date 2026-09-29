# M0-014 Public-app checkout proof candidate

This is the isolated development-only materialization of the reviewed M0-013
candidate for [M0-014](../../docs/delivery/prompts/M0-014-PUBLIC-APP-CHECKOUT.md).
The two checked-in `artifacts/*.wasm` files retain the approved PR #18 CI
candidate executables for historical replay. The M0-014R extension build
compiles current M0-014 source and checks raw and trampolined upload bytes
against separate `artifacts/m0-014r/` binaries. `wasm_opt = false` prevents
further CLI optimization. Before activation, the operator must also verify
the actual CLI preview/upload path and Function/version identities. The
platform-side hash remains unknown if Shopify does not expose it.

`rust/` retains the M0-013 protocol and verifier while admitting canonical
CartLine `/0`. Both Function queries additionally project a fixture-only role
property so the current issuer can map actual intent across differing target
IDs. The role is not a signed protocol field; actual variant, quantity and
exact money remain verified. `scripts/check-local.sh` checks canonical TS and
native Rust, the retained 152-row replay, all 88 historical rows against
pinned executables, and the current 110-row replay against corrected binaries.
The corrected artifact matrix is local evidence. The bounded native checkout,
order/lifecycle and cleanup observations are in the
[M0-014R evidence record](../../docs/delivery/evidence/m0-014r-cartline-and-checkout.md);
the exact 200-line live carts remain blocked by a 51st-Large-line HTTP 422.
No complete gate pass or production capacity is claimed.
`python3 -B scripts/check-live-setup.py` hashes and reconciles the saved
Admin setup receipts offline, including the exact initial 272-unit stock,
draft status, owned metadata and effective Function flags.

## Operator boundary

The single Shopify operator first records the exact installation, Basic dev
store, Public/Draft app, scopes, existing preview/Function ownership,
payment test mode and one available merchant-managed location. The live
resource and test ledger is [the manifest](evidence/resource-manifest.json).
M0-014R reuses only products `10485042479387` / `10485042839835`, their
three existing variants and Shop location `120998986011`; no new product,
variant, location or manual inventory write is authorized. The operator reads
all existing `$app` projection
keys before creating package-owned values. The preview must read back the
owned Transform and Validation identifiers, `blockOnFailure: true` and
Validation `enable: true` before any positive checkout. A changed or
inaccessible current state stops the dependent step.

`generate-ephemeral.mjs` creates a new protected key directory **outside Git**
after the app/store/day check. Its public config is staged only under this
app's owned metadata. `issue-current.mjs` uses the fixed-target authenticated
Admin read, fresh operator-owned plain-cart Function captures, product policy,
market/country/day, actual line/quantity counts, distinct
`_insignia_fixture_role` properties on customized lines in both Function
inputs, null roles on ordinary lines, and projected input byte bounds before
calling the M0-013 whole-quote issuer. Ordinary lines retain unique Ajax-only
fixture probe properties to prevent Shopify coalescing. It rejects mismatch and
writes the signed quote to a new mode-0600 file outside Git. A captured input
is an operator observation; this helper cannot attest its Shopify origin.
The operator must verify its actual preview source and inspect the resulting
post-issuance Function input before checkout. No quote is issued from buyer
supplied byte ceilings.

The positive small cart has three customized Small units allocated as
`1 × 30.34 + 2 × 30.33 = 91.00`, plus one plain Small at `20.00`:
four physical units and `111.00` pre-discount merchandise. The 10+190 and
32+168 cases are unpaid. Actual Shopify line counts, input/output and resource
results must be recorded; merged lines never count as a 200-line result.
The 33-bucket proposal is rejected before signing.

The required Product B, economic wrong-price Transform removal/recreation,
invalid-line repair, one Bogus order and native one-unit partial fulfillment
and two calculated refund/restock steps follow the prompt's exact limits.
Inspect the native fulfillment quantity before submitting. Stop on a bad
selection or price rather than compensating through inventory or refunds.
The cleanup order is: clear owned carts, unpublish/archive fixtures, then
remove only owned policy/Functions, delete ephemeral private key and stop the
preview. The final ledger must state any retained preview/grant holding state.
