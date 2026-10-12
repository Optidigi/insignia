# Independent spec review — round 1

Candidate 08c7ab26a4699484fb38e33a2bcd195eaa4981da; base 36945927e3fedc72c44247ec8357eb669186c0c6; tree b1c27c8496fc7d91a6ec85a20b7a975b9a9640d0.

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-spec-r1-08c7ab26

Reviewed `3694592…08c7ab2`; candidate tree matches `b1c27c8`. Seven material findings:

1. **P1 — Oversized guest bodies hang authentication.** [guest.ts:80](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/server/artwork/guest.ts:80) awaits cancellation of a cloned request stream while the original branch remains unread. A 4-KiB unauthenticated JSON request stayed blocked; cancelling the original released it. This defeats the bounded private-body admission contract and allows request exhaustion. Parse once or cancel both branches without blocking rejection.

2. **P1 — One missing upload starves every later asset.** [artwork-runner.ts:112](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/worker/src/artwork-runner.ts:112) aborts the entire pass on one processing error. Completing an upload without PUT produces `NOT_FOUND`, which [artwork.ts:284](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:284) treats as retryable. Oldest-first selection repeatedly retries that asset until expiry, skipping other tenants’ work. Reproduced across two passes. Plan §11 requires “Retry transient storage errors only”; isolate asset failures and bound retries.

3. **P1 — Product permission grants private-original download authority.** [http.ts:73](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/server/artwork/http.ts:73) authorizes downloads using `canRead`, derived solely from product scopes in the existing authenticator. A product-read-only actor knowing an asset UUID receives a download response for any artwork in that installation. Plan §6.1 requires “per-use-case permissions” for artwork/downloads. Preserve an explicit artwork grant through authentication and enforce it here.

4. **P1 — Presigned uploads bypass byte quotas.** [storage/index.ts:169](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/storage/src/index.ts:169) signs only `content-type;host`; declared length never reaches this boundary. A publicly admitted guest can declare one byte and PUT substantially larger content repeatedly during URL validity. Inspection eventually rejects it, but storage admission/accounting remains bypassed. Plan §12.1 says “do not rely on browser size checks.” Bind an enforceable size constraint or supply another authoritative admission bound.

5. **P2 — Merchant-enabled logo-later cannot pass quote usability.** [artwork.ts:334](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:334) returns `unavailable` for every deferred intent. The acceptance use case requires every returned choice to be usable. Thus the new default production port rejects explicitly permitted logo-later designs. Plan §3.3 allows “an explicit logo-later intent.” Reproduced directly; authorize deferred intent under the published policy.

6. **P2 — Custom-domain storefront requests are rejected.** [guest.ts:31](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/server/artwork/guest.ts:31) accepts only the canonical `myshopify.com` Origin. Valid signed proxy requests carrying a merchant’s custom storefront Origin fail. Reproduced locally. The supported Online Store scope needs verified custom-domain handling. WORKLIST acknowledges qualification remains pending, but the deterministic rejection is a code limitation.

7. **P2 — Preview expiry clears still-usable artwork selection.** [ArtworkUpload.tsx:40](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/islands/ArtworkUpload.tsx:40) clears the preview, download controls and `onPreview` selection after five minutes, although the asset remains usable for seven days. Users must reupload instead of refreshing access. Plan §12.3 separates stable asset identity from short-lived URLs; retain selection and renew the derivative URL.

Existing web and runner tests passed **8/8 each**. These probes establish local defects, not native acceptance. Presigned S3, actual proxy forwarding, G7/authentication, privacy/uninstall and verifier obligations remain separately open.

**Cumulative architecture verdict:** Exact-byte promotion and domain/Shopify/renderer boundaries remain coherent; whole-quote economics are preserved. Material admission, authorization, retry and usability defects prevent a clean M6 correctness verdict.

Disposition: material findings remain open. No publication or merge acceptance.

