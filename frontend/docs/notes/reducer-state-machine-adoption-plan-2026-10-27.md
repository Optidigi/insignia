# Reducers and state machines for Insignia

**Superseded proposal:** the owner requested complete frontend coverage rather than a pilot. Use the [complete frontend migration plan](../../architecture/frontend-state-migration-plan.md), awaiting approval. This earlier note remains as research history, not the current implementation scope.

Research and proposed adoption plan, 27 October 2026. No application code, dependencies, runtime services, merchant records or frontend designs changed in this research turn.

## Recommendation

Adopt small typed reducers for coupled frontend workflows, using explicit state-machine rules where transitions matter. Start with a preview/model pilot of the owner-facing merchant editor's photo-picker session and assignment controller. This pilot lives in test-support preview code and does not refactor the shipped merchant editor. Use the existing Preact hooks and pure model functions. Keep independent local state simple. Do not install Redux, XState or Pocock's historical use-fsm-reducer package as a prerequisite, and do not convert the entire editor into one global machine.

Three independent Luna agents at xhigh investigated Pocock's first-party material, Insignia's code and the library/effect tradeoffs. Their notes support this synthesis: [Pocock sources](reducer-pocock-primary-research-2026-10-27.md), [code audit](reducer-insignia-code-audit-2026-10-27.md), [options](state-machine-options-research-2026-10-27.md). This is a proposed engineering direction, not an implemented refactor or owner acceptance.

## What Pocock is recommending

The supplied [video transcript](https://www.youtube.com/shorts/r8FYE2ZOj0E) argues for moving frontend decision logic into reducers/state machines so agents can change and test the behavior outside browser rendering. His description of greater robustness is personal experience, not a measured defect reduction. The video page was throttled during research; the supplied transcript is the evidence for that particular clip, not independently retrieved captions.

First-party corroboration includes his [typed reducer teaching](https://www.totaltypescript.com/tutorials/react-with-typescript/hooks/typing-state-and-actions-for-usereducer/exercise), [use-fsm-reducer example](https://github.com/mattpocock/use-fsm-reducer), and [current prototype skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md). The latter suggests pure reducer/machine/function models for exploring behavior. Its throwaway-prototype instructions are not a reason to omit tests from maintained application logic. His [TDD skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md) supports behavior tests at public interfaces; Insignia's inspected local adaptation continues to govern the project's test workflow.

A reducer computes next state from current state and an event. A finite-state model additionally names valid modes and decides which events are legal in each mode. A reducer can implement this without a library. XState adds a runtime for statecharts and actors. These are related choices, not interchangeable names. David Khourshid's first-party [Redux is half of a pattern](https://dev.to/davidkpiano/redux-is-half-of-a-pattern-1-2-1hd7) explains why an event switch alone is insufficient: the current state must also constrain the transition.

The relevant official guidance is consistent: [React reducers](https://react.dev/learn/extracting-state-logic-into-a-reducer) consolidate update rules and can be tested directly; [state structure](https://react.dev/learn/choosing-the-state-structure) groups coupled values and avoids contradictory or duplicated facts; [Preact already provides useReducer](https://preactjs.com/guide/v10/hooks/#usereducer). This supports an incremental change in the current stack.

## What exists in Insignia

- The production buyer frontend already has `buyerReducer` in `apps/storefront/src/customizer.tsx:46`, consumed by useReducer at line162. Its phase-based model is not yet a fully constrained state machine: optional config/proposal/accepted data and a general phase event allow combinations the type system does not distinguish. This is a modeling opportunity, not evidence of a reproduced checkout defect. Add/replace, remove, empty-cart completion and repair need different facts; do not require an accepted quote for every completion state.
- `createRequestLane` in `apps/storefront/src/buyer.ts:85` already aborts earlier work and checks generation ownership. Retain that protection instead of reimplementing it in every component. It is also covered by a focused stale-response test.
- `applyGeometryCommand` in `packages/visualizer/src/geometry.ts:342` is an existing immutable command interface with a baseVersion check. Reuse it for renderer operations rather than creating a competing geometry store.
- The owner-facing merchant placement workspace lives in the local preview, `apps/web/test/admin/support/placement-workflow-preview.tsx`. Its photo open/confirm flow coordinates target IDs, selected images, staged media, processing/readiness, preview mode, notice and focus across several setters around lines378–418. Its `setProduct` at line128 owns draft pruning and one history commit. The pure assignment, next-unassigned and usage helpers are already useful building blocks.
- Production `apps/web/src/islands/MerchantConfigEditor.tsx` is a different implementation, with real save conflict/ambiguous recovery and publication operations. A successful preview refactor will not automatically migrate or qualify it.
- The polished React buyer prototype is the sibling `designer-prototype/src/designer.tsx`, not the production Preact customizer. Share pure behavior only where the product contracts are actually equivalent. Do not import preview fixture code into production to create superficial reuse.

Line references describe the inspected checkout on this date, not a permanent interface.

## Preview/model pilot: photo selection and assignment

Keep the UI and workflow behavior unchanged. The goal is fewer places an agent must coordinate when changing behavior.

Model the picker intent as one discriminated state: closed, adding views, replacing a captured view, or assigning an image to captured variant groups. An open session carries its identity, owning product/view/targets and appropriate selected image IDs. An assignment target is single-group or explicit same-image bulk. Next is unavailable for bulk. The closed state cannot retain an active target or eligible selection.

Keep asynchronous media ownership in the existing PlacementImagePicker child: it already owns upload processing, per-image load status, retry attempts and stale-callback guards. Do not mirror those records in the parent reducer. The parent owns intent/targets and controlled selected IDs; the child reports eligibility for the exact session and selected-image identity. Treat this as a scoped observation, not another image-status system. A late ready/busy callback cannot authorize a new selection. Derive selected count and next target instead of maintaining copies. Use tagged unions for meaningful operation statuses and exhaustive event handling, as supported by [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).

At the parent workflow interface use meaningful events such as picker opened, photo chosen, selection eligibility observed, use requested, use-and-next requested and picker cancelled. Image loaded/failed/retry events remain under the child media owner. A setter-shaped event for every old useState value would only move the complexity. Events from obsolete sessions or image attempts must leave the current session unchanged. Unsupported transitions must be explicitly ignored or rejected according to the public contract; ordinary user mistakes should not crash rendering.

| Event and current condition | Intended result |
| --- | --- |
| Open for Black / Front | Capture explicit target and current photo, if assigned. No colour/orientation inference. |
| Choose an image that is still loading | Preserve the candidate selection if the current UI permits it, but confirmation remains unavailable until the exact current image loads. The current implementation disables new pending-image selection; preserve that behavior in the pilot. |
| Current selected photo fails | Preserve the existing assignment and choice, disable confirmation, offer Retry or another photo. |
| Retry then an earlier attempt completes | Ignore the stale attempt; it cannot mark the current choice ready. |
| Use, with valid loaded image and current targets | Commit one domain change through the existing draft owner, record at most one Undo step for a real change, none for a semantic no-op, then close and return focus. |
| Use and next succeeds | Commit once, then advance only to the next unassigned group in this view. Start a blank choice; preserve every existing assignment record. |
| Cancel after two successful uses | Discard only current uncommitted selection/upload staging. Keep the two completed assignments. |
| External product identity, view, grouping or picker session changes | Cancel/invalidate relevant session work. Late results cannot affect the new target. The session’s own successful assignment must not invalidate its Use-and-next continuation. |
| Duplicate confirm arrives after closing/advancing | Ignore the old session/target event. Do not record a second assignment/history step. |

### State ownership and effects

The photo-session reducer must not acquire a second authoritative copy of the product, saved baseline or history. The editor continues owning the document and history; renderer/DOM elements, AbortControllers and object URLs stay in adapters/refs. Pure helpers retain domain responsibility for image assignment, grouping and alignment.

Use one event interface for the photo workflow, for example handlePhotoEvent(event), and selectors for its current intent, targets and confirmation eligibility. The pure reducer is the maintained transition interface. Keep the existing synchronous commit handler as its imperative adapter, with a named confirmation seam tested alongside it. A new hook/controller module is only warranted if it hides this coordination behind that small interface; do not add a pass-through wrapper around the old setters. Its confirmation handler validates the latest session and current draft, computes the candidate using existing pure helpers, calls the existing draft commit once, then sends the confirmed/advanced session event. Do not advance or report success before the commit is accepted. Use the same path for Use and Use-and-next. Before calling the document/history commit, synchronously claim the confirmation token for the current session and target. A second invocation from the same rendered controls must fail that claim even before the framework rerenders. Revalidate current ownership before the claim; permit a fresh claim only for a new legitimate target/selection attempt, with explicit failure/retry rules. This is local at-most-once handling, not a claim of exactly-once network execution. A reducer ignoring duplicate completion events is too late to prevent an already executed commit or focus/advance effect. During migration, test this combined public workflow seam so a correct session reducer cannot hide double commits or missed document updates. This is bounded orchestration, not a new global command framework. Do not invalidate the session from an effect watching the whole product object: the workflow’s own assignment changes that object. Distinguish an expected commit in the active session from an external context/grouping change.

Keep the reducer pure: no fetch, sessionStorage, DOM query, focus, random ID generation, timers, or calls to the currently mutable history helpers. Assign IDs/timestamps outside and include required facts in events. Run user-triggered work from the controller/handler; use effects for genuine external synchronization and cleanup. Do not store commands in reducer state and replay them from a generic useEffect queue. React's [effect guidance](https://react.dev/learn/you-might-not-need-an-effect) makes this distinction explicit. Async completion events carry session/request identity, not just success=true.

Aborting a request and ignoring its result does not prove a server mutation was rolled back. The future production save/cart pilot must retain command identities, uncertain-outcome reconciliation and authoritative backend checks. Browser state does not grant access, validate prices or establish publication.

### Pilot verification

Write a short state/event table and invariants before editing, then preserve the existing manual-assignment browser tests. Add pure event-sequence checks through the maintained reducer interface and controller tests around the existing document-commit callback. Use independent literal expectations rather than mirroring implementation branches. Critical cases are Cancel, Use-and-next, last target, same-image bulk, per-step Undo, stale target/media completions, retry independence and mutation preservation. Invoke the confirmation controller twice synchronously before any render flush and assert only one commit and one advance/focus outcome; a transition-only duplicate-event test cannot establish this.

Keep browser coverage for dispatch wiring, upload decode, modal close, focus, native Polaris actions, unsaved navigation and actual screenshots at 1440/390/320. Reducer tests cannot prove those. Measure the baseline and pilot's focused test duration and changed-handler review surface rather than claiming a speedup from architecture alone. Acceptance means no UI change, one owner for each state fact, at most one commit per confirmation and one history entry only for a real draft change, no stale media authorization, passing existing scenarios and a smaller coherent behavior interface.

The gallery404 incident would not have been prevented by a photo reducer. Its HTTP asset-path regression and visual load check remain necessary. The removed matching feature also shows that correct state transitions do not establish product usefulness. Product/design review remains independent.

## Follow-on order

1. Preview/model photo-picker pilot, preserving the latest manual flow. Production adoption remains a separate implementation decision with contract and integration checks.
2. Editor interaction modes: placement editing, movement-area editing, drawing, measurement and preview. Define real exclusions without forcing compatible conditions into one flat enum. Keep high-frequency drag/zoom refs and renderer commands out of a global reducer.
3. Contextual method/price dialogs and production save/publication state, as separate bounded projects. Product draft editing and publication can coexist; a single status enum must not falsely make them exclusive. Preserve exact unsaved/ambiguous/conflict semantics and existing backend command identities.
4. Buyer review/accept/apply/repair, building on its existing reducer and request lane when the production frontend integration is being addressed. Keep quote expiration, consent, accepted history and native cart reconciliation authoritative. This is the higher-consequence candidate and should not be the first learning exercise.

Do not refactor Home, Settings cards, independent search fields or simple disclosure booleans merely to increase the reducer count. Server query data, route filters and long-lived accepted records also have their own owners.

## When to consider XState

Default to plain typed reducers. Evaluate a pinned stable XState release only when a specific workflow needs nested/parallel lifecycles, invoked services, delayed transitions or inspection/model-path tooling that would otherwise need substantial hand-written infrastructure. Compare a small equivalent implementation and integration cost before choosing it. There is no dependency addition proposed today.

Version caution: current Stately documentation displayed v6-alpha navigation during this research. The options researcher separately checked the official registry and found stable latest 5.33.3 versus alpha 6.0.0-alpha.70. Do not mix APIs from those versions or adopt an alpha by following an unversioned documentation example. The source/verification details are in the options note.

## Suggested agent working rule

Proposed wording for a future scoped project instruction, not installed in AGENTS.md during research:

> For frontend workflows with coupled updates or invalid state combinations, define typed states, meaningful events and allowed transitions before changing the UI. Keep transition rules pure and reuse existing domain helpers. Give every state fact one owner. Correlate async results with the active operation. Test important event sequences at the maintained workflow interface, then verify browser wiring and pixels. Use simple local state for independent UI values. Do not add a state-machine library or rewrite unrelated screens without a concrete need.

For parallel agent work, give one agent ownership of the event/state contract and another independent sequence/invariant review. A UI adapter agent can implement the agreed contract without adding private flags around it. Review both the model and its actual integration, not just whether a reducer file exists. Event logs for local debugging should omit capabilities, artwork bytes/URLs, customer details and full draft payloads; reducers do not justify new persistent telemetry.

## Independent proposal review

The Luna options researcher reviewed this plan against primary sources and caught a real gap in the initial proposal: guarding a duplicate reducer event after a document commit cannot prevent duplicate handler side effects before rerender. The plan now requires a synchronous confirmation claim and an integration-level duplicate-invocation check. The reviewer also required the pilot to be labeled explicitly as preview/model work, since the production merchant editor is separate. These corrections are part of the proposal, not implemented fixes.

The independent code auditor also caught duplicate media ownership in the draft plan and an overly broad product-change invalidation rule. The final proposal leaves image loading/retry/upload state in the existing picker, reports only scoped eligibility to the parent, and permits the session’s own assignment commit to advance to the next target. No-op reassignments correctly have no Undo entry. The event interface and existing synchronous commit adapter are preferred over an additional generic controller layer.
