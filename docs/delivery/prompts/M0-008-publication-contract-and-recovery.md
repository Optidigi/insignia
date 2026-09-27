# M0-008 — scoped policy publication and recovery

**One local implementation package. No Shopify operations or test orders.** Execute after the already-authorized PR #10 merge is verified and the owner forwards this package's launch instruction.

## Outcome

Turn the approved Option A trust boundary into an executable, restartable publication use case and a reviewable activation/recovery contract. Return one PR containing the narrowly amended architecture records, implementation, failure tests and final local reviews. This is not a new general audit, metadata-redundancy experiment or whole-application scaffold.

Read `AGENTS.md`, delivery state and operating model, `OPTION-A-APPROVED.md`, PR-010 principal review, the relevant plan/ledger publication and failure sections, and M0-007's policy model, contract and reviewed evidence. Use the existing pinned writing-for-agents, research, tdd, diagnosing-bugs and code-review skills when their tasks arise. Public Shopify documentation/schema MCP and source inspection are allowed; merchant-authenticated calls are not.

Use actual `gpt-6-sol` / high. At most two non-overlapping restricted writers/worktrees, one integration owner, fresh Spec and Standards/security reviews. A working restricted sequential route is sufficient. Complete normal research, tests, fixes and review corrections locally. Worktrees do not confer credential isolation.

## 1. Resume and record the actual decision

Verify PR #10's approved head and actual normal merge before branching from updated remote main. The merge-only instruction already sent remains the authority to merge #10; do not re-merge a completed PR or reopen approval of unchanged refs. If an unrelated change has appeared, preserve it and report the changed binding rather than resetting work.

Record Option A as approved; include this decision record in the repository at a clear architecture path. Narrowly amend plan and ledger to v1.2, plus operational pointers and current status. Exact unrelated decisions and their wording stay intact. Keep whole-quote v2 explicitly provisional. Do not add a catalogue registry, Bloom filter, third/fourth redundant anchor, blanket checkout-outage policy or migration project.

**Historical tests:** current CI hardcodes the v1.1 plan/ledger digests. Preserve validation of that archived version at its fixed Git ref; add appropriate checks of the authorized current amendment. Do not require current v1.2 bytes to equal v1.1, silently regenerate historical receipts, or delete the history checks to get green CI. If the plan mirrors the ledger, keep that mirror synchronized. This is an authorized decision change, not evidence tampering.

Completion: approved boundary is discoverable from the ledger, historical provenance remains verifiable, and no current document describes joint policy loss as an unanswered A/B decision.

## 2. Specify one practical publication contract

Separate these facts explicitly: merchant intent, durable operation journal, Shopify mutation acknowledgement, exact Admin readback, Function-projection observations, and application activation. Name the point at which a requested policy becomes the effective policy and when new quote issuance may use it. A local test model must not present an acknowledgement or one sampled Function run as proof that all future platform reads see a revision.

Prefer the smallest use of existing Shopify primitives: app-owned values/definitions with appropriate write restrictions, per-product revision/generation, and conditional atomic `metafieldsSet` updates. Distinguish `compareDigest: null` (create only if absent) from an omitted digest (unconditional write). Verify the pinned API shape using existing schemas/current primary sources.

Investigate the actual activation assumption once, then document a recommendation with its evidence limits. The former requirement to observe both Functions before an archived product can be exposed is not an established production solution. A synthetic buyer order on every publish is not a requirement. Neither a fixed sleep nor repeated Admin reads proves global propagation. Option A does not authorize relabeling a known unsafe normal transition as an exceptional platform-loss incident.

For stricter transitions, preserve known management evidence and explicitly account for the previous effective policy and in-flight carts. Any proposed temporary product-availability change is a separate modeled port/precondition and merchant-facing effect, not an automatic global archival permission. If a transition cannot safely complete under established assumptions, return an explicit activation-pending result with the precise unverified prerequisite; do not claim production readiness. Continue implementing the other recoverable paths.

Keep the two-field representation for this bounded work unless a source-backed ordinary simplification materially improves it; neither field count nor the journal implementation is newly frozen as production architecture. Existing signed quotes remain governed by their signatures, historical revisions, context, generation and expiry. Avoid full offer invalidation for an unrelated configuration edit.

Completion: one contract, explicit consistency assumptions, and no additional backup-state system or invented provider guarantee.

## 3. Implement a restartable publisher, not another diagram

Under `spikes/m0-008/`, implement a strict-TypeScript publication use case with small injected interfaces for the operation journal, policy read/write transport and any required activation/availability checks. TypeScript matches the eventual backend ownership; reuse M0-007's cases rather than modifying its retained evidence. The journal may be an in-memory test adapter whose snapshot is recreated between steps; state clearly that durable database behavior is not proven. Do not build PostgreSQL, workers, admin screens or a general workflow engine here.

Implement the pinned GraphQL request/response mapping against a fake transport and schema validation where available. No credentials or live endpoint execution. Include actual namespace, owner ID, generation, desired revision, expected prior digests, idempotency identity and typed outcomes. No float-based money or cryptographic changes are needed.

Mandatory cases:
- First managed publication; required-to-required revision; optional-to-required and required-to-optional intent.
- Journal-before-side-effect ordering; crash/restart at every external boundary; same-operation replay.
- Network timeout where the remote write may have committed: re-read exact desired state before retry; do not blindly overwrite.
- Mutation user errors, stale compare digest, concurrent conflicting revisions and same revision/op-ID with different payload.
- Missing, partial, malformed, stale and wrong-installation readback; correct rejection/pending classification.
- Known-managed evidence is not deliberately erased during a live required transition. Unknown or partially written state does not become “optional” by default.
- Already accepted valid historical quote behavior is preserved; newly issued quotes cannot use an uncommitted configuration.
- Reconciliation yields a bounded retry, conflict or operator action. It never edits historical purchase economics or claims to undo already-completed plain purchases.
- Complete trusted-state loss and coherent rollback remain named unsupported-fault fixtures per Option A, not a falsely passing stronger guarantee.

Use the existing Rust projection as an independently checked consumer contract where useful; do not rewrite the Ed25519 protocol or renderer/framework stack. Test the selected publication semantics through the fake remote store and the consumer observations; label synthetic and previously observed inputs separately.

Completion: the use case demonstrably resumes after ambiguous outcomes, avoids conflicting publication, and exposes any unresolved activation precondition in its result type rather than only a prose caveat.

## 4. Integrate, review and stop

Run all applicable existing checks and focused new CI. Add source-bound fixtures and compact failure traces; no hundreds of repetitive receipt files are required for simulated operations. Complete fresh Spec and Standards/security reviews on the final implementation, fix findings, and disclose any actual review-tool limitation without fabricating coverage.

Return one PR with actual base/head/merge-base, source-bound CI, publication tests, review dispositions, v1.2 amendment diff and a short remaining-M0 dependency map. Distinguish accepted residual risk, implementation obligation, development gate and genuine new user decision. Reuse the existing G1–G8 register rather than inventing another gate taxonomy.

Publication acceptance and v2 adoption remain principal decisions. G7/G8 and other unexecuted gates remain required; future work should be scheduled from the remaining risks, not automatically another policy spike. This package does not authorize M1, a full gate pass, capacity limits, production deployment, the next PR's merge or any subsequent work.

## Permission boundary

Allowed: named local code/docs/tests/dependencies, public technical research and schema checks, ordinary branch commits, CI and opening one PR after the prior approved merge. All product/Shopify calls using merchant credentials, new staging writes, Function previews, orders, inventory/payment changes and privileged host changes remain outside this package. Leave the existing app/store and orders #1001–#1006 untouched.

The unchanged PR #10 head must not be edited to incorporate this work. If its merge is still pending, independently safe design/test work may use scratch space, with the final branch based on the verified merge. No repeated resource-designation questions or general preflight.

## Primary source pointers

Consult these only for the corresponding API/ownership branch and verify against the pinned schema. They are evidence for particular interfaces, not global propagation guarantees.
- Metafield ownership/value control: https://shopify.dev/docs/apps/build/metafields/manage-metafields
- Definition permissions, including optional merchant write access: https://shopify.dev/docs/apps/build/metafields/definitions
- Metafield digest and atomic mutation documentation: https://shopify.dev/docs/api/admin-graphql/latest/objects/Metafield
- Fixed history: PR #10, reviewed head `9941f68316316a3cad07885d6e78b067e6784fbd`, and M0-007 contract/evidence at that ref.
