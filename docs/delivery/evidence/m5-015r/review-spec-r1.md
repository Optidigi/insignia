**Two unresolved material findings. Keep the pre-credential gate closed.**

Verified repository `Optidigi/insignia`, PR46:

- Base: `6a186bea8e5d1c01a66f7ab683c06393fe81e991`
- Head: `aa894d6451a8bc404af859b59ad23596ae9bd760`
- Tree: `7506827599cf35e2692c0b0286e6cb0ecdb17b8b` — this is a tree object.

Worktree clean; requested diff/log verified. PR45’s ordered parents/tree match. Launch-settings evidence records GPT-6.1-sol/high, read-only/never.

Read all M5-015R scripts/tests, changed root/delivery files, requested authority/skills/plan sections, complete interacting v1/v2 adapters/contracts, recovery/activation/version/SQL fences, exports/build configuration, credential-loader source and historical reports/incident.

1. **P1 — PARTIAL survives unresolved cleanup.** [qualification.mjs:413](/home/serveradmin/insignia-m5-015r-worktree/scripts/m5-015r/qualification.mjs:413) preserves PARTIAL whenever cleanup reports final archive, without checking unresolved mutation settlement or `cleanupStop`. Memory-only reproduction: zero-effective ACTIVE, archive applied, ACK lost; result remains PARTIAL while the archive event remains UNKNOWN. The [principal Result rule:229](/home/serveradmin/insignia-m5-015r-worktree/docs/delivery/prompts/M5-015R-LIVE-V2-QUALIFICATION.md:229) requires STOPPED for settlement/cleanup ambiguity. Fix: retain STOPPED unless the permitted classification explicitly settles cleanup and accounting matches; add this regression.

2. **P2 — ambiguous cleanup exceeds its read allowance.** [qualification.mjs:217](/home/serveradmin/insignia-m5-015r-worktree/scripts/m5-015r/qualification.mjs:217) calls `final()`, which performs ownership **and** production snapshot reads. The same reproduction emitted both after the lost ACK. The [principal Cleanup rule:221](/home/serveradmin/insignia-m5-015r-worktree/docs/delivery/prompts/M5-015R-LIVE-V2-QUALIFICATION.md:221) permits “one bounded classification read only.” Fix: limit ambiguity handling to one permitted classification read, or stop.

Own checks: binding test and all-script syntax passed; actual production-factory omitted/typo checks denied locally with nativeCalls=0; imports=0; memory-only failure traces executed. All 3,156 binding hashes, raw/copy provenance and 39 historical canonical hashes match. Production/SQL and historical M5-015 source/evidence are unchanged; both run directories remain absent.

Uncertainties/limits: grant-set drift is accepted; the brief specifies minimum grants, so whole-set equality needs clarification. Supplied logs support 34/170/20 tests, root/stress/control and PostgreSQL18 CI; these are not my executions. Cached CI shows nine successes/one running, unrefreshed. Gate absent; live **NOT_RUN**. No edits, credentials, network, children or principal/native approval.