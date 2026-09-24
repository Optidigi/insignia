# PF-001R — targeted preflight remediation and evidence handoff

Principal-issued continuation of PF-001. Date: 24 September 2026.
Local orchestrator: sol-6-high in the user's existing host.

## Objective and boundary

Finish the missing prerequisites for the smallest M0-001 same-variant Shopify lifecycle spike, publish the documentation bootstrap where authorized, and return independently reviewable evidence. This authorizes preflight remediation only. M0-001 and G1–G8 remain unexecuted and unauthorized until a separate principal prompt.

The principal has received only the prior agent's summary, not the report, patch or local session evidence. Principal status is BLOCKED_EVIDENCE; that is not a finding that the local changes are defective. No local commit or PR has been approved.

## Resume, do not restart

Reported workspace: `/home/serveradmin/insignia-pf001-local-20260924`.
Reported checkpoint: `7f7fbabbfb60bd0e3d693d332e2b7da59693b9dd`.
Reported patch: `/home/serveradmin/insignia-pf001-local-20260924.patch`.
These are handoff assertions to verify locally, not proof of the current state.

Read root `AGENTS.md`, the original PF-001 prompt, operating model, tooling register, state and actual preflight report. Verify Git root/status/HEAD and locate the checkpoint. Preserve all newer user work; a different HEAD requires explanation, not a reset. Inspect the supplied original manifest and recorded transfer verification. Compare the plan and ledger against the supplied originals; keep both unchanged.

Reuse prior successful checks whose exact commands, environment, results and evidence are available and remain applicable. Re-run checks affected by changed configuration, executable paths, credentials or repository location. A summary alone is not reusable test evidence.

## Permission envelope

Allowed: non-mutating discovery and diagnosis; documentation/evidence updates; minimal project-local instruction/configuration changes; trusted, inspected, pinned tool installations in an explicit isolated project/scratch location without elevated privileges, profile changes or global configuration changes; harmless disposable toolchain smoke tests. Preserve skills and version provenance.

Publishing a documentation/configuration-only branch and PR is allowed only once the user-approved rewrite repository, base and authenticated write identity are verified. The neutral directory and name-matching legacy repositories do not establish that approval.

The user must authorize new repositories/default-branch initialization, credential grants, machine-level package changes, security-policy changes and new test resources. Give the smallest exact action needed; never request secret values in chat or commit them. No application scaffold, Function/app/theme deployment, Shopify store mutation, usage event/subscription charge, production access, merge or protection change is authorized. Do not disable the sandbox or broaden permissions merely to make a probe pass.

## 1. Establish an evidence handoff and publication destination

Inspect the previous report and all operational edits first. Make them reviewable independently of GitHub: prepare a sanitized export of the actual report, changed tracked documentation/configuration, relevant smoke-test evidence and fixed-ref local review findings. Include the source checkpoint, tested head, comparison base and SHA-256 manifest. A local Git bundle is useful only after inspecting reachable tracked history for secrets. Otherwise use a tracked-file archive plus a complete patch with its real base.

Keep export/checksum artifacts outside the worktree where appropriate to avoid self-referential commit hashes. Do not include credentials, full environment dumps, personal/global config contents, buyer data or unredacted transcripts. If evidence needs redaction, retain the diagnostic facts and label the redaction.

Resolve the approved rewrite destination from explicit user context or ask for the exact existing `owner/repository` and PR base. If none exists, report the required user authorization for a new repository and its initial base; do not create one implicitly. Separately verify local GitHub authentication. A ChatGPT-side connector does not supply local `gh` credentials.

Once authorized and authenticated, branch from the real remote PR base, transfer only the intended documentation/configuration changes and open the PF-001 bootstrap PR. Do not force-push or overwrite a remote branch with unrelated neutral-workspace history. Preserve the original checkpoint as provenance and record the actual PR SHAs, which may differ. Re-run instruction/skill discovery in the final repository location. If blocked, return LOCAL_ONLY and the sanitized export instead; complete independent remediation below.

**Complete when:** the principal can inspect a PR or attached export, and repository/base/authentication status has explicit evidence or a specific owner action.

## 2. Repair the executable agent environment

Capture the failed fresh-session command, host/version, execution mode, exit status and relevant sanitized stderr. Diagnose against the installed version's current official documentation and effective configuration. Check Linux sandbox prerequisites where applicable; do not assume a particular missing package is the cause before observing the error.

Use only allowed project-local fixes. If a host package, namespace policy, security configuration or elevated action is necessary, report the exact proposed change and obtain user authorization. An unrestricted successful run is not a passing sandbox test.

Verify the actual orchestrator provider/model identifier and effort from host configuration/runtime diagnostics, not model self-description. Preserve the requested sol-6-high choice; explain an unresolved alias instead of silently substituting another model. State separately what is configured and what is observable in a launched session.

Run a fresh read-only session that actually reads root AGENTS, the ledger, the active slice and at least one selected skill. It must return file/line references for the current authorization and two locked decisions, then stop. Verify relevant permissions and that it made no modifications.

Try one bounded native read-only child if supported. Native delegation is not required for the first spike: the existing sequential fresh-session fallback is allowed. If using that fallback, disable parallel delegation and record which working runtime supplies implementation and fresh-context review. The failed child path remains FAILED/NOT_TESTED rather than being presented as fixed. A session that cannot read files does not satisfy either path.

Identify which runtime performed the previously reported fresh review, which base/head it reviewed and what evidence it produced. Do not conflate that review with the failed Codex probe or infer that either report was necessarily false.

**Complete when:** the chosen execution path demonstrably reads the correct project instructions/files/skills, the orchestrator settings are established, and independent review is executable or explicitly awaiting remediation. Child-model verification is required before using that child, not before a working sequential fallback.

## 3. Supply the first-spike toolchain and test context

Inspect existing executable paths before installing anything. Within the permission envelope, install missing Rust/Cargo, rustfmt, clippy, the `wasm32-unknown-unknown` target and Shopify CLI using inspected, pinned official distributions. Keep scratch/tool installation outputs outside application source; do not change global shell/profile settings. Report any prerequisite that cannot be supplied without user approval rather than silently escalating.

Prove Rust toolchain availability by compiling a disposable generic Wasm smoke program and record versions, target, command and result. This is not a Shopify Function proof, crypto benchmark or G2 pass. Verify Shopify CLI version/help independently of its account authentication.

Resolve the explicitly designated non-production Shopify app and test store from approved context. Require user designation when missing. With existing authorized credentials, verify their identities and access using non-mutating reads. Record distribution/store-plan/development privileges and any reason this environment might mask genuine non-Plus behavior. Do not choose a production/legacy merchant installation or create a test resource silently.

M0-001 will authorize its own narrow installation, cart/order and refund/restock actions separately. PF-001R does not grant those mutations.

**Complete when:** Rust/Wasm and Shopify CLI probes pass, and the app/store identity and read access are proven or precisely blocked with the required user action.

## 4. Scope readiness correctly

The intended M0-001 harness can use fixed test inputs and does not require the application's database or production quote service. Do not install PostgreSQL solely to clear a global checklist. Record PostgreSQL access as missing/not yet required for this DB-free first spike, retaining it as a prerequisite for DB-dependent work. This changes no PostgreSQL architecture decision and authorizes no substitute application database.

Likewise, R2 and Partner billing test access remain explicit later prerequisites, not prerequisites for the smallest same-variant lifecycle proof. Native parallel subagents are optional if the working sequential fallback is demonstrated. Shopify developer MCP success remains documentation/schema evidence, not authenticated store evidence.

For each unresolved item, record: observation, relevant evidence, capability affected, earliest slice blocked, smallest remedy, and responsible actor. Batch non-resolvable manual actions once; continue independent safe work rather than stopping at the first external blocker.

## 5. Return a reviewable checkpoint and stop

Update `preflight-report.md`, the tooling register and delivery state with the remediation delta, observed capabilities, exact limitations and current PF-001R-only authorization. Retain G1–G8 as NOT_RUN. Use the existing review-packet template.

Run a fresh fixed-ref read-only review when possible. Include its execution mode, refs and findings. Verify only permitted docs/config/evidence changed, the plan and ledger are byte-identical to their originals, no secrets are staged and the worktree is clean after the final local commit. Put final commit references in the response/export manifest or PR metadata rather than creating self-referential file hashes.

Return:

- Actual report and sanitized export/PR; local absolute paths alone are insufficient for the principal to inspect.
- Readiness for M0-001, publication status and separate principal-review status. Environment readiness is not implementation authorization.
- Full actual local/PR base, head and effective merge-base where available; otherwise identify the unavailable remote refs without inventing them.
- Checks reused and rerun, with evidence, and all unresolved owner actions.
- Confirmation of unchanged architecture records and untouched production resources.

Stop for principal review. Do not start or seed an executable M0 slice yourself.

## References for bounded diagnosis

Consult installed-version help and current official documentation rather than copying unverified flags:

- Codex sandbox: https://developers.openai.com/codex/sandboxing
- Codex configuration: https://developers.openai.com/codex/config-file/config-basic
- GitHub CLI authentication: https://cli.github.com/manual/gh_auth_login
- GitHub CLI authentication status: https://cli.github.com/manual/gh_auth_status

These references do not prove the cause of the reported failure or grant elevated installation permission.
