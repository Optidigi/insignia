CHANGES_REQUESTED

Reviewed PR54 head `f0f67061d16a1b7c01a7d4bd008266a4ec6de84a`; pinned tree matches and working tree is clean.

**P2 — Preflight omits required application-function permissions.** [host-operator.py:287](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:287) checks EXECUTE privileges only within `pgboss`. Bootstrap directly invokes `pg_catalog.pg_advisory_xact_lock(bigint)` at [tenant.ts:171](/home/serveradmin/insignia-m5-023-worktree/packages/database/src/repositories/tenant.ts:171).

Concrete static counterexample: an already-running healthy worker retains all checked permissions, but EXECUTE on that overload is revoked from PUBLIC and `insignia_runtime`, with no inherited grant. Lifecycle qualification still passes; the first authenticated bootstrap then fails with PostgreSQL permission error 42501. This violates the requirement to qualify every required application/queue permission before backup, provisioning, deployment or Search ([production plan:5](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/M5-023-PRODUCTION-PLAN.md:5)).

Smallest correction: add read-only `has_function_privilege` checks for the exact functions required by bootstrap/ingress/uninstall, including the advisory-lock function, `hashtextextended` and the generation UUID default. Add independent actual-PG revocation controls showing rejection before mutation and successful qualification after restoration. The counterexample was not executed in this review.

Static coverage included all preserved round1–5 reports/settings/responses and root objections; interacting tenant/transaction/uninstall paths; SDK, staff grants, HTTP, observability and readiness; offline consumers; trusted release and historical v1/v2/v3 activation/recovery; complete operators, packaging, roles and host references. Prior corrections address their reported counterexamples; this permission omission remains.

Parent executions are supplied evidence: root86, PG197, concurrency/SDK/stress/portable controls and focused round6 qualifications. I performed Git/file inspection only—no execution, mutation, network or credential access.

Exact-head CI remains pending, the gate unfrozen, and live processor/readiness unproven. This grants neither principal approval nor production readiness.