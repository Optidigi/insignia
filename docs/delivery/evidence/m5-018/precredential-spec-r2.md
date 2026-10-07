**CHANGES_REQUESTED — Spec/correctness, precredential source gate.**

Reviewed base/effective merge base `407608ab929e703cd2b10972de93cf00c58aa9df` → candidate `0d004d92d9c988b662189b288259cd9699351259`. This session’s runtime metadata confirms **GPT-6.1-sol/high**, read-only, approval policy never. Uncommitted edits appeared during review; findings remain bound to the candidate Git objects, with candidate line numbers below.

1. **P1 — Active reconciliation still loses some OPERATOR_HOLD results.**  
   [production-publication.ts:551](/home/serveradmin/insignia-m5-018-worktree/packages/database/src/repositories/production-publication.ts:551) returns OPERATOR_HOLD when `current()` fails without persisting `adminReconciliation`; the activated-status/effective-pointer check at line556 has the same omission. Only remote-field mismatch persists the diagnostic.

   Counterexample: activate an operation, increment its authorization epoch through the existing signing-key lifecycle, then replay its original publication request. `current()` rejects the old epoch, so POST reports OPERATOR_HOLD. However, durable progress remains `active`, activation remains `RESTORED`, and the effective operation still matches. The next authenticated GET at [merchant-config.ts:296](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/server/merchant-config.ts:296) therefore projects ACTIVE. The editor immediately performs that GET after publication at line833, replacing the detected hold with Active. New-request admission also sees no reconciliation hold.

   This violates brief §§2–4: truthful durable operator state and no misleading mounted activation success. Persist the diagnostic for every applicable active-reconciliation refusal while preserving terminal phase and immutable activation/hold evidence. Add an epoch/key-premise regression covering POST, GET, reentry and subsequent request admission.

2. **P2 — Existing browser scenario cannot complete after the authorization fix.**  
   [editor-browser.test.mjs:863](/home/serveradmin/insignia-m5-018-worktree/apps/web/test/admin/editor-browser.test.mjs:863) switches from a403 save to another save without reloading. The preceding denial now correctly invokes `clearPrivate()` through [MerchantConfigEditor.tsx:691](/home/serveradmin/insignia-m5-018-worktree/apps/web/src/islands/MerchantConfigEditor.tsx:691), clearing `view` and removing the editor and Save button. Consequently, the next click waits for a nonexistent button, preventing the later validation/ambiguous-save checks from executing.

   This conflicts with brief §7’s full browser-suite requirement. Assert private-state removal, then perform a fresh authenticated reload before the remaining cases, or isolate them. Preserve the authorization-clearing behavior. This is a source-traced failure; I did not execute Playwright.

I examined the full diff/log, all seven changed source files and six changed test files; complete relevant admin production/auth/HTTP/readiness/preview/runtime and UI/API routes; durable-core/config/command/publication/activation/recovery repositories and relevant migrations; application activation, v1/v2/v3 contracts and recovery; Shopify identity/catalog/publication/ownership and availability adapters; and worker composition/handlers/runtime. I read AGENTS, ledger, operating model, relevant plan sections, the full M5-018 brief, report/matrix, both original reviews, dispositions and regression receipts.

The authorization race, explicit409 and stale-observation corrections address their reported counterexamples. Remote-field drift is now durable, but finding1 limits that correction’s completeness.

Git-object comparison found **2,690 pre-existing evidence/spike blobs unchanged**; historical v1/v2 availability source and migrations are unchanged. Both rendered-log manifests match committed SHA256 values.

The bounded initial read-only live procedure respects the release boundary. Pending embedded outcomes are appropriate at this stage. I inspected existing receipts and personally ran no tests/builds/SQL, used no credentials/provider/browser/Shopify CLI, edited nothing and delegated nothing. Full root/PG/eleven-workflow success remains unverified here. This verdict grants neither credential access nor principal approval.