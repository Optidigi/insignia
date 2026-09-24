# <slice ID> — <single outcome>

Authorization: <principal prompt/verdict reference>
Milestone / gate: <M# / G# as applicable>
Prerequisites: <merged PRs and accepted evidence>
Base: <verified branch and SHA>

## Outcome

A single observable behavior or falsifiable platform question.

## Read first

Ledger clauses; implementation-plan sections; relevant source/tests; current gate evidence. Prefer precise pointers over the entire historical chat.

## Scope and contract

Allowed paths and shared-file owner. Define boundary inputs/outputs/invariants. State non-goals. Identify the one scenario demonstrating incremental end-to-end value. For spikes, state pass/failure before execution.

## Resources and permissions

Allowed development app/store/database/storage prefix; permitted mutations and cleanup; forbidden live resources. Native sandbox/tool policy; version requirements. Unknown resource identity means no mutation.

## Work and delegation

Ordered tasks; optional separate worker assignments with disjoint paths and context; integration point; explicit delegation limit. Only the orchestrator edits shared roots/locks/contracts/state.

## Verification

Executable acceptance cases, negative controls, real-platform evidence needed, commands discoverable from the checked-out scripts and required artifacts. Define which missing check blocks completion.

## Deliver and stop

One PR with tests, feature migration if applicable, compatibility notes and review packet. Update state; return actual URL/base/head and unresolved blockers. Stop before merge or another slice. Material contradictions go to principal/user with evidence.
