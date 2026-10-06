Two unresolved material findings at base `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e` → head `0c5af128b947586cac780bffb298e2ca8859ba56`.

- **Spec — P2: malformed GraphQL errors permit cleanup.** [operator.mjs:450](/home/serveradmin/insignia-m5-012-worktree/scripts/m5-012/operator.mjs:450) checks `!raw.errors`. An otherwise valid includedProducts response containing `errors: false`, `null`, `0`, or `""` passes and permits the ARCHIVED request. This violates the prompt’s “no GraphQL/provider ambiguity” requirement. All four cases reproduced through the actual operator with synthetic HTTP and memory-backed filesystem writes. Smallest fix: require the `errors` property to be absent; add regression coverage requiring update0.

- **Standards/security — P2: rejected foreign data enters retained evidence.** [operator.mjs:456](/home/serveradmin/insignia-m5-012-worktree/scripts/m5-012/operator.mjs:456) assigns `event.response` before ownership validation. A foreign search result containing a synthetic private-title sentinel stops with `ownership`, but catch/finally persistence retains that title. Selecting field names does not sanitize unvalidated field contents. This violates AGENTS’ restriction against personal data in logs/handoffs. Smallest fix: retain response contents only after validation; preserve rejected observations as redacted failure metadata. Add a retention regression test.

Examined: all six M5-012 files; complete inherited M5-011 operator/documents, M5-004 operator/qualification/binding, M5-010 recovery; Shopify source/build modules loaded through the imported barrel; availability contract; required authority documents, approval/merge receipts, offline evidence, package integration and ten workflows. Required diff and log commands ran.

Actually executed:

- Six syntax checks: passed.
- In-memory operator probes: reproduced both findings; event-index0 quarantine blocked another request.
- Authorization hashes and external approval copy: matched.
- Prior Shopify build: 26/26 matched; closed registers: 27/27 matched.
- Secret/provenance checker: passed.
- Binding tests: gate-record test passed; full-freeze test blocked by nested `git` subprocess `EPERM`.
- Diff whitespace check: failed on retained red-log whitespace.

Supplied focused27/27, 100 serial cases, TDD and schema logs were inspected, not rerun. Root/stress/current-head CI remain unverified.

Local review verdict: **material findings remain; offline gate incomplete**. Credentials **NOT_ACCESSED**; live **NOT_RUN**. No principal/native approval granted. Actual GPT-6.1-sol/high host identity could not be independently verified here.