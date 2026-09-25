# Principal review — Insignia PR #3

Date: 25 September 2026. Principal: ChatGPT, Insignia Rewrite Project.

## Verdict and binding

**APPROVED — executable harness and bounded activation checkpoint.**

| Field | Reviewed value |
|---|---|
| Repository | `Optidigi/insignia`, ID `1386102402` |
| PR | https://github.com/Optidigi/insignia/pull/3 |
| Base / effective merge base | `0f87be149247ea6720984f2cefdc557423001661` |
| Head | `a64f5939f9f9871e274868d4d9c10ed3dbbd890b` |
| Observed status | Open, unmerged, mergeable |
| Change inventory | 39 files; six commits ahead of base |

No merge-blocking defect was found in the inspected implementation and evidence. The maintainer may merge this exact change. An agent needs explicit, one-PR delegation to perform that merge. Approval does not permit adding commits to the reviewed head, bypassing protections, releasing an app version or merging the next slice.

This is acceptance of a useful **partial** M0-001 outcome. The original cart/order/fulfillment/refund/restock objective is not completed. G1 stays **IN_PROGRESS**; G2–G8 stay **NOT_RUN**. Do not relabel activation as a passed materialization or lifecycle gate.

## Review performed

**Implementation/spec axis.** Inspected the Rust Function, GraphQL input and custom-scalar mapping, Function/build configuration, static development server, local check script, Vitest/Wasm harness, representative positive and control fixtures, package configuration, gate record, manifest, activation transcription and cleanup JSON. The only price operation is one `lineExpand` with one child of the original real variant, relative quantity 1 and predetermined amount 30.0. Eligibility is fixture-allowlisted, marked, currency-matched and quantity-bounded. It does not consume a buyer price. Plain same-variant coexistence and multiple variants have local fixtures.

**Quality/security axis.** The scope remains a DB-free experiment. The static app stub returns no authenticated data; scopes and dev configuration remain bounded to the named app. Local checks are fail-on-error. CI is limited to build/test with contents:read and no Shopify credentials or store operations. The marker is not authorization; absent/invalid fixture state can produce no transform and is not a production fail-closed design. `Decimal(30.0)` is an exact whole-unit constant, not proof of general money/FX/rounding correctness. These limitations are appropriate and explicit for this spike.

**CI.** Independently read Actions run `36068575630` and job `107863966407`, including job logs. Formatting/clippy, two native tests, release Wasm compilation and eleven schema-validated Wasm fixtures passed. The actual checkout was the synthetic PR merge `f1872b8db4ed5d50b870fcc3d41a080f40c67780`; its parents match the reviewed base/head and its tree `ffc86a794e54bc02f080859e164a666e424d6406` equals the head tree. This is CI without Shopify access, not an air-gapped dependency build. The logs download dependencies. No extra CI-only ref discrepancy was found.

**Source provenance.** The manifest names Function-source checkpoint `7279b49fe983b4ac883435a5a73031ab52655c5a`. The comparison to the final head shows no change to Rust Function source, query, Cargo inputs or schema; later changes include CI, JS lockfile policy, locales and evidence. Keep source/build/test references distinct in subsequent evidence. The reported local Wasm hash is `5db1b7838409ef4a2a85dbd1ba976e1abb15f32c267a87ab4c006e7d6bac8d1e`; no remote-uploaded binary hash is established.

**Architecture preservation.** Independently recomputed the supplied plan and ledger hashes, compared their bytes with the v1.1 archive and matched their computed Git blob identities with the published objects at this head. Both remain unchanged; neither appears in this PR's change inventory. See `PR-003-verification.json`.

**Limitations.** Review used the GitHub connector. A local Git request failed DNS resolution, so the principal did not build or run the Rust/Wasm suite independently, run the Shopify tests, access the shared browser, or audit every transitive dependency/generated-schema line. The inspected CI logs are actual GitHub results; server executions and retained Shopify outputs remain evidence supplied by the local run. The activation transcript is explicitly reconstructed. Its checksum establishes artifact integrity, not Shopify-authenticated historical provenance. Cleanup output is not retroactive proof of the activation event. No independent subagent review was performed in this principal runtime.

## Native GitHub review submission

An APPROVE submission for this exact head returned HTTP 403, `Resource not accessible by integration`. **No native approval was posted.** No fallback comment, merge or store mutation was performed. This file and the principal's chat verdict are the attributed external approval; relay them as such, not as a native approving review by the author.

## Evidence disposition

| Outcome | Disposition |
|---|---|
| Local Function shape and tests | Accepted at their tested local/CI scope |
| Dev preview/activation | Recorded result accepted as a bounded activation checkpoint, with transcription provenance limitation |
| Cleanup | Retained direct output reports no transforms returned, archived owned product and zero recorded fixture stock; installation/seven scopes remain |
| Real cart, order, fulfillment, refund, restock | Not demonstrated; continue in M0-002 |
| Public-app/non-Plus qualification | Still unverified and required before overall G1 PASS |

The owner's subsequent conversation supplies the shared Admin login and designates **Shop location**, `gid://shopify/Location/89465290910`. These supersede the old missing-input entries for planning the next attempt; the executor must recheck the actual session and resource before mutation. Admin login is not itself proof of storefront buyer access or a test-payment route. Do not ask the owner to designate the same location again.

## Next slice

Issue **M0-002 — actual cart/order lifecycle with the existing harness**, after the approved PR #3 is merged normally. Use a new branch from the actual merged main. Reuse `spikes/m0-001/`, the owned fixture product/variants, current app and the designated staging store. Do not generate another app/harness or repeat preflight.

The companion prompt specifies the bounded work: publish and stock the fixture; reuse the shared browser and existing app; restore only the development preview and owned transform; verify real cart prices before payment; complete two small test-only checkouts and native fulfillment/refund/restock; capture direct sanitized evidence at each step; clean up the owned active resources. The companion owner launch message confirms both the exact merge and continuation permissions.

Keep credentials, raw session traces, real buyer data, cart secrets and payment details out of the repository. Stop the affected checkout if the observed merchandise price/quantity/variant is wrong. A reproducible platform failure is useful evidence; rewriting prices, refund amounts or inventory afterward to manufacture a pass is not.

No M1/product build, signed-authorization implementation, other gates, public/custom distribution selection, real charge, released app deployment or later merge is authorized by this verdict.

## Source pointers

- Reviewed PR: https://github.com/Optidigi/insignia/pull/3
- Function: https://github.com/Optidigi/insignia/blob/a64f5939f9f9871e274868d4d9c10ed3dbbd890b/spikes/m0-001/extensions/m0-001-same-variant/src/cart_transform_run.rs
- Wasm tests: https://github.com/Optidigi/insignia/blob/a64f5939f9f9871e274868d4d9c10ed3dbbd890b/spikes/m0-001/gates/nonplus-same-variant/function.test.js
- G1 record: https://github.com/Optidigi/insignia/blob/a64f5939f9f9871e274868d4d9c10ed3dbbd890b/spikes/evidence/G1.md
- Cleanup: https://github.com/Optidigi/insignia/blob/a64f5939f9f9871e274868d4d9c10ed3dbbd890b/spikes/m0-001/evidence/post-cleanup.json
- CI: https://github.com/Optidigi/insignia/actions/runs/36068575630/job/107863966407
- Shopify Function testing: https://shopify.dev/docs/apps/build/functions/test-debug-functions
- Dev-store restrictions: https://shopify.dev/docs/apps/build/stores/development-stores
- Inventory states: https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states
