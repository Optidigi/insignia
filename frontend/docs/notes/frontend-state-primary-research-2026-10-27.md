# Complete frontend state research

27 October 2026. Root-led source and code research for an implementation plan awaiting owner approval. No application implementation, dependency installation, service restart or backend change was made for this research.

## Research and scope

The owner explicitly requested the complete current frontend, not a photo-picker pilot. The [full migration plan](../../architecture/frontend-state-migration-plan.md) supersedes the earlier pilot recommendation. Sequencing work does not reduce the completion scope.

Root personally inspected merchant editor/save/navigation/upload infrastructure, the production buyer reducer and acceptance/removal handlers, custom-element host, React designer/product-return composition, package scripts, project procedure, and the primary sources below. Two supporting Luna agents at xhigh supplied the [merchant inventory](frontend-state-merchant-inventory-2026-10-27.md), [buyer inventory](frontend-state-buyer-inventory-2026-10-27.md), alternative-design assessment and risk review. A child of the buyer agent checked application roots. Their reports supplement root research rather than replace it.

Root's [React prototype inventory](frontend-state-react-prototype-inventory-2026-10-27.md) separately maps document/cart/upload/return/positioning ownership. Independent reviews corrected conflated preview/production acceptance checks, missing buyer bootstrap outcomes, overlapping shared-file ownership, and the prototype's absent maintained interaction suite. Those corrections are incorporated in the full proposal.

## Pocock's current skills

Root retrieved and read official skill sources at commit `59db609eb1e18aaf59b63284d0e52255aff0c63c`, observed on 27 October. The checked-in project adaptations separately retain an older pinned source and govern local procedure. No skills were installed or overwritten.

| Source | Application to Insignia |
| --- | --- |
| [to-spec](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/to-spec/SKILL.md) | Synthesize conversation and inspected code into behavior, decisions, testing and exclusions. Prefer existing public test interfaces. Keep exact path inventories separate from lasting decisions. |
| [wayfinder](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/wayfinder/SKILL.md) | Set the destination and resolve architectural choices before implementation tasks. Distinguish unresolved questions from exclusions and record dependencies. |
| [codebase-design](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/codebase-design/SKILL.md) and [deepening](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/codebase-design/DEEPENING.md) | Hide workflow decisions behind a small meaningful interface. Keep external dependencies behind adapters. Test the interface used by callers. |
| [design it twice](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/codebase-design/DESIGN-IT-TWICE.md) | Compare materially different architectures before choosing. The plan compares feature reducers, actor/statechart runtime and an application store. |
| [implement-spec](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/implement-spec/SKILL.md) | Inform the later dependency-aware implementation/review process. This skill is not being executed before approval. |

These techniques are adapted to a local Markdown proposal and the project's [operating model](../operating-model.md). No tracker issue, branch push or external message was created. The approval hold comes from the owner's explicit instruction, not an extra skill checkpoint.

Root also read the project's adapted Pocock TDD skill. Its public-interface tests, meaningful red/green changes and vertical behavior slices inform implementation verification; this research task does not manufacture test failures for prose or require an extra seam-approval conversation.

The supplied [short](https://www.youtube.com/shorts/r8FYE2ZOj0E) describes separating rendering from pure event-driven decisions and testing those decisions outside a browser. Its transcript was supplied by the owner; the video page was throttled during earlier research. Pocock's experience of improved robustness is not a measured defect-rate or speed claim. His historical [use-fsm-reducer repository](https://github.com/mattpocock/use-fsm-reducer) illustrates the idea; it is not evidence that this package is his current preferred dependency.

## Primary guidance and conclusions

1. [React's reducer guidance](https://react.dev/learn/extracting-state-logic-into-a-reducer) recommends consolidating scattered related update logic, using actions that describe what happened. Reducers are pure next-state functions. Generic setter actions alone do not express valid workflow transitions.
2. [State-structure guidance](https://react.dev/learn/choosing-the-state-structure) recommends avoiding contradictions, redundancy and duplication. [Sharing state](https://react.dev/learn/sharing-state-between-components) gives each shared fact an owner. Insignia needs bounded owners, not a second product document, media store, upload lease or cart journal.
3. [Effect guidance](https://react.dev/learn/you-might-not-need-an-effect) separates user-triggered commands from external synchronization. Derived values should be calculated. [Synchronization guidance](https://react.dev/learn/synchronizing-with-effects) requires cleanup and stale-work handling. Insignia should retain explicit commands and lifecycle synchronization, with pure decisions beneath both, rather than a generic reducer-state effect queue.
4. [React useReducer](https://react.dev/reference/react/useReducer) requires purity and describes development Strict Mode checks. [Preact v10 hooks](https://preactjs.com/guide/v10/hooks/#usereducer) supplies the installed Preact 10 reducer primitive. Do not assume identical React/Preact lifecycle details. Pure transitions can work in both; hooks and adapters stay runtime-specific.
5. [Reset guidance](https://react.dev/learn/preserving-and-resetting-state) explains identity-dependent lifetime. Product, view, scenario, session and request identity need explicit rules. Resetting on every product-object reference change would also reset self-commits and break continued photo assignment.
6. [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) supports state/event variants and exhaustive handling. It does not validate network, storage or postMessage input. Keep runtime parsers.
7. [Redux's official style guide](https://redux.js.org/style-guide/#model-actions-as-events-not-setters) reinforces event vocabulary and purity. That supports the modeling choice without requiring Redux.
8. [Stately statecharts](https://stately.ai/docs/state-machines-and-statecharts), [actors](https://stately.ai/docs/actors) and [parallel states](https://stately.ai/docs/parallel-states) show what a runtime adds: hierarchy, independently active regions and actor lifetimes. The current documentation banner says v6 alpha. The [options research](state-machine-options-research-2026-10-27.md) separately verified stable v5 metadata. No v6 API is proposed. Ordinary reducers must still represent compatible conditions, such as a dirty draft during pending publication, with separate typed regions.

## Recommendation and limits

Use feature-owned typed reducers and explicit transitions with current React/Preact hooks and existing effects/adapters. Independent input/disclosure state stays local. This is a complete frontend architecture policy, not a requirement to replace every useState.

XState core is a valid alternative. Its actor lifecycle could help new nested long-running workflows. Current buyer request lanes/cart recovery and merchant save/publication already have effect and reconciliation owners. Replacing them with actor infrastructure would enlarge this refactor. No inspected requirement needs that runtime. Do not recreate an actor scheduler as a home-grown framework either.

An application-wide store fits poorly across Astro islands, theme custom elements and a separate React app. It would not solve stale results or unclear transitions by itself.

Code-specific controls required by the plan:

- Refine the existing buyer reducer rather than introducing a second store. Distinguish add/replace, renew, remove and repair. Removal completion can legitimately lack an accepted quote.
- Keep native cart locking, digest journal, fingerprints and read-after-write verification. Abort is not rollback. Never automatically redispatch an uncertain write.
- Claim consequential commands synchronously before effects. A disabled button or reducer rejecting completion cannot undo duplicate synchronous handler effects.
- Keep media readiness in the picker child. Parent owns assignment intent and targets, receives scoped observations and rechecks identity when committing.
- Do not call mutating preview history helpers inside reducers. Preserve one document/history owner. Real assignment is one semantic edit; no-op is zero; canceling the next picker preserves prior commits.
- Keep asset, preview and link expiry distinct. Renewal cannot extend original retention. Live resources, private URLs and capabilities stay in existing adapters with cleanup, outside traces and serialized snapshots.
- Validated server response observations may be reducer context. The browser still cannot authorize permissions, money, subscription, quotes or saved publication.
- Retain browser/resource and visual tests. Reducers cannot detect gallery 404s, clipped controls, bad focus or incorrect UI wiring.

This is planning, not proof of a passing refactor or native Shopify behavior. No application suite or benchmark ran for this research. Existing tests were inspected as behavior evidence. Implementation needs a fresh baseline, meaningful missing checks and affected integration tests. Expected benefits are clearer ownership and isolated feedback; performance or reliability gains must be measured rather than promised.
