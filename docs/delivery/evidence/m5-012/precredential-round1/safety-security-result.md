One unresolved material finding at base `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e`, head `0c5af128b947586cac780bffb298e2ca8859ba56`.

**Standards/security — P2: rejected foreign-product content enters durable evidence.** At [operator.mjs:456](/home/serveradmin/insignia-m5-012-worktree/scripts/m5-012/operator.mjs:456), `event.response` receives the selected response before ownership validation. If `includedProducts` or a root search returns product123 with customer text in its title/tags, validation throws `ownership`, but the catch/finally saves that content into `register.json`. Cleanup correctly remains blocked; retention still violates AGENTS.md’s requirement to keep personal data out of logs/handoffs.

**Counterexample executed:** actual operator source, entirely synthetic HTTP and an in-memory filesystem. A foreign result caused `ownership`, zero updates, and retained both injected private title and tag strings. No files or external resources were created.

**Smallest fix:** assign rich `event.response` only after successful validation. Preserve sanitized failure metadata separately. Extend the foreign-result regression to assert that rejected descriptive fields are absent from serialized evidence.

**Spec axis:** the same defect violates the fixed-target evidence boundary; no additional material finding identified. Copied transport/binding techniques were assessed for safety, without an optional refactoring finding.

Examined: the requested diff/log; all six M5-012 files; full interacting repository helpers and Shopify source/build modules; authority, architecture, prompt, research/report, skills, external approval and merge receipts.

Actually executed:

- Six syntax checks: exit0.
- Binding metadata test: 1/1, exit0.
- Pure classification/product checks: 22 cases, exit0.
- Retention reproduction: confirmed.
- Integrity verification: approval manifest/original, merge parents/tree, 27 closed-register hashes and 26 prior-bound Shopify build hashes match; production source unchanged.
- Full binding suite: exit1 from sandbox `spawnSync git EPERM`.
- `git diff --check`: exit2 for preserved-log whitespace.

Supplied evidence only: focused27/27, including100 serial scenarios and denied-target cases; schema and TDD logs. Root/stress/current-head CI remain pending.

Credentials **NOT_ACCESSED**; live **NOT_RUN**. Worktree remains clean. This review does not clear the precredential gate or grant approval. Project configuration requests GPT-6.1-sol/high, but actual runtime model/effort attestation is unavailable here.