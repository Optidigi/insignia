# Insignia — milestone-autonomous delivery operating model

Version 2.0 — 9 October 2026. Authority: [owner decision](authority/milestone-autonomy-2026-10-09.md). Replaces per-slice/per-PR external principal review for current and future work. Product and security contracts are unchanged.

## 1. Ownership and review boundaries

The **local orchestrator** owns execution inside the active milestone. It decomposes work, chooses tactics and appropriate skills/tools, assigns subagents, implements, tests, resolves findings, accepts slices locally, opens and normally merges PRs, and continues without a principal checkpoint between slices. It is responsible for the integrated outcome, not only its own code.

The **principal**, ChatGPT in the Insignia Rewrite project, accepts completed milestones against the full implementation plan, decision ledger, architecture, cross-component behavior and evidence. The principal does not routinely review internal PRs. Only milestone acceptance allows the next milestone to begin.

The **owner** retains product/commercial decisions, resource allocation and permission for out-of-envelope external actions. The owner has delegated within-milestone PR merges to the local orchestrator. A local review or merge never impersonates an external principal verdict or a distinct GitHub reviewer.

“Milestone” means M5, M6, M7, etc. Historical phase groups P0–P5 can remain descriptive; they do not postpone M6 review until the whole P3 group ends. The current active milestone is M5 until an actual M5 acceptance changes it.

## 2. Authority and source hierarchy

Newest explicit owner decisions -> decision ledger -> detailed implementation plan. This operating model governs execution. AGENTS.md routes agents; delivery state records facts and current work. Historical slice approvals/reports preserve what happened then and are not a second current workflow.

Within a milestone, the orchestrator may make and record ordinary implementation/security-mechanism decisions that preserve locked requirements. It may repair previously reviewed defects with new tests and evidence. Prior code is not untouchable simply because it was accepted; prior observations and immutable records must not be rewritten. A proposed change to a locked product decision, protocol contract or accepted residual-risk boundary needs the appropriate owner/principal decision.

All code necessary for the active milestone is authorized for local work. Do not require a new principal prompt for each path or slice. Minimal supporting work in a dependent package is allowed; starting an entire later milestone is not. Maintain an impact note for meaningful supporting work rather than silently expanding milestone acceptance.

## 3. The local delivery loop

1. Verify the live repository, current milestone entry commit, plan, active decisions and actual resource permissions. Read affected architecture sections and source before changing behavior.
2. Derive a compact milestone acceptance map and dependency-aware worklist. Prefer vertical outcomes. Identify resource/owner inputs early, grouped into one practical request.
3. Define the next slice's invariant, affected paths, dependencies and tests. The orchestrator authorizes the slice locally. Use TDD and defect diagnosis where applicable.
4. Implement and test using isolated branches/worktrees, databases, ports and storage prefixes. Review actual provider contracts for new uncertain platform assumptions. Documentation or mocks do not establish native behavior.
5. Freeze a candidate and obtain independent read-only local review on both axes: **Spec/correctness** and **Standards/security**. Review the complete changed implementation and relevant interacting source, not just changed lines or the author's summary. Resolve actionable findings. Reviewers must not be the writer of the reviewed changes.
6. Run applicable deterministic checks and exact-head CI. Preserve failures, commands, source/build identifiers and attempts. Source corrections need renewed relevant tests and both fresh completed-change reviews. A legitimate changed base also needs requalification.
7. Record the exact local verdict and evidence in the PR. Revalidate actual head/base and all required checks; normally merge with the delegated identity, without bypass or fabricated approval. Verify ordered parents, tree and remote main.
8. Update milestone progress and immediately continue the next internal slice. A reviewable blocker finding may be merged as evidence without enabling unsafe behavior. It does not finish the milestone.

There is no automatic principal handoff at the end of this loop. End-to-end milestone completion, not the existence of another PR, is the objective.

## 4. Independent agents, skills and tooling

Use a single accountable orchestrator with fresh scoped writer, researcher, test and reviewer contexts as useful. Parallelize genuinely independent work when path/resource ownership and integration contracts are explicit. The orchestrator selects the number of workers within actual compute/tool budgets; a fixed two-writer cap is not an external approval gate. Serialize shared contract/lockfile/migration changes and shared external mutations. Worktrees are not credential isolation.

Use the repository's inspected, pinned Matt Pocock skills: `writing-for-agents`, `tdd`, `diagnosing-bugs`, `code-review`, `handoff`, and `research` when its source has been inspected and made available. Read their support files. Use other relevant available skills and tools when they add value; do not indiscriminately install everything or introduce competing orchestration policy. Preserve provenance and licenses. A user-invoked skill such as handoff may need an explicit invocation or direct file read; do not assume automatic discovery.

Verify actual local host capability, instruction loading, subagent execution and reviewer read-only enforcement. Prefer the existing verified high-reasoning reviewer setup; log actual model/effort, session, reviewed refs and sandbox. Comparable available tooling/model choices are implementation decisions and must be recorded truthfully. Never claim GPT-6.1-sol/high, independent review, network isolation or a successful test unless actually established. When native delegation cannot enforce the intended review boundary, use fresh restricted sessions. If no independent execution route exists, report the limitation; do not self-certify missing reviews.

Project-scoped nonprivileged tool/skill setup within the available environment is delegated. New paid services, elevated/global installation, external credentials and new infrastructure need owner authority. A missing optional plugin is not a project-wide blocker when an equivalent supported tool works.

## 5. Testing and evidence proportional to risk

Keep all existing acceptance/security invariants. Use actual package scripts, not invented commands. Changed behavior needs relevant type/lint/boundary tests, local behavior and integration tests, database races, browser controls, protocol/Wasm checks and provider evidence where required. Run comprehensive integrated regression at milestone exit and whenever cross-cutting changes warrant it.

Apply provenance-based reuse to unchanged source/build/environment inputs. A documentation-only update need not rerun the entire historical test suite; it still needs document/link/scope/secret checks, independent completed-change review and naturally applicable CI. Do not copy stale runtime results onto changed inputs.

All naturally applicable exact-head workflows and repository-required checks must pass. Preserve current attempt-1 qualification requirements where they apply, along with every failed attempt. Do not manually trigger irrelevant workflows to reach an old numeric count. No false green via skipped required tests, weakened assertions, waived security failures or rerun laundering.

Keep compact public manifests, verdicts and source/artifact hashes in Git; keep bulky/private raw evidence in an approved durable artifact location with retention/retrieval information. Preserve old findings, native receipts and historical failures byte-exact where required. Explicitly distinguish PASS, EXPECTED_NEGATIVE, REPRODUCED_DEFECT, BLOCKED, NOT_RUN and REUSED. Passing vulnerability characterization is never security PASS.

## 6. Merge and integration ownership

The orchestrator is authorized to accept and merge ordinary PRs inside the active milestone, including PR58 and governance adoption. External principal PR approval is not required. This does not approve any existing PR blindly: local independent reviews, scope and exact-ref checks still apply.

Use normal merge commits unless a later explicit owner decision changes the method. No direct pushes to protected main, force-push history rewriting, squash/rebase substitution, protection weakening or administrator bypass. Repository-enforced approvals still apply; a tool permission obstacle must be reported, not bypassed or impersonated.

Record reviewed base/head, effective merge base, accepted tree, local reviewer sessions/verdicts, CI run IDs/attempts, actual merge SHA, ordered parents and integrated tree. A merge receipt is a fact; LOCAL_SLICE_ACCEPTED is not PRINCIPAL_MILESTONE_APPROVED.

At milestone completion the implementation PRs may already be merged. Freeze the exact integrated main commit/tree for principal review. Do not create an empty PR just to manufacture a milestone gate. Milestone approval binds the entry-to-candidate cumulative change and its integrated evidence.

## 7. Technical qualification versus external resource permission

The orchestrator owns technical plans, preflights, freeze decisions and local approval of within-milestone experiments. Where existing explicit owner allocation covers the resources, operations, cost and effects, execute after local qualification without an additional principal signature.

The owner has separately allocated [permanent read-only VPS access](authority/permanent-vps-readonly-2026-10-09.md) for the established Insignia host. Use it without recurring read-budget or authorization-window requests; retain bounded technical calls, private accounting and retention. It grants no production changes or independent Shopify resource operations.

This policy does not allocate unknown infrastructure or authorize all production/Shopify activity. For missing authority, request one specific owner allocation: resource identity, access, operation/effect bounds, secrets channel, cost, cleanup, delayed obligations and stop conditions. Do not open another plan-only PR merely to ask that question. Start the permitted work immediately when allocation is granted and recorded. Any scope expansion needs renewed owner permission, not a new routine principal review.

Retain secure secrets handling, raw evidence, uncertainty accounting, no ambiguous external mutation retry, and pause-on-unsafe-state. Preserve closed historical runs. A reviewed fix may create a new locally authorized technical run under valid owner resources; it may not relabel or resume a sealed failed attempt by patching in place.

Native evidence cannot be invented when a permitted experiment is unavailable. Gate conditions remain safety conditions, not just approval paperwork.

## 8. Milestone completion and principal handoff

A milestone is internally complete only when its original acceptance criteria and assigned gate rows have qualifying evidence, all required integration works, unresolved milestone-blocking defects are zero, and resource/cleanup obligations are settled or explicitly owned within accepted policy. A STOP, partial proof or local-only green is not completion when real-store evidence is required.

Before handoff, run two fresh independent milestone-level full-source reviews plus a cumulative architecture/plan-drift audit. Check interfaces, dependency boundaries, locked decisions, backwards compatibility, migrations, resources, privacy, visual expectations and real user behavior. Compare the accepted entry tree to the integrated candidate, not only the last PR.

Provide the milestone review packet: exact entry/main/head/tree; cumulative PR/merge list; acceptance and G1–G8 matrix limited to this milestone's assigned rows; meaningful decisions and deviations; demo/real flow evidence; local and native test provenance; runtime/build/artifact identity; secrets/resource cleanup; limitations; next milestone readiness. Use `MILESTONE_READY_FOR_PRINCIPAL_REVIEW`, then stop before the next milestone.

Principal outcomes: APPROVED, CHANGES_REQUESTED or BLOCKED_EVIDENCE, bound to the candidate. Approval enables the next planned milestone when its entry/resource prerequisites hold. Corrections stay in the same milestone under the local delivery loop; return for principal review when the corrected milestone is ready. Approval is not merchant rollout or a new provider resource grant.

## 9. Exceptions and continuity

Only substantive exceptions interrupt the current milestone: missing owner inputs/permission, an actual locked-decision conflict, a safety/security incident, or an unresolved external mutation. Explain the smallest blocker, evidence, recommendation and exact required input; continue independent safe work. These exceptions do not restore per-PR principal review.

Read-only research that keeps returning UNKNOWN because native access was never granted must become a concrete resource request, not another sequence of near-identical STOP PRs. Exhaust equivalent safe local tools before treating missing optional tooling as an exception.

Maintain a short active state/index with milestone, exact entry/current refs, acceptance rows, remaining blockers, resource ownership, next actions and resume commands. Archive long historical status text without changing its bytes. Sessions may end for runtime/context limits: save a usable handoff and resume within the same milestone. Do not claim this chat or the agent works indefinitely/asynchronously without an actual running mechanism.
