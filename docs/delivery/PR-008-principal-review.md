# PR #8 — principal review

Review date: 26 September 2026. Repository: `Optidigi/insignia`.
Verdict: **APPROVED — off-store whole-quote feasibility only**.
Base/effective merge base: `878c9b9b58cc7aeae81b2393847eb18ef91e2540`.
Reviewed head: `eb1abc3b1828d3aa5e6b99cc785f5e25f2839ffa`.
Native GitHub APPROVE submission: **HTTP 403; not posted**. This is the attributed external principal verdict, not a GitHub review submitted successfully by another identity.

## Disposition

No merge-blocking defect found in the inspected prototype. M0-005 achieved its local engineering target. The principal accepts **FURTHER_EVIDENCE**, not production adoption, protocol freeze, a merchant capacity setting, or complete gate acceptance. The maintainer may merge this reviewed checkpoint; an agent still needs the owner's exact merge authorization. Keep this head unchanged while merging; subsequent work belongs on another branch.

## Specification and correctness review

The Rust core reconstructs every member in quote-global index order and authenticates the complete domain/header/member statement with one strict ordinary Ed25519 verification per Function. It rejects incomplete/duplicate/contradictory membership, mismatched actual variants/quantities, wrong independent context, arithmetic errors, revoked or out-of-window keys and inappropriate selling plans. Both full targets independently invoke verification. Validation additionally compares the independently supplied lexical monetary field. The implementation does not verify one old line token and trust the others.

The TypeScript path is an issuer/codec, not a second custom elliptic-curve implementation. Maintained Dalek primitives implement Rust canonical/nonweak key admission and signature checks. Existing exact allocation is reused. Reviewed tests include compensated monetary changes that preserve totals, changed quote/member combinations, key windows, malformed encodings, and complete-set removal.

The live meanings of those projected fields are not established by synthetic inputs. Missing required-product policy remains an explicitly demonstrated allow-path limitation. Neither capability is approved for production reliance.

## Capacity evidence

| Case | Transform instructions / output bytes | Validation instructions / output bytes |
|---|---:|---:|
| 10 signed + 190 ordinary | 6,055,185 / 3,446 | 6,324,982 / 17 |
| 64 signed + 136 ordinary | 7,114,868 / 21,968 | 7,037,769 / 17 |

The first case meets the package's 8.8M-instruction / 16,000-output-byte engineering objective. The 64-member Transform output fails the 20,000-byte reference. Do not add the independent Functions' instruction counts together.

**64 was a stress case, not an approved minimum product capacity.** Its failure remains evidence and requires eventual bounded quote admission/output handling, but it does not require another optimization project before live carrier testing. No two-/four-/ten-/64-bucket merchant cap is adopted. Live testing below uses a deliberately small fixture envelope, not a new product limit.

## Independent principal verification

- Inspected fixed-ref comparison and changed-file inventory; core verifier/key admission, issuer, adapters, selected adversarial tests, runner, candidate contract, proposal and local-review packet.
- Read final-head CI job 108225521844 for run 36181749558. The log shows 10 TS tests, 13 Rust core tests and 5 native tests per target, both builds, case generation and artifact publication succeeding.
- Downloaded actual CI artifact 10884747241. Verified archive SHA-256 `f22af0b641bdcd1129f0e50293cbfb1ff0e5180ba15c85db823c927ef347e894` and manifest SHA-256 `f42cd48acbc300e842f3e74c80650b076d10c124580e07e2823f624ab39fdde4`.
- Verified both actual CI Wasm files and the four case/result payloads against the manifest; checked 70 case/input/expected-output digest bindings and byte sizes.
- Ran a separate Python struct/cryptography fixture oracle. All 70 expectations agreed: 28 authenticated cases, 36 rejection cases, and 6 ordinary controls, including named negative capabilities. This verifies the supplied statement and fixture expectations independently; it does not rerun the Rust or Wasm targets or exhaustively prove all hostile-point crypto behavior.
- GitHub synthetic merge `12374e400ff5b45d5ffc7de160c5cce6e58c091d` has the exact base/head parents and the same source tree as the reviewed head: `4ccfc04b16b0d325f1715850e419ecfb12299cc5`.
- Plan/ledger published blobs remain `d3d7d9c155cdcdcc3b88aeaaa77eebb10d8a767d` / `3544e054bb52c11713b2bc1c96cdf6d7a2264936`.

Limits: the principal did not rebuild the full toolchain, execute the downloaded Wasm, remeasure instructions/memory, independently refetch all 46 source hashes, mechanically compare every local/CI row, or operate Shopify. The local and CI binaries are different. Keep each measured result bound to its actual artifact; behavior agreement is not byte identity.

## Proposal adjudication and next direction

1. Retain v2 as a promising, unadopted candidate. Authorize the next bounded experiment only after the owner sends its launch permission.
2. Test the complete carrier path and actual monetary semantics next: guest cart, Transform, Validation, order, stale-envelope repair, and available accelerated entry paths separately. Missing private native HTTP interception is not a blocker; supported Function inputs/outputs and direct order/cart evidence matter.
3. Do not require a legacy v1-to-v2 production migration or dual-version implementation now. These protocols have only synthetic off-store offers. Future deployed-version compatibility needs a design when live issued authorizations exist; preserve old source/evidence without building speculative migration.
4. Required-product policy publication/propagation and complete fail-closed checkout behavior remain G6 work. A successful known-required control does not close the missing-policy risk.
5. Overall G1/G2/G3/G5 remain IN_PROGRESS. G4/G6 may receive limited live evidence in the next explicitly scoped package; neither will be declared fully passed. G7/G8/M1 are not authorized.

No GitHub merge or Shopify mutation was performed by the principal review.

## Sources

- Fixed head: https://github.com/Optidigi/insignia/tree/eb1abc3b1828d3aa5e6b99cc785f5e25f2839ffa/spikes/m0-005
- Run: https://github.com/Optidigi/insignia/actions/runs/36181749558
- Current Function reference: https://shopify.dev/docs/api/functions/2026-07
- Validation activation: https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ValidationCreateInput
- Ajax cart (including non-removal of cart attributes by clear): https://shopify.dev/docs/api/ajax/reference/cart
- A first-hand developer report describes accelerated-entry carrier loss; this is a test lead, not a platform-wide verified conclusion: https://community.shopify.dev/t/function-input-cart-attribute-doesnt-map-to-the-ajax-cart-attributes/13794
