Two unresolved material spec findings:

1. **P1 — Partial discovery suppresses observed ambiguity.** [discovery.mjs:75](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:75) gates every ambiguity check on enumeration completion. Counterexample: complete positive APP publications plus incomplete APP catalogs containing two catalogs claiming the target returns `GENERIC_DISCOVERY_CONFIRMED`. A5 requires `UNRESOLVED` for “identity/coverage ambiguity”; the brief explicitly states “Multiple catalogs claiming target is ambiguity.” This could incorrectly permit Phase B correction. Evaluate contradictions in retained observations regardless of completion; add a regression with a complete positive counterpart and truncated conflicting enumeration.

2. **P2 — Empty continuation pages qualify discovery.** [discovery.mjs:45](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:45) accepts zero nodes with `hasNextPage=true` and a valid cursor. An empty first page followed by the target returns complete discovery and `GENERIC_DISCOVERY_CONFIRMED`. Production v2 rejects this shape. A3 requires “production-equivalent safety bounds.” Reject empty nonterminal pages on both surfaces and test this failure path.

Verified exact refs:

- Base: `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate: `8ab88ec35366a848466a9b1a25a3d3c5eba72190`
- Tree: `aca8ef021d00e0743834da60ed83f75af8ea194c`

Host launch records confirm GPT-6.1-sol/high, read-only sandbox, approval never. Reviewed the requested complete M5-016 source, changed root/delivery files, governing documents, pinned skills, interacting production contracts/adapters/recovery/activation/version/SQL/build paths, protected-loader source and reused operator/guard helpers.

Own checks: exact diff/log inspection and `git diff --check` passed; final worktree clean; all **3,233 source/build hashes** and **46 historical canonical hashes** matched. Production packages/SQL and historical M5-015R source/report/evidence remain unchanged from base. The fresh canonical run directory is absent. Memory-only binding test passed **1/1**; both counterexamples above were reproduced without network access.

Limits: focused/adapter/recovery/root/stress/renderer results are supplied logs, not my executions. PostgreSQL18 and exact-source CI completion were not independently verified. No build, loopback, credentials, provider access, edits or approval performed.