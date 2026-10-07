Three unresolved material Spec/correctness findings remain:

1. **P1 — HTTP errors bypass the identity fence.** [operator.mjs:183](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:183) rejects non-200 responses before inspecting returned identity. Memory-only DIRECT/HTTP500 and catalogs/HTTP403 replays containing wrong `shop.id` each dispatched archive and finished `PHASE_A_SETTLED`. This violates “Require exact app/client/shop/domain/installation/development identity.” Preserve and permanently latch reported identity/grant contradictions before HTTP-status rejection; add regressions requiring zero archival dispatch.

2. **P2 — Response completion renews ownership freshness.** [operator.mjs:244](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:244) sets `ownedAt` after response processing. Five simulated seven-second reads allowed archival with prestate origin age **35 seconds**, while stored ownership age was **28 seconds**. This violates the supplied cleanup requirement “identity and ownership fresh <=30s.” Capture a conservative observation origin before provider I/O and enforce freshness from that origin.

3. **P2 — HTTP denial incorrectly negates positive discovery.** [discovery.mjs:82](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:82) treats `provider_status` as structural ambiguity. Complete positive APP publications plus an ordinary catalogs/HTTP403 `ACCESS_DENIED`, without contradictory data, returned `UNRESOLVED`. The brief says denial “cannot negate an independently complete positive surface.” Distinguish qualified denial from structural failure while retaining contradiction checks; add this regression.

Verified exact refs:

- Base `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate `f5ce8cd1fc16ebf3ce505ea635d88cc1e844a2e5`
- Tree `7caf5e3dd5dbd57b05a82ffb9f41cf17e0778929`

Same-launch metadata confirms GPT-6.1-sol/high, read-only, approval never. Reviewed complete M5-016 source, changed root/delivery artifacts, governing documents/pinned skills, interacting production contracts/adapters/recovery/activation/version/SQL/export/build paths, protected-loader source and reused helpers.

Own checks: exact diff/log and `diff --check`; binding test **1/1**; filesystem-memory operator replay **36/36**; independent counterexamples above. Two initial replay-harness loading failures preceded the corrected execution. All **3,250 binding hashes**, **96 compiled baseline hashes**, **46 historical canonical hashes**, and **23 log-provenance pairs** matched. Production/historical paths remain unchanged; final worktree clean; canonical run absent.

Limits/uncertainties: broader suites, PostgreSQL18 and CI are supplied evidence, not independently executed/verified. No edits, build writes, canonical initialization, credentials, loopback/network/provider/browser access, child agents or approval occurred.