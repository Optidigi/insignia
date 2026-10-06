Standards/security review found **one P2 persistence finding**.

Base: `55060c5a48617a27858d10fb0db639c7e9efe148`
Candidate: `3e294aa4dad334365ca3d2171f22de6a1bdf830c`

**P2 — Activation evidence does not fence nested ACK version or tenant identity.** The [v2 evidence constraint](/home/serveradmin/insignia-m5-014-worktree/packages/database/migrations/20261006000100_m5_availability_v2.sql:121) validates hold/before/held/observation versions but never examines `hold.acquisitionAcknowledgement`. The [ACK constraint](/home/serveradmin/insignia-m5-014-worktree/packages/database/migrations/20261006000100_m5_availability_v2.sql:161) applies only to `m5_activation_state`.

Falsifiable reproduction: use the existing [direct INSERT helper](/home/serveradmin/insignia-m5-014-worktree/packages/database/test/activation.test.ts:704) with otherwise valid `nestedEvidence`, changing only its acquisition ACK’s version to an unsupported value or its scope to another shop. Recompute the evidence digest as the helper does. No evidence-table constraint or INSERT trigger rejects those changes, allowing permanently immutable malformed audit evidence. This breaches implementation-plan §10.2’s bounded-version checks and the versioned evidence/tenant contracts. Apply the audit discriminator and identity fences to evidence holds and add rejection regressions. This conclusion follows from source inspection; I did not execute the PostgreSQL reproduction. The normal coordinator’s commit binding protects its own path.

The prior runtime-v1 and recovery-fixture findings are corrected. The prior mixed hold/snapshot counterexamples now have SQL rejection fences.

I examined complete v1/v2 ports/adapters, activation, recovery, publication admission, persistence repositories, both activation migrations, publication HTTP transport, interacting regressions, CI and authority documents. No additional material finding or smell warrants reporting.

Own commands: requested fixed-ref `git log`/three-dot `git diff`, `git diff --check`, three package `typecheck` scripts—all passed. Source equals `47fcce9`; all 39 canonical hashes and 31 compressed/uncompressed log hashes matched. Working tree remained clean.

Application/Shopify test commands exited 1 before executing tests because temporary SSR directories could not be created. Full regression, PG18, stress and renderer results remain supplied evidence. Final-head CI was not independently verified or replaced with earlier-source CI.

No edits, child agents, live operations, principal approval or native approval.