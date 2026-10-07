**CHANGES_REQUESTED — Standards/security, round3 precredential source gate.**

Reviewed base/effective merge base `407608ab929e703cd2b10972de93cf00c58aa9df` → candidate `8ca36eebd42a89ecb5bb99d0d08caa12cbd4e298`. Local runtime metadata confirms `gpt-6.1-sol`, `high`, read-only sandbox and approval policy `never`.

Examined the full candidate diff/log, all seven changed source files and six changed tests; complete relevant admin production/auth/HTTP/SSR/runtime/readiness, editor/API, PG tenant/config/publication/activation/recovery, command/outbox, worker and Shopify adapter sources; application activation, availability and key lifecycle contracts. Read AGENTS, ledger, operating model, relevant plan §7/§10/M5/G7, the full prompt, report/matrix, all four original reviews, dispositions and focused receipts. Coverage included authorization, tenant/install fencing, CSRF, private-state handling, concurrency, idempotency, durable atomicity, retention, boundedness and exact money.

Two blocking findings remain:

1. **P1 — New publication admission can displace an operation awaiting restoration.**  
   [merchant-config.ts:508](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/server/merchant-config.ts:508) and its transactional check at line545 admit any `active` phase without a reconciliation diagnostic, ignoring `activationKind` and an unresolved availability hold.

   Counterexample: first publication durably activates but ends `ACTIVATED_RESTORATION_PENDING`. A second tab submits a fresh publication key for the unchanged draft version. Admission commits another immutable revision, current-request pointer, command result and outbox event. Only afterward, [production-publication.ts:351](/home/serveradmin/insignia-m5-018-worktree/packages/database/src/repositories/production-publication.ts:351) rejects preparation because restoration remains unresolved, producing503. Original-key continuation then encounters the newer `intent` pointer and returns409 at merchant-config.ts:618. The prior recovery request has been displaced despite the failed new request.

   This violates prompt §§2–3’s durable recovery/operator-state requirements. Reject unresolved restoration/holds before committing a new intent, including inside the serialized transaction. Cover second-key admission, unchanged pointer/outbox and original-key continuation.

2. **P1 — Last-key destruction bypasses durable reconciliation refusal.**  
   [production-publication.ts:498](/home/serveradmin/insignia-m5-018-worktree/packages/database/src/repositories/production-publication.ts:498) calls `buildPublicConfig()` without handling its deterministic validation failure. The new diagnostic at line570 runs only when `current()` returns false.

   Counterexample: retain a current activated/restored operation, revoke its sole signing key, then destroy it after the supported retention window through [signing-keys.ts:219](/home/serveradmin/insignia-m5-018-worktree/packages/database/src/repositories/signing-keys.ts:219). Exact-key reentry filters out that destroyed key; [public-config.ts:37](/home/serveradmin/insignia-m5-018-worktree/packages/application/src/keys/public-config.ts:37) throws for zero keys. The transaction rolls back and HTTP returns503 without recording `adminReconciliation`. The following GET still projects ACTIVE at [merchant-config.ts:296](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/server/merchant-config.ts:296), and new-intent admission sees no hold.

   This violates prompt §§2/4’s truthful operator state and refresh requirements. Persist deterministic registry-premise refusal while preserving terminal phase and historical evidence; add POST→GET→reentry→new-admission coverage.

Both counterexamples are source-traced; I did not execute them.

The original authorization race, explicit409 recovery, stale poll, remote drift, pending-key/epoch drift and post403 browser cases have concrete corrections and focused receipts. No additional definite standards/security breach was identified; subjective smell concerns are not blockers.

Git-object comparison confirms 2,690 pre-existing evidence/spike blobs unchanged, including tracked raw evidence; historical v1/v2 sources and relevant migrations remain unchanged. All three rendered-log manifests match candidate hashes. External sealed artifacts were not independently rehashed.

I inspected receipts but ran no tests/builds/SQL, edited nothing, delegated nothing and used no live access. Concurrent unstaged test edits are excluded. Final full checks/CI remain unverified here. The bounded initial live procedure and pending matrix are appropriately gated. This grants neither credential access nor principal approval.