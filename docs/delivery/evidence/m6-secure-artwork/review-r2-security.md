# Independent Standards/security review — round 2

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-security-r2-d0e73688

**Standards/security: two open P2 findings; no new P1 code defect.** Review pinned to `d0e73688bd58fc6fb0f5036ff93771ae79b8206f`, tree `4d40035e0804303011e6ace9ec30ce5027c94a49`. Base and original-candidate trees also matched the supplied values.

1. **P2 — Queue maintenance failure still blocks artwork retention cleanup.** At [main.ts:70](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/worker/src/main.ts:70), artwork cleanup follows webhook retention and uninstall recovery inside one `try`. A failed expired-job removal propagates through [handlers.ts:89](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/worker/src/handlers.ts:89), preventing artwork cleanup on every reconciliation pass.

   **Reproduction:** Executed the production reconciliation function extracted from source, with successful payload erasure and a synthetic queue-removal exception. Two passes produced two reported failures and **zero artwork cleanup calls**. Persistent queue-specific failure therefore retains unrelated originals and derivatives indefinitely. This violates the independent cleanup/retry contract in plan §§10.4–11. Isolate each maintenance operation’s failure and preserve independent artwork cleanup.

2. **P2 — Quote artwork usability omits guest ownership authority.** [artwork.ts:393](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/artwork.ts:393) filters by tenant, generation, UUID and usable state, but not session ownership. The default quote composition now uses this port; neither its request nor `QuoteRequest` carries an owner capability.

   **Reproduction:** On the explicitly authorized synthetic PostgreSQL database, created one owned fixture for guest A. Guest B’s scoped asset lookup returned `null`, while the quote artwork port returned `usable` for that same UUID without owner authority. Exact fixtures were removed. Knowing another guest’s asset ID can therefore satisfy the current quote integration seam. Preserve verified owner/design authority—or an explicit authorized sharing grant—through this check. This is a code-level integration defect under plan §1.3; **no live buyer quote endpoint exploit was demonstrated**, and M7 remains unauthorized.

**Prior findings, independently reassessed:**

| Prior attribution | Disposition |
|---|---|
| Spec 1 / Security 1: oversized-body cancellation hang | Resolved locally: single bounded read, 2 KiB limit, three-second deadline, nonblocking cancellation. |
| Spec 2 / Security 2: missing PUT blocks other assets | Resolved locally: durable retries, terminal missing state at upload deadline, fair selection and per-asset runner isolation. |
| Spec 3: product scopes expose private originals | Resolved code-side: verified online account-owner grant required. Staff artwork access remains conservatively unavailable; native identity qualification remains open. |
| Spec 4 / Security 3: unsigned upload length | Exact length is now signed and locally checked. Native R2/browser enforcement remains unqualified; cumulative transfer/request quotas are **not** established. |
| Spec 5: all logo-later choices unavailable | Resolved locally: explicit deferred intents pass only after effective published placement-policy validation. |
| Spec 6: canonical-only Origin rejects custom domains | Deterministic rejection removed. Signed routing plus private body capability is coherent under correct proxy forwarding and no-ACAO response assumptions. Native forwarding remains unqualified. |
| Spec 7: derivative expiry discards selection | Resolved code-side: stable selection survives URL renewal; auth loss and actual asset expiry clear it. Browser evidence was inspected, not independently replayed. |
| Security 4: cleanup failure blocks unrelated deletion | Per-row service correction is sound, but the production-composition failure above leaves the end-to-end objection open. |
| Security 5: immutable-deadline resweep starvation | Corrected by durable attempt timestamps, cooldowns and never-attempted-first ordering. |

**Cumulative architecture verdict:** Exact inspected-byte promotion, separate private originals/raster derivatives, tenant/generation fences and immutable identity/manifest/deadline protections remain coherent. No material drift was found in pure-domain, Shopify SDK adapter, renderer or database-facade boundaries. SQL grants remove obsolete artwork column privileges and deny identity/expiry mutation; they provide table/column separation, **not row-level isolation**. The two P2 findings prevent a clean security verdict.

I independently ran **89 focused tests, all passing**, plus the two reproductions above. I made no source, commit, ref or role changes, and accessed no browser, connector, cloud service or private configuration. Unrelated uncommitted runtime-test changes appeared during review and were excluded.

Acceptance remains limited: native S3 presigning/browser CORS/actual proxy forwarding are **NOT_RUN**; the 108-byte MCP probe does not qualify them. Reusable URLs permit repeated same-size PUTs, and late in-flight writes plus eventual lifecycle cleanup do not prove exact collection-deadline erasure. Docker inspection remains unqualified. Exact-head CI and inherited M5 authentication/G7/privacy/uninstall/verifier obligations remain open. This review grants no milestone, deployment, rollout or M7 approval.

