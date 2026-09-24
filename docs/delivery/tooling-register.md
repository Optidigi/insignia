# Tooling, MCP and skill acceptance register

Version 1.1 — 24 September 2026. PF-001R current observations supersede the PF-001 snapshot below; the baseline matrix remains the acceptance criteria. See `preflight-report.md` and `evidence/pf001r-probes.md`.

## PF-001R current delta

| Capability | State | Observation |
|---|---|---|
| Rust/Wasm | VERIFIED | Official pinned Rust 1.98.1, rustfmt, clippy and Wasm target in isolated tool directory; disposable formatting, clippy and generic Wasm compile passed. System `cc` missing; Shopify Function remains untested. |
| Shopify CLI | VERIFIED | Official pinned CLI 4.8.2 isolated install; version/help passed. |
| Shopify authenticated runtime | MISSING | User designated app `insignia` and `insignia-staging` development store; zero CLI store sessions and noninteractive organization listing requires login. Exact IDs, domain, plan/privileges and authenticated identity remain unverified. |
| Instructions and fresh read-only review | FAILED | Root AGENTS/four skills discovered in prompt diagnostics; fresh CLI session could not read files because `bwrap` loopback namespace setup failed. |
| Orchestrator model/effort | NOT_TESTED | Project config requests `gpt-6-sol`/`high`; doctor still reports `<default>` and no feature override; launched session did not expose effective model/effort. |
| Native child/sequential fallback | FAILED | Earlier child could read files in unrestricted API runtime but had no enforced read-only isolation. Fresh restricted sequential fallback cannot read files. Parallel delegation disabled in project config only if loaded. |
| GitHub base/write path | VERIFIED | `Optidigi/insignia` approved; local `gh` account `shimmy-aga` has ADMIN permission. User-authorized README-only `main` commit `38a711ad46aec63b8f410519f30352a88e4113c7` pushed and remote-confirmed. Docs/config PR result and refs are external. |
| PostgreSQL | NOT_YET_REQUIRED | Missing for DB-dependent work; fixed-input DB-free M0-001 first spike does not need it. |
| R2 / Partner pricing | NOT_YET_REQUIRED | Later M6 / G8 dependencies remain undesignated. |

The project-local Codex config is not proven effective in this neutral repository. This current-thread API runtime has separate settings. Do not treat prompt injection as proof of sandboxed file access or an explicit model request as proof of the wire model.

## PF-001 observed snapshot — 24 September 2026

| Capability | State | Observed fact |
|---|---|---|
| Rewrite workspace | MANUAL_ACTION | CWD `/home/serveradmin` is not a Git repository; no approved rewrite destination was identified. |
| Codex host/model | NOT_TESTED | CLI 0.156.1; provider `openai`; catalog supports `gpt-6-sol` with `high`; fresh explicit CLI call accepted. Parent/child effective model and effort were not exposed. |
| Instructions | FAILED | Root `AGENTS.md` loaded in `codex debug prompt-input`; no global/ancestor/nested overrides found. Two fresh read-only CLI sessions received instructions but shell reads failed at sandbox initialization (`bwrap: loopback: Failed RTM_NEWADDR`). |
| Git/worktrees | VERIFIED | Git 2.53.0; scratch worktree add/list/remove succeeded. |
| GitHub | NOT_TESTED | Connected GitHub app read repositories as `Optidigi-AK`; local `gh` 2.101.0 has no login. No approved target or branch/PR write probe. |
| Review/protection | MANUAL_ACTION | Principal review relay documented; native reviewer/maintainer separation and ruleset/protection status unverified without selected repo. |
| Node/TypeScript | VERIFIED | Node 24.21.0 executed a smoke; existing TypeScript 7.0.2 compiled a strict temporary file. |
| pnpm | VERIFIED | Corepack fetched pnpm 12.6.0; disposable script passed. Project pin/lockfile NOT_CREATED. |
| Rust/Wasm | MISSING | `cargo`, `rustc`, `rustfmt`, `rustup`, clippy and Wasm target unavailable on PATH. |
| Shopify developer reference | VERIFIED | Transient `@shopify/dev-mcp@1.15.4` listed tools, returned 2026-07 Cart Transform docs; valid query accepted and invalid field rejected. No persistent local MCP config. |
| Shopify authenticated runtime | MISSING | Shopify CLI absent; no designated app/store or authenticated read. |
| Browser | VERIFIED | Existing Playwright Chromium 153.0.8010.12 navigated a disposable page, clicked, read DOM/console and captured screenshot with existing local shared-library path. |
| PostgreSQL | MISSING | `psql` absent; no designated development database/connection. |
| R2 | NOT_YET_REQUIRED | No designated non-production resource or read-only access; M6 dependency. |
| Partner/App Pricing | NOT_YET_REQUIRED | No designated test app/plan context or authenticated read; G8 dependency. |
| Evidence/CI | NOT_CREATED | No rewrite repository or workspace scripts/workflows established. |
| Selected skills | NOT_TESTED | Five inspected MIT-licensed skills copied to neutral `.agents/skills` at upstream `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`; Codex prompt diagnostics list four. `handoff` has upstream `disable-model-invocation: true`, so automatic discovery/use was not demonstrated. Not installed in an approved rewrite repository. |
| Child/fresh review | NOT_TESTED | One child returned active slice and two locked rules without edits; model/effort inheritance and read-only sandbox enforcement not proven. No fixed-ref repo review is possible. |

The transient MCP package and Corepack pnpm download reside in disposable/local caches. They are not project pins for a future rewrite checkout. The browser smoke used `LD_LIBRARY_PATH=/home/serveradmin/component-catalog/.pw-libs`; a default launch failed to load `libatk-1.0.so.0`.

## Capability matrix

| Capability | Baseline / preferred route | Exercise during preflight | Blocks |
|---|---|---|---|
| Correct workspace | User-approved greenfield working directory and repository | Resolve cwd, Git root, remotes, default branch, status and tracked entry docs; inspect candidate metadata | Writes/publication if target ambiguous |
| Local orchestrator | sol-6-high in the user's chosen host | Record host version, provider/model ID, effort, profile, workspace/sandbox and runtime-supported diagnostics | Any delegated implementation if mapping unresolved |
| Instructions | Root AGENTS.md; minimal verified host-specific bridge only if needed | Trace global/ancestor/root/nested/override sources; launch a fresh read-only session that locates the correct authority and active slice | Preflight completion if wrong instructions govern |
| Git | Installed Git; independent branches/worktrees | Version/status; safe local worktree creation/removal in a scratch repo, preserving user files | Parallel writers; normal repository publication |
| GitHub | Existing GitHub plugin/MCP for reads; `gh` and Git for local writes | Authenticate without printing tokens; read selected repo/PR/checks; publish authorized docs-only branch/PR to verify actual write path | Remote save/review lifecycle |
| Review identity/protection | Principal verdict plus maintainer native merge/approval | Identify PR author, authorized human reviewer/merge operator; read rulesets where allowed; record unavailable settings honestly | Merge, not safe local investigation |
| Node | Node.js 24 LTS; exact patch recorded | Run version and an ordinary TypeScript/build-tool smoke via installed tooling; no app scaffold | M0 JS/SSR harness |
| pnpm | Exact supported version chosen for Node 24 | Run version; verify scoped package-install/lockfile path in disposable directory where needed | M0 TS harness; full workspace later |
| Rust | Rust/Cargo, rustfmt, clippy, wasm32-unknown-unknown | Record versions/installed target; compile minimal temporary Wasm only to prove toolchain; no Function architecture implied | G2/G3 and deployed Function harness |
| Shopify developer reference | Official Shopify AI Toolkit / Dev MCP [T1] | Discover actual tools; perform docs search, fetch schema guidance and validate a harmless GraphQL operation; deliberate invalid-field control must be rejected | Shopify schema-dependent work |
| Shopify authenticated runtime | Shopify CLI with explicitly designated app/test store | Read version/help; verify app/store identity and access through a non-mutating request; record dev-store privilege caveats | G1/G4/G6/G7 and store-facing portions |
| Browser automation | Playwright plus one working native browser or Playwright MCP route [T4] | Open local static test page, inspect DOM, click and capture screenshot/console; confirm ability to persist redacted trace artifacts | G7 and browser-facing gates |
| PostgreSQL | Dedicated PostgreSQL 18, psql or pg path | Read-only connection and version check; identify test database and isolation strategy without dumping credentials | DB-dependent harness and M3 |
| Artwork storage | Dedicated non-production R2 account/bucket/prefix | Verify named resource access read-only when available; record write/delete test as NOT_RUN until authorized | M6, not a pure local codec spike |
| Billing context | Designated Shopify Partner/app-pricing test capability | Verify non-mutating access and plan/test context; no events/subscriptions/charges created in PF-001 | G8; report separately from general app auth |
| Evidence/CI | GitHub checks/logs/artifacts and local test output | Read existing workflow metadata if present; otherwise mark planned checks NOT_CREATED, not PASS | Merge gates after checks exist |
| Selected skills | Scoped pinned workflow skills from source list below | Inspect content/dependencies/license, record source revision and resolved local paths, confirm host discovers and can read them | Mandatory workflow skill use |
| Native subagents | Host-supported spawn/join and effective permissions | One harmless read-only child reads active slice/ledger and returns file references; inspect diagnostic metadata | Parallel delegation only; sequential fallback recorded |
| Fresh-context review | Separate reviewer session/worktree | Demonstrate fixed-ref review context and declared read-only restrictions | Local independent pre-review claim |

“Required” means required by the upcoming slice, not install every future dependency today. Record `VERIFIED`, `FAILED`, `MISSING`, `NOT_TESTED`, `NOT_YET_REQUIRED` or `MANUAL_ACTION`. Optional-tool absence is not a false global blocker. Overall PF-001 readiness is for the named next slice, with future blockers explicitly preserved.

## MCP/plugin choices

Use **one** developer-resource route for Shopify: the official toolkit's developer capabilities or the Dev MCP. Documentation access and authenticated store access are separate probes. The generic Shopify merchant-management ChatGPT plugin is not assumed to be a developer-schema server. A working plugin label alone proves neither capability [T1].

Use GitHub's already connected surface for the principal's repository reads; local `gh`/Git for branch and PR work. Verify the local host's connection independently—this chat connection does not transfer credentials to a laptop. No additional issue tracker is needed.

Use one browser automation route already supported by the local host. Install Playwright MCP only where it fills a missing interactive-browser capability. Committed Playwright tests remain the reproducible browser checks. Context7 is optional, as is an OpenAI documentation MCP for a Codex-specific setup question. Do not add PostgreSQL, R2, Figma, Canva, task-management or memory MCPs without an actual unmet task.

## Skill selection and source paths

The upstream source is `https://github.com/mattpocock/skills`. The following paths were checked against its current layout. Resolve and record an exact commit at installation; `main` is only the discovery location, not the pinned production source.

| Skill | Path in upstream repository | Trigger |
|---|---|---|
| writing-for-agents | `skills/productivity/writing-for-agents/SKILL.md` | Authoring AGENTS, prompts, handoffs and other agent-facing docs |
| tdd | `skills/engineering/tdd/SKILL.md` | Implementing behavior in a narrow red/green/refactor slice |
| code-review | `skills/engineering/code-review/SKILL.md` | Independent local spec and code-quality review of fixed refs |
| diagnosing-bugs | `skills/engineering/diagnosing-bugs/SKILL.md` | Reproduce, isolate and fix a real defect with regression coverage |
| handoff | `skills/productivity/handoff/SKILL.md` | Compact verified state for another session or the principal |
| research (on demand) | `skills/engineering/research/SKILL.md` | A bounded current platform/source question; inspect current content before using |

Install referenced support files required by a chosen skill, not just its SKILL.md. Preserve license and source provenance. Inventory duplicate/overriding skill names across global/repo/plugin scopes. Existing global skills may be reused if their resolved version/content is known and compatible; avoid silently changing the user's other projects.

The chosen repository workflow already fixes authority, review and task tracking. Where upstream expects `docs/agents/issue-tracker.md`, that mapping is supplied. Its fallback to a setup interview is not needed when the facts are already documented. Do not run upstream orchestration/commit/tracker-write steps outside the authorized slice. Superpowers is not an additional required framework.

## Installation and configuration

Read the installed host's current help/config schema before editing. Prefer project-local, inspected, version-pinned tool/skill installation that requires no elevation, billing or credential broadening. User-level/global changes, new secret grants and privileged installation require user approval. Generate a precise remediation action rather than repeating an interactive product questionnaire.

For a Codex host, verify AGENTS override precedence, project trust, local skill discovery, custom-agent loading and actual inherited model/effort using its official current docs [T2/T3]. Templates from a different CLI release are not proof. For another host, use that host's documented mechanisms. Do not replace an existing secure approval mode with an unrestricted mode simply to complete preflight.

Record version changes in the register and re-probe affected capabilities. Keep credentials in the host/OS secret mechanism or approved untracked environment, with tracked templates containing names only. Logs/handoffs record credential presence and scopes, never values.

## Sources

T1: `https://shopify.dev/docs/apps/build/ai-toolkit`
T2: `https://developers.openai.com/codex/guides/agents-md` and `https://developers.openai.com/codex/skills`
T3: `https://developers.openai.com/codex/multi-agent` and `https://developers.openai.com/codex/mcp`
T4: `https://github.com/microsoft/playwright-mcp`
T5: `https://github.com/mattpocock/skills`
T6: `https://docs.github.com/en/actions/reference/security/secure-use`
