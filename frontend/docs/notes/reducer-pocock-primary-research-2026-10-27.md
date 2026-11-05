# Matt Pocock on reducers, state machines, and AI coding

Research note · 2026-10-27

## Finding

Pocock’s short presents reducers as a useful tactic for interactive frontend logic when agents are writing or changing the code: represent behavior as state plus events, calculate the next state in a pure transition, and keep UI effects outside that transition. The transcript supplied with the task says this makes agent changes feel more robust and encourages him to use more reducers. That is his reported experience, not a measured result.

His current first-party `/prototype` guidance independently supports the underlying design move: for a state-model question, build a small pure module (a reducer, a machine, or plain functions), show the state after each interaction, and use it to expose edge cases. It says the validated logic can move into real code. The skill deliberately says the prototype has no tests; that guidance applies to throwaway exploration. Production transition logic should have tests at its public behavior seam, consistent with Pocock’s separate TDD skill and React’s requirement that reducers be pure.

## What the sources establish

| Point | Source and confidence |
|---|---|
| The supplied short describes reducer state plus events, a pure transition, separation from UI logic, independently fast tests, and Pocock’s impression that agent edits feel more robust. | The task supplied this transcript and linked [Pocock’s YouTube Short](https://www.youtube.com/shorts/r8FYE2ZOj0E). The video page was throttled during this research, so I could not independently verify the transcript against captions. Treat the quoted advice as transcript-provided, not independently transcribed. “More robust” is explicitly a subjective impression; no benchmark, bug-rate comparison, or controlled evaluation is given. |
| For unresolved state-model behavior, Pocock’s current `/prototype` skill calls for a small pure reducer, machine, or function module; step-by-step state visibility; and using a validated model in the real implementation. | [Pocock’s prototype skill documentation](https://github.com/mattpocock/skills/blob/main/docs/engineering/prototype.md). This is direct corroboration from his agent-workflow material. The skill also says a prototype is throwaway: no tests, production error handling, or persistence. |
| A reducer is a pure function of current state and action/event that returns next state. React recommends moving update logic out of event handlers when updates spread across many handlers or become difficult to follow. | [React `useReducer` reference](https://react.dev/reference/react/useReducer) and [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer). React describes the reducer as pure and the event handlers as dispatching descriptive actions. |
| State quality matters independently of whether a reducer is used. Group related state, avoid contradictory and redundant data, and keep the shape as simple as possible. | [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure). A reducer can centralize updates without fixing a poor or overcomplicated state model. |
| Reducers should not perform asynchronous work or side effects. | [Redux Style Guide](https://redux.js.org/style-guide/). This is Redux guidance, but it states the same purity boundary React documents. Keep fetches, timers, DOM work, and other effects in handlers/effects/middleware; return state from the transition and dispatch result events. |
| A finite state machine names a finite set of states and the events/transitions allowed from each; transitions are deterministic, and unmatched events can be ignored. | [Stately/XState transitions documentation](https://stately.ai/docs/transitions). This is the distinction between an ordinary reducer and a deliberately modeled finite-state flow. |
| Pocock has implemented a reducer/machine bridge in React. | His [use-fsm-reducer repository](https://github.com/mattpocock/use-fsm-reducer) describes the package as bringing “state machine code quality” to `useReducer`; its example models `pending`, `errored`, and `loaded`, accepts typed event variants, and separates effects. It is useful as an illustration, not evidence that every reducer is a finite state machine or that the package is his current recommendation. |
| Tests should verify behavior through a public seam. | Pocock’s [TDD skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md) says tests should survive refactoring and target agreed public interfaces. A pure transition makes direct input/output tests easy to write; that ease is a structural implication, not a claim that the short supplies a test-speed benchmark. |

## Reducer, finite-state machine, and XState are related but distinct

- **Reducer:** a function such as `nextState = reducer(currentState, event)`. It can update a counter, edit-form draft, selection, or other state without defining an explicit finite list of modes. React requires its reducer to be pure, but purity alone does not make it a finite-state machine.
- **Finite-state machine (FSM):** an explicit set of named states plus the events/transitions accepted from each state. Use a tagged union for the state and a transition table/function when mutually exclusive phases and legal transitions are central to the behavior. A reducer can implement an FSM, but not every reducer does.
- **XState:** a library and modeling/runtime toolkit for richer statecharts and actors. The official registry separately checked for the options note identifies v5 as the stable release line; the current documentation navigation flags v6 as alpha. Verify the installed version rather than mixing those examples. Consider that additional machinery when the flow actually needs nested or parallel states, guards, delayed transitions, invoked actors, or their associated tooling. It is not a prerequisite for using a pure reducer.

Pocock’s `use-fsm-reducer` is an example of the overlap: state-specific event handlers plus a tagged state shape are layered onto a React reducer API, while effects are returned separately. The repository’s own wording frames it as bringing machine qualities to `useReducer`, rather than saying the concepts are interchangeable.

## What this can and cannot do for agents

**Plausible benefits (inference from the cited design):** an explicit event vocabulary and one transition boundary give an agent a smaller, more reviewable place to change behavior; reviewers can enumerate expected transitions; a discriminated union can make certain invalid combinations unrepresentable; and a pure function can be exercised without mounting UI or invoking network/browser effects. These constraints can make agent edits easier to inspect and regressions easier to locate.

**Limits:** the sources do not establish that reducers improve agent quality on average, reduce defects by a known amount, or make tests fast by measurement. Agents can still encode the wrong requirements, omit a transition, mutate nested state, or add a reducer where simple local state would be clearer. Pure-transition unit tests validate only the cases covered and do not replace integration checks for rendering, dispatch wiring, effects, or persistence. A reducer also does not make state durable: React’s component state is in memory unless the application separately persists it. Read “persistent state” in the supplied transcript as state carried across events, not database/storage persistence.

## Actionable guidance

1. Keep simple, independent view values in local state. Reach for a reducer when several event handlers coordinate related updates, transition rules are scattered, or a shared transition boundary makes behavior materially easier to review. This matches React’s “choose the simplest structure that fits” guidance.
2. Use an explicit FSM shape when the UI has mutually exclusive phases or meaningful forbidden transitions: for example, `idle → submitting → success | failure`, with `retry` valid only from `failure`. Model status and associated data together so impossible combinations such as `isLoading && isSuccess` cannot be represented.
3. Keep the transition pure. Pass facts in as events; return next state. Put network calls, time, random values, browser APIs, and other effects outside, then dispatch success/failure events with their results.
4. Test production behavior at the chosen public seam. Cover expected transitions, boundaries, and ignored/rejected events that matter. A throwaway model prototype can be untested per Pocock’s prototype skill; once the model becomes production logic, give its behavior durable tests and add integration coverage for the UI/effect boundary.
5. Do not add a reducer just because an AI agent will touch the code. Prefer it when the complexity warrants the extra vocabulary and indirection; use XState only when its statechart/actor features solve a real flow problem.

## Sources reviewed

All substantive claims above are tied to first-party material: Pocock’s short and GitHub projects/skills, React documentation, Redux’s official style guide, and Stately/XState documentation. No secondary summaries were used as evidence. The short itself was not independently transcribed during this review.
