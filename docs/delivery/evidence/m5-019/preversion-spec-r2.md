CHANGES_REQUESTED — independent PRE-VERSION spec/correctness review.

Reviewed HEAD `a52da8b6330af35b83b57c3b671eb81fea313fcd` against base/effective merge base `703cfb21a4262675b088cd06289fe08a421ecdd8`. References below use committed-head line numbers; concurrent uncommitted wrapper/control edits are excluded.

1. **P1 — Git validation inherits an unprotected execution environment.** [create-unreleased-version.py:96](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:96), :132 and :134 invoke PATH-resolved `git` with the parent environment. The protected environment is constructed only afterward, at :180.

   Requirement: “Gate must bind full accepted inventory/current candidate files/reports/settings/CI/host receipts”; creation occurs “Only after all readiness gates pass.”

   Counterexample: an inherited PATH containing a Git shim can return the expected HEAD, empty status and incomplete tracked-file inventory. Deployment configuration and supporting receipts can consequently escape mandatory binding while candidate validation compares against mutable working-tree configuration. Inherited `GIT_*` configuration can also redirect Git’s repository context or execute an fsmonitor command before reservation.

   **Correction:** use a trusted absolute Git executable, bind its identity, and sanitize Git’s environment/configuration before every validation subprocess. Add an offline control rejecting substituted Git execution/context.

2. **P2 — Two distinct review reports are not enforced.** [create-unreleased-version.py:141](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:141) validates axes and distinct sessions, but does not require distinct report paths. Mandatory membership at :112 collapses duplicate report paths into a set.

   Requirement: “two distinct review reports/settings,” also claimed by [preversion-r1-responses.json:12](/home/serveradmin/insignia-m5-019-worktree/docs/delivery/evidence/m5-019/preversion-r1-responses.json:12).

   Counterexample: spec and security entries reference the same CLEAR report, with two settings files claiming different sessions and the same report hash. Every implemented review check passes; the frozen inventory contains only one report.

   **Correction:** require two distinct canonical report paths and two distinct canonical settings paths before constructing the mandatory inventory. Retain session/hash checks and add a duplicate-report negative control.

The original optimization bypass and duplicate-CI acceptance are corrected in committed source. Direct candidate UID/config/query/Wasm checks, exact file membership and symlink rejection substantially close the original artifact-substitution gap; the issues above remain.

Inspection covered the diff/all changed files, authority documents, both original predeployment reviews, both round-one reports/settings, responses and sanitized evidence; complete relevant deployed routes/editor, admin authentication/token exchange, production composition, application publication/activation/recovery, Shopify adapters, database repositories/migrations, packaging/configuration and creation operator. Personal read-only hash inspection found zero mismatches across **396 accepted source + 225 build files**.

Committed evidence supports `HOST_WEB_READINESS_PASS`, with original failures, rollback timeout, revoked temporary access and unresolved LXD administrative cleanup preserved. Empty redirects match online token exchange. Proposed UUIDs remain local identities. Supported installation evidence establishes designated presence and Draft distribution while correctly leaving other installations unknown.

The exclusive/fsynced reservation and fixed `--no-build --no-release` subprocess otherwise support one attempt with no retry. Creation/readback are appropriately pending. Dispatch requires corrected-head fresh CLEAR reviews and all **TEN** distinct applicable exact-head attempt-one workflows completing SUCCESS; historical results cannot substitute. M0-007 is inapplicable.

I ran no tests, builds, network/provider operations, mutations or delegation. This is not principal approval.
