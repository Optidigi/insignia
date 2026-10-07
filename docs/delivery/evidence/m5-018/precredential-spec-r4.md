**CLEAR — round4 precredential Spec/correctness source review.** No blocking source/spec findings or unresolved prior objections identified.

Reviewed base/effective merge base `407608ab929e703cd2b10972de93cf00c58aa9df` → candidate `2c84d8feb95f8ec29ef90ed84d2c99b13aa22d6e`. Local session metadata confirms actual **GPT-6.1-sol/high**, read-only.

I examined the full diff and commit log, every changed source/test, AGENTS.md, decision ledger, operating model, relevant plan §7/§10/M5/G7, the full originating brief, report and matrix. Production coverage included:

- MerchantConfigEditor, admin state projection/composition, merchant-config service and shared DTOs.
- Complete relevant HTTP/auth/runtime/routes, preview/grant and release-readiness source.
- Durable core, PG config/publication/activation/recovery/tenant/key/idempotency/outbox repositories and relevant SQL guards.
- Application activation, versioned availability, recovery and key/release contracts; Shopify online identity, catalog, publication, Function ownership and v1/v2/v3 adapters.
- Renderer ownership and worker dispatch/reentry seams; all six changed admin tests.

All six original round1–3 reports, responses and qualified red/green receipts were considered. The corrections address the reported defects:

- Active reconciliation refusals persist in versioned progress diagnostics; terminal phase, activation evidence and hold JSONB remain intact.
- Key/epoch drift and deterministic zero-key builder refusal reach that durable diagnostic.
- Fresh-intent admission checks settled activation and unresolved holds before intent creation, then repeats those checks under the config lock. Original-key continuation remains available without displacing its pointer or redispatching claimed restoration.
- Browser authorization epochs prevent delayed responses restoring private state; explicit409 remains conflict; observation ordering preserves newer pending requests/storage. The post403 sequence reloads with fresh authorization, and operator/conflict controls disable fresh publication.

The request identity, immutable revision, current-intent pointer and intent outbox commit atomically before provider preparation. New activation uses v3; pending and effective revisions remain separate. Historical recovery remains operator-bound. I found no scope creep or new availability-contract defect requiring principal escalation.

Read-only blob comparisons found **2,302 pre-existing evidence files, 15 migrations and 26 availability/activation/key source files unchanged**. All **23 committed log checksum bindings** matched.

I inspected receipts showing six focused HTTP controls and five browser controls passing; **I personally ran no tests or builds**. Exact-head full root, PostgreSQL171 and natural eleven-workflow CI results remain unverified here.

The bounded initial live procedure retains the required offline/review/CI/freeze prerequisites and stops at platform/release boundaries. **Live access remains CLOSED.** This verdict establishes neither completed M5/G7 acceptance, RELEASE_BOUND completeness, principal approval nor merge authority.