# Insignia — agent entry point

## Start every session

Read `docs/architecture/decision-ledger.md`, `docs/delivery/state.md` and the currently authorized slice prompt. Before executing or delegating a slice, read `docs/delivery/operating-model.md`. For affected architecture, read the relevant sections of `docs/architecture/implementation-plan.md` before changing code. The detailed plan is a reference, not an always-loaded instruction blob.

The user owns product decisions; ChatGPT in the Insignia Rewrite Project is principal. Current authorization is [M5-014 availability hold v2](docs/delivery/prompts/M5-014-AVAILABILITY-HOLD-V2.md), LOCAL/OFF-STORE ONLY after the exact approved normal merge of PR #43. Implement versioned v2 snapshots/holds/activation evidence and generic complete includedProducts intent, separate effective visibility, semantic settlement and version-aware recovery. Preserve historical v1 semantics/JSONB and trusted recovery exactly; new activation creates v2 only and unresolved v1 holds remain operator-held. updatedAt is v2 diagnostic, never CAS or tolerance. All historical registers and the permanently closed M5-013 fixture remain untouched. Fully qualify with synthetic HTTP/credentials, full regression, PostgreSQL18 CI, 100-case publication stress/renderer control and fresh actual GPT-6.1-sol/high full-source Spec/security reviews. Return one implementation PR, then stop for principal review; do not merge the successor. No Shopify/Partner/API/browser/credential/Shopify CLI/provider operation, fixture creation/mutation, scope/version operation, M6/M7, production activation, RELEASE_BOUND/gate pass or launch. GitHub merge/PR/CI operations and repository-local tool/test commands remain authorized.

## Authority and scope

The ledger controls settled decisions; the plan provides implementation detail; the operating model controls delivery. Record approved changes rather than silently replacing a decision. `Optidigi/insignia` is the rewrite repository; `Optidigi/insignia-legacy` is the storefront UI/visual reference only. New-application SQL migrations are required; legacy import/migration/compatibility work is outside scope.

For missing access, conflicting instructions or platform evidence that invalidates a lock, report the narrow blocker and continue only independent safe work. Prefer reading available files/tool state to repeating answered product questions.

## Implementation

Use one outcome per slice/PR, explicit contracts and executable invariants. Build a failing behavior test, implement the narrow path and refactor. Keep domain independent of Shopify, Astro, Preact, Konva and persistence. Keep Shopify SDK use in its adapter; Konva remains a renderer. Follow exact-money, tenant, idempotency, immutable-record and retention contracts in the plan.

Consult the maintained G1–G8 evidence register in the plan and delivery state. A source citation, schema validation, mocked test or successful compilation is not real-store gate evidence. Preserve failing observations and obtain principal acceptance before dependent work proceeds.

## Delegation and integration

One orchestrator; one writer by default, at most two for independently authorized non-overlapping slices. Writers use separate branches/worktrees and assigned paths/resources. The orchestrator owns root/lockfiles, contracts, fixture definitions, migration ordering, CI and delivery state. Read-only local reviewers do not replace principal review. See `docs/delivery/agent-roles.md` when spawning or configuring a role.

Use runtime-supported sandbox/approval controls. Worktrees and instructions are not credential isolation. Serialize shared Shopify store/app mutations. A missing subagent feature permits a recorded sequential workflow, never fictional delegation.

## Verification and review

Use actual package/workspace scripts once present; discover commands rather than inventing them. Capture the commands, exit status and sanitized evidence. Commit SQL migrations with relevant features and TS/Rust fixtures together. Check the whole staged diff for scope and secrets.

Before handing off a PR, use `docs/delivery/templates/review-packet.md`. Principal approval is bound to repo/PR/base/head; changed code or effective base needs re-review. Merge authority stays with the user unless explicitly delegated for that reviewed change. An agent-authored approval file is not independent approval.

## Tools and skills

Before declaring readiness, exercise capabilities from `docs/delivery/tooling-register.md`. Verify instruction and skill loading in the actual local host. Use project-scoped, inspected, pinned skills; their defaults cannot override the active slice or approval boundary. When authoring agent-facing docs use writing-for-agents; for behavioral work use tdd; for a defect use diagnosing-bugs; for local pre-review use code-review; for context transfer use handoff, subject to this project workflow.

## Safety

Use designated non-production stores, databases, storage prefixes and synthetic data. Keep credentials, original artwork, personal data and presigned secrets out of code, logs and handoffs. Production changes, paid actions, privilege escalation and destructive operations need explicit user authorization. Preflight may not deploy Functions, scaffold the application, create billable events or change repository protections.

## Finish each slice

Update the short delivery state and PR evidence, distinguish verified/failed/unavailable/not-run checks, and stop at the principal review boundary. Do not auto-start the next slice. The user carries the PR URL/head to the principal; no background watcher is assumed.
