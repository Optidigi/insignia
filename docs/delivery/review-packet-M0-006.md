# Principal review packet — M0-006

## Identity and authority

Repository: `Optidigi/insignia`. Slice: [M0-006 live carrier and checkout economics](prompts/M0-006-live-carrier-and-checkout-economics.md). PR URL, final head and final-head CI are recorded in the PR description after commit; the reviewed base/effective merge base is remote `main` `9f08c8ff6ee8a6a908b976c26f8435e4301308c5` unless GitHub reports a newer main. PR #8 had exact base/effective merge base `878c9b9b58cc7aeae81b2393847eb18ef91e2540`, approved head `eb1abc3b1828d3aa5e6b99cc785f5e25f2839ffa`, attributed external approval and final-head green CI. The owner authorized its normal merge. Actual remote merge `9f08c8ff6ee8a6a908b976c26f8435e4301308c5` has those exact parents and the approved head tree. No native approval was fabricated.

Required next action: principal review of this one outcome PR, including the economic mismatch and remaining adoption blockers. No approval or gate adjudication is predicted here.

## Outcome and scope

The shared 208-character v2 quote and 30-character per-line members reached both live Functions and the actual order. Independent Validation rejected malformed sets, revoked keys, known-required unsigned goods and a valid quote whose materialized base price did not match. One synthetic Bogus order (#1005, four units) proved the exact USD111.00 allocated-plus-plain pre-discount order and native refund/restock. The conditional 10% discount path showed USD9.09 discount / USD81.91 net against the prompt's USD9.10 / USD81.90 expectation, so no Order B payment occurred. Validation's actual input exposed pre-discount subtotal only. This is a failed economic acceptance observation and remains unresolved.

Changes are confined to a standalone M0-006 preview harness/Function adapters, synthetic fixtures, off-store CI and sanitized live evidence, plus operational docs. The approved plan and decision ledger, M0-004/M0-005 source and historical receipts are unchanged. The v2 domain, signature, shared carrier and compact record format are unchanged. The ten-bucket limit is an experimental trusted admission setting, not a product cap. No full application scaffold, released deployment or architecture change was made.

## Acceptance evidence

| Check | Result | Direct evidence |
|---|---|---|
| Actual app/shop/location, gateway, protected baseline | PASS | `spikes/m0-006/evidence/identity-before.json`, `baseline.json`, `test-gateway-before.json`, protected order snapshots |
| Both owned Functions active, Validation enforced, carrier across cart/Function/order | PASS_OBSERVED | `functions-active.json`, `cart-A-complete.json`, `function-A-*-checkout.json`, `order-A-attributes.json` |
| Exact un-discounted USD91 customized + USD20 plain | PASS_OBSERVED | `function-A-transform-checkout.json`, `function-A-validation-checkout.json`, `order-A-before-cancel.json` |
| Invalid sets, known-required unsigned, revoked key, base-price mismatch | PASS_OBSERVED_REJECTION | `negative-*-validation.json`, `transform-off-fresh-readback.json` |
| Quote replacement across incomplete updates | PASS_OBSERVED | `repair-*.json` |
| Order A native calculated refund/restock | PASS_OBSERVED | `order-A-refunds.json`, `order-A-after-cancel.json`, stock before/after |
| Discount net expectation and Validation's independent net check | **FAIL** — 9.09 / 81.91, pre-discount Function input | `discount-observation.json`, `discount-checkout-validation.json`, two native screenshots; Order B not paid |
| Product Buy Now | FAIL_COMPATIBILITY_SAFE — new unsigned checkout blocked | `buy-now-required-validation.json` |
| Cart express, wallet, last customized-line removal | NOT_RUN/UNAVAILABLE | No cart express option visible; no wallet setup used; `cart-attribute-clear.json` covers explicit clear only |
| Cleanup and history | PASS for direct resource/cart reads; operator assertion for preview/key process cleanup and native discount list | `final-baseline.json`, `final-metadata.json`, `final-orders.json`, `discount-final-observation.json`, `password-protection.json`; #1001–#1004 JSON-equal |
| Exact preview bundle and local bounds | PASS_OFF_STORE | `preview-bundle-identity.json`, decoded/encoded retained assets, `preview-replay.json`, `live-artifact-manifest.json`, local/CI `scripts/check-local.sh` |

The reproducible receipt checker is `python3 -B spikes/m0-006/scripts/check-evidence.py`; full local check is `cd spikes/m0-006 && ./scripts/check-local.sh` with pinned Node 24.21.0, Rust 1.98.1 and Shopify CLI 4.8.2. The 23 retained Function projections include actual inputs/outputs and raw-log hashes; they are not synthetic replay inputs. Raw logs and the unfiltered CLI bundle manifest are omitted for privacy, so those source hashes and remote execution identity cannot be independently attested from this PR alone. Retained local preview Wasm replayed eight synthetic target/case combinations with the pinned runner. Later local/CI Wasm rebuilds may have different bytes; the manifest reports the difference and binds the preview bundle bytes separately.

## Local pre-review and dispositions

One isolated adapter writer delivered only `spikes/m0-006/extensions/**`; the orchestrator integrated the branch, owned all staging operations, evidence, CI and documentation. Fresh independent read-only Spec and Standards/security reviews inspected actual retained receipts and code. Both found the positive Order A proof and the required halt on the one-cent discount mismatch sound. Both required explicit disclosure that Validation's `cost.subtotalAmount` is pre-discount, so net monetary enforcement has not been proved; this is recorded as an open failure rather than relabeled as pass. They also asked for discount-cleanup and cart-clear evidence; the sanitized `discount-final-observation.json` and `cart-attribute-clear.json` were added. Security review found the original cleanup screenshot exposed unrelated merchant discount names; it was removed from the published branch. No reviewer accepted the missing-policy projection as safe required enforcement. The source/receipt manifest is included, with final-head CI recorded in the PR description after it completes; principal review remains independent and mandatory.

## Compatibility, safety and residues

Exactly one successful test order and four purchased units used the owner's ceiling of two/seven. Order #1005 remains an auditable refunded test record. #1001–#1004 and their commitments were unchanged. Small and Medium stock returned to 5/2/7 and 8/2/10 at designated Shop location without manual adjustment. Direct reads verify removal of owned Functions and dedicated metadata, fixture archival/unpublication and empty guest carriers; the native discount list observation reports the owned code absent. The operator stopped/cleaned the preview and removed the ephemeral private key, but those process/filesystem actions have no retained independent receipt. Storefront password remained. Existing app installation retains owner-approved `read_validations` and `write_validations`. No real-payment provider settings changed. The built-in test provider was already active.

Remaining blockers: net discount rounding/observation differs by one cent; Validation cannot attest the net from its observed input; missing required-policy projection can allow unsigned goods and needs a safe publication/rollout obligation; product Buy Now starts a fresh session; cart express/wallet and last-line removal remain untested; future/expired key was not live-tested although revoked was; 64-bucket historical stress failure remains. No G1/G2/G3/G4/G5/G6 full pass, v2 production adoption, product cap or protocol freeze follows.

## Principal decision — principal completes externally

Verdict: PENDING. Bound PR/base/head: record after principal inspects final refs. Gate result separately accepted: NONE. Required corrections/conditions and next authorization: principal/owner to decide, not inferred by this packet. No native approval is claimed.
