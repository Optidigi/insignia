**Offline safety disposition: six unresolved material findings. Credential access and authenticated execution should remain gated.** This is an independent Standards/security review, not principal approval.

Role: fresh read-only M5-004 reviewer, session designated `gpt-6.1-sol/high`. No provider-private runtime attestation was inspected.

| Binding | Exact value |
|---|---|
| Repository | `Optidigi/insignia` |
| Base / effective merge base | `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` |
| Base tree | `5f3f29d44da7d5f0423fd6902c19dc501f7c79ff` |
| Candidate / HEAD | `09de2ef844113570d5d67dd7b959401445e79687` |
| Candidate tree | `6439b8c2c921174c54a1729602a747798196d379` |
| Branch | `feat/m5-004-availability-qualification` |

The worktree was clean. The base Git object has the exact approved ordered parents recorded for PR #29.

**Findings — source-derived; no reproducer was executed**

1. **P1 — Accounting and serialization are per directory, not whole slice.**  
   [operator.mjs:113](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:113) initializes fresh counters and a new fixture marker in any supplied directory; [operator.mjs:261](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:261) locks only that directory. The CLI accepts an arbitrary directory. Initializing directories A and B permits independent create attempts, budgets and concurrent operators against the same store. The existing test checks duplicate initialization/locking only within one directory.

   **Consequence:** §2’s whole-slice ceilings and §3’s single-fixture authority are not enforced across worktrees or alternate run directories.  
   **Smallest correction:** bind the launch to one canonical, persistent slice register/lock outside individual worktrees; reject alternate locations and recreation after history loss. Keep the simple register pattern.

2. **P1 — The pre-credential gate accepts incomplete CI and unbound review summaries.**  
   [binding.mjs:42](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/binding.mjs:42) requires merely a nonempty CI array whose supplied entries succeeded. One successful workflow passes while other applicable workflows are absent, pending or failed. Individual review entries contain no reviewed base/head, binding digest or evidence reference. Old review summaries can therefore accompany a newly supplied top-level source value.

   **Consequence:** credential loading can begin without the complete exact-source CI and fresh source-bound reviews required by §1.  
   **Smallest correction:** require the complete applicable workflow set with identified runs and exact head bindings; require each review and offline result to reference its exact reviewed binding and retained evidence. Reject omissions.

3. **P1 — The verified binding is not connected to both executing modules and the durable register.**  
   [qualification.mjs:81](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:81) verifies caller-supplied `root`, but imports adapters and launches the reload helper from the actual module location. The complete-workflow fixture deliberately verifies an unrelated synthetic repository with empty source/dist directories ([operator.test.mjs:302](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.test.mjs:302)). Separately, register validation checks only that its events match its own stored source; `qualify()` never compares that stored binding with the binding that passed `verifyGate()`.

   **Consequence:** the gate can certify different bytes from those executed, and a stale register can label new attempts with an older source.  
   **Smallest correction:** bind verification to the executing checkout and imported module paths; compare the complete register binding with the verified binding before credential metadata/content access. Preserve counters and stop on mismatch. Update the workflow test to exercise those connections.

4. **P1 — Closing can release the lock while an older dispatch can still overwrite history.**  
   [operator.mjs:438](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:438) relies on abort signals while awaiting fetch/body completion. The production adapter has an independent hard deadline and can return while an abort-ignoring request remains pending. [operator.mjs:548](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:548) then unlinks the lock without checking outstanding dispatches. The older continuation still calls `save()` after completion.

   **Consequence:** a reopened operator can append reservations, then the older in-memory state can overwrite them, losing counters/events and defeating durable accounting. Existing lost-response coverage throws immediately and does not cover late completion after close/reopen.  
   **Smallest correction:** retain exclusive ownership while any continuation can persist; refuse lock release with outstanding dispatches, and prevent terminal/closed continuations from replacing newer history. Cover this synthetically without introducing live fault experiments.

5. **P2 — The HTTP wrapper changes the production adapter’s failure behavior.**  
   [operator.mjs:436](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:436) requires a JSON body before recording HTTP status and returning a response. An empty/non-JSON 403 or 429 becomes `unknown_http_result`; the production adapter converts that exception to `network_or_timeout`. In contrast, [availability-hold.ts:239](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/availability-hold.ts:239) classifies those statuses directly, without parsing non-200 bodies. Malformed 200 JSON is likewise changed from `provider_shape` to transport ambiguity.

   **Consequence:** qualification measures altered failure semantics, may enter an additional recovery-read path, and loses the actual HTTP failure observation.  
   **Smallest correction:** preserve bounded response status/body semantics for the unchanged adapter, recording observed status independently of parsing. Keep write settlement conservative without replacing adapter classifications.

6. **P2 — Sanitized response evidence cannot faithfully reproduce normalized failures.**  
   [operator.mjs:456](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:456) adds `errors: null` when errors were absent, flattens `extensions.code`, and removes `message` from GraphQL/user errors. The production parser distinguishes absent errors from `null` and requires string messages. Replaying the stored envelope can therefore produce `provider_shape` instead of the observed success, forbidden, throttled or user-error result.

   **Consequence:** the sanitized replay required by §5 cannot reliably preserve the raw-versus-normalized discrepancy. A response digest alone cannot reconstruct omitted structure.  
   **Smallest correction:** preserve field presence, nesting and relevant types; redact sensitive strings with type-preserving placeholders. Verify replay against the actual adapter.

**Other assessed safeguards**

The exact request documents, API version, fixture-ID checks, status-only payloads, redirect denial and reserve-before-fetch ordering are present. The normal serialized path preserves finalization reserves, retains unknown/abandoned write intents, prohibits blind write retries, and treats unknown creation lookup as a candidate rather than settled ownership. Ownership and complete unpublished-membership checks precede status cycles. Restoration permission remains experiment-local; no production coordinator or invented RELEASE_BOUND evidence is used. No allowlisted publication, policy, Function, inventory, billing or deletion mutation was found.

These observations do not close the findings above. Code-review smells and tool-enforced formatting were treated as judgments, not arbitrary blockers.

**Source and evidence inventory**

Read the full AGENTS, ledger, state, operating model, M5-004 authority/report, code-review skill, and TDD skill/tests/mocking references; also the three M5-003 reports, M1 unresolved register, tooling register and relevant plan sections.

Examined all 37 changed files: all five operator files, root/CI wiring, delivery documents, seven logs, schema/merge evidence, and the entire supplied principal package. Read complete production `availability-hold.ts` and its 1,185-line test file; complete catalog source/tests and deadline transport; and their available built JavaScript counterparts. Historical availability/publication/activation snapshots were inspected as evidence and verified against matching current Git blobs, never treated as runtime replacements.

**Executed and restrictions**

Only local read-only shell/file/Git/hash operations ran: ref/tree/parent/status inspection, diff inspection, searches, reads, comparisons and checksums. All 14 principal manifest entries passed; duplicated authority/approval documents matched. `git diff --check` exited 2 for retained log whitespace, which is not a material finding. Initial path lookup errors were corrected.

No tests, builds, database access, delegation, networking, browser/provider/Shopify operation, edits, or credential access—including credential metadata—occurred. The reported 13 passing operator tests were inspected as claims and source coverage, not independently rerun. Current candidate CI, completed independent review evidence, live observations, budgets and final fixture state remain unverified here.

Production limitations remain: previously published withdrawal, nonempty publication-history preservation, all-channel propagation, in-flight checkout drainage, atomic status CAS, genuine RELEASE_BOUND/recovery provenance, and complete M5/G6/G7 acceptance. The nine grants and shared resources were untouched by this review.