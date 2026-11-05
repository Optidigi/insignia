# Frontend agent maintainability review

Owner source preference, 28 October: the owner rejected OpenAI and Anthropic as architectural authorities for this assessment. The [Matt Pocock video and implementation recheck](pocock-video-implementation-recheck-2026-10-28.md) supersedes this note's source basis and recommendation order. The source inspection and test observations below remain historical evidence; the proposed journey map is optional, not a practitioner-mandated next step.

28 October 2026. Frontend-focused source inspection and current primary-source research. No application code, route, dependency or product behavior was changed. This is a maintainability assessment, not a new whole-system correctness or security certification.

## Verdict

The state architecture is a sound foundation for continued frontend work: workflow decisions have named owners, explicit events, guarded transitions and executable checks. Overall frontend maintenance is improved but not finished. Large orchestration/rendering files, the split between production and polished preview implementations, and noisy broad checks still increase the effort required to make a safe change.

A compact behavior-to-owner map is justified. Its particular format is our application of the sources below, not a universal community requirement. It should explain where to work and what must remain true; it should not duplicate every transition from the reducers.

## Primary-source check

- OpenAI's [harness engineering account](https://openai.com/index/harness-engineering/) describes a short agent entry file, an indexed repository knowledge base, architecture checks and documentation freshness. It supports navigable context with executable constraints. Its reported team results do not measure Insignia or establish a universal productivity gain.
- Matt Pocock's [agent-friendly architecture article](https://www.aihero.dev/how-to-make-codebases-ai-agents-love) recommends cohesive modules with small interfaces, navigable structure and behavior tests. That is different from splitting every function into a new file. His current source and its qualifications are checked in the [supporting source note](agentic-maintainability-source-check-2026-10-28.md).
- Anthropic's [current best-practice guidance](https://code.claude.com/docs/en/best-practices) recommends concise project-specific context and checks agents can run to establish whether their work is complete. Rules requiring consistent enforcement belong in tooling rather than prompts alone.
- [React's reducer guidance](https://react.dev/learn/extracting-state-logic-into-a-reducer) supports consolidating coupled updates into pure transitions while retaining ordinary local state where appropriate. This is general frontend design guidance, not evidence that every input needs a state machine.
- Matklad's [architecture-map guidance](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html) supports a short overview of coarse modules, relationships and invariants. Frequently changing implementation detail should stay elsewhere. Stable symbol names and checked references are preferable to a second exhaustive description of the code.

## What I checked in Insignia

Read the current specification, agent entry, README, delivery ledger, selected state models and callers, and the frontend check runner. Inspected the largest active merchant/buyer source files and the locations of production and polished implementations. Used the completed independent-review receipts as historical evidence, rather than pretending they were new audits during this check.

Freshly ran `corepack pnpm test:frontend:models` under Node 24.21.0: **70 passed, zero failed, zero skipped**, reported test duration 384ms. This checks repository models/controllers, not the separate buyer's browser/runtime. No broad browser rerun was needed for this read-only assessment.

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Workflow ownership | Orders, buyer, save/publication, Methods, upload and exports expose named states/events and pure transitions. The save and publication regions can coexist. | Stronger locality and fewer implicit state combinations. |
| Effect and resource ownership | Requests, exact command identities, abort/epoch checks, DOM, private URLs, renderer and storage remain in adapters/controllers. | Useful separation; browser/controller tests remain essential because pure-model tests alone miss wiring errors. |
| Validation feedback | Fast model command, strict compiler coverage, source checks and targeted browser suites exist. Previous migration receipts include independent correction/review passes. | Good local feedback. The broad default pass/fail signal still needs maintenance. |
| UI/orchestration size | `MerchantConfigEditor.tsx` has 3,245 lines; the polished placement coordinator has 3,832; the sibling designer has 1,792. These files mix substantial rendering and effect coordination. | File length alone is not a defect, but the observed responsibilities still require substantial context. Extract cohesive panels and lifecycle owners when working in those areas. |
| Current implementation discovery | Polished merchant workflows live in `apps/web/test/admin/support`; the polished buyer is a separate sibling directory. Persisted editor and production buyer have different contracts. | Easy for a new agent to mistake active UI for test scaffolding or edit the wrong implementation. Existing inventory/coverage notes help, but one concise current map is missing. |
| Agent entry and documentation | `AGENTS.md` is short and points to authoritative documents. README has verification commands. The 298-line current-state file contains many dated handoffs, and the entry file still names a particular next presentation assignment. | Good progressive-disclosure foundation. Clarify current versus historical instructions and do not let an old assignment compete with the live task. |
| Portability | Full frontend verification requires an explicit absolute path to the separate buyer and refuses to silently skip it. | Honest coverage guard, but additional setup and source assembly remain necessary outside this repository. |

## Remaining test debt

The completed migration record identifies 24 broad browser failure conditions reproduced against its preserved baseline, plus 123 identical baseline/current Polaris presentation diagnostics. I did not rerun or reclassify those here. They cannot be described as passing tests or assumed harmless merely because they predate the migration. See the [implementation and evidence record](frontend-state-implementation-2026-10-28.md).

This matters for agent work: an agent needs to distinguish a new regression from a stale assertion or an accepted pattern rejected by an outdated rule. Restore an accurate baseline by inspecting each intended behavior and correcting the appropriate code, assertion or narrowly justified policy. Do not make checks green by disabling them or accepting arbitrary new failures.

## Recommended order

1. **Restore trustworthy broad verification.** Keep the fast checks. Resolve the known broad failure conditions and presentation-rule mismatch against intended current behavior. This improves the feedback signal for every subsequent feature.
2. **Add one concise current frontend map.** For each merchant/buyer journey, identify its entry route, UI owner, model/controller, persistence authority, critical forbidden behavior, recovery path and relevant checks. Explicitly distinguish production, polished simulation and the separate buyer. Link to existing sources of truth rather than repeating business requirements.
3. **Decompose the observed editor hotspots incrementally.** Keep one workflow/document owner while extracting cohesive rendering panels and bounded adapters. Do not move coupled state into several competing local owners, or split files solely to satisfy an arbitrary line limit. Retain characterization tests while changing structure.
4. **Clarify eventual preview promotion and source assembly.** Record which implementation future frontend work should target, and how its tests run. Moving or promoting preview code should be a deliberate integration task under its actual contract, not an automatic cleanup that introduces backend persistence or merges incompatible workflows.

The proposed map would make missing recovery states and cross-page dead ends easier to audit. It would not discover unrecorded customer needs by itself. Product requirements and realistic user journeys remain necessary inputs.

No numerical improvement in agent productivity or guarantee of complete agent understanding is claimed. The observed gains are explicit ownership, isolated executable rules and a faster local check; remaining friction is concrete and addressable without another state-management rewrite.
