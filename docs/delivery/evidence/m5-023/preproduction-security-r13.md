CHANGES_REQUESTED — round13 Security/Standards review, bound only to PR54 head `4b6778ac66ed034bb514a69c84fdf6f1a5136906`.

Verified clean tree `2456dd53661bf137f362784202fff1efb5a8efa5` and effective merge-base `66983f7a959c67cea8e03e79e16761613b73a9b2`.

**P1 — Schema and backup clients can target an unqualified database.** In [host-operator.py:154](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:154), `psql` specifies database/user but no endpoint and inherits the database container’s libpq environment. The dump commands at lines362/366 behave similarly; provisioning executes through this connection at line395.

Concrete counterexample: `database.env` supplies `PGHOST` pointing to another reachable PostgreSQL server with matching database/user, credentials, migration history and privileges. Canonical Compose bytes remain unchanged. Web/worker sessions still qualify against the designated container, but the separate privilege probes, backups, migration and role writes target the other server. Provisioning can report success while mutating an unrelated database and leaving the runtime database unprovisioned.

This is a hard violation of the [production plan’s designated-database qualification, backup and provisioning requirements](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/M5-023-PRODUCTION-PLAN.md:5).

Smallest correction: centralize these DBA clients behind an explicit designated local endpoint with sanitized libpq routing/startup settings. Verify the actual DBA session’s database/user/public schema before reservations, and use the same binding for both dumps and provisioning. Add redirect controls requiring rejection before any mutation reservation.

I reassessed r1–r12 reports/settings/responses and interacting source. The state-first Compose guard, current lifecycle requalification and explicit operator CONNECT corrections are present.

This finding is static, not an executed reproduction. Supplied execution evidence does not cover this routing case. I ran no tests/builds or live operations. The gate remains unfrozen; no principal/live approval or credential/network isolation is claimed.