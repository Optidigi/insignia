One unresolved material Standards/security finding remains.

**P2 — Early local dispatch rejection is recorded as an unknown provider write.** [guard.mjs:44](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/guard.mjs:44) calls `current()` before assigning the reserved event index. If that gate throws, [guard.mjs:71](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/guard.mjs:71) skips `rejectDispatch`.

My memory-only replay injected the actual `Stop('source_binding')` at this boundary after archival reservation. Results: archive/final native calls **0/0**, cleanup `UNKNOWN_ARCHIVE_WRITE`, unknown mutations **1**, and accounting **reserved6/dispatched5/denied0/matches=false**. This violates the supplied Round-5 rule: known local denial must be durably `NOT_DISPATCHED`, increment denied accounting, and satisfy reserved=dispatched+denied. Capture the reserved index before throwing admission checks and settle every known pre-dispatch rejection through `rejectDispatch`; add this gate-rejection regression. Provider access correctly stopped.

Verified exact refs:

- Base: `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate: `3f8a189f6ae73e3447f6d99db438305e1cd79b07`
- Tree: `d0306509313012220447b0757aa33881a26c6431`

Same-launch host metadata confirms actual **GPT-6.1-sol/high**, read-only sandbox, approval never. Reviewed complete M5-016 source, exact diff/log, changed root/delivery artifacts, governing documents/pinned skills, interacting production v1/v2 contracts/adapters, recovery/activation/version/SQL fences, exports/build, protected-loader source and reused helpers.

Own checks: `diff --check`; binding test **1/1**; operator suite **66/66** with filesystem writes redirected to memory; independent rejection probes. The initial memory harness failed during module loading; corrected execution passed. All **3,273 binding hashes**, **96 compiled baseline files**, **46 historical canonical hashes**, and **36 provenance pairs** matched. Production/historical paths remain unchanged; final worktree clean; canonical run absent. Previous reported counterexamples now fail closed.

Limits/uncertainties: broader suites/PostgreSQL are supplied evidence. Exact-candidate CI completion was not independently verified. No edits, physical writes, canonical initialization, credentials, network/provider/browser access, child agents or approval occurred.