Local Spec/correctness disposition: **changes requested before preview**. Three concrete findings:

1. **P1 — External requests fail during accounting.** [preview-server.mjs:21](/home/serveradmin/insignia-m5-002-worktree/scripts/m5-002/preview-server.mjs:21) calls `fsyncSync`, but line 2 does not import it. The first token exchange or Admin read increments and writes the reservation, then throws `ReferenceError` before sending the request. Import `fsyncSync` and verify the actual launcher’s reservation path with a synthetic transport.

2. **P2 — Failure capture omits projected geometry.** [MerchantConfigEditor.tsx:1104](/home/serveradmin/insignia-m5-002-worktree/apps/web/src/islands/MerchantConfigEditor.tsx:1104) uses `JSON.stringify(project)` on a function, yielding `undefined`. The stress failure report therefore receives no projected geometry. Serialize the current projected scene and verify the capture contains its geometry.

3. **P2 — Canvas preservation can pass without a canvas.** [editor-browser.test.mjs:1074](/home/serveradmin/insignia-m5-002-worktree/apps/web/test/admin/editor-browser.test.mjs:1074) captures canvases without requiring renderer construction. If the asynchronous visualizer import fails or remains delayed, both snapshots can be `[]`, and equality passes. Wait for the expected Konva canvases and rendered edited geometry before taking the baseline; missing construction must fail.

No additional material issue found in independent source/hash/install matching, diagnostic versus release authority, retained production prerequisites, or local CAS/exact-request replay.

Verified clean worktree, exact base/merge-base `28e69864ebb9796504861a541363880cc86a82f8`, head `336db3b6bf21b4f45f8372d07a8b70c75861620e`, and tree `4841a448d60657897e17cafee1c94ab207cb23db`, unchanged at completion.

Inspected all **28 changed files in full**, including complete editor/browser tests, plus interacting authentication, catalog, merchant-config, tenant/config persistence and key-readiness source. Executed only read-only Git/file inspections and `git diff --check` (passed). Supplied logs report application 110, Shopify 93, PostgreSQL 52, integration 8 and stress 40 passes; I did not rerun them.

Live embedded outcomes, cookie measurement, live artifact observations, cleanup/grant-change receipt and final-head verification remain pending criteria. This review does not substitute for principal approval.