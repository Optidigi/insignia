CHANGES_REQUESTED — round13 Spec/correctness review bound **only** to PR54 head `4b6778ac66ed034bb514a69c84fdf6f1a5136906`.

Verified clean worktree, effective merge-base `66983f7a959c67cea8e03e79e16761613b73a9b2`, and tree `2456dd53661bf137f362784202fff1efb5a8efa5`.

**P2 — Trusted append can write after its original authority expires.** [release-append.mjs:146](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/release-append.mjs:146) checks freshness before `operator.query()` establishes its connection and acquires database locks. The INSERT at line151 has no database deadline predicate.

Concrete counterexample: the original Function observation is28seconds old and Active is fresh. Another session holds an ACCESS EXCLUSIVE lock on `trusted_release_records`. The JavaScript check passes; INSERT waits5seconds, then commits when the lock releases, with Function authority now33seconds old. The host’s30second subprocess timeout does not prevent this shorter wait. [Migration16:17](/home/serveradmin/insignia-m5-023-worktree/packages/database/migrations/20261008000100_m5_trusted_release.sql:17) imposes no upper freshness bound. Runtime qualification rejects afterward, but the immutable append already occurred.

This violates brief§9 and the production plan’s requirement to append within both original30second windows. **Smallest correction:** enforce the original deadline at the database write boundary, bound connection/lock waits by remaining authority, and add a PostgreSQL lock-delay regression proving zero append after expiry. Preserve original observations and historical reader/migration semantics.

I independently reassessed all r1–r12 reports/settings/responses, root objections, sensitivity controls and interacting source. The first-statement `state` guard, explicit operator CONNECT and repeated current lifecycle qualification address their reported counterexamples.

This finding is static, not executed. Recorded root86, PG198, stress and operator results remain **supplied execution evidence**; existing append controls omit this delayed-write case. I performed only Git/tracked-file reads, with no tests, imports, network, credential inspection or delegation.

The gate remains **UNFROZEN**; exact-head natural CI and live readiness are unverified here. This grants no principal, production or merge approval.