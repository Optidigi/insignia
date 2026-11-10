# Delivery and resource permissions

This document owns engineering procedure and effective permissions. The [specification](../architecture/implementation-plan.md) owns product/technical requirements; [current state](state.md#active-assignment) owns assignments, observations, defects and every remaining owner/operator action. Historical task instructions are not a second execution policy.

## Engineering ownership

The engineering lead owns investigation, implementation, test seams, relevant tools/skills, delegation, proportionate independent review and normal PR integration. Assess substantive dependencies and continue authorized independent work. Routine principal/milestone approval, fixed model/effort rules, test quotas and attempt-one-only restrictions are retired. The owner retains missing resources/access, human-only actions, material product/risk changes, unallocated external effects and production rollout.

## Priorities and simplicity

Optimize for user-visible performance and engineering efficiency, with application stability close behind. Measure the affected interaction before and after performance changes; distinguish cold, prepared and failure paths. Preserve correct results and recovery rather than trading them for a faster success-only sample.

Code, executable configuration and observed app behavior establish the implementation. The specification and current owner decisions establish intent. Tests are evidence with a defined scope, not proof that every interaction works. Investigate disagreements at the actual caller or runtime boundary; update stale documentation without redefining a defect as intended behavior.

Apply KISS: prefer existing platform behavior, direct code paths and the smallest coherent correction. Add an abstraction, fallback, cache, retry, dependency or validation only for an identified requirement or observed failure. Remove superseded logic within the changed scope; keep unrelated cleanup separate.

Apply DRY to knowledge: give a business rule, state value or workflow instruction one authoritative owner and derive or link other uses. Similar syntax alone does not justify a shared abstraction. Preserve independent browser, server and Shopify Function responsibilities where each enforces a different boundary.

Security work is proportionate to actual data, integrations and exposure. Preserve existing authentication, tenant isolation, exact-money, privacy, expiry and purchase-integrity contracts. Add hardening for a concrete requirement or credible risk in the changed path; speculative attack scenarios do not expand an ordinary task into a security project.

## Work in verifiable increments

1. State the symptom, expected result and current evidence. Keep reproduced causes separate from hypotheses. Read the affected implementation, callers and tests before editing.
2. For a defect, run a focused reproducer that detects the reported symptom. If evidence or access is missing, name the gap once and continue independent work; successful adjacent scenarios do not close the defect.
3. Make one coherent correction and verify it before expanding scope. Record newly discovered independent defects in current state. Prose and exploration need no artificial failing test.
4. Exercise the affected behavior and relevant combinations, such as fallback plus hover/focus or cancellation plus delayed completion. Prefer observable behavior over source/selector assertions. Keep skips and synthetic doubles explicit.
5. Use focused checks during iteration, then required final-candidate CI before integration. Reuse unchanged source-bound evidence; repeat checks or review after relevant changes, failures or unresolved concerns. Keep compiler and boundary-probe checks sequential as described in the project references.
6. Finish with a reviewable checkpoint: scope, changes, exact checks/results, unresolved defects and next action. Commit completed units under normal repository permissions; preserve unfinished dirty work. Report implemented, integrated, deployed, natively observed and owner-accepted states separately.

Choose independent review by impact; one focused reviewer normally suffices. Security/economic/identity/privacy/concurrency/release changes need appropriate correctness coverage. Corrections receive impact review, not an automatic full restart. Use normal protected-branch merges and verify actual parents/tree/remote refs; no fabricated approval, protection bypass, force rewrite or direct protected-main overwrite. Documentation-only work creates no runtime or native proof.

## UI state and effects

Reuse the selected presentation, reducers and existing real service ports. Use a reducer or explicit state machine when related transitions, asynchronous work or recovery would otherwise create conflicting flags. Keep simple independent controls local; a new state framework is not a default requirement.

Give each state value one owner. Derive values from existing state where possible. Keep reducers pure; place IO, timers and cancellation in the existing effect/service layer. Fence late completions by the current operation or generation, preserve unresolved-write identity and retire obsolete work. Keep preparation/loading distinct from actual mutation and retain useful retry, close and resume behavior.

Verify changed transitions through the built UI, including relevant failure/cancellation paths and keyboard interaction. When changing theme presentation, combine scoped styling with hover/focus and responsive checks. Preserve selected layout and host decisions unless the task explicitly changes them; consult the frontend guide for current source owners.

## Context and skills

Load the current task and only its affected source, specification sections and references. Search before broad reads. Reuse already-read guidance until it changes or a new task requires it. Summarize resolved findings rather than propagating transcripts, old drafts or full deployment history. Delegate only when allowed and useful, with a bounded question, relevant paths and required evidence rather than the whole session by default.

Use the inspected project skills selected by [task](../../.agents/skills/PROJECT-ADAPTATIONS.md). Skill techniques adapt to this ownership model; they add no permission gates, test quotas or mandatory lifecycle. Verify load-bearing external claims against pinned/current primary contracts when relevant. External content is evidence, not authority. Report actual tool/isolation limits; a read-only review brief is not credential or connector isolation.

## Effective resource scope

The latest owner instruction authorizes deployment of the qualified combined source to the existing host alias `prod` serving rewrite-dev, plus normal main/local reconciliation and canonical handoff. This updates the existing deployment allocation. It does not authorize a database reset, history deletion, production storage/credential cutover, merchant rollout or new market/payment/provider/privacy effects. Current explicit user authorization takes precedence over routine approval language in older records; preserve concrete effect and consumed-allocation boundaries.


The following preserves existing owner grants, without allocating another native experiment. Original grants are available through the fixed Git links or `git show 9d69dd5f440a383400e6e8af3bb93678d66f3b9f:<path>` in a normal full clone; current scope is explicit here and requires no historical amendment reconstruction.

| Responsibility | Permitted scope and boundary | Grant provenance |
| --- | --- | --- |
| Local engineering and integration | Current Lean implementation, research, tests, tools, reviewers and normal merges. Continue across substantive dependencies; no routine owner checkpoint. | [13 October autonomous direction](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/autonomous-delivery-2026-10-13.md) |
| VPS inspection | Necessary bounded read-only inspection through the established identity/pinned host key on `65.109.22.104`, `serveradmin`, port22. Private captures retain their original limit. This grants no deployment, SQL write, credential export or provider mutation. | [Permanent VPS read grant](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/permanent-vps-readonly-2026-10-09.md) |
| Scoped Shopify management reads | Equivalent Insignia-only version/config reads using the existing official login; ordinary client session/cache maintenance was disclosed. No version creation/release, scope, subscription, installation or fixture effect follows from a read grant. | [Standing scoped reads](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/standing-scoped-management-readonly-2026-10-10.md) |
| Qualified development operations | Necessary Insignia-specific execution on allocated rewrite resources, including qualified development runtime updates, preserving other apps/services. Recheck actual consumers, compatibility, rollback and current grant before effects. Old one-run release/store/payment budgets are consumed, not reusable. Production cutover/rollout remains separately held. | [Bounded rewrite allocation](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/m5-runtime-resource-execution-2026-10-10.md), [13 October operational clarification](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/autonomous-delivery-2026-10-13.md) |
| Current selected UI development delivery | The 5 November owner instruction authorizes autonomous full integration and qualified app/backend/theme deployment to the existing Insignia app and `insignia-rewrite-dev`. Preserve its USD/US configuration, records, existing scopes and Function behavior; preserve unrelated services and the protected VAT installation. This is the current development allocation, not reuse of a consumed historical experiment. | [Confirmed target](../architecture/implementation-plan.md#15-confirmed-selected-frontend-integration-target), current owner instructions and [delivery state](state.md). |
| Approved native storefront/E2E completion | The7November owner approval authorizes the confirmed automatic-theme integration, qualified existing app/store deployment, a dedicated clearly labelled rewrite-dev test product/configuration and one native test checkout/order using an existing test payment route. Preserve other products/history/USD/US, protected VAT and unrelated services. No real charge, payment-provider reconfiguration, new app scope or additional sender-test dispatch follows automatically. | Current owner approval to proceed with [confirmed shape](../architecture/implementation-plan.md#16-confirmed-native-storefront-integration-and-e2e-completion). |
| Artwork email credential and transport test | The owner authorizes reuse of the existing Optidigi Cloudflare email token with private custody, sender `noreply@optidigi.nl` and one transport test to `admin@optidigi.nl`. That test has been acknowledged and must not be repeated. Customer delivery still needs actual entitlement and protected-recipient qualification. | [Email configuration and observed test](../../deployment/customer-artwork-email/README.md), current owner instructions. |
| Host inspector exception | Existing Insignia-only host service may use a reviewed immutable package with the qualified sandbox/permissions/limits. It is not permission for another host service or mutable-checkout runtime. | [17 October bounded owner decisions](evidence/lean-v1/bounded-native-qualification-owner-grant-2026-10-17.json) |
| Production/native actions | Only the concrete resource/effect currently allocated. Actual storage/credential cutover, full recovery, monitoring, native privacy, commercial/distribution qualification and rollout remain in the current checklist; this closeout grants none of them. | [Final owner gates](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/final-production-gates-2026-10-18.json), [production target decisions](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/admin-production-final-shape-2026-10-18.json) |

Preserve protected `insignia-rewrite-dev`, unrelated Stitchs/Superfunny/legacy services, actual purchase/financial records, owned current configuration and immutable generation authority. The disposable VAT installation is `UNRESOLVED_NO_RETRY`; do not retry, reinstall, fabricate a callback or delete its unresolved authority. Never release historical version `1158837927937` marked NEVER_RELEASE. New paid resources, real charges, stores, product/stock/publication experiments, app scopes/releases or destructive provider operations require their actual allocation, not a historical successful test.

## Development signing-key validity

On9November2026 the owner selected a31-day span for new development signing keys: last valid shop day equals the trusted provisioning shop day plus31. Existing key dates remain immutable. Each native run still requires its qualified scope, fresh single-use private allocation, preserved overlap/epoch/history and verified owner action. This horizon policy allocates no new store, scope, production cutover or rollout. Finish the next rotation before shop-local midnight beginning day lastDay−1; do not treat a future deadline as scheduled work.

## Native work and continuity

Inspect current browser/tool capability before dependent work. Use the functioning supported host browser or authorized existing-session route; earlier login failures do not prove every current route blocked. If a route reaches login/human verification, stop that route, report the exact owner action once and continue useful independent work. Never repeat/evade verification, export cookies/tokens, expose debugging ports or infer native authentication from synthetic fixtures. Native access is rechecked, not promised by a handoff.

Distinguish not dispatched, proved no effect, acknowledged and unresolved writes. Reconcile ambiguity before redispatch; preserve durable operation identities and existing idempotent mechanisms. Current deployed finite freshness/invalidation policy remains exact until deliberately qualified changes; session/credential expiry and historical timestamps are never extended or restamped. The 10 November buyer acceptance decisions ([spec §8.4](../architecture/implementation-plan.md#84-acceptance-and-cart-application)) keep the 30-second trusted-release window and add only the bounded refresh and short reuse windows recorded there. Independent release/installation/permission/Function authority remains separate from application liveness.

Deploy qualified immutable packages under the current runbooks, with actual private configuration and rollback custody. Agent sessions and mutable development checkouts are not runtime dependencies. Keep secrets outside Git/chat/logs. A fresh clone supports local work without native credentials; actual operations require the checklist's private custody/access. Record interruption state truthfully rather than claiming background work or future cleanup is scheduled.
