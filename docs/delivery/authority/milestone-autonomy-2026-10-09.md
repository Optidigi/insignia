# Owner decision — milestone autonomy

Effective 9 October 2026. Source: the owner's latest instruction in the Insignia Rewrite project conversation. This is the current decision, not a claim that an earlier slice had this authority.

## Operative owner instruction

The owner requests milestone-by-milestone execution: the local agent handles implementation, testing, subagent review, slices, PRs and merges within each milestone; the principal reviews completed milestones M5, M6, M7 and onward against the full plan, architecture and established decisions. The instruction applies immediately to unfinished M5. The agent is enabled to use relevant skills, subagents and tooling and must have the full current plan and conventions locally.

The owner's explicit merge delegation is: “handles PR/slice review autonomously and has authority to merge. Only gated for milestones (m5, m6, m7, etc.).”

## Authority granted now

1. The local orchestrator owns all ordinary engineering execution inside the active milestone: decomposition, implementation tactics, research, test design, technical blocker resolution consistent with locked decisions, independent local reviews, PR acceptance, normal merges, integration and continuation to the next internal slice.
2. This includes current PR58 and any necessary governance-adoption PR. Neither needs a new external principal PR verdict. The orchestrator must verify the live candidate, review evidence and CI before merging. This package does not manufacture a principal approval of PR58.
3. The local orchestrator may appoint independent writer/research/test/reviewer subagents, choose supported tools and project-scoped skills, and maintain the current plan/conventions. Relevant changes remain locally reviewed and within resource permissions.
4. Local verification may clear technical execution gates inside an authorized milestone and resource envelope. Those gates no longer need a separate principal signature simply because an old slice said so.
5. The principal owns milestone acceptance: complete M5 -> principal review -> accepted M5 enables M6; complete M6 -> principal review -> accepted M6 enables M7, and so on. Do not start the next milestone before that boundary is cleared.

## What this supersedes

The delivery parts of older instructions requiring principal authorization for each slice, external principal review of every PR, owner relay of each technical outcome, and an external signature before every internal plan/collector/review cycle are replaced prospectively. Older “do not merge this successor” wording no longer prevents a locally accepted within-milestone merge. Preserve its historical meaning in the record.

The orchestration policy is to be maintained in `docs/delivery/operating-model.md`, with the matching delivery entry in the decision ledger and plan. Do not maintain competing active policies.

## What this does not change

Product scope, architecture locks, protocol bytes, exact-money rules, tenant/privacy/security invariants, gate acceptance criteria and provider/commercial facts remain binding. A merged blocker PR is not a completed milestone or safe production implementation.

This engineering/merge delegation is not a blanket resource grant. Existing owner allocations remain usable within their scope. Missing credentials, unallocated hosts/stores/storage, paid actions, destructive experiments, production changes, Shopify app-version/release/scope changes and merchant rollout still need the necessary explicit owner permission. After an allocation is granted, the orchestrator owns technical qualification and safe execution inside it; do not reintroduce principal approval for every step.

An actual conflict with a locked product/security/protocol decision, an incident, an ambiguous external mutation, or missing external resource authority may require an exception before milestone completion. These are substantive exceptions, not routine slice-review gates. Continue independent safe work and present one concrete decision/access request rather than another proposal-only PR loop.

## Immediate active milestone

M5 remains unfinished. Authorize the local agent to work toward its full original merchant configuration/preview/save/publication and G7 end state, including necessary lifecycle, worker, queue, native qualification and supporting safety corrections within the established architecture and owner-approved resources. Do not jump to M6 because M5 is blocked.
