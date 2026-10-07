One unresolved material Spec/correctness finding remains.

**P2 — Clock rollback restores stale cleanup authority.** [operator.mjs:72](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:72) measures freshness using `Date.now()`, while subsequent successful reads replace the identity observation. This violates “identity and ownership fresh <=30s.” My memory-only replay simulated five seven-second reads and a 15-second rollback after DIRECT. Archive dispatched **35 seconds** after ownership observation, although the wall-clock calculation reported **20 seconds**, and qualification returned `PHASE_A_SETTLED`. The identical replay without rollback stopped before archive. Measure freshness from monotonic observation origins; retain backward-clock protection and add a regression covering rollback followed by successful identity reads.

Verified exact refs:

- Base: `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate: `3f8a189f6ae73e3447f6d99db438305e1cd79b07`
- Tree: `d0306509313012220447b0757aa33881a26c6431`

Same-launch host metadata confirms actual **GPT-6.1-sol/high**, read-only sandbox and approval never.

Reviewed complete M5-016 source, changed root/delivery artifacts, governing documents and pinned skills, implementation-plan sections, interacting production v1/v2 contracts/adapters/recovery/activation/version/SQL/export/build paths, protected-loader source and reused helpers. Re-examined every prior finding and correction.

Own checks: exact diff/log inspection and `diff --check` passed; binding test **1/1**; operator suite **66/66** with filesystem writes redirected to memory; differential counterexample above. An initial memory shim failed before loading; corrected execution passed. All **3,273 binding hashes**, **96 historical compiled hashes**, **46 historical canonical hashes** and **36 log-provenance pairs** matched. Production/historical paths remain unchanged; final worktree clean; fresh canonical run absent.

Limits/uncertainties: broader root, adapter, recovery, stress, renderer and PostgreSQL results are supplied evidence. Exact-candidate CI completion was not independently verified. No edits, physical build writes, canonical initialization, credentials, network/provider/browser access, child agents or approval occurred.