CHANGES_REQUESTED — round15 security/standards review, bound **only** to head `52c9631c6695bf66835d14dd621b4b00cc081be4`.

Verified effective base `66983f7a959c67cea8e03e79e16761613b73a9b2`, tree `e38268da4369dd591ce9cc423019a31d75588236`, and clean tracked files before and after inspection.

**P2 — Operator append still depends on PUBLIC EXECUTE.** [trusted-release-roles.sql:14](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/trusted-release-roles.sql:14) grants only `clock_timestamp()` and `jsonb_typeof(jsonb)`. Migration16 directly requires `isfinite(timestamptz)` in its [CHECK constraint:12](/home/serveradmin/insignia-m5-023-worktree/packages/database/migrations/20261008000100_m5_trusted_release.sql:12), but neither role verification nor [host readback:436](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:436) checks that privilege.

Concrete **static** counterexample: revoke PUBLIC EXECUTE on `pg_catalog.isfinite(timestamp with time zone)`, retaining runtime access and all currently checked privileges. Provisioning/readback can pass and the fresh operator can connect, but its trusted-release INSERT fails with `42501` when evaluating that CHECK. This violates brief §6’s requirement that the dedicated operator can append.

Smallest correction: explicitly grant and verify that exact overload in role SQL and host readback. Extend the isolated PG18 control to revoke its PUBLIC EXECUTE, retain runtime rights, and prove fresh operator append/immediate runtime qualification with existing privilege denials preserved. The supplied [control:18](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/trusted-release-connect-control.mjs:18) revokes only clock/JSONB access.

I reassessed r1–r14 findings/settings/responses, root objections, sensitivity controls and interacting source; no additional actionable finding emerged.

This was static inspection only. Executed results are supplied evidence; I ran no tests, scripts or live operations. Filesystem read-only enforcement does not establish credential/network isolation. The gate remains UNFROZEN; this grants no principal or live approval.