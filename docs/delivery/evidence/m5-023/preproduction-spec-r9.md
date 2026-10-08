CHANGES_REQUESTED

Bound **only** to PR54 head `20d5e09df2123cfdbf46ab35f867563c248bb3f2`. Supplied base/effective merge-base and tree match; worktree is clean.

**P1 — Read-only code mounts can qualify a different running worker implementation.** [host-operator.py:254](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:254) rejects writable mounts but permits read-only executable mounts. Line262 also excludes read-only mounts from overlap checks.

Concrete counterexample: start the worker with an unreviewed database implementation in a host bind directory mounted read-only. Replace that directory’s package files with the reviewed bytes without restarting the worker. Node retains the previously imported implementation; the separate inspector hashes current files. Exact PID1 arguments/binary, inventory, database privileges and `/ready` can all pass, allowing provisioning despite an unqualified running uninstall processor. Container read-only access does not prevent host-side replacement.

This violates [production-plan step0](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/M5-023-PRODUCTION-PLAN.md:5), requiring the existing processor’s complete immutable executable identity before mutation.

**Smallest correction:** reject every effective mount overlapping a resolved executable/package root, regardless of its `RW` flag, unless independently immutable provenance establishes the running code. Preserve the stop boundary without restarting or deploying a worker. Add a process/filesystem control demonstrating loaded-code versus current-file divergence and a host control proving rejection with zero mutation reservations.

I assessed r1–r8 reports/settings, responses and root objections alongside bootstrap/authentication, transactions/generations/uninstall/credentials, trusted release/calendar/readiness, historical recovery/SQL, M3 consumers and provisioning/deployment paths. The specific r8 corrections are present; supplied controls omit this mounted-code case.

This counterexample is **static, not executed**. Root86, PG198, stress, archive and focused controls remain parent-supplied execution evidence. I ran no tests, builds, imports or external operations.

Exact-head natural CI remains unverified here; the gate remains unfrozen and live processor/readiness unproven. This grants no principal approval or deployment/merge authority.