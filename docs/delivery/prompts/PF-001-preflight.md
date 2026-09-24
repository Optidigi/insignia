# PF-001 — local orchestrator preflight and documentation bootstrap

You are the **local sol-6-high orchestrator** for Insignia, a greenfield public Shopify customization app. The principal architect/reviewer is ChatGPT in the Insignia Rewrite Project. The user owns business decisions and resource authorization. Your task is **preflight only**: establish a correct, verifiable working environment and a reviewable documentation/configuration bootstrap. Stop afterward.

## Inputs and authority

Use the provided `insignia-handoff` package. Read `HANDOFF.md` and root `AGENTS.md`, then:

1. `docs/architecture/decision-ledger.md` — version 1.1.
2. `docs/architecture/implementation-plan.md` — version 1.1; focus on sections 0, 2 and 14–17 for this task.
3. `docs/delivery/operating-model.md`.
4. `docs/delivery/state.md` and `docs/delivery/tooling-register.md`.
5. `docs/delivery/agent-roles.md` and `docs/agents/issue-tracker.md` when configuring local roles/skills.

The pasted baseline and subsequently approved decisions are already recorded. No product interview is needed. Legacy `Optidigi/insignia` is a storefront UI/visual reference, not automatically your rewrite destination. Importing old data/code, reproducing old backend/admin workflows, or changing the stack is not part of this task.

## Permission envelope

Allowed: read local/project configuration and GitHub metadata; run harmless local capability probes; write the supplied documentation and necessary project-local agent/tool configuration; install the specifically selected trusted, inspected, pinned skills/tools without privilege escalation or global changes; create a branch and docs/config-only PR **only in an already verified user-approved rewrite repository**.

Do not scaffold the application or full monorepo, implement pricing, run G1–G8, deploy Functions/app/theme changes, mutate a Shopify store, create subscription/usage charges, create a remote repository, change repository protection, alter scopes/secrets, buy services, or access production buyer data. User/global configuration changes, elevated installs and new credentials are reported as specific manual actions rather than performed silently. Preserve existing work and do not overwrite conflicting instructions.

## Steps

### 1. Verify the workspace and save the records

Inspect cwd, Git root, sanitized remotes, branch/default branch, working-tree changes and existing root/ancestor/nested agent instructions. Read available README/project metadata to establish the workspace's purpose. Confirm the destination from actual user-approved project context; matching an Insignia repository name is insufficient. The neutral handoff snapshot has no remote and is not evidence of a destination choice.

Verify the bundle's SHA-256 manifest before editing. In the verified rewrite worktree place the plan and ledger under `docs/architecture/`, delivery documents under `docs/delivery/`, the skill tracker mapping under `docs/agents/`, root `AGENTS.md` and the PR template. Preserve approved content and hashes unless changing only the recorded operational setup; explain every change. Stage exact paths rather than broad additions that might include secrets.

If no destination is established, inspect and report safely in the unpacked handoff/scratch directory. Do not select or create one, touch legacy code, or push. If the remote is empty and lacks a PR base, report the maintainer's required initial-branch action; do not silently create/push its default branch. Complete all independent preflight checks and return the narrow blocker.

**Done when:** each required record exists at a verified path with checksum, and destination/publication state is explicit.

### 2. Verify the actual agent host and instructions

Record host/version, resolved provider/model identifier and reasoning setting corresponding to sol-6-high. Use host metadata/config diagnostics, not model self-description. Read its current documentation and `--help` before editing settings. Do not assume a friendly alias is a valid API model string or substitute a different model silently.

Inspect the effective global/ancestor/root/nested instructions, override files, project trust, discovery size limits, skill search paths and existing plugins. Keep `AGENTS.md` uppercase and authoritative. Add only the minimal documented host bridge required; no duplicated independent CLAUDE/AGENTS policy. Test instruction loading from a fresh read-only session after changes. It must identify the correct ledger, current PF-001-only scope, review boundary and legacy exclusion. Record diagnostics where available; distinguish configuration inspection from a fully verified live launch.

Configure the roles in `agent-roles.md` only through the host's supported mechanisms. Smoke-test one read-only child task: find and cite the active slice and two locked rules, then stop. Verify actual model/effort/tool/sandbox inheritance where observable. If native subagents are unavailable, record the sequential fresh-session fallback; do not invent successful delegation. Use one orchestrator, one writer by default and no recursive subagents.

**Done when:** the real host settings and loaded instruction/role paths are documented, including any unresolved limitation.

### 3. Verify tools and services through actual probes

Work through `tooling-register.md`. Record versions, executable/server names, sanitized invocation, observed result and readiness dependency. Exercise Node 24/pnpm, Rust/Cargo/rustfmt/clippy and wasm32-unknown-unknown, Git/worktrees, GitHub reads and the authorized write path, Shopify developer docs/schema tooling, separately authenticated Shopify CLI/test-app/store reads, browser automation, and dedicated PostgreSQL access. Inventory R2 and Partner/App Pricing test access; do not mutate them.

For Shopify developer tools, discover the exposed schemas/names rather than guessing them. Perform a docs lookup and a harmless GraphQL schema validation; check that an intentionally invalid field is rejected. This does not prove authenticated store access. Verify the designated app/store via a read-only request separately and note development-store capabilities that might mask non-Plus restrictions.

For browser tooling, use a disposable local static page to verify navigation, DOM interaction and evidence capture. For PostgreSQL, use a read-only version/connection probe against a designated development database. Toolchain smoke outputs are not platform-gate results. Missing full-workspace scripts in a new repo are NOT_CREATED, not failed tests or fabricated passes.

Inspect GitHub identity, permission boundaries and protection/ruleset status where readable. Identify the principal-review relay and actual maintainer merge/approval identity. A connected plugin in ChatGPT does not prove your local credentials. A local or same-account “approval” must not masquerade as an independent native review. Do not modify security settings to make the checks pass.

**Done when:** every matrix item has a factual state and scope: VERIFIED, FAILED, MISSING, NOT_TESTED, NOT_YET_REQUIRED or MANUAL_ACTION.

### 4. Install and verify a minimal skill set

Inspect/pin the selected `mattpocock/skills` entries listed in the register: writing-for-agents, tdd, code-review, diagnosing-bugs and handoff. Research is on demand. Inspect referenced files and license; record exact upstream revision, local paths and dependencies. Prefer existing compatible installations over duplicates. Use writing-for-agents for the docs you edit.

Verify discovery and actual readability from the host. Map upstream tracker/spec lookups to `docs/agents/issue-tracker.md`; do not reopen a configuration interview whose answers are already present. Do not install another orchestration framework by default. Skills cannot authorize extra commits, interviews, agents, remote writes or later implementation phases.

**Done when:** the chosen workflow capabilities are usable and their provenance is recorded, or a specific blocker/remedy is documented.

### 5. Produce the preflight report and bootstrap PR

Create `docs/delivery/preflight-report.md` containing:

- Overall verdict: READY_FOR_M0_001, PARTIAL or BLOCKED; readiness is for the named next slice, not a claim the application works.
- Verified workspace/repo/default branch and publication state.
- Canonical document paths/checksums, actual instruction chain and host/model settings.
- Capability/skill matrix with evidence and explicit missing items.
- Agent role and permission setup, GitHub reviewer/merge path, test-resource boundaries.
- Every blocker: impact, next slice affected, smallest concrete remedy and who must act.
- Changed files, checks run, untouched production resources, and G1–G8 still NOT_RUN.

Update the short `state.md` and tooling register with observed facts. Have a fresh read-only reviewer check instruction contradictions, claimed-versus-observed capabilities, secret exposure and unauthorized scope. Where unavailable, report that limitation; external principal review remains required.

In a verified repo with a suitable base and write access, create branch `chore/pf-001-preflight` and open a docs/config-only PR. Discover supported Git/gh commands; do not force-push, touch main, or merge. This actual branch/PR publication proves the write path; otherwise report LOCAL_ONLY with a clean local commit/patch and the access blocker. Do not mark metadata permissions as a completed write probe.

Return the report path, PR URL (or LOCAL_ONLY), full base/head/effective-merge-base SHA where available, checks/evidence, and the exact principal action needed. Put final refs in the PR body/response after committing to avoid self-referential hashes. Use `docs/delivery/templates/review-packet.md`.

**Stop here.** Do not begin M0-001, mark a gate passed, merge the PR or generate an application skeleton. The principal must review this preflight and seed the next executable prompt.
