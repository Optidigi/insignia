# M5-025 — generation-safe uninstall authority

Source: owner-relayed principal authorization in the current T3 thread, 9 October 2026. This is a transcription of the operative scope, not an agent-issued principal approval.

## Entry

Fetch `Optidigi/insignia` PR55 and main. Approved base `56f504e88dd0dd77ee2c5165e3417f65dd0a5d36`, head `520a252dd8e1c00dcede00100cdf9974486774c6`, tree `8c8a59cafc8956118bd2fe0c69b30d392bbed426`; APPROVED outcome `BLOCKED_WEBHOOK_METADATA_SECURITY_BOUNDARY / M5_G7_NOT_PASSED`. Reverify final reviews/CI. Verify an existing normal merge or execute the delegated normal merge without squash/rebase/protection bypass. Changed refs stop for principal rereview. Preserve a durable merge receipt.

## Invariant and work

A previously authenticated Shopify webhook body must never acquire authority to deactivate a newer installation solely because unauthenticated delivery metadata claims a later event.

Read live AGENTS, ledger, operating model, state, M5-023/024 reports/evidence and affected application/worker/database source. Analyze raw body, HMAC, topic, delivery/event IDs, timestamp, Shop identity and generation authority. Preserve the reproduced cross-generation failure as a negative control.

Prioritize shop-specific `APP_UNINSTALLED` subscriptions with generation-bound callback capabilities: public-app/API feasibility, lifecycle, declarative coexistence, registration gaps, scopes and capability security. Documentation is evidence to validate, not definitive platform proof. Compare independent provider verification and pending/reconciliation, including revoked Admin access on a genuine uninstall.

Implement the smallest demonstrably sound correction only when the required authority is established. Separate receipt admission from irreversible deactivation; attacker-controlled headers cannot supply missing generation authority. Test old signed-body replay, changed IDs/topic/time/domain, legitimate identical-body later uninstalls, missing/out-of-order delivery, uninstall/reinstall/bootstrap races, unavailable provider, crash/retry and privacy/erasure. Use failing-then-passing isolated PostgreSQL18 and real HTTP/worker controls.

Preserve v1/v2/v3, whole-quote contracts, existing worker/queue implementation and historical evidence. No new credential system, merchant seeding, commercial invention or unrelated redesign.

## Hard stop and delivery

If independent installation-generation authority cannot be established while meeting genuine-uninstall requirements, return `BLOCKED_PLATFORM_UNINSTALL_AUTHORITY`, the precise impossibility/trade-off and smallest viable alternatives. Never silently accept cross-generation replay or weaken uninstall/privacy obligations.

Complete relevant full local regression, two NEW independent actual GPT-6.1-sol/high full-source CLEAR reviews and naturally applicable exact-head CI. Return one integrated M5-025 PR, exact URL/base/head/tree/evidence and recommended principal decision. Stop for external principal review; do not merge M5-025.

## Production boundary

OFFLINE/local implementation, synthetic qualification and public documentation research only. No VPS/SSH, Shopify provider/browser, production queue/schema provisioning, worker/web deployment, app version/release/scopes, merchant fixture, M6/M7 or rollout. PR55 approval does not resume a stopped historical live phase.

## Qualification seams

The owner explicitly named isolated PostgreSQL18 and real HTTP/worker controls. Test those existing public seams: raw-byte verification, built HTTP admission, durable tenant/inbox facade and production queue/worker processing. Any exploratory alternative is clearly separate from production and cannot claim provider feasibility from a mock or local green result.
