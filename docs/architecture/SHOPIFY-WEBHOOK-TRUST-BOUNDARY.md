# Shopify webhook trust boundary

Current M5 status — 9 October 2026: **independent uninstall authority and privacy remain unqualified; no production deployment is approved**. The [M5-025 principal invariant](../delivery/prompts/M5-025-GENERATION-SAFE-UNINSTALL.md) requires that an old authenticated body never acquire authority to deactivate a newer installation solely from unsigned delivery metadata. The [current local correction](../delivery/prompts/M5-UNINSTALL-AUTHORITY-QUARANTINE.md) enforces defensive generic-uninstall quarantine under delegated milestone engineering. This is not a newly claimed principal verdict or complete lifecycle qualification.

## Admission and irreversible effects

Verify the exact raw body HMAC using the current/previous app-secret ring before durable admission. Bound routing metadata and preserve exact delivery deduplication/conflict rules. HMAC authenticates the body only. Topic, domain, delivery/event IDs, time, API version and name do not independently establish uninstall purpose or installation generation. Matching signed Shop identity is diagnostic.

The generic route has no independently qualified uninstall-generation authority. Fresh receipts and old pending header-derived bindings therefore remain pending/unqualified and cannot select a generation for deactivation, credential revocation, publication-pointer clearing or business completion. Historical processed records remain unchanged. Queue transport completion is separate from uninstall/privacy fulfillment; unresolved and overdue obligations remain visible blockers. Conservative bootstrap fencing is preserved, including its unsigned-metadata denial limitation; it is not proof of a genuine uninstall or its absence.

## Remaining qualification

Genuine uninstall, identical-body later uninstall, registration gaps, reinstall/delayed delivery, revoked credentials, callback reconciliation and privacy still need independently established authority plus native qualification. Permanent quarantine is not an accepted replacement policy. Documentation, mock callbacks or passing local safety controls cannot qualify those obligations. Deployment/TLS/proxy controls and secret/body logging restrictions remain required; they cannot cryptographically authenticate unsigned metadata or supply generation authority.

## Historical PR23 record

The [original record](../delivery/evidence/m5-uninstall-authority-quarantine/historical-pr23-trust-boundary.md) is retained byte-exact, with its original source/relative-link context in Git. Its generic header-based binding/deactivation description and accepted residual describe PR23's historical decision, not the current M5 correction or approval of existing behavior for production. The historical [principal review](../delivery/PR-023-principal-review.md) and [authorized correction](../delivery/prompts/M3-002R-WEBHOOK-TRUST-CLOSURE.md) are unchanged. Whole-quote, availability v1/v2/v3, credential, generation and retention contracts remain intact.
