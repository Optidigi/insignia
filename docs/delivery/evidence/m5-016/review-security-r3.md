Two unresolved material Standards/security findings remain.

1. **P1 — HTTP errors bypass the identity fence.** [operator.mjs:183](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:183) rejects HTTP status before examining parsed identity. Memory-only counterexample: DIRECT returns HTTP403 with partial data containing the wrong `shop.id`; subsequent discovery succeeds, `identityFailed` stays false, and archive dispatch occurs once. This violates the brief’s exact-identity cleanup requirement. Inspect and permanently latch reported identity/grant contradictions before status rejection; preserve denial-only behavior and add a regression requiring zero archive dispatch.

2. **P1 — Malformed partial-error discovery can qualify generic intent.** [discovery.mjs:60](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:60) retains partial error data without validating its shape; classification subsequently ignores nonarray nodes and excludes `provider_error` from structural ambiguity. Memory-only counterexample: complete positive APP publications plus APP catalogs returning errors and `nodes={bad:"shape"}` produces `GENERIC_DISCOVERY_CONFIRMED`, with `ambiguity=false`. This violates A5’s coverage-ambiguity rule and [schema-notes.md:9](/home/serveradmin/insignia-m5-016-worktree/docs/delivery/evidence/m5-016/schema-notes.md:9), which requires malformed pages to fail qualification. Validate reported partial shapes and latch structural ambiguity; add regressions for both surfaces while preserving pure denial behavior.

Verified exact refs:

- Base: `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate: `f5ce8cd1fc16ebf3ce505ea635d88cc1e844a2e5`
- Tree: `7caf5e3dd5dbd57b05a82ffb9f41cf17e0778929`

Same-launch host records confirm actual GPT-6.1-sol/high, read-only sandbox and approval never. Reviewed complete M5-016 source, requested governing documents/pinned skills, changed root/delivery artifacts, interacting production contracts/adapters/recovery/activation/SQL/export/build paths, protected-loader source and reused helpers.

Own checks: exact diff/log and `diff --check`; binding test **1/1**; operator suite **36/36** with filesystem writes redirected to memory; targeted memory probes. All **3,250 binding hashes**, **96 compiled baseline hashes**, **46 historical canonical hashes**, and **23 log-provenance pairs** matched. Production/historical paths remain unchanged; final worktree clean; fresh canonical run absent. Prior corrected counterexamples fail closed.

Limits: broader suite results are supplied evidence. Exact-source CI/PostgreSQL completion was not independently verified; the available receipt remained incomplete. No edits, physical build writes, canonical initialization, credentials, network/provider/browser access, child agents or approval occurred.