Standards/security review found **one P2 persistence finding**.

Base: `55060c5a48617a27858d10fb0db639c7e9efe148`
Head: `fc630956cd48dbb886ce5eac2cb4297a5162c684`

**P2 — Immutable v2 recovery resolutions lack nested hold/audit fences.** The [resolution constraint](/home/serveradmin/insignia-m5-014-worktree/packages/database/migrations/20261006000100_m5_availability_v2.sql:111) checks `originalHold.version` and `before.version`, but never checks `originalHold.held.version` or nested ACK versions/tenant identity. The [shared audit predicate](/home/serveradmin/insignia-m5-014-worktree/packages/database/migrations/20261006000100_m5_availability_v2.sql:185) applies only to state and activation evidence.

Falsifiable counterexample: insert an otherwise valid v2 resolution for an unoccupied synthetic publication, changing only `originalHold.acquisitionAcknowledgement.version` to an unsupported value and recomputing `resolution_digest`. Every CHECK input and foreign key remains unchanged; no INSERT trigger rejects it. The resulting malformed audit is permanently immutable. An in-memory source dependency check also confirmed unchanged constraint inputs for altered held-snapshot version and foreign ACK tenant identity. This violates implementation-plan §10.2’s bounded-version checks and M5-014’s versioned recovery contract. Apply nested hold/audit fences to v2 resolutions and add accepted-control/rejection regressions. Normal recovery copies constrained state; this finding concerns direct SQL persistence. PostgreSQL reproduction was **not executed**.

All prior findings are corrected in the candidate, including the runtime v2 fixture, recovery intent reset, nested activation evidence and ACK fences. No additional material security finding or reportable smell identified.

Examined full v1/v2 availability ports/adapters, activation, publication admission, recovery, persistence, original/new migrations, transport/deadlines, interacting tests, CI and required authority documents.

Own checks: fixed-ref `git log`/full three-dot `git diff`, `git diff --check`, three package typechecks and hash/equality checks passed. Source equals `a443b51`; all 39 canonical files and 39 compressed/uncompressed log pairs matched.

Application/Shopify Vitest commands exited 1 before executing tests because temporary SSR directory creation was blocked. Full regression, PG18, stress and renderer results remain supplied evidence. Final-head CI was not independently verified.

HEAD and working tree remained unchanged. No edits, agents, credential inspection or live operations. No principal/native approval.