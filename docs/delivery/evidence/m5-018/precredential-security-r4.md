**CLEAR — round4 precredential Standards/security source review.**

Reviewed base/effective merge base `407608ab929e703cd2b10972de93cf00c58aa9df` → candidate `2c84d8feb95f8ec29ef90ed84d2c99b13aa22d6e`. Local runtime metadata confirms actual **GPT-6.1-sol/high**, read-only sandbox and approval policy `never`. HEAD matches; working tree is clean.

Examined the full five-commit log/diff and complete changed source: `MerchantConfigEditor.tsx`, `merchant-config.ts`, admin `production.ts`/`activation-state.ts`, `admin-view.ts`, `durable-core.ts` and `production-publication.ts`; all six changed test files and the workflow change. Traced complete relevant admin auth/HTTP/SSR/routes/preview/readiness, application activation/availability/key contracts, PG tenant/config/command/outbox/publication/activation/recovery/signing-key repositories, Shopify identity/catalog/publication/availability adapters and worker source. Read AGENTS, ledger, operating model, plan §7/§10/M5/G7, full authorized prompt, report/matrix, all six original reviewer reports, dispositions and associated red/green receipts.

**No concrete blocking standards/security finding remains.** Coverage included tenant/staff/install authorization, CSRF, private SSR/browser state, current-read failures, concurrency/idempotency, atomicity, retention, boundedness and exact money. Subjective smell concerns did not establish contract breaches.

The prior findings have substantive corrections:

- Remote/key/epoch reconciliation refusals persist a scoped, versioned progress diagnostic. Historical active phase remains SQL-terminal; activation evidence and hold JSONB remain unchanged. Superseded historical requests cannot project ACTIVE against another effective pointer.
- Authorization epochs fence delayed command/readback responses; private state clears on denial. Observation epochs prevent obsolete polls from replacing newer pending state/storage. Explicit409 remains conflict even for equal content. Post403 recovery now reloads fresh authorization.
- [New admission](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/server/merchant-config.ts:514) requires settled activation and no unresolved owned hold, both before execution and under the config transaction lock. Original-key continuation remains available without replacing its pointer or redispatching restoration.
- [Deterministic registry refusal](/home/serveradmin/insignia-m5-018-worktree/packages/database/src/repositories/production-publication.ts:498) reaches durable reconciliation handling; database/provider exceptions remain errors. Operator/conflict UI blocks fresh publication.

Git-object comparisons confirm **2,690 pre-existing evidence/spike blobs, 26 application-publication/Shopify source files and all15 migrations unchanged**, including tracked historical raw evidence and v1/v2 source. All23 rendered-log hashes across four manifests match. External sealed runs were not independently rehashed.

I inspected existing receipts, including six focused HTTP and five browser controls; **I personally ran no tests/builds/SQL**, edited nothing, delegated nothing and made no provider/browser/credential/Shopify CLI call. Exact-head full root,171PG and natural eleven-workflow CI remain unverified here and are not assumed green.

The bounded initial read-only live procedure respects the freeze/release boundary, and the pending matrix honestly separates offline proof from live obligations. **Live remains CLOSED.** This CLEAR verdict is precredential source review only; it grants neither principal approval nor completed M5/G7 acceptance.