# Correction impact — Standards/security

Independent `/root/m7_core_security_review`; frozen `476180c10409d209ed6ac710964db119263a0d3c`, tree `7f54f0d301322e4a67ba76124f2f9db1600e02d5`, delta from `2ca51d5b5d1772aeda7982f999bcc771ed9d7f2b`. No new material Standards/security finding.

P2 renewal-key reuse closed: acknowledgement clears identity before cart application; uncertain API outcome retains it. External cart edits stop before issuance/mutation; cart adapter also rechecks before dispatch. Explicit repricing fetches each current product config, preserves the full vector and updates revision/hash only in the request; incompatible choices fail visibly without removal. Historical quotes and private ownership authority stay unchanged; unresolved-write latching still prevents redispatch. Merchant-only logo-later copy is consistent. Runtime buyer HTTP tests use existing synthetic PostgreSQL, not native qualification.

Reviewed correction log:8PASS,0FAIL/SKIP. Tests were not independently rerun; RED evidence was not independently inspected. Prior post-effect throttle finding remains closed. Inherited cumulative architecture/security assessment applies: domain/adapter/renderer boundaries, whole-quote v2, immutable history, scoped replay, admission and retention preserved.

Read-only source/test/log review; no writes, credentials or DB/native/provider calls. Final-head CI and deferred deployment/G1–G7/privacy acceptance remain separate.
