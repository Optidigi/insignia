# Insignia Rewrite — M8 agent continuation

Continue the existing `Optidigi/insignia` project. The attached `PRINCIPAL-DECISION.md` is the M7 engineering verdict and M8 authorization. This prompt executes that decision; it does not add a competing operating policy.

## Authority and entry

**M7_ENGINEERING_SHAPE_ACCEPTED / NATIVE_ACCEPTANCE_DEFERRED**  
**M8_ENGINEERING_AUTHORIZED**  
G1–G7 native acceptance and merchant rollout remain unpassed.

Reconcile live PR99/main and any existing local work before implementation. The reviewed checkpoint is:

- M7 entry / PR99 base: `31b92db714fc1bb90f4f2b417361c58c0deb2cf4`
- Final PR99 head: `6cc2b0c45942e80e608fab8aef9a5ce38d59aad2`
- Integrated commit: `3ae4b8505d4c383fbb874694ef870454b6a074ef`
- Integrated tree: `931cd3fb3d7809feeb0d2043646c1fe7642124f2`

PR99 is already merged. Verify rather than repeat its merge. Treat these refs as the accepted checkpoint, not a reset target; preserve legitimate newer work and avoid duplicating completed implementation.

Read current `AGENTS.md`, the complete `docs/architecture/implementation-plan.md`, `docs/architecture/decision-ledger.md`, `docs/delivery/operating-model.md` and `docs/delivery/state.md`, plus affected source and the M7 engineering packet. Keep the complete current plan locally available. Record this principal decision and make M8 the active engineering milestone through the existing workflow. There is no new governance-adoption exercise or planning-only principal gate.

## Deliver M8 — purchase snapshots, artwork work and refunds

Build the planned flow:

**Verified Shopify order facts → complete authorization-set binding → immutable purchase snapshots → merchant artwork work → first-paid/refund facts and reconciliation.**

Required outcomes:

- Preserve actual Shopify order and line identity, product/variant quantities, accepted customization, configuration, geometry and the corresponding authorization set, including renewed issuance where applicable. A client cart-application confirmation is not proof of an order or payment.
- Reconcile duplicate and out-of-order order/payment/refund observations without duplicating facts or overwriting purchase economics. The same valid offer used in separate orders must produce separate purchase identities.
- Deliver the planned minimal merchant order/artwork interface, authorized original access, merchant-only post-order attachment, append-only replacement history and artwork locking. Preserve original purchase facts.
- Handle missing webhooks, incomplete authorization bindings and unsupported order edits with explicit reconciliation or exception behavior. Do not reconstruct unavailable history from current prices or current ProductConfig.
- Preserve collection-based retention. An order reference, reuse or replacement link must not renew an old asset's lifetime. Keep erasable production detail distinct from permitted economic/audit facts.

Reuse M3 durable delivery, the existing accepted quote/renewal identities, M5 historical configuration/geometry and M6 artwork boundaries. Shopify remains the authority for payment, fulfillment, refunds, returns and restock. This work consumes and reconciles those facts; it does not introduce a garment/customization refund split or replace Shopify commerce. First-paid facts support M9 later; usage charging and provider pricing setup are outside the current milestone.

These are outcomes and contracts, not a prescribed implementation sequence.

## Implementation ownership

You own implementation design, task order, test seams, investigation, refactoring, research, tools/MCPs, subagents and available model/effort choices within account limits, proportionate independent review and normal PR merges inside M8.

Prioritize useful behavior developed with meaningful TDD and relevant regression. Use existing interfaces and substantive integration boundaries where they provide the right evidence. Tests support delivered functionality; additional harnesses or reports are not substitutes for implementation.

Use inspected Matt Pocock skills and their relevant support files where helpful. Research independently, including firsthand community and maintainer experience. Verify important version, security and API claims against source, contracts and observed behavior rather than relying only on previous research. Skills and external sources do not override project permissions or locked product contracts.

Keep the current simple-delivery model: relevant passing final-candidate checks, proportionate independent correctness/security review and honest evidence reuse. Superseded test quotas, first-attempt-only CI, fixed reviewer/model effort and universal full-review restarts do not return. Normal merges remain delegated, subject to repository protections. No external principal approval is needed between ordinary M8 slices.

## Carried obligations and native work

Keep the M5–M7 obligations in one current acceptance register:

- Persistent unresolved-cart latching lacks reconciliation/reset. This is a known recovery gap to resolve before live buyer exposure, not a browser-only deferral. It need not block independent M8 work; do not blindly clear it or retry unresolved mutations.
- Native theme/proxy/cart, inventory, Markets, discounts, accelerated checkout and visual parity remain unqualified. Buyer production composition is not activated merely by merging code.
- M5 native authentication/G7, unattended uninstall/full privacy and temporary verifier limitations remain open. M6 S3/CORS/presigning, aggregate-transfer, exact-erasure and production-isolation limitations also remain open.
- Preserve current fixtures, captures, journals, protected `insignia-rewrite-dev`, and actual retention/resource obligations. Deferred acceptance neither extends deadlines nor discharges cleanup.

Use a supported owner-authorized autonomous browser route when available. Otherwise name the exact supervised observation and continue independent engineering and local UI automation. Do not repeat login/Console loops or weaken authentication to manufacture native evidence. Known defects stay explicit even when native observations are deferred.

M8 engineering authorization grants no new external resources. Native order creation, payment/refund/fulfillment, store changes, storage actions and deployment must fit actual existing owner grants and safety prerequisites. Request genuinely missing permissions or credentials specifically, while continuing safe independent work. Reconcile uncertain external effects before redispatch.

## Completion and handoff

Implement, test, review, normally merge and continue within M8. At engineering readiness, freeze the integrated commit/tree and return the working purchase/artwork/refund flow, relevant evidence, cumulative architecture assessment, meaningful decisions, open defects, deferred native acceptance and cleanup status.

Stop for principal milestone review before M9—not after individual slices or PRs. Full native acceptance and merchant rollout remain separate decisions. A real locked-contract conflict, missing permission or unresolved unsafe effect should be reported precisely while independent safe work continues.
