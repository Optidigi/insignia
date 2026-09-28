# PR #17 — principal review

Issued 28 September 2026. **APPROVED — bounded M0-012 effective-zero metering checkpoint.**

Repository: Optidigi/insignia; PR #17.
Base/effective merge base: `e77e4e42f8858662889f9814eeb7d0c4ed3713ab`.
Approved head: `811a45d4efff0dabe77df6fc573475acaab510e8`.
Fixed source for the reported four live sends: `ef9d50c6e77fe87913c3fd6242c6c4f2782875ae`.

Native APPROVE was attempted at the exact reviewed head and returned HTTP 403, “Resource not accessible by integration.” No native review was posted. This is the external principal verdict. The principal has neither merged the PR nor operated Shopify. Merge/resource authority remains with the owner.

## Verdict and accepted observations

No merge-blocking defect found in the inspected implementation, relevant tests and evidence. M0-012 is complete at its authorized prototype scope. Accept **PASS_OBSERVED_ZERO_PRICE_METERING** for this exact retained development subscription and the immediate replay experiment, not for the whole G8 gate.

The actual baseline raw Partner envelope and final normalized contract bind the new app `429028933633`, shop `105501393179`, private plan `insignia-dev-zero-20260928`, meter `customized_order_paid`, and `legacySubscriptionId` value `gid://shopify/AppSubscription/38085427483`. The identifier's source field is preserved; it is not evidence of legacy-app migration.

Three distinct value:1 events used four token acquisitions and four event POST attempts. Four HTTP 202/success:true receipts are separately recorded from three exact-key native App Billing Event SUCCESS observations. Retained observations show quantity 0→1→1→2→3 with effective USD 0.0 cost. E1's exact replay added no observed unit or second billing row in the recorded interval. E3's initial log delay was retained instead of treating quantity alone as billing-log evidence.

Native log content is operator-reported evidence with detail identifiers, not a log independently retrieved by the principal. The final contract is normalized adapter output; the baseline is a raw sanitized HTTP response envelope. The accepted result is limited accordingly.

## Implementation assessment

- The real-contract profile binds the exact app/shop/domain/subscription, current monthly cycle, unique plan/meter items and unchanged effective-zero amounts. It retains the observed one-tier VOLUME and price.active:false metadata. Missing usage remains UNKNOWN; numeric zero is not invented.
- Fresh Partner reads are performed before token acquisition and again afterward. Changed identity/economics/cycle, transitions, read failures or unexpected counts stop this operator.
- The immediate-use token path uses the designated first-party HTTPS endpoint, explicit Bearer type, bounded reads and deadlines, and an in-memory credential for one event request. Missing scope/expiry stays UNKNOWN; contradictory supplied metadata rejects. The 30-second deadline is client policy, not a measured Shopify token lifetime.
- The durable register reserves acquisition and possible dispatch before remote side effects; a separate retained receipt prevents unnoticed reset after run-directory loss. Exact event bytes and unresolved outcomes are preserved. This is a single-operator experiment register, not a production distributed outbox or an independently witnessed audit log.
- Later events require recorded native billing observations and fresh numerical Partner reads. An entered log URL is an operator attestation, not a programmatic proof that Shopify returned SUCCESS.
- Historical M0-010/011 defaults and production architecture are not changed. Hard-coded descriptions, active:false and this one tariff/cycle are a deliberate fixture profile; production parsing must not copy them as universal Shopify rules.

The successful recorded sends resolve whether the tested missing-metadata bearer can be accepted through this immediate-use path. They do not resolve production token caching, refresh, revocation or every possible response shape. No additional credential or repeated token-only investigation is required for this completed experiment.

## Verification performed

Inspected all five new source modules, material contract/operator/Partner/register/token tests, new CI workflow, gitignore change, supplied execution prompt, review packet, evidence narrative, observation rounds, baseline/final contracts and register/receipt. Reviewed the 28-file change inventory and compared the fixed live source with the PR head: subsequent changes are documents/evidence only. No plan/ledger change or historical source modification appears in that inventory. PR comments were empty at review.

Read actual CI job `109069827237` from run `36464141846`: Node 24.21.0, frozen pnpm install, strict TypeScript and 33 tests pass. History check reports unchanged v1.2 plan/ledger, 41 earlier sources and 120 receipts. All five head-associated workflows passed: `36464141384`, `36464141854`, `36464141431`, `36464142580`, `36464141846`.

Verified synthetic CI merge `41c909dddf333411a3122d97e3f0689d17dcbcb9` has exact base/head parents and the head's tree `ffad6eb2dd81447e201e79e807363ffbd8f4f79b`.

Independent offline Python checks reconstructed four connector-returned files and verified each against its exact Git blob identity before using it. Verified all three event-body SHA-256s, deterministic key derivations, counts/ordinals, cycle membership, paired run identity, unchanged baseline/final monetary terms and three-unit aggregate delta. See `verification/receipt-results.json` and its executable checker. These are retained-record consistency checks, not live observations or TypeScript execution.

Not performed independently: full repository or TypeScript test execution, Shopify/Partner calls, token acquisition, native Dashboard inspection, wire-level replay capture, monotonic live timing measurement, secret-file permissions inspection or a complete historical receipt rehash. Other four workflows were checked by metadata, not every job log. The principal did not certify every newly added document byte against the earlier local handoff.

## Gate and resource disposition

G8 now has an accepted real development transport/processing/immediate-replay sub-result. It remains incomplete for the full commercial lifecycle: actual selected-plan trials, allowance/plan changes, cancellation/delayed billing, durable purchase-to-usage delivery and production billing qualification. Lifetime provider deduplication cannot be empirically proved by a finite immediate replay; retain the documented contract and plan relevant longer-window regression rather than claiming universal proof.

Retain the current private draft, meter, effective-zero subscription, operator register/receipt and existing preview states. Do not activate App Pricing, change subscriptions, reset usage or exhaust the remaining two request slots. Package authorization ends at this review boundary. No M1, full M0/G8 pass, production billing adoption or whole-quote v2 adoption follows from approval.

## Next direction

After an explicitly owner-authorized merge, perform one **read-only M0 evidence/readiness reconciliation** using the companion brief. Its purpose is to identify the finite remaining original prerequisites to the full build, not to create new gates, auto-defer failures, repeat billing setup or open another paperwork PR. The principal will adjudicate the result and seed the next implementation scope. Local reports and agent consensus cannot change the approved plan.

## Sources

- PR/ref/source/evidence: https://github.com/Optidigi/insignia/pull/17
- CI: https://github.com/Optidigi/insignia/actions/runs/36464141846
- Shopify App Events receipt, processing and idempotency: https://shopify.dev/docs/api/app-events/latest/creating-events
- Shopify App Events authentication: https://shopify.dev/docs/api/app-events/latest
- Shopify developer testing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing

The public documentation view retrieved during principal review still displayed unstable; the run's evidence identifies successful requests to 2026-07. This review accepts the observed fixed-endpoint behavior, not a blanket statement about all versions or documentation synchronization.
