# Independent spec review — round 2

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-spec-r2-d0e73688

**Spec/correctness review: two new P2 findings remain open.** Verified HEAD `d0e73688bd58fc6fb0f5036ff93771ae79b8206f`, tree `4d40035e0804303011e6ace9ec30ce5027c94a49`; supplied base and original candidate trees also match.

1. **P2 — Valid artwork intermittently fails quote acceptance.**  
   [artwork.ts:359](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:359) captures a new observation instant, while [accept-quote.ts:388](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/quote/accept-quote.ts:388) compares it against an earlier instant captured before calling the port. Crossing one millisecond rejects valid artwork as a future observation. The new default production composition exposes this mismatch.

   **Reproduction:** use the existing acceptance fixture with the real `createArtworkUsabilityPort`, a USABLE asset retained for seven days, and a shared clock advancing one millisecond per call. Acceptance throws `artwork unavailable through complete quote window`. With the real clock, **9/50 attempts failed** locally. Validate observation freshness against a current post-read instant while preserving the acceptance-day and expiry fences. This affects both verified files and permitted deferred intents.

2. **P2 — Initial processing/preview failures discard the upload’s recovery identity.**  
   [artwork-upload.ts:118](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/islands/artwork-upload.ts:118) throws after polling exhaustion without returning the admitted asset ID. A transient initial preview failure has the same outcome. [ArtworkUpload.tsx:135](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/islands/ArtworkUpload.tsx:135) displays the error with no retained asset, leaving no status/preview retry or original-download action.

   **Reproduction:** return QUEUED for 120 polls, then make the admitted asset USABLE. The first call reports “Try again later”; retrying through the available upload action allocates `asset-2`, abandoning access to `asset-1`. Retain pending upload identity and resume status/preview retrieval without another allocation.

These findings are independently attributed to the **Spec/correctness axis**.

Prior findings’ disposition:

- **Spec #1 / Security #1, body hang:** locally resolved by the shared bounded read and nonblocking cancellation.
- **Spec #2 / Security #2, missing-upload starvation:** resolved by per-asset isolation, durable retry scheduling and terminal missing-upload handling.
- **Spec #3, private-original authorization:** locally resolved by explicit verified account-owner artwork grants. Staff artwork delegation remains unavailable.
- **Spec #4 / Security #3, byte quotas:** signature now binds exact request length. Native enforcement remains unqualified; reusable URLs still do not enforce cumulative transfer/request budgets.
- **Spec #5, logo-later:** published-policy validation and explicit intent allowlisting resolve the original rejection; finding 1 affects resulting acceptance.
- **Spec #6, custom domains:** deterministic application rejection is removed. Actual proxy forwarding and storage CORS for custom domains remain unqualified.
- **Spec #7, derivative expiry:** renewal preserves stable selection locally. Finding 2 concerns initial upload recovery.
- **Security #4–5, cleanup isolation/fairness:** per-row isolation, durable cooldowns and attempt-based ordering address the reported defects.

**Cumulative architecture:** exact-byte promotion, immutable manifests, private originals, separate raster derivatives, domain/Shopify/renderer boundaries and frozen economics remain coherent. The two correctness defects prevent a clean Spec verdict.

**Evidence and acceptance limits:** 65 focused local tests passed; neither new reproduction is covered by those checks. No database, browser, MCP, external network, credential or cloud operations were performed. Native S3/browser/proxy checks remain NOT_RUN; host-isolation evidence was not independently rerun, and Docker inspection remains unqualified. Late PUT resurrection, lifecycle timing and exact collection-deadline erasure remain unresolved guarantees. M5 authentication/G7/privacy/uninstall/verifier obligations remain open. This review grants no native acceptance, deployment, rollout or M7 authorization.

Disposition: two new P2 findings open; no integration acceptance.

