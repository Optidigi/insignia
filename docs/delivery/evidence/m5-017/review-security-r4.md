**Round 4: NOT CLEAR — one unresolved P2 defect, affecting both axes.**

Reviewed BASE `4bba14fb4415815557ffa5f1e600427a62128489` through HEAD `b06cc057782513f9401b830fbf647405fa50dfbd`, tree `0cb88d7a96b2e0c9e37ccb1e57a45437490f1988`. Checkout remained clean.

## Standards/security

**P2 — Original-DRAFT restoration permits scheduled ACK evidence in a successful durable receipt.**

Location: [v3 migration, line 116](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:116).

Requirement: brief §9 says visible scheduling must “fail closed” and “never claim v3 success.” The [review response](/home/serveradmin/insignia-m5-017-worktree/docs/delivery/evidence/m5-017/review-findings-responses.md:6) additionally claims SQL rejects successful restoration records containing scheduled ACKs.

Concrete counterexample:

- `before` and non-null `held` are the same qualified, effectively unpublished DRAFT snapshot.
- Acquisition ACK is absent, as permitted for original DRAFT.
- Restoration claim is valid and correctly bound.
- Restoration receipt has `kind: RESTORED`, a clean matching `current`, and a structurally valid DRAFT ACK containing an unpublished future publication record.

`m5_v3_ack` admits that ACK structurally. The RESTORED predicate then short-circuits at `original->>'state'='unavailable'`, bypassing `m5_v3_ack_qualified`. Consequently, this scheduled ACK does not disqualify the successful receipt.

This is a definite predicate gap established by source inspection; **I did not execute a SQL probe**. The shipped adapter ordinarily returns no restoration ACK for original DRAFT, which limits ordinary runtime reachability but does not close the durable validation boundary.

Smallest correction: require qualification of **every non-null restoration ACK** before admitting RESTORED; preserve the legitimate ACK-free DRAFT case and scheduled ACK conflict/pending audits. Add a PostgreSQL regression for this exact payload, alongside controls for ACK-free success and retained conflict evidence.

## Spec

**The same P2 also affects coordinator completion.**

Location: [activation.ts, line 586](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/activation.ts:586).

Given a qualified original-DRAFT owned hold, an injected availability port can return RESTORED with a clean current snapshot and the scheduled ACK described above. The coordinator saves that receipt, bypasses ACK qualification through its original-DRAFT branch, and returns ACTIVE with durable RESTORED state.

Apply the matching qualification rule here. Classify the unqualified ACK as conflict before persisting the receipt, retain its evidence, and enter OPERATOR_HOLD. Add a coordinator regression proving that a clean readback cannot erase scheduling observed in a restoration ACK.

I found no additional unresolved material objection.

## Inspection and execution

I inspected the complete resulting changed implementation, migration, tests, guarded harness and relevant publication/recovery/web interactions; original v1/v2 contracts, adapters and migrations; old guarded timing/identity interfaces; required authority documents; rounds 1–3 reports/settings/responses; original red receipts and neutral failure/green logs.

Historical v1/v2 source and prior operators have no changes in the fixed diff. The earlier acquisition-ACK, scheduled-original, unheld-DRAFT, dispatch freshness/deadline, identity-poisoning, web integration and eleventh-workflow corrections are present.

Actual commits were:

- `12c422b` — v3 implementation
- `2dde06d` — review corrections
- `316419d` — original hold authority and applicable CI fences
- `b06cc05` — unheld incident ACK adoption and SQL success fences

Executed only read-only Git, source/evidence reads and receipt parsing/hash comparisons, including the exact SHA-based three-dot diff. **No tests, builds, database operations, credentials, network/provider/browser operations, mutations or delegation.**

Original failures and NOT_CLEAR dispositions remain failures; supplied green logs do not establish this HEAD’s gate or live qualification. Live remains NOT_RUN. Principal approval remains external and ungranted.

**Findings: Standards/security 1 P2; Spec 1 P2 — one distinct defect.**