CHANGES_REQUESTED — independent PRE-VERSION round2.

Reviewed HEAD `a52da8b6330af35b83b57c3b671eb81fea313fcd`, base/effective merge base `703cfb21a4262675b088cd06289fe08a421ecdd8`.

**One new material Standards/security finding:**

**P1 — Registry validation and CLI execution can use different HOME values.** [create-unreleased-version.py:165](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:165) checks registry absence under `/home/serveradmin`, while [line180](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:180) inherits arbitrary `HOME` into the child. The committed [CLI audit:4](/home/serveradmin/insignia-m5-019-worktree/docs/delivery/evidence/m5-007r4/reused-launch-policy.json:4) establishes that Oclif derives its user-plugin registry from `HOME`. The [launch envelope:72](/home/serveradmin/insignia-m5-019-worktree/docs/delivery/evidence/m5-019/cli-launch-envelope.json:72) requires the same-account HOME.

**Source-derived counterexample:** with an otherwise valid frozen gate, launch using an alternate HOME containing `.local/share/@shopify/cli/package.json` and a plugin. The approved-home absence check passes, reservation is consumed, and the CLI can load unreviewed plugin code outside the frozen inventory. Fixed `CI=1`, `--no-build` and `--no-release` do not bind that registry. This violates the complete protected launch gate required before creation by [prompt:63](/home/serveradmin/insignia-m5-019-worktree/docs/delivery/prompts/M5-019-HOST-READINESS-UNRELEASED-VERSION.md:63).

**Narrow correction:** require the approved HOME before reservation, or explicitly construct the child environment with that HOME; validate registry absence against the same environment. Add an offline control covering altered/missing HOME before reservation or Shopify dispatch.

All three mandatory round1 objections are closed in actual source:

- Explicit `require()` failures remain active under Python optimization.
- Mandatory inventory covers tracked files, 621 accepted artifacts, seven candidate files, CLI/Node anchors, both reports/settings and fresh receipts; direct module/hash/extra/symlink checks reject substitutions.
- CI requires exactly ten named workflows, distinct run IDs, intended repository, current head, attempt1 and completed SUCCESS.

TEN is the applicable current gate; M0-007 does not trigger. Historical predeployment checks and PR49’s eleven successes cannot substitute. Both fresh reports must be CLEAR and all ten current-head workflows successful before freezing.

Inspection covered the diff and all 95 changed files; required authority documents; original predeployment and both round1 reports/settings, responses and sanitized evidence; complete relevant admin/editor/routes, HTTP/authentication/online exchange, production/diagnostic composition, tenant/config/publication/activation/database source and migrations; deployment helpers/configuration, packaging and creation wrapper. Personal hash inspection found **zero mismatches across 396 source + 225 build files**. I inspected the seven-control PASS log; I did not execute those tests.

Evidence supports `HOST_WEB_READINESS_PASS`, coexistence/restart/rollback and separate least-privilege PG18. Original failures and rollback timeout remain preserved; LXD cleanup remains explicitly blocked by administrator authentication. Empty redirects match online token exchange. Proposed UUIDs remain local identities. Supported installation observations meet the brief’s bounded requirement while leaving other installations unknown.

Creation/readback are intentionally pending and are not findings. No tests, builds, writes, provider/network/credential operations or delegation occurred. Correct the HOME binding and obtain fresh review before dispatch. No principal approval is granted.
