# Governance / permissions / exact merge contract

**Hierarchy:** current explicit owner decisions → `docs/architecture/decision-ledger.md` → relevant `implementation-plan.md` → `docs/delivery/operating-model.md` for workflow → active principal slice brief and live evidence. `AGENTS.md` routes sources. Evidence and skills never authorize wider mutations. Local agent works under principal/user decisions; independent reviewers do not approve merges.

## Only merge already authorized

PR54 external principal verdict: **APPROVED**, exact `Optidigi/insignia #54` base `66983f7a959c67cea8e03e79e16761613b73a9b2`, head `c7bbca723179e908553b6f8e786a9b638e9bf6a8`, tree `53f40875d12a48bcf4f9c799c387233b2cc5172b`. M5-023 accepted a correct stop; M5/G7 stays blocked. Owner states local agent performs the merge. Permission is scoped to **normal merge commit of this exact candidate only** and no bypass/squash/rebase, forced push or other PR. Prefer the repository's already working `gh` / Git tooling, discovering real command syntax rather than inventing scripts. If branch has moved/unknown required checks/merge conflict/no permission, **STOP**, do not grant your own exception.

### Required receipt after merge

- Confirm PR #54 moved to merged and GitHub reports actual merge commit SHA.
- Actual merge commit must have first parent **current main** `66983f7a959c67cea8e03e79e16761613b73a9b2`, second parent `c7bbca723179e908553b6f8e786a9b638e9bf6a8`, tree `53f40875d12a48bcf4f9c799c387233b2cc5172b` (or stop if GitHub legitimately created a different topology and seek principal rereview).
- Confirm remote main at actual merge SHA and no unexpected intermediate main change.
- Save time, native URL, method, ordered parent SHAs, tree, complete check outcome and reference to this external verdict; do not fabricate GitHub review.

## Successor authority

The principal in this handoff authorizes exactly **M5-024 OFFLINE source/qualification work** after merge. Resource owner must separately grant temporary host access and any production schema, role, container, service, backup or deployment mutation. A PR54 approval is **not** an advance production rollout authorization. M5-024 successor PR must return for a fresh principal verdict, and the local agent cannot merge it by default.

## Non-negotiable operational rules

One orchestration writer, default one implementation writer; separate worktrees for independently approved non-overlapping lanes. Exact source/head gates, genuine failure evidence, no hidden review/rerun. Scope/token/secret/merchant data isolation; no credential values in repo or handoff. Preserve v1/v2/v3 accepted history and immutable release/economic records. Never retry an ambiguous external mutation without a reviewed safe settlement protocol. Never assume a stopped M5 phase means success of G7/G1–G8.
