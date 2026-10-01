**Offline safety disposition: two unresolved P2 findings. This exact candidate does not receive Spec/correctness clearance for credential access. No principal approval is implied.**

Role: fresh independent, read-only M5-004 Spec/correctness reviewer, designated `gpt-6.1-sol/high`. No provider-private runtime attestation was inspected.

| Binding | Verified value |
|---|---|
| Repository/worktree | `Optidigi/insignia`; `/home/serveradmin/insignia-m5-004-worktree` |
| Base/effective merge base | `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` |
| Base tree | `5f3f29d44da7d5f0423fd6902c19dc501f7c79ff` |
| Candidate/HEAD | `5420a886ca6a9a143f8ade0f204d804e4baed685` |
| Candidate tree | `b3a124df8d28397b37df1cbb75bdc41bfb98a66c` |
| Branch | `feat/m5-004-availability-qualification` |
| Worktree | Clean at final inspection |

The base retains PR #29’s exact approved ordered parents.

**Findings**

1. **P2 — Restarting qualification overwrites earlier normalized evidence.**

   [qualification.mjs:135](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:135) creates fresh empty evidence arrays on every invocation. [qualification.mjs:146](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:146) writes them to the same `qualification.json`, without loading or preserving its previous contents. The first successful credential load triggers that overwrite at line 208, before the existing-create guard at line 239.

   **Condition:** reopen the intact canonical register after an interrupted or completed qualification. The subsequent invocation retains counters, authenticates, then stops at `creation_already_attempted`.

   **Consequence:** the prior case matrix, returned acquisition/observation/restoration results, catalog results and original failure evidence disappear from `qualification.json`. Raw register events and hold files survive, but they do not preserve every actual normalized outcome or its observation timestamps. This violates the whole-slice evidence-preservation requirement across restarts.

   **Smallest correction:** preserve existing qualification evidence before any new persistence. Either refuse ordinary re-entry before credential access without changing the existing report, or append a separate source/run-bound continuation record for permitted finalization. Add a synthetic restart regression proving earlier normalized evidence survives and successful cases are not repeated.

2. **P2 — Successful non-200 catalog responses still receive altered transport semantics.**

   [operator.mjs:574](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:574) discards every non-200 GraphQL body and returns a bodyless response. The unchanged catalog transport instead accepts `response.ok` at [catalog.ts:202](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/catalog.ts:202), then reads and validates its body.

   **Condition:** a catalog detail/list request returns HTTP 201 or another body-bearing successful non-200 response.

   **Consequence:** direct catalog execution parses that response; wrapped execution reports `Catalog response body missing`. The register records `NOT_READ_STATUS_CLASSIFIED`, losing the received body and its provenance. Qualification therefore measures a wrapper-induced failure rather than the actual adapter’s behavior.

   **Smallest correction:** use the catalog transport’s success predicate for catalog operations before deciding to discard a body. Preserve bounded original bytes and replay evidence for successful catalog responses. Keep availability’s existing non-200 classification. Add a direct/wrapped/replayed catalog 201 control.

Both findings are source-derived; no reproducer was executed.

**Prior findings and corrections**

| Prior finding | Current source disposition |
|---|---|
| Per-directory budgets/locks and lost history | Canonical live directory, initialization sentinel, private directory checks and durable counter validation are present. |
| Incomplete CI/unbound reviews | Ten named workflows, exact-head receipts, binding digests and hashed independent review/settings artifacts are required. |
| Foreign checkout/stale register binding | Live entry is module-root anchored; complete register-binding equality precedes credential loading. |
| Late continuation releasing lock | Pending and queued dispatches prevent lock release; aborted queued requests refuse dispatch. |
| Malformed rejection or success settles a write | Explicit supported rejection validation and actual empty-array success ACK are present. Other outcomes remain UNKNOWN. |
| Missing/oversized body semantics | Original bounded delivery now preserves availability shape failures; catalog uses its 1,000,000-byte bound. |
| Transformed bytes/raw hashes/malformed UTF-8 | Original bounded bytes reach adapters; hashes cover received bytes. Catalog fatal decoding and availability’s lossy decoding remain distinct. |
| Sanitized error replay | Relevant field presence, types, nesting and classifier codes are preserved for inspected cases. |
| Fixture metadata drift | Acknowledged handle/title/exact tags/creation timestamp are bound and checked. |
| Failed drift/catalog evidence | Results are persisted before assertions; affected cases become STOPPED. |
| Known-drift restoration permission | The consumed SETUP step grants zero restoration writes. |
| Request enumeration | Corrected to 59 normal reads and 62 nominal total reads, including final observation. |

The original and second review reports, failed observations and corrective logs remain preserved. Their historical green CI does not clear this head.

**Other source-traced safeguards**

The workflow invokes the actual built availability/catalog adapters. DRAFT follows the no-status-write path. ACTIVE, UNLISTED and ARCHIVED retain exact held-state, version, visibility and restoration-readback checks. Hold files are reloaded byte-for-byte through a fresh subprocess before parent-process observation/restoration.

Every actual fetch reserves durably before dispatch. Requests serialize; normal caps preserve 12 reads and three updates for finalization. RESERVED/UNKNOWN writes survive reopening and prohibit later status writes and cleanup. Unknown creation allows one bounded exact-marker lookup, without granting settlement or mutation ownership.

The fixed endpoint, API version, exact documents, variables and returned fixture ID restrict mutations to one DRAFT creation and fixture status updates. No publication, policy, key, Function, inventory, price, billing, commerce or deletion mutation is allowlisted. Finalization checks settled writes, identity, ownership and unpublished membership.

Restoration permission remains finite, step-bound and experiment-local. The separate synthetic seam requires synthetic credentials and transport; its fake gate establishes no launch clearance.

**Source/build verification**

At final reinspection, [frozen-binding.json](/home/serveradmin/insignia-m5-004-handoff/frozen-binding.json) names this exact candidate. Its complete expected **173-path set and every hash match**.

- Manifest SHA-256: `f090e12b32f7397086bfa32227d5f9c3e59dfb91bb4f80068cf840da47548530`
- Built availability: `69b863e3d90acc800ac9e24954914abc907fd3564a755f6e87aceac3a9725733`
- Built catalog: `3215983ca743601cb3b7b9873f64e8812fd54de35a1dddb319fc8c257c187b07`

Production `packages/` and `apps/` are unchanged from the fixed base. All 14 principal-package manifest entries match. Historical availability/publication/production-activation snapshots equal current source bytes; they were treated as historical evidence, never runtime replacements.

**Read, executed and restrictions**

Reviewed the 72-file fixed-base comparison and complete current five-file operator implementation/tests; changed configuration, delivery documents and evidence; both full initial and second safety reports/settings; corrective logs including the 30-test result; and the supplied principal diagnostic package. Read complete production availability source/tests, catalog source/tests, deadline transport, availability contracts and relevant built JavaScript.

Also read AGENTS, ledger, operating model, state, full M5-004 authority/report, code-review and TDD/tests/mocking guidance, M5-003/R/R2 reports, unresolved-acceptance register, relevant plan sections, tooling register and review-packet template.

Executed only read-only shell/file/Git/hash inspection. Ref, tree, parent, merge-base, package equality and manifest checks passed. `git diff --check` exited **2** for retained evidence/Markdown whitespace; this is not a material safety finding. Supplied test results were inspected, **not independently rerun**. Current root-suite and exact-head CI clearance were not independently verified.

No edits, builds, tests, delegation, networking, credential access—including metadata—provider/Shopify/browser operations or database access occurred. Nine grants and shared resources were untouched by this reviewer.

Live qualification remains **NOT_RUN**. Remaining production limitations include previously published availability withdrawal, nonempty publication histories, all-channel propagation, in-flight checkout drainage, atomic product-version CAS, genuine RELEASE_BOUND/recovery provenance, ProductConfig activation and complete M5/G6/G7 acceptance.