# PR #14 principal review — M0-011

Date: 28 September 2026. Verdict: **CHANGES_REQUESTED**.

Repository: `Optidigi/insignia`.
PR: https://github.com/Optidigi/insignia/pull/14
Base / effective merge base: `88dca8ebb4aad6baa24922508335e14038abbc98`.
Reviewed head: `15c4281a5d08fa509a03ac9bba47d9b5dd59889c`.

The native REQUEST_CHANGES attempt returned HTTP 403, “Resource not accessible by integration.” It was not posted. This is an attributed external principal verdict, not native approval or merge authorization. No repository file or Shopify resource was modified by the principal.

## Spec / correctness findings

### R1 — canonical cycle matching (P2, required)

`spikes/m0-011/src/index.ts:307`, inside `AppEventsClient.allowed`, compares raw `currentBillingCycle.startTime`/`endTime` with the manifest strings. The manifest requires exact millisecond UTC; M0-010's parser accepts and canonicalizes valid RFC3339 seconds and offsets, but `readLiveEnvelope` returns the raw body. Thus equivalent provider representations fail the guard.

Independent synthetic result: `2026-09-20T00:00:00.000Z` passes, while `2026-09-20T00:00:00Z` and `2026-09-20T02:00:00+02:00` describe the same instant and parse ACTIVE but fail. Matching end dates were used in each case. The current official Partner example uses second-resolution `Z` timestamps.

Compare validated canonical instants, preferably reusing the existing parser/normalizer rather than adding an unrelated parser. Preserve raw provider evidence. Reject invalid, missing and truly different cycles, including a one-millisecond change. No tolerance, changing the authorized cycle to fit the response, or permissive Date.parse-only fallback.

### R2 — identity-based item matching (P2, required)

`index.ts:309` destructures `[flat, meter]` from `active.items`. The reused parser matches types/handles without requiring that order. Reversing the exact two valid items parses ACTIVE but fails the new guard. Array position is not an approved identity or tariff invariant.

Select exactly one expected flat item and one expected meter by their handles/types. Preserve total item count, uniqueness, activity, currency agreement, zero recurring price, both zero flat tier amounts and both zero unit rates. Missing, duplicate, unexpected or extra items must reject. Do not reorder tiers: graduated tier order is economically meaningful.

Both findings fail closed; neither demonstrates an unauthorized charge or weakens the decision to stop live setup. They are defects in the locally promised adapter behavior and should be corrected on this PR.

## Standards / maintainability

No additional hard standards violation found in the inspected implementation. The most useful maintenance correction is to use consistent normalized provider facts at the guard instead of duplicating representation assumptions. No broad refactor, production catalogue, database, additional framework or generalized billing engine is requested.

Review axes were performed by this principal in one session. No independent principal-side subagents were available or used. The agent's reported local reviews remain supporting evidence, not principal approval.

## Accepted work and live prerequisites

The source defaults to dry run, uses fixed credentialed endpoints with redirect refusal, bounds response size and request duration, separates Partner/App Events credentials, reserves exact payload/key before attempted transmission, re-reads the no-charge terms before send, and keeps HTTP receipt separate from billing success.

The disclosed missing public-App-Pricing eligibility, Partner App GID binding, isolated zero-price contract, provider credentials and operator-wide budget remain real live-use prerequisites. The present file counter protects one intact journal; deletion or a different worktree/file can reset that counter. A future run must have run-wide accounting and stop on unknown counts. This is not a request to build a tamper-resistant distributed service for six test requests, nor permission to reset the file or call live APIs now.

M0-011 stopped before setup: the packet reports zero event POSTs and zero new billing resources. Those are reported operational observations, not a Shopify audit independently performed by the principal. The stopped preview/grants and orders #1001–#1006 remain protected.

The App GID should not automatically be classified as knowledge only the owner can supply. In a later separately permitted read-only discovery step, the Admin App/installation projection can associate returned `App.id` with the known OAuth `apiKey`, with subsequent Partner-side confirmation. That does not establish public distribution or App Pricing eligibility, and no ID should be constructed from a Dashboard number.

## Verification performed

- Live PR metadata and complete 16-file inventory inspected; comparison confirms the supplied effective merge base.
- Entire new implementation and material adapter tests inspected, along with README, readiness report, review packet and original M0-011 prompt.
- Actual provider-local job log read: strict checks and 34 M0-010 plus 20 M0-011 tests passed on Node 24.21.0. Four current-head workflows succeeded.
- Synthetic merge `062e43435b85829fe31390750258ddbbec212fb3` has exact base/head parents and the same tree as the head: `e6aaa014b51fa4fb120b72ed429d85b47158ec05`.
- Independent targeted reproduction on Node 22.16.0 used a Git-blob-verified complete reused parser and a disclosed guard-body excerpt. It did NOT execute complete AppEventsClient.send, the whole checkout or the pinned Node 24 suite. Eight cases include an accepted control, three false rejections and four safety controls. Attached script supports complete-checkout synthetic execution for the local agent.
- No live provider request, credential acquisition, staging interaction, independent local full build or complete repository test run occurred in this review.
- Current plan/ledger are absent from the change inventory; CI reports their unchanged v1.2 hashes. The principal did not independently recompute both current document hashes during this review.

## Disposition

Continue the EXISTING PR #14 under M0-011R. No merge or successor PR. Complete integrated synthetic regressions and local reviews; return the new head and applicable final-head CI. No full G8 pass, M1, v2 adoption, live event test or subsequent package is authorized.

## Sources

- Fixed-head implementation: https://github.com/Optidigi/insignia/blob/15c4281a5d08fa509a03ac9bba47d9b5dd59889c/spikes/m0-011/src/index.ts
- Fixed-head packet: https://github.com/Optidigi/insignia/blob/15c4281a5d08fa509a03ac9bba47d9b5dd59889c/docs/delivery/review-packet-M0-011.md
- Provider example / eligibility: https://shopify.dev/docs/api/partner/latest/active-subscription
- Pricing configuration location: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Admin App query and fields: https://shopify.dev/docs/api/admin-graphql/latest/queries/app and https://shopify.dev/docs/api/admin-graphql/latest/objects/App
