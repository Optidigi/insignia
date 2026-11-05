# Agent maintainability source check

28 October 2026. Supporting primary-source research for the current maintainability review. This note makes no application change and does not assess the whole codebase. It checks what the sources actually recommend, separately from our proposed application to Insignia.

The evidence supports clear module ownership, explicit state, tests at meaningful interfaces and a small navigable documentation entry point. It does **not** establish a universal community standard combining journey maps with typed reducers, or a measured productivity gain for that combination.

## Matt Pocock's current guidance

GitHub's [main commit API](https://api.github.com/repos/mattpocock/skills/commits/main) resolved to `59db609eb1e18aaf59b63284d0e52255aff0c63c`, committed 27 October 2026. The links below pin that inspected revision rather than silently tracking future changes.

- Pocock's [How to make codebases AI agents love](https://www.aihero.dev/how-to-make-codebases-ai-agents-love), updated 26 February 2026, directly recommends deep modules, a filesystem matching the developer's mental map, small public interfaces, behavior tests and fast feedback. He presents navigability and reduced cognitive burden as benefits. This is practitioner guidance, not a controlled benchmark. It supports organizing related workflow decisions together; it does not prescribe a journey-map document or require reducers.
- [codebase-design](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/codebase-design/SKILL.md) defines depth as capability behind a small interface, and locality as concentrating knowledge, changes and verification. Its deletion test asks whether an abstraction removes complexity or merely moves it. Its [deepening reference](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/codebase-design/DEEPENING.md) rejects ports with no justified variation and recommends tests through the caller's interface. Splitting every handler into a separate wrapper is not the recommendation.
- [improve-codebase-architecture](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/improve-codebase-architecture/SKILL.md) explicitly prioritizes recently changed areas and observed navigation/testing friction. It flags pure functions extracted for testing when actual bugs remain in the callers. Pure transition tests therefore support, rather than replace, controller and browser tests.
- [to-spec](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/to-spec/SKILL.md) captures user behavior, decided interfaces, contracts, test decisions and exclusions. It prefers existing high-level test seams. It omits file paths and ordinary implementation snippets because they quickly age, with an exception for decision-rich prototype reducers, state machines and types. This supports a durable contract and a separately maintained code index.
- [wayfinder](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/wayfinder/SKILL.md) is specifically a planning map of unresolved decisions for work larger than one agent session. Each decision has one authoritative ticket; the map indexes rather than repeats it. This is different from mapping merchant or buyer runtime journeys. Citing it as proof that all applications need journey maps would overstate its scope.

## What supports typed state and reducers

Pocock's [TypeScript discriminated unions for frontend developers](https://www.totaltypescript.com/discriminated-unions-are-a-devs-best-friend) recommends explicit state variants with the data each variant actually permits, instead of unrelated optional fields. Its example uses `useState`; the type-modeling advice does not require a reducer or an AI-specific architecture.

His [use-fsm-reducer repository](https://github.com/mattpocock/use-fsm-reducer/tree/194071dd8af0af02d096539ce6737026ffa7d0e9) demonstrates tagged states/actions and state-specific transitions with separately declared effects. The latest `master` commit returned by GitHub was dated 22 March 2020. It is a historical illustration, not evidence that this dependency or effect-queue design is his current recommendation. The previously supplied YouTube-short transcript was not independently verified here, so it adds no new source claim.

For current framework guidance, [React's reducer guide](https://react.dev/learn/extracting-state-logic-into-a-reducer) recommends reducers when state updates spread across many handlers. It calls for pure transitions and actions describing interactions, and discusses debugging and isolated testing. It also says reducers add code and can coexist with `useState`. This supports choosing reducers for related workflow state, with ordinary local state for simple independent inputs.

## Maps and documentation need maintenance

OpenAI's [Harness engineering](https://openai.com/index/harness-engineering/) describes its own team's short `AGENTS.md`, linked repository knowledge, mechanically enforced architecture and documentation freshness checks. It reports that a giant instruction manual became stale and crowded out relevant context. It explicitly limits generalization of its team's autonomous results. This supports concise navigation plus maintained evidence, not treating documentation alone as proof of correctness.

Matklad's [ARCHITECTURE.md](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html) recommends a short map answering where behavior lives, coarse module relationships and architectural invariants. Keep frequently changing implementation detail elsewhere; revisit stable architecture periodically. This supports a small behavior-to-owner map, but not a duplicate exhaustive inventory that must mirror every function.

## Application to Insignia

Our inference is to use a compact journey/workflow index to connect observable behavior to its existing owner, invariants and executable checks. Keep the current specification authoritative for product and authorization rules. Use reducers where transitions are actually coupled. Keep effects and lifecycle coordination visible at the module's interface and verify the wiring through integration tests.

Whether Insignia already achieves that requires current code and test evidence. These sources cannot certify the repository, justify an application-wide store, or establish that more documents and more abstraction will improve maintenance.
