**CHANGES_REQUESTED — Standards/security.** Personally reviewed, without delegation.

Verified base/effective merge base `b2a874089482ec6f98938385da65453bd3b85d11`, HEAD `66e9227b9ee3f192462674db041c4fb4f44f0567`, tree `fc012f8ae103762704bb97e5d06ead83a3a3e094`, and the nonempty 18-file diff.

1. **P1 — Concurrent replacement can be erased before its authenticated deadline.**  
   [cleanup.mjs:49](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/cleanup.mjs:49) authenticates the mapping, checks `eraseBy`, and inspects the tree before acquiring the deletion guard. Its subsequent call at line 73 invokes [operator.mjs:129](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/operator.mjs:129), which reloads the current directory without comparing its identity/binding/deadline to the inspected experiment.

   An accepted concurrent operator can finish erasing experiment A and create B at the same name during that gap. The worker then deletes B while B’s actual `eraseBy` remains in the future. I reproduced this using the actual cleanup/operator/store source with an in-memory filesystem schedule; it returned `LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED`.

   **Smallest correction:** bind deletion to the inspected experiment identity and authenticated mapping, and recheck actual time and tree under the same lifecycle guard that protects removal. Add a concurrent erase/recreate regression that preserves B.

2. **P2 — The purported exact tree accepts unknown filenames.**  
   [cleanup.mjs:29](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/cleanup.mjs:29) permits both `.json` and `.bin` in every receipt directory. Consequently, `spool/000001.json`, `commits/000001.bin`, and `reservations/000001.bin` pass inspection, although the accepted writer produces none of these paths. Subsequent recursive deletion removes them, contradicting the documented unknown-entry refusal.

   I executed the actual tree-checking function against memory-only filesystem metadata and confirmed all three pass.

   **Smallest correction:** require `.bin` exclusively in `spool` and `.json` exclusively in `reservations`/`commits`; verify that mismatched suffixes produce `BLOCKED` and remain preserved.

3. **P2 — Metadata cleanup discards unconfirmed termination.**  
   [supervisor.mjs:208](/home/serveradmin/insignia-m5-callback-lifecycle-control-worktree/scripts/m5-callback-qualification/supervisor.mjs:208) awaits `owned.stop()` but ignores its result and always returns `REFUSED`. Startup subsequently collapses every non-mapping result to `REFUSED`; erasure collapses it to `BLOCKED`. A metadata child whose exit/group absence cannot be confirmed therefore loses the explicit `STOP_UNCONFIRMED` outcome promised by the lifecycle contract.

   An execution of the actual supervisor source with simulated process/clock boundaries confirmed `REFUSED` despite no observed child exit or group absence.

   **Smallest correction:** propagate `STOP_UNCONFIRMED` through startup and map that uncertainty to `UNCERTAIN` for erasure. Preserve the distinction in standalone reporting.

Personally completed: full changed-file and interacting-source inspection; six memory-stream READY protocol checks; the three memory-only reproductions above; executable SHA verification; all **17 public owned-content pins and 29 interacting-input pins**; changed JSON parsing; archive byte equality; unchanged acceptance/native rows; and `git diff --check`. Production paths have no diff, and the worktree remained clean. Two reviewer-harness setup errors—an unsupported Node option and a missing VM global—were corrected; neither was a product-test result.

Inspected, **not rerun**: the 24+9+6 registered controls, public RED/GREEN provenance, writer/parent PASS records, and historical PR69/70 receipts. No private evidence, real captures, credentials, environment values, network, SSH, browser, provider operations, builds, filesystem fixtures, or CI queries were accessed/run. The edge note’s scope and tagged references were inspected; external contents were not fetched. Actual model/high-effort and completed-process attestation remain for the parent to verify.

The documented native, cgroup, persistent-timer, TLS/logging, external-copy, genuine-uninstall and privacy unknowns remain unresolved. **M5/G7 remains NOT_PASSED; this review grants no native host/provider mutation or principal acceptance.**