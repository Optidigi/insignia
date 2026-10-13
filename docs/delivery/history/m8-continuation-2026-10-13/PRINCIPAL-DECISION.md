# Insignia — M7 engineering review and M8 authorization

Decision date: 13 October 2026.
Repository: Optidigi/insignia.

## Principal decision

M7_ENGINEERING_SHAPE_ACCEPTED / NATIVE_ACCEPTANCE_DEFERRED
M8_ENGINEERING_AUTHORIZED
G1–G7 native acceptance remains unpassed; ROLLOUT_NOT_AUTHORIZED.

The M7 engineering foundation is accepted for progression to independent M8 development. This does not declare the cart-recovery implementation complete, certify native checkout, resolve the carried M5/M6 limitations, or authorize deployment or merchant exposure.

The principal found no additional material issue in the inspected source and evidence that requires blocking independent M8 engineering. This was a source/evidence review, not a fresh execution of the complete test suite or native platform qualification.

## Reviewed integration

- M7 entry / PR99 base: 31b92db714fc1bb90f4f2b417361c58c0deb2cf4
- Reviewed correction source: 476180c10409d209ed6ac710964db119263a0d3c
- Final PR99 head: 6cc2b0c45942e80e608fab8aef9a5ce38d59aad2
- Integrated main: 3ae4b8505d4c383fbb874694ef870454b6a074ef
- Final-head and integrated tree: 931cd3fb3d7809feeb0d2043646c1fe7642124f2
- Verified ordered merge parents: [31b92db714fc1bb90f4f2b417361c58c0deb2cf4, 6cc2b0c45942e80e608fab8aef9a5ce38d59aad2]

Live GitHub records confirm normal merge, exact head/tree identity and five successful final-head checks: runtime, foundation, durable-core, provider-local and local-proof. The final commit adds packet/evidence/state material after the reviewed correction; it does not change the reviewed executable source.

The committed verification ledger reports 249 PostgreSQL passes with four skips, 189 web passes, and 40 corrected storefront passes. It preserves the initial SSR startup failure, its unconfirmed cause, and the successful isolated/full reruns. The principal did not rerun these suites, access private reviewer sessions, or retrieve the agent-local ZIP. Local shutdown and native-resource accounting remain attributed to their recorded evidence.

## Engineering assessment

The implemented flow connects buyer choices and M6-owned artwork to complete-customized-subset price review, immutable owner-bound quote acceptance and real-variant cart application. It reuses the M4 pricing/authorization, M5 published configuration/visualizer and M6 artwork boundaries.

The inspected server paths derive tenant and resource authority from verified context, reserve accept/renew commands before signing, and recheck material inputs and availability. Buyer-supplied amounts, tenant fields and cart confirmations are not purchase/payment authority.

Renewal preserves the original accepted quote and records a separate issuance window. New price review refreshes each product's current configuration while preserving compatible choices. The final corrections prevent renewal against an externally changed cart and retire an acknowledged renewal key without discarding the identity of an uncertain request.

The Ajax adapter is deliberately non-transactional: it compares a captured cart baseline, addresses marked lines by current keys, preserves ordinary lines, and verifies readback. It latches unresolved writes before dispatch rather than automatically repeating uncertain mutations. This does not make Ajax a checkout enforcement boundary.

The local integrated EUR91 example uses actual browser/HTTP/PostgreSQL/HMAC/Ed25519 with explicit provider doubles. It is useful engineering evidence, not native Shopify/Markets/checkout or final visual-parity proof. Whole-quote v2 wire bytes and Rust Functions remain unchanged according to the changed-file inventory and reviewed evidence.

## Open obligations carried forward

| Obligation | Acceptance boundary |
| --- | --- |
| Persistent unresolved-cart latch has no reconciliation/reset path | A known implementation/recovery gap, not merely a missing browser observation. Keep it open; qualify recovery before live buyer exposure. Do not blindly clear the latch or retry uncertain writes. It need not block independent M8 implementation. |
| Native theme, App Proxy, cart, inventory clipping, Markets, discounts, accelerated paths, checkout and visual parity | Remain unqualified. Local doubles and a cart-confirmed response do not pass the corresponding G1–G6 criteria. |
| Buyer production composition | Explicitly disabled unless configured and dependent on valid credentials/readiness. It reads existing trusted release evidence; it does not create freshness by itself. Activation must not be inferred from source integration. |
| M5 native authentication/G7, unattended uninstall/full privacy and temporary verifier | Remain explicit defects, implementation/provider limitations or operational obligations as applicable. They are not all browser-only deferrals. |
| M6 S3/CORS/presign/proxy, aggregate transfer, exact erasure and production isolation | Retain their existing native and engineering limitations. Local inspector or MCP evidence does not qualify every production/storage path. |
| Fixtures, captures, journals and retention | Continue actual deadlines and ownership. Deferred acceptance neither extends nor discharges retention. Preserve protected insignia-rewrite-dev and the existing product/config fixture. |

Keep one current acceptance register. Historical failure evidence remains history; describe current mitigations and remaining defects separately. No new planning-only PR is required to restate these items.

## M8 engineering scope

Proceed with the existing plan's “Purchase snapshots, artwork work and refunds” milestone:

Verified Shopify order facts → complete authorization-set binding → immutable purchase snapshots → merchant artwork work and append-only replacements → first-paid/refund facts and reconciliation.

Deliver the existing planned outcomes:

- Purchase records retain actual Shopify product/variant/quantity/line mappings and the exact accepted customization, configuration, geometry and relevant authorization set, including renewed issuance where applicable.
- Duplicate and out-of-order order/payment/refund observations do not duplicate business facts or overwrite historical purchase economics. The same valid offer used in distinct orders does not collapse those orders into one purchase.
- Merchant-only post-order artwork attachment, replacement history and locking preserve original purchase facts and authorized original access.
- Missing webhooks, incomplete bindings and unsupported order edits have explicit reconciliation or exception behavior. Missing source evidence is not reconstructed from current prices or current published configuration.
- Retention remains tied to original collection and existing commitments. Order references and replacement links must not silently renew the old asset's lifetime. Distinguish erasable production detail from permitted immutable economic/audit facts.

Shopify remains the payment, fulfillment, refund, return and restock authority. M8 consumes and reconciles those facts; it does not introduce a garment/customization refund split or a replacement commerce ledger. First-paid facts support the later M9 billing milestone; M9 usage charging and provider pricing setup are not started by this decision.

A client “cart applied” or “confirmed” response is never evidence that an order exists or is paid. Preserve independent order/authorization verification when implementing M8. Carry retained quote/renewal identities into this design instead of depending on a still-live browser session or recomputing historical economics.

These are scope and contract requirements, not a prescribed implementation sequence.

## Execution ownership

The current simple-delivery operating model remains authoritative. The local agent owns implementation design, task order, test seams, research, tools/MCPs, subagents and available model/effort choices within account limits, proportionate independent review and normal merges inside M8.

Prioritize working behavior with meaningful TDD and relevant regression. Use inspected Matt Pocock skills where helpful. Research independently, including firsthand community/maintainer experience, and verify important claims against source, contracts and actual observations. No fixed test quota, universal full-review restart, first-attempt-only rule or per-PR principal approval is restored.

Use a supported authorized autonomous browser route when available. Otherwise name the owner-supervised observation and continue independent engineering. Existing data/resource obligations and known defects remain visible. Safe local substitutes do not become native proof.

This decision grants M8 engineering scope, not new external resource permissions. Native order creation, payment/refund/fulfillment, store mutations, storage actions and deployment must fit explicit existing owner grants and safety prerequisites. Request genuinely missing permissions or credentials once and continue safe independent work.

## Continuation and next milestone review

Refresh live main and preserve legitimate newer work. PR99 is already merged; do not merge it again. Record this principal decision and make M8 the active engineering milestone alongside the named M5–M7 deferred obligations.

Implement, test, review, normally merge and continue within M8. Return at M8 engineering readiness with integrated commit/tree, the working purchase/artwork/refund flow, relevant evidence, cumulative architecture review, open defects, deferred native acceptance and cleanup status. Stop for principal review before M9.

No repository write, native operation, deployment, watcher or background monitoring was performed by this principal review.

## Evidence basis

Repository paths below were inspected at integrated commit 3ae4b8505d4c383fbb874694ef870454b6a074ef, with live PR/commit/check records retrieved separately:

- docs/delivery/evidence/m7-storefront/M7-ENGINEERING-REVIEW.md
- docs/delivery/evidence/m7-storefront/verification.md
- docs/delivery/evidence/m7-storefront/review-completed-spec.md
- docs/delivery/evidence/m7-storefront/review-completed-security.md
- docs/delivery/evidence/m7-storefront/review-correction-spec.md
- docs/delivery/evidence/m7-storefront/review-correction-security.md
- AGENTS.md; docs/delivery/operating-model.md; docs/architecture/decision-ledger.md
- docs/architecture/implementation-plan.md: M7/M8/M9, persistence/retention and engineering/native acceptance sections
- apps/storefront/src/cart.ts; apps/storefront/src/customizer.tsx
- apps/web/src/server/buyer/service.ts; http.ts; bootstrap.ts
- packages/application/src/quote/material.ts; renew-quote.ts

Review links:
- PR: https://github.com/Optidigi/insignia/pull/99
- Engineering packet: https://github.com/Optidigi/insignia/blob/3ae4b8505d4c383fbb874694ef870454b6a074ef/docs/delivery/evidence/m7-storefront/M7-ENGINEERING-REVIEW.md
- Final-head checks: https://api.github.com/repos/Optidigi/insignia/commits/6cc2b0c45942e80e608fab8aef9a5ce38d59aad2/check-runs
