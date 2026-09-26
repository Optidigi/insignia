# PR #7 — principal re-review

**Date:** 25 September 2026. **Verdict: APPROVED — corrected off-store spike and negative capacity evidence.**

| Binding | Value |
|---|---|
| Repository / PR | `Optidigi/insignia` / `7` |
| Base and effective merge base | `4591d102bb7368681622221253dbd4c997df1ad4` |
| Approved head | `f1bf2484a8805138bef4b95cfa0b90e60f8da7f3` |
| Superseded external review | CHANGES_REQUESTED on `d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae` |
| CI run / job | `36172396109` / `108194840882` |
| CI synthetic merge | `b2c689b6110b3fe2f78b4990d065f084d730d8a4` |
| Head and CI tree | `db4768c69b688418c3328c17e4ea9b27bd636131` |

The approval binds this corrected head only. It permits a maintainer-authorized normal merge of the isolated experiment. It is not approval to deploy its Functions, freeze the protocol, accept a merchant-facing capacity, close a gate, or begin M1. The principal attempted native APPROVE at this head; GitHub returned HTTP 403, `Resource not accessible by integration`. No native review was posted and no merge or Shopify operation was performed.

## Findings closed

**R1 — raw magic:** TypeScript now compares the four header bytes directly. The appended corpus covers all fifteen nonempty high-bit combinations with independently signed malformed messages, plus the unresigned control. The reviewed generator preserves the original corpus prefix. Raw format rejection no longer depends on Node's ASCII decoding.

**R2 — named strict verification profile:** The pinned Node 24.21.0/OpenSSL 3.5.8 probe and final CI reject identity-key/R=identity/S=0 and a canonical signature's R paired with S+L; the canonical signature succeeds. Rust trusted-key admission constructs a private parsed VerifyingKey, rejects weak keys and reuses it while retaining verify_strict. The requested named regression is closed. This is not a proof that all possible hostile keys have identical behavior across Node/OpenSSL and Dalek, or that arbitrary future runtimes inherit these results. Our earlier Node 22 observation must not be misreported as Node 24 behavior.

**Effective validity:** Both full-set paths require an independently supplied shop-local day in inclusive E-2..E, with ordering before subtraction. Signer issuance remains E=D+2. No wire-layout change was made. The interval restricts use; it is not external proof of the physical signing instant.

**Safe optimization:** Structural/context/count/duplicate/quantity checks occur before expensive signature work. Every member of a complete accepted set still receives strict verification. Parsed keys and decoded claims are reused; the Transform emits no partial authorized result on failure. No additional merge-blocking defect was found in the inspected correction and integrated paths.

## Capacity adjudication

The completed bounded study is accepted as negative evidence about this candidate and the measured builds. It is not evidence that every possible Ed25519 implementation fails.

| Full-target case | Transform instructions | Validation instructions | Disposition |
|---|---:|---:|---|
| 10 signed buckets | 22,024,958 | 21,977,289 | Both exceed the 11M reference |
| 3 signed + 197 ordinary | 9,805,740 | 10,115,508 | Within measured limits, without comfortable universal headroom |
| 4 signed + 196 ordinary | 11,961,204 | 12,264,872 | Both exceed the reference |
| 10,000 physical units in five buckets | 11,092,566 | 11,070,692 | Both exceed the reference |

At 64 buckets the Transform output is 32,775 bytes, exceeding 20,000. That is a second constraint; reducing signature instruction cost alone cannot remove repeated transport bytes. No two-, three- or four-bucket product cap is accepted. The bounded same-protocol optimization package is complete; another open-ended tuning loop is not the next step.

**Gate status:** G2/G3/G5 remain IN_PROGRESS. The measured candidate's capacity result is FAIL. Local codec and exact-money evidence is retained, not promoted to complete platform qualification. G1's prior limited native outcome remains unchanged.

## Build and verification scope

The principal inspected live metadata, the five-commit corrective comparison, updated TypeScript and Rust code, negative-vector construction, both integrated target paths, the review/evidence records, and actual CI job logs. The CI synthetic merge has the exact base/head parents and the same tree as the approved head. The log executes 77 TypeScript tests, 18 Rust core tests, two cross-language tests, one native test per target, both Wasm builds, and 16 smoke / 42 benchmark rows.

CI binaries are 156,626 / 157,995 bytes; clean local binaries are 156,805 / 158,188 bytes. CI logs record the different hashes. Key row counts, outputs and instruction results agree with the retained local evidence. The agent reports comparison of all 58 rows except binaryBytes; the principal did not independently script that complete comparison. General cross-machine bit reproducibility and the cause of every binary difference are NOT established. Build once from a clean tree, hash the exact artifact measured and later deployed, and do not mix evidence from different binaries. This does not require a separate build-system project now.

The principal did not rerun the complete local toolchain, mechanically reconstruct all experiment patches, or independently rehash every retained receipt. Current plan/ledger blob identities match the approved records; local copies are verified in the companion JSON.

## Remaining deployment blockers

An absent product-policy projection can still make an unsigned required product indistinguishable from ordinary merchandise to this harness. The named negative-capability test is appropriately retained. Neither signatures nor a green local check repair that missing independent policy fact. The app cannot rely on this path for required-product enforcement before the publication/rollout contract is resolved and tested.

Actual token transport, post-Transform Validation price semantics, key rollout, native allocated-bucket behavior and ordinary non-Plus/public-app qualification remain unverified. No approval here waives them.

## Next direction — experiment, not adopted architecture

Recommend a bounded, owner-authorized **M0-005 whole-quote authorization feasibility** experiment. Reopen only independent per-line signing and placement of repeated authorization data for that experiment. Test one ordinary Ed25519 signature over a canonical representation of the entire accepted customized quote, with a shared envelope and compact line records. Both Functions independently authenticate the complete set and compare every physical member; verifying one existing line and trusting the rest is not permitted.

This fits the already accepted cart-wide economics, but changes the authorization protocol and therefore must be explicit. The accompanying owner launch grants experiment permission only. Keep the existing ledger/plan and old protocol unchanged; record the candidate separately with an unmistakably different domain/version. Adoption requires subsequent principal review and an explicit decision-record amendment. Staging remains untouched.

## Sources inspected

- [PR #7](https://github.com/Optidigi/insignia/pull/7), approved head and corrective comparison.
- [Review packet](https://github.com/Optidigi/insignia/blob/f1bf2484a8805138bef4b95cfa0b90e60f8da7f3/docs/delivery/review-packet-M0-004R.md) and [measurement evidence](https://github.com/Optidigi/insignia/blob/f1bf2484a8805138bef4b95cfa0b90e60f8da7f3/spikes/m0-004/evidence/m0-004r/README.md).
- [CI run](https://github.com/Optidigi/insignia/actions/runs/36172396109), job 108194840882; synthetic and head Git commit metadata.
- [Shopify Function limits](https://shopify.dev/docs/api/functions/latest#limitations), consulted 25 September 2026: 11M instructions / 20kB output at up to 200 lines, with separate fixed limits.
- [Dalek 2.2.0 VerifyingKey](https://docs.rs/ed25519-dalek/2.2.0/ed25519_dalek/struct.VerifyingKey.html), named strict verification/admission behavior.
- [RFC 8032](https://datatracker.ietf.org/doc/html/rfc8032), ordinary Ed25519 signing and verification of a message; not a Shopify feasibility claim.
