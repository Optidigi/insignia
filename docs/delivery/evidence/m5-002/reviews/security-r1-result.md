**Standards/security: CHANGES_REQUESTED.** Two concrete source defects remain.

1. **P1 — Preview authentication cannot reach Shopify.** [preview-server.mjs:21](/home/serveradmin/insignia-m5-002-worktree/scripts/m5-002/preview-server.mjs:21) calls `fsyncSync`, but the import on line 2 omits it. The first token exchange enters `reserve('adminAuth')`, writes the reservation, then throws `ReferenceError` before calling the transport. Import `fsyncSync` and verify the actual launcher with a synthetic transport before starting the authorized preview.

2. **P2 — Stress failures cannot capture projected geometry.** [MerchantConfigEditor.tsx:1104](/home/serveradmin/insignia-m5-002-worktree/apps/web/src/islands/MerchantConfigEditor.tsx:1104) uses `JSON.stringify(project)`, where `project` is a function. This evaluates to `undefined`, leaving the diagnostic attribute absent. A geometry-preservation failure therefore captures `projectedGeometry: null`. Serialize the current projection, such as `project(editor)`, and verify that the captured value is valid scene JSON.

No additional material security finding emerged. Production readiness requires `RELEASE_BOUND` evidence, an independent expected build and matching current observations; development evidence does not grant activation authority.

The clean worktree remained at verified base `28e69864ebb9796504861a541363880cc86a82f8`, head `336db3b6bf21b4f45f8372d07a8b70c75861620e`, tree `4841a448d60657897e17cafee1c94ab207cb23db`.

I read all **28 changed files in full**, including complete editor/browser tests, preview sources/tests/launcher, attestation/readiness sources/tests, workflows, configuration and documents. Interacting reads covered authentication, HTTP/origin controls, production composition, merchant commands, Shopify SDK/catalog transport, key/config requirements and tenant queries.

**Executed:** read-only Git and file inspection only. Supplied logs record passing build, application **110**, Shopify **93**, PostgreSQL **52**, HTTP **8**, and stress **40** checks; I did not rerun them.

Live preview, embedded G7 outcomes and cleanup remain pending evidence. They are separate from these defects. This review does not grant principal approval.