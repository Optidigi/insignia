**CHANGES_REQUESTED — PRE-CREDENTIAL SOURCE GATE**

Reviewed base/effective merge-base `407608ab929e703cd2b10972de93cf00c58aa9df` → candidate `9c2262e938fef156910c8eaf92a8f75096dc2769`. Merge-base and HEAD matched.

Examined the complete diff and two-commit log; all five changed source files and six changed tests; complete relevant admin auth/HTTP/runtime/production/readiness/preview/routes, UI, application activation/availability/recovery, PostgreSQL repositories/migrations, Shopify identity/catalog/publication/availability adapters, and worker composition. Read AGENTS, ledger, operating model, plan sections 7/10/M5/G7, full slice prompt, report, matrix and committed evidence.

**Standards/security: CHANGES_REQUESTED**

1. **P2 — An older save completion restores private data after authorization denial.**  
   [MerchantConfigEditor.tsx:422](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/islands/MerchantConfigEditor.tsx:422) clears private state and increments `requestId` after passive-refresh 401/403, but save completions at [line 632](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/islands/MerchantConfigEditor.tsx:632), 662 and 687 have no corresponding epoch guard.

   Counterexample: passive refresh starts; the merchant starts saving; refresh returns 401 and clears the page; a delayed successful save response then restores `view` and `draft`, displays private product details and replaces the denial with “Draft saved.” The renderer remains cleared, but private view clearing has been undone. This violates the prompt’s expired-session/current-authorization requirements (§4, lines 93–102). Fence every asynchronous save/readback completion against authorization/context invalidation and cover this ordering.

**Spec/correctness: CHANGES_REQUESTED**

2. **P1 — Detected publication drift is reported as ACTIVE.**  
   [merchant-config.ts:684](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/server/merchant-config.ts:684) discards the meaning of `advanced.kind === 'OPERATOR_HOLD'`; [line 704](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/server/merchant-config.ts:704) then projects unchanged durable state.

   Counterexample: an ACTIVE/RESTORED operation’s remote policy changes; exact-key publish reentry detects the mismatch. [production-publication.ts:585](/home/serveradmin/insignia-m5-018-worktree/packages/database/src/repositories/production-publication.ts:585) returns `{kind:'OPERATOR_HOLD', phase:'active'}` without persisting a hold. The handler nevertheless returns ACTIVE, and subsequent config reads retain ACTIVE. This contradicts prompt lines 14 and 60 and plan §7.2’s actionable conflict requirement. Preserve the detected failure in the response and durable current-state projection without rewriting historical activation evidence.

3. **P2 — A delayed passive observation overwrites a newer publication request.**  
   [MerchantConfigEditor.tsx:720](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/islands/MerchantConfigEditor.tsx:720) synchronizes stored request state before checking current state; the updater at line 724 checks only config/draft identity. Starting publish does not invalidate the observation epoch.

   Counterexample: revision A is effective while saved draft version 2 awaits publication. A poll captures A/ACTIVE; publishing version 2 creates B and a newer refresh displays B/WAITING_RELEASE. The delayed poll then displays A/ACTIVE and clears B’s retained request because ACTIVE is terminal. This violates truthful current-request state and mounted refresh concurrency requirements (prompt lines 60–61, 119–124). Fence observations that precede a command and test deliberately reordered responses.

These are source-traced counterexamples, not executed reproductions or availability-contract findings. No subjective code smell is treated as a blocker.

All 125 tracked application/database/Shopify files and 2,302 historical tracked evidence files match the base Git objects, preserving v1/v2/source/raw evidence. External sealed directories were not inspected. Committed rendered-log checksums match their manifest; I inspected receipts and ran no tests/builds/SQL or live operations.

Two tests acquired unstaged edits during review; those edits were excluded from the candidate assessment. The bounded initial read-only live procedure respects the freeze/CLEAR/CI gates; pending embedded outcomes are appropriate here. This is not principal approval.

Runtime model/effort metadata is not exposed to me; the required actual GPT-6.1-sol/high identity needs caller-side attestation.