CHANGES_REQUESTED — independent PRE-VERSION round3.

Reviewed HEAD **`66e902c254a1a75aa959947b2d657d953cabe82a`**, base/effective merge base `703cfb21a4262675b088cd06289fe08a421ecdd8`.

**P2 — Newly created accounting directory is not durably linked before dispatch.** [create-unreleased-version.py:203](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:203) permits creating `version-run`. [durable_new():58](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:58) then fsyncs the reservation file and its containing directory, but never fsyncs the parent directory containing the newly created `version-run` entry.

**Requirement:** the reservation must survive crashes and prohibit another attempt after ambiguous settlement; [originating prompt:65](/home/serveradmin/insignia-m5-019-worktree/docs/delivery/prompts/M5-019-HOST-READINESS-UNRELEASED-VERSION.md:65).

**Source-derived counterexample:** on the supported first invocation with no existing accounting directory, Shopify receives the creation request, then the host crashes before the new directory’s parent entry is durable. Syncing the child directory does not establish that parent-entry durability. Recovery can therefore lose the directory and reservation; another invocation can reserve and dispatch again despite ambiguous first settlement.

**Narrow correction:** fsync `CANONICAL.parent` after establishing the accounting directory, before any dispatch, and fail closed if synchronization fails. Retain exclusive reservation and file/directory fsyncs. Add an offline control checking this ordering for the newly created directory. This finding concerns host-crash durability; existing process-failure and timeout accounting otherwise stops retries.

All mandatory round-one and round-two objections are closed in actual source:

- Explicit `require()` checks survive optimization.
- Mandatory membership binds tracked files, 621 accepted artifacts, seven candidate files, CLI/Node/Git anchors, distinct reports/settings and required receipts. Direct configuration, UID, query, Wasm, extras and symlink checks reject substitution.
- CI requires exactly ten named distinct repository/run/current-head/attempt-one completed successes.
- Absolute hash-bound Git uses filtered environment, disabled global/system configuration and protected context checks. HOME is validated before subprocesses; fixed PATH and filtered environment exclude ambient loaders and force flags.
- Canonical report/settings paths and reviewer sessions are distinct; reports bind current head and settings hashes.

Inspection covered the cumulative diff, all 103 changed files, required authority documents, original predeployment and both prior pre-version rounds’ reports/settings/responses, sanitized evidence, deployment helpers/configuration/operator, and complete relevant deployed routes/editor, authentication/token exchange, production composition, publication/activation/recovery adapters, database repositories and 15 migrations. Personal read-only hashing found **zero mismatches across 396 source and 225 build files**. I inspected the ten-control PASS log without executing tests.

Committed evidence supports `HOST_WEB_READINESS_PASS`, legacy coexistence, restart/rollback, separate least-privilege PG18 and revoked temporary access. Original SDK/profile/dependency failures and rollback timeout remain preserved. LXD cleanup remains explicitly `BLOCKED_ADMIN_AUTHENTICATION`. Empty redirects match implemented online exchange; UUIDs remain proposed local identities. Designated installation presence and unknown total installation count satisfy the brief’s supported-evidence limit.

**Do not dispatch until the durability correction receives fresh CLEAR reviews, all TEN applicable exact-current-head workflows succeed, and the complete gate is frozen.** M0-007 is inapplicable; historical CI cannot substitute. Current CI success was not observed here. Creation/readback are intentionally pending.

No tests, builds, writes, network/provider/credential operations or delegation occurred. No principal approval is granted.
