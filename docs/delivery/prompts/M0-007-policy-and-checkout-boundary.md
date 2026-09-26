# M0-007 — required-policy and checkout-boundary proof

**One integrated prototype outcome, not production adoption.** Execute only after the owner sends the explicit launch authorization and the reviewed PR #9 is normally merged.

## Outcome, context and execution

Determine a defensible fail-closed publication/observation contract for required-customization products, implement and test the smallest viable candidate, and complete the remaining focused validity/cart-repair/discounted-order checks. Return one integrated PR with code, tests, evidence and a concrete adoption-dependency matrix. A precisely demonstrated inability to distinguish safe from unsafe state is a useful result; it is not permission to relax the product requirement.

Read AGENTS.md, delivery state, PR-009-principal-review.md, this prompt, the pricing/quote/publication/failure parts of the plan and ledger, M0-005's protocol contract, and M0-006's source/actual receipts. Use the repository's pinned research, writing-for-agents, tdd, diagnosing-bugs and code-review skills where relevant. Reuse GitHub, Shopify documentation/schema MCP, CLI, existing browser and pinned toolchains. Actual sol-6-high (`gpt-6-sol` / high), up to two non-overlapping restricted writers/worktrees, one integrator, fresh Spec and Standards/security reviewers, exactly one staging operator. No new general preflight. Complete ordinary in-scope research/test/fix/review iterations locally.

Principal retains project direction, acceptance criteria, architecture changes, gate adjudication and review of every PR. Owner retains resource and merge authority. Native multi-agent absence uses the established restricted-session fallback.

## 1. Start and preserve the evidence

Verify PR #9 base/effective merge base `9f08c8ff6ee8a6a908b976c26f8435e4301308c5`, head `a0bfaa713839cb5ccc794e67e0085a51eb00f782`, external approval and final-head passing CI. Use only the owner's exact normal-merge permission. Branch from the verified updated remote main. Changed refs require review rather than forced alignment.

Keep plan/ledger, M0-004/M0-005 protocol code and all old raw receipts/preview binaries/manifests unchanged. Reuse and extend the M0-006 harness through a small, reviewable adapter/helper delta; do not create another copy of generated schemas, core crypto and fixtures merely for a new slice number. Place new evidence, contract and tests under `spikes/m0-007/`; explain any changed import or adapter. Retain a frozen historical-check path for M0-006 source-bound manifests rather than rewriting old hashes to describe new code.

Record the principal's discount adjudication in current operational status: USD9.09 discount / USD81.91 net matches the observed native percentage rounding. Original USD9.10/81.90 prompt and halt remain historical. Add an exact integer test for that interpretation. Validation continues enforcing the signed pre-discount USD91.00; build no net-discount engine or penny compensation.

Completion: current refs, bounded internal tasks, preserved historical checks and adopted experimental expectation are explicit.

## 2. Define and prototype the policy trust boundary first

The current null policy can mean either unrelated merchandise or lost required-product state. Write a compact executable truth table and publication state transition contract before modifying the adapter. Cover unmanaged, managed optional, managed required, pending/unavailable, malformed, missing, stale and wrong-installation states.

Use independent app-controlled product/shop metadata, not buyer cart markers, to establish policy. Identify what lets the Function distinguish unmanaged merchandise from missing managed policy. State who can write each field and what happens when each field, and then every policy anchor, is unavailable. A duplicate sentinel does not magically solve joint loss. Do not silently grant an unsigned required purchase, declare all unmarked goods required, or claim reconciliation repairs a purchase that already happened. Do not make the fixture's hard-coded ID the production enforcement rule.

Inspect current primary docs/schema for app-owned namespaces/access, metafield atomic writes and compare-and-set support. Prototype the smallest justified representation using existing APIs. At most one preferred design and one justified alternative; no generic policy framework, secondary database or new service. App-owned metadata representation and adapter changes are prototype-only implementation choices, not an authoritative plan amendment.

Model prepare → publish/read-back → ready, idempotent retry, stale concurrent publication and interrupted/partial rollout. Publishing a new configuration must not silently invalidate already accepted historical quotes; their signed terms remain authoritative within the existing rules. A PostgreSQL/Shopify distributed transaction is not assumed. Use a local test journal/state model for publication intent—do not scaffold the production database/admin.

Required tests: buyer marker removal; known-required unsigned rejection; invalid signature rejection; valid authorized acceptance; malformed/missing/stale policy on independently known managed merchandise; explicit optional plain acceptance; unmanaged plain acceptance; first publication and changes in both directions; interrupted writes and stale compare-and-set/retry; reinstall/generation mismatch. Preserve the current missing-policy negative case as a before-control and show what exact observation changes after the candidate.

Include a realistic resource analysis: query fields, serialized metadata size and full-target cost for mixed 200-line carts. A central registry tested with one product is not proof of catalogue-scale feasibility. Where cost grows with catalog size, quantify at least 1,000/10,000 synthetic products or show a bounded alternative. Do not impose an unapproved production catalogue/cart limit to claim success.

If complete loss of every independent anchor is indistinguishable from an unmanaged cart, say so and present the precise guarantee/trade-off needing principal/owner choice. Do not introduce a store-wide checkout-blocking outage policy without approval. Finish independent safe work; no mid-package approval loop is required for ordinary candidate implementation. This outcome may remain a documented blocker instead of a false gate pass.

Completion: executable contract, smallest candidate and adversarial tests, explicit uncertainty and source-bound full-target measurements. Local reviewers inspect it before the first new staging mutation using that candidate.

## 3. Named staging envelope and safe fault probes

Existing app `insignia`, existing shop `insignia-staging.myshopify.com` only. Reuse the authenticated Admin and separate guest storefront. Fixture product `gid://shopify/Product/10294344482974`, handle `insignia-m0-001-fixture-20260924`; Small variant `50529053343902`; Medium variant `50529054163102`; Shop location `gid://shopify/Location/89465290910`.

Orders #1001–#1005 and their fulfillments/refunds/commitments are read-only. Record current resource/stock snapshots; last baseline Small available/committed/on-hand 5/2/7, Medium 8/2/10 is a comparison, not a current assumption. Use existing available stock only.

Owner authorization covers local candidates and dedicated app-owned `m0_007_*` fixture/shop metadata (including narrowly needed app-owned definitions), temporary fixture publication, fresh ephemeral Ed25519 keys, one owned dev Transform/Validation pair, existing-scope reauthorization, cart operations, the one test order below and cleanup. Preserve namespaced ownership and exact original values. Both runtime blockOnFailure values and enabled Validation must be set and read back. No released app deployment, distribution change, new app/store, extra scopes, global theme edit, unrelated resource mutation or variant requiresComponents change. A missing new permission produces a precise owner action; finish independent safe tasks meanwhile.

Before live policy fault injection, prove the candidate is fixture-contained and cannot block unrelated checkouts. Use actual Function inputs to demonstrate the policy/identity projection. Exercise missing/malformed/stale dedicated policy and recovery without paying on an invalid case. Also test valid authorized and explicit optional plain controls. If production-scale or all-anchor behavior remains unresolved, report the narrower observed result; do not promote the experiment to a complete required-product guarantee.

Use fresh keys, not public test-seed keys on staging. Keep secrets off stdout/committed files. Remove only owned resources at cleanup. Preserve existing Test/Bogus gateway and real-payment settings; activating the built-in simulated provider is allowed only if no real provider is disabled or reconfigured. Preserve password protection.

## 4. Complete the remaining checkout checks in the same run

- Create independently signed expired and future-window offers using correct historical/future signing dates while keeping Shopify's actual clock unchanged; checkout must reject. Renew a complete offer for the current shop-local day and verify repair. No signing-protocol/date-check bypass.
- Remove the last customized line while keeping an ordinary optional item; clear only Insignia's orphan envelope and verify ordinary checkout usability. Capture the empty-cart stale-envelope case as a regression. Cart keys identify duplicate-variant lines; variant ID alone is not sufficient.
- Reuse the demonstrated non-atomic replacement behavior. Capture actual input/output when a new helper changes it; do not repeat the entire historical negative matrix just for more screenshots.
- Exercise already available cart express entry without new wallet/real-payment setup. Product Buy Now's earlier carrier-loss result stays recorded. A safe block is not customized compatibility; provide a storefront routing recommendation, not a silent change of scope or a global theme patch.

Negative outcomes require no successful payment. Only the discounted order below may complete. Stop a path on wrong pre-discount price, wrong identity, unauthorized acceptance, inconsistent selection or resource ownership; do not manufacture a pass. Continue independent safe checks and cleanup.

## 5. At most one new discounted Bogus order, three purchased units

A new permission budget: maximum ONE successful new test order / THREE units, including unexpected successes. Do not repeat undiscounted Order A. Do not mutate #1005 to finish earlier work.

After the valid path and requisite local/live safety controls pass, use three Small units with the unchanged USD91.00 accepted allocation: 2 × USD30.33 and 1 × USD30.34. Create at most one temporary native 10% product discount restricted to this fixture, one-time purchases, no combinations, through native Admin (no added discount-write scope). Confirm independent pre-discount Validation observes USD60.66 and USD30.34 and the actual cart has exactly the complete signed set.

For this fixture, corrected expected native discounts are USD6.06 + USD3.03 = USD9.09 and net merchandise USD81.91. Verify the actual discount allocations and current test gateway before payment. Taxes/shipping remain separately observed; do not edit them to force a grand total. A different live calculation warrants a recorded discrepancy, not altering the signed price or hand-entering a refund.

Capture order shared/member correlation, variant quantities, original pre-discount amounts, actual native discount allocations and net merchandise. Native Admin calculated cancellation/refund/restock on this NEW order only must reconcile the native paid amount and quantities; record net refund allocations and actual stock return. No paid labels, manual stock reset or manual refund adjustment. If policy candidate work is blocked, the already demonstrated valid-policy v2 path may complete this independent discount case within the same envelope, clearly distinguished from policy success.

Completion: one discounted order/refund result or the precise first failure. No order is required merely to improve screenshots.

## 6. Cleanup, reproducible review and adoption boundary

Remove only the owned Functions before removing their dedicated keys/policy, stop/clean preview, revoke/remove ephemeral material, restore exact prior metadata, remove the owned discount, archive/unpublish fixture and clear guest carriers. Validate stock/protected history. Keep any unexplained new failed-order state for diagnosis rather than manually reconciling it. Separate direct resource readback from operator process assertions.

Capture actual query-limited Function inputs/outputs and exact preview bytes. Hash/build bindings must distinguish rebuilt CI artifacts from preview. Add deterministic replay of retained live input/output pairs to the extent supported by the established runner, not just more synthetic happy paths. If replay is unavailable, state that limitation without an interception-tooling project. Include the actual case data and small result manifest in CI artifacts along with binaries; avoid a summary that cannot reproduce the comparisons.

Return ONE integrated PR with final refs/CI, completed internal tasks, local Spec/security findings and dispositions, all permissions used/residues, and a compact matrix of every original G1–G8 criterion as accepted evidence / missing evidence / implementation obligation / owner decision / deferred. Keep partial observations distinct from overall gate acceptance. State concrete next experiments and which risks prevent M1 versus release; do not automatically start them.

The principal must adjudicate policy guarantees, production capacity, unsupported paths and any v2 adoption/ledger amendment. This package is not authorization for a new product cap, blanket store outage rule, different crypto/carrier, full gate pass, production release, next-PR merge or M1.

## Current source pointers

- Shopify staff percentage-discount clarification (12 February 2026): https://community.shopify.dev/t/inconsistent-cents-rounding-on-discounts-across-different-stores/28655/10
- App-owned metadata/permissions: https://shopify.dev/docs/apps/build/metafields
- Atomic metafield/CAS semantics; verify against pinned schema: https://shopify.dev/docs/api/admin-graphql/latest/payloads/MetafieldsSetPayload
- Ajax cart clearing/attributes: https://shopify.dev/docs/api/ajax/reference/cart
- Validation fields and surfaces: https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation
- Keep actual namespace/variant/checkout observations separate from generic documentation.
