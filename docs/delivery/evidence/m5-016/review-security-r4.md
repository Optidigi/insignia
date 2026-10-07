Two unresolved material Standards/security findings remain.

1. **P1 — Malformed error data bypasses discovery admission.** [discovery.mjs:73](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:73) validates partial connections only when truthy; `provider_error` is otherwise excluded from ambiguity. My memory-only operator replays returned `GENERIC_DISCOVERY_CONFIRMED` when either surface reported `false`, `0`, or `""` alongside errors, with the counterpart complete/positive. Malformed `errors:[]`/`errors:{}` also escaped envelope validation at [operator.mjs:211](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:211). This violates A5 and [schema-notes.md:9](/home/serveradmin/insignia-m5-016-worktree/docs/delivery/evidence/m5-016/schema-notes.md:9): malformed evidence must fail qualification. Validate connection presence independently of truthiness and validate error envelopes; add both-surface regressions requiring `UNRESOLVED`.

2. **P2 — Ownership freshness expires before archive dispatch.** Cleanup admission checks freshness before reservation, fsync and repeated gate verification; [guard.mjs:64](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/guard.mjs:64) dispatches without rechecking. My memory-only replay admitted ownership aged **29.5 seconds**, added one second during preparation, then dispatched archive at **30.5 seconds** and finished `PHASE_A_SETTLED`. This violates the supplied **≤30-second** cleanup fence. Revalidate freshness and backward-clock protection immediately before private transport dispatch, after preparation, while preserving accounting for a reserved but unsent request.

Verified exact refs:

- Base: `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate: `a736cf018e4442980f7f899ea376c1d35db543c5`
- Tree: `8b8decff4eb9339b55d7fe268c79210350f1d355`

Same-launch metadata confirms actual **GPT-6.1-sol/high**, read-only sandbox, approval never. Reviewed complete M5-016 source, governing documents/pinned skills, changed root/delivery artifacts, interacting production contracts/adapters/recovery/activation/version/SQL/export/build paths, protected-loader source and reused helpers.

Own checks: exact diff/log and `diff --check`; binding test **1/1**; operator tests **45/45** with filesystem writes redirected to memory; independent counterexamples above. Initial memory-harness loading failed, then corrected execution passed. All **3,262 binding hashes**, **96 compiled baseline hashes**, **46 historical canonical hashes** and **30 log-provenance pairs** matched. Production/historical paths remain unchanged; final worktree clean; canonical run absent.

Limits: broader suites are supplied evidence. Exact-source CI/PostgreSQL completion remains unverified. No edits, physical writes, canonical initialization, credentials, network/provider/browser access, child agents or approval occurred.