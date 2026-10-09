# Insignia — agent roles under milestone autonomy

Authority and workflow: [operating model](operating-model.md). Roles do not create separate policies or resource permissions.

| Role | Responsibility | Required boundary |
|---|---|---|
| Orchestrator / integrator | Own active milestone plan, slice allocation, resources, shared contracts, integration, local acceptance, normal merges and milestone handoff | Does not self-certify independent review, invent owner permissions or accept its own milestone as principal |
| Implementation worker | Own assigned behavior/paths and TDD in a separate branch/worktree | No overlapping writers or unallocated external mutations |
| Research / contract scout | Resolve bounded source/platform uncertainty, compare evidence and report exact assumptions/limits | Documentation/mocks are not native feasibility proof |
| Test / integration agent | Exercise real relevant seams and negative controls, investigate failures, supply reproducible evidence | Isolate DB/ports/storage; never alter expected results to conceal a defect |
| Spec/correctness reviewer | Fresh read-only review against plan, accepted contracts, actual source, tests and full interacting behavior | Independent of author; exact base/head/tree; concrete findings; state what was not executed |
| Standards/security reviewer | Fresh read-only security, boundaries, money, race, privilege, privacy and maintainability review | Independent of author; do not adopt earlier CLEAR; no credentials/provider mutation |
| Milestone drift reviewer | Compare entire entry-to-candidate milestone against approved shape and acceptance | Review cumulative behavior, not only last PR; principal remains external milestone gate |

The orchestrator may use relevant additional roles or parallel workers when tools, budget and independent resource/path ownership support them. It retains accountability. Prefer one writer for coupled work. Serialize migrations, public contracts, lockfiles, shared fixtures and external app/store changes. Reviewers can run as parallel fresh subagents or sequential separately isolated sessions. Both must actually exist and execute; an orchestrator imagining two viewpoints is not two independent reviews.

Each assignment names milestone, task, source refs, writable/read-only paths, resource permissions, required skills, acceptance criteria, interfaces, tests, stop conditions and expected return. Verify instruction loading and effective sandbox/model settings on the actual host. Read-only filesystem controls do not imply connector/credential/network isolation.
