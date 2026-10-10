**CHANGES_REQUESTED — Spec/correctness. Two blocking findings.**

Reviewed personally without delegation. Verified base/effective merge base `b2a874089482ec6f98938385da65453bd3b85d11`, HEAD `66e9227b9ee3f192462674db041c4fb4f44f0567`, tree `fc012f8ae103762704bb97e5d06ead83a3a3e094`, and the nonempty 18-file diff. Read the complete changed files, interacting receiver/storage/operator/service/guard code, and relevant unchanged HMAC/bootstrap/quarantine/generation/queue/retention source.

1. **P1 — Deadline authorization can survive replacement of the experiment.** [cleanup.mjs:49](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/cleanup.mjs:49) checks the authenticated mapping’s `eraseBy` before acquiring the lifecycle guard used by deletion at [cleanup.mjs:73](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/cleanup.mjs:73). Between those operations, another legitimate operator can erase the expired experiment and recreate the same name with a new capability and future deadline. `eraseExperiment` authenticates the replacement but neither compares its identity with the checked experiment nor checks its deadline. The old worker consequently deletes the replacement early and reports `LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED`.

   I reproduced this using actual cleanup/operator/store source with an entirely in-memory filesystem and substituted inspection linkage. The replacement’s future deadline had not elapsed when deletion succeeded.

   **Smallest correction:** carry the authenticated experiment identity into a guarded erasure operation; authenticate and compare the target, check actual time and validate its tree while holding the same lifecycle guard through recovery/removal. Refuse replacement. Add a deterministic erase/recreate regression control. Rechecking before guard acquisition leaves the race open.

2. **P2 — Failed inspection hides unconfirmed child cleanup.** [supervisor.mjs:208](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/supervisor.mjs:208) awaits `owned.stop()` but discards its result and always returns `REFUSED`. If the separate cleanup budget expires with `STOP_UNCONFIRMED`, `startSupervisor` returns ordinary refusal and `eraseAtDeadline` reports `BLOCKED`, losing the fact that the owned group may remain alive. This contradicts the documented exit-confirmation/uncertainty contract.

   An in-memory probe of the actual `boundedInspection` function confirmed that a substituted `STOP_UNCONFIRMED` result becomes `REFUSED`; I did not induce an unkillable real process.

   **Smallest correction:** preserve `STOP_UNCONFIRMED` through inspection/startup and map it to `UNCERTAIN` in erasure. Add a control verifying that unsuccessful cleanup confirmation cannot become ordinary refusal/blockage.

Personally executed: ref/diff checks, syntax checks, ten memory-only READY protocol cases, both source probes, 46 public-manifest pin checks, all 18 root-freeze file checks, historical snapshot/log hash checks, exact Node executable verification, byte-exact state archival and unchanged acceptance/resource/native-fact comparisons. The worktree remained clean; no files, fixtures or caches were written.

Inspected—not rerun—the writer and parent logs showing 39 passes and zero skips, preserved RED→GREEN and harness-failure evidence, CI registration and historical merge receipts. No network, SSH, browser, provider, authentication, credential/environment-value or private actual-response access occurred. Tagged edge-research links were inspected locally without fetching them; native unknowns remain unknown.

M5/G7 remain **NOT_PASSED**. This review grants neither principal acceptance nor native host/provider mutation authority.