**Offline safety disposition: two unresolved P2 findings. This candidate does not receive clearance for credential access.** Findings are source-derived; no reproducer was executed. This is an independent Standards/security review, not principal approval.

Role: fresh read-only reviewer, session designated `gpt-6.1-sol/high`. No provider-private model attestation was inspected.

| Binding | Verified value |
|---|---|
| Repository | `Optidigi/insignia` |
| Worktree | `/home/serveradmin/insignia-m5-004-worktree` |
| Base / effective merge base | `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` |
| Base tree | `5f3f29d44da7d5f0423fd6902c19dc501f7c79ff` |
| Exact candidate / HEAD | `e4fce4b6f7ab950e94a639b63785232b9d206032` |
| Candidate tree | `3f8780b70abb33aa4ce7155eb23f6dd108c6d1af` |
| Branch | `feat/m5-004-availability-qualification` |
| Worktree status | Clean at entry and completion |

The base object retains PR #29’s approved ordered parents.

**Findings**

1. **P2 — HTTP-200 body-bound failures still change the availability adapter’s classification.**

   [operator.mjs:274](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:274) rejects a missing body, and line 284 rejects a body exceeding 128 KiB. The catch at [operator.mjs:532](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:532) converts either into `unknown_http_result`.

   The unchanged adapter consequently reports `network_or_timeout`. Direct execution instead reports `provider_shape` for these conditions at [availability-hold.ts:384](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/availability-hold.ts:384) and line 394.

   **Condition/consequence:** an oversized HTTP-200 response enters the adapter’s ambiguous-write recovery-read path instead of stopping with its actual shape failure. The register retains HTTP status but no replayable body-bound observation. Qualification therefore measures altered failure behavior. The original security finding #5 is only partially closed.

   **Smallest correction:** distinguish bounded shape failures from transport failures in the experiment wrapper, return a bounded response that preserves the unchanged adapter’s classification, and retain a sanitized replay representation. Keep mutation settlement UNKNOWN and cleanup blocked. Add actual-adapter boundary cases for missing and oversized bodies; do not patch production source.

2. **P2 — Decoding and rebuilding responses can hide catalog UTF-8 failures and changes response provenance.**

   [operator.mjs:293](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:293) decodes provider bytes using replacement-character UTF-8 conversion. Line 300 hashes that decoded text, and [operator.mjs:603](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:603) constructs a new response from it.

   The production catalog transport deliberately uses fatal UTF-8 decoding at [catalog.ts:229](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/catalog.ts:229).

   **Condition/consequence:** invalid UTF-8 inside an otherwise valid JSON string becomes valid replacement-character UTF-8 before reaching the catalog adapter. The direct adapter would reject; qualification can accept. Different invalid byte sequences can also produce the same recorded `responseDigest`, which currently hashes transformed text rather than received bytes.

   **Smallest correction:** retain bounded bytes for adapter delivery and compute provenance hashes from those bytes. Decode separately for sanitized evidence, preserving decoding-failure replay without exporting sensitive raw bodies. Add an actual-catalog transport regression for invalid UTF-8.

**Trace of prior findings and corrections**

| Prior issue | Current source disposition |
|---|---|
| Per-directory budgets/locks; missing history | Addressed: canonical live directory, initialization sentinel, private directory checks, durable counters and exclusive lock. |
| Incomplete CI and unbound review summaries | Addressed structurally: ten required workflows, exact-head receipts, binding digests, retained artifact hashes and distinct reviewer settings. Actual launch evidence remains unverified here. |
| Gate verifies another checkout | Addressed: live root is anchored to the executing module; synthetic execution has an explicit separate seam. |
| Stale register binding before credentials | Addressed: complete binding equality precedes credential loading. |
| Late continuation releases lock/overwrites counters | Addressed: pending and queued dispatches prevent close/reopen; aborted queued requests reject before fetch. |
| Malformed/5xx mutation treated as rejected | Addressed: only HTTP-200, explicit-null-product, valid user-error envelopes settle as REJECTED. Other unsupported outcomes remain UNKNOWN. |
| HTTP classification altered | Partially addressed; finding 1 remains. |
| Sanitized GraphQL/user-error replay | Required presence, message types and classifier nesting are restored; byte-level failure preservation remains incomplete under finding 2. |
| Unrelated fixture metadata drift | Addressed: acknowledged identity baseline binds handle, title, exact tags and creation timestamp. |
| Request-plan read count | Corrected to 59 normal reads; successful nominal total is 62 including final observation. |

Both complete initial reports, settings and failed observations remain preserved. Their initial green CI never constituted safety clearance.

**Other assessed safeguards**

The normal source path enforces the fixed shop/app/API target, exact documents and variables, one DRAFT creation, returned fixture ID and status-only updates. Every actual fetch reserves durably first; requests serialize; RESERVED/UNKNOWN writes survive reopening and block later mutations and finalization. Normal caps preserve the final 12 reads and 3 updates.

Creation lookup is exact-marker-filtered, bounded and single-use; it does not settle the lost create or grant ownership for mutations. Known ownership and complete unpublished membership are checked before status setup and after cycles. Finalization rechecks identity and ownership and archives only when earlier writes are accounted for.

The five-case synthetic workflow invokes the actual built availability/catalog adapters and reloads exact hold bytes through a fresh subprocess. Its fake gate is unused by the synthetic seam and establishes no live launch clearance. Restoration permission is experiment-local, finite and step-bound; it supplies no production RELEASE_BOUND authority.

No allowlisted publication, policy, key, Function, inventory, variant, price, billing, commerce or deletion mutation was found. Credential contents, auth responses and authorization headers are excluded from retained evidence. Code-review heuristics and retained formatting output were treated as judgments, not arbitrary blockers.

**Source/build and evidence verification**

The frozen manifest was refreshed during this review. Its final source is the exact candidate; all **173 paths and hashes**, including the complete expected module set, match current files.

- Binding JSON SHA-256: `51cd3be0675c0386bdd99554c220ab37f6c08af84664506d656392bc1ace1981`
- Manifest file SHA-256: `e6a0752623e746517f421f273172173d0b4ade5bbf3144bc904c5d1c33fabaf3`
- Built availability adapter: `69b863e3d90acc800ac9e24954914abc907fd3564a755f6e87aceac3a9725733`
- Built catalog adapter: `3215983ca743601cb3b7b9873f64e8812fd54de35a1dddb319fc8c257c187b07`

All 14 historical principal-package manifest entries match. Its availability, publication and production-activation snapshots equal current source bytes; duplicate authority/approval documents also match. Those diagnostics were treated as historical evidence, never runtime replacements. Production packages/application behavior are unchanged from the fixed base.

**Inventory, execution and restrictions**

Reviewed all 59 changed files through the fixed-base diff inventory and complete source/evidence reads: five operator files, root/CI wiring, authority/report/state/tooling changes, prior reports/settings, corrective and historical logs, schema/merge receipts, and the complete principal package. Also read complete production availability source/tests, catalog source/tests, deadline transport, interacting availability contracts and relevant built JavaScript.

Read AGENTS, ledger, operating model, code-review and TDD/tests/mocking instructions, M5-003/R/R2 reports, M1 unresolved register, relevant implementation-plan sections and review-packet template.

Executed only read-only file, search, Git, comparison and hashing operations. Final binding/object checks passed. Two mistaken path lookups were corrected. `git diff --check` exited **2** for retained evidence/Markdown whitespace; this is not a material safety finding.

No edits, builds, tests, networking, delegation, database, browser, provider/Shopify operations, or credential access—including credential metadata—occurred. The supplied **23-test success** log was inspected, not rerun. Corrected root results, completed review receipts and exact-source CI were not independently verified.

Live qualification remains NOT_RUN. Remaining production limitations include previously published withdrawal, nonempty publication histories, all-channel propagation, in-flight checkout drainage, atomic product-version CAS, genuine release/recovery provenance and complete M5/G6/G7 acceptance. Nine grants and shared resources were untouched by this review.