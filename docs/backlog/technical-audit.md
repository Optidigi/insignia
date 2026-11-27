# Technical audit checklist

The 26 November 2026 audit attachment, `insignia-local-agent-review.md`, assigned these 48 IDs.
The local review compared the attachment's source `f249353d` against `e7420b83`. This checklist
records dispositions and links to the evidence. [Delivery state](../delivery/state.md) owns the
running releases. The [specification](../architecture/implementation-plan.md) owns requirements.

The owner chose to hold resubmission for the worker and merchant stability pass. See the
[review checklist](../delivery/shopify-review-resubmission.md) for the merchant walkthrough,
USD and EUR purchase checks, and the owner's submission step.

| ID | Status | Evidence and next step |
| --- | --- | --- |
| INS-01 | Deployed on AY | [Orders batching](https://github.com/Optidigi/insignia/pull/683) batches hydration and artwork authority before projection. Frozen-preview metadata remains a per-group read. |
| INS-02 | Deployed on AY | [Order query](../../packages/database/src/repositories/purchase.ts) reads only the latest observation for list rows. Detail and privacy export retain history. |
| INS-03 | Deployed on AY | [Artwork-bearing SQL-count regression](../../apps/web/test/purchase-flow.test.mts) observed 17 core statements for one and two displayed orders. Preview queries are outside that count. |
| INS-04 | Deployed on AY | [Built browser check](../../apps/web/test/admin/home-guide-browser.test.mts) verifies English plus the chosen language. Local English Home JavaScript fell from 371,160 to 151,222 gzip bytes. |
| INS-05 | Measure | The [contracts root](../../packages/contracts/src/v1/index.ts) makes an isolated artwork constant import large. Measure the actual Designer graph before adding a narrow export. |
| INS-06 | Deployed on AY | [Merkle issuer](../../packages/cart-authorization/src/line-v3.ts) builds one tree, with byte equality at sizes 1–32. The local 32-line stub-signer measurement fell from 8.606 ms to 0.355 ms. |
| INS-07 | Deployed on AZ | The [settlement scan](../../scripts/release/launch.mts) still visits all phases. A read-only prototype checking four at a time matched all 1,011 live phase results. Median scan time fell from 1,761 ms to 1,317 ms over three alternating samples. The installed AZ scanner measured 1,383 ms median on the same 1,011 phases. Queue and end-to-end collection time remain separate. |
| INS-08 | Measure | [Trusted-release reader](../../packages/database/src/repositories/trusted-release.ts) queries current privileges and evidence separately. Keep refusal for writable consumers if combining the reads. |
| INS-09 | Measure | [Trusted-release reader](../../packages/database/src/repositories/trusted-release.ts) hashes and parses evidence on read. Profile before caching immutable content. Preserve live authority and expiry checks. |
| INS-10 | Deferred | [Collection](../../scripts/release/collector.mts) repeats app observations for different shops. Any sharing must preserve the opening and closing agreement and installation-specific evidence. |
| INS-11 | Retain | The [signing policy](../architecture/implementation-plan.md#84-acceptance-and-cart-application) requires release evidence no older than 30 seconds at signing. |
| INS-12 | Measure | [Effective revision](../../packages/database/src/repositories/accepted-quote.ts) performs separate reads and bypasses the buyer revision cache. Reuse only immutable revision data if the saving warrants it. |
| INS-13 | Measure | [Lean pricing](../../packages/domain/src/pricing/lean.ts) and normalization may validate the same config. Profile with INS-12 and keep external validation and immutable outputs. |
| INS-14 | Measure | [Rule selection](../../packages/domain/src/pricing/evaluate.ts) scans rule arrays repeatedly. Check representative placements and rules before indexing. |
| INS-15 | Retain Lean policy | [Lean pricing](../../packages/domain/src/pricing/lean.ts) constrains new prices. Preserve stored economics and historical verification when simplifying the generic evaluator. |
| INS-16 | Deployed on AZ | [Discovery lease fix](https://github.com/Optidigi/insignia/pull/684) claims each shop as work starts and retains cursor and installation fences. |
| INS-17 | Deployed on AZ | [Worker reconciliation](../../apps/worker/src/reconciliation.ts) runs two passes on the 30-second tick. A blocked discovery regression verifies another cleanup tick runs and shutdown drains both passes. |
| INS-18 | Measure | [Artwork restore](../../apps/storefront/src/designer/live-ports.ts) reads preview descriptors serially. Measure multi-artwork reopen before adding bounded parallelism. |
| INS-19 | Measured, deferred | In a local six-image presign fixture, [loading the profile](../../packages/storage/src/profile.ts) per image took 4.165 ms median per request versus 1.813 ms with per-request reuse. The probe used synthetic credentials, no R2 requests and no Orders SQL. On AY, read-only preview queries for 11 USD groups and 5 distinct revisions took 3.28 ms median versus 1.57 ms when deduplicated. The EUR fixture had 5 groups and 5 distinct revisions, with about 1.6 ms either way. Keep the existing reads for this pass. |
| INS-20 | Measure | [Theme integration](../../apps/storefront/src/theme-integration.ts) rescans on broad DOM changes. Profile real theme churn before narrowing the observer. |
| INS-21 | Retain pending measurement | [Designer startup](../../apps/storefront/src/designer/frame.tsx) bounds the Latin font wait and loads other faces after open. Measure cold start, fallback and layout shift before changing typography behavior. |
| INS-22 | Deferred cleanup | [Shared CSS](../../frontend/designer/src/style.css) contains demo selectors. Move clearly demo-only rules during related work and retain shared responsive behavior. |
| INS-23 | Deferred cleanup | [Old renderer](../../packages/visualizer/src/renderer.ts) survives alongside the [active renderer](../../frontend/visualizer/src/renderer.ts). Align the boundary check first and retain geometry. |
| INS-24 | Deferred cleanup | [Konva boundary](../../scripts/boundaries/check.mts) covers the old package. Retarget it to the live renderer and keep the [built negative control](../../scripts/runtime/missing-renderer-control.mts). |
| INS-25 | Deferred cleanup | [Usage runtime](../../apps/worker/src/usage-runtime.ts) supplies no production metering. Account for historical obligations before retiring durable machinery. |
| INS-26 | Retain historical verification | [Rust v2 fixtures](../../crates/cart-authorization/tests/production_vectors.rs) serve as oracles. Separate shared primitives only if worthwhile. [TypeScript v2 reconciliation](../../packages/application/src/purchase/reconcile.ts) remains required. |
| INS-27 | Measure | [Rust decoder](../../crates/cart-authorization/src/line_v3.rs) checks canonical base64 beyond decoding. Require differential rejection tests and Wasm instruction evidence before simplifying. |
| INS-28 | Deferred hardening | [Artwork](../../apps/web/src/server/artwork/body.ts) and [webhook](../../apps/web/src/server/shopify-webhook.ts) readers differ on deadlines and cancellation. Preserve raw webhook bytes and route-specific limits when consolidating. |
| INS-29 | Measure | [Function replay](../../scripts/functions/replay.mts) reports resources. Collect instruction and memory headroom across normal, maximum and failed cases before setting a budget. |
| INS-30 | Resolved | [Foundation](../../.github/workflows/foundation.yml) shares one build and [Runtime](../../.github/workflows/runtime.yml) removed redundant web invocations. Independent restricted-role checks remain. |
| INS-31 | Deferred cleanup | [Editor](../../frontend/admin/src/islands/SelectedProductEditor.tsx) and [publication](../../apps/web/src/server/merchant-config.ts) compose several responsibilities. Extract where a tested change makes state ownership clearer. |
| INS-32 | Deferred cleanup | [Frontend ownership](../../frontend/README.md) records live dependencies of `examples/admin/support`. Move verified shared code incrementally and preserve standalone examples. |
| INS-33 | Partial | The [root commands](../../README.md) were corrected. [Visualizer documentation](../../frontend/visualizer/README.md) still has an outdated dependency version. |
| INS-34 | Deferred cleanup | [Verifier receipts](../../scripts/release/collector.mts) mark the deployed digest and SDK HTTP attempts unasserted. Clarify legacy OAuth counts without rewriting historical receipts. |
| INS-35 | Partial | Intent-only Designer loading and scoped stock hints are live. [AW and AX validation](../delivery/shopify-review-resubmission.md#deploy-aw-validation) retains the observed limits. Keep independent Market stock and remaining performance evidence open. |
| INS-36 | Owner deferral | [First publication](README.md#after-the-hardening-pass-25-nov-2026) has a 10-second p95 target. Keep the current hold checks through approval and measure cold first publish separately. |
| INS-37 | Deployed on AY | [Artwork admission](../../packages/database/src/repositories/artwork.ts) bounds the storefront lock wait at two seconds. A timeout rolls back and returns a retryable 409. Post-order links keep their existing policy. |
| INS-38 | Deployed on AZ | [Catalog transport](../../packages/shopify/src/catalog.ts) types connection and response-stream failures as transient. Safe reads use the existing busy response. Auth, parse and uncertain-write outcomes keep their existing paths. |
| INS-39 | Retain retry contract | [Admin HTTP](../../apps/web/src/server/admin/http.ts) treats provider internal errors on safe reads as retryable. Judge persistent outage copy from bounded retries and telemetry. |
| INS-40 | Partial | [AZ](../delivery/shopify-review-resubmission.md#deploy-az-validation) verified stable-name queries returning both AY and AZ entries for each service. The 48-hour baseline remains open. |
| INS-41 | Open UX | [Products view](../../frontend/admin/src/islands/ProductsOverview.tsx) renders Insignia publication independently of Shopify status. Clarify both states. |
| INS-42 | Open UX | [Setup Copy](../../frontend/admin/examples/admin/support/placement-setup-copy-dialog.tsx) keys by ID. Reproduce duplicate titles on the affected picker and add a discriminating label if needed. |
| INS-43 | Retain calibration basis | [Editor calibration](../../frontend/admin/src/islands/SelectedProductEditor.tsx) uses the base image. Explain the prerequisite where useful. |
| INS-44 | Open UX | [Placement setup](../../frontend/admin/examples/admin/support/placement-workflow-model.mts) derives the price-required reason. Surface it where it explains the offer state. |
| INS-45 | Deferred cleanup | [Editor return handling](../../frontend/admin/src/islands/SelectedProductEditor.tsx) still consumes `chooseMethods`. Check saved links and preserve independent placement and image parameters. |
| INS-46 | Deployed on AZ, native check open | The [built editor fixture](../../apps/web/test/admin/selected-config-rejection-browser.test.mts) reproduces the first preflight refusal when its reconciliation request fails. The client clears unchanged custody for the definite new refusal. Prior, accepted and access-denied writes retain their reconciliation paths. Repeat the duplicate-product check natively. |
| INS-47 | Native check open | [Built editor fixtures](../../apps/web/test/admin/selected-config-rejection-browser.test.mts) adopted the saved baseline after inherited defaults changed or eligibility paused publication. The original blank EUR product walkthrough still needs a native recheck. |
| INS-48 | Owner deferral | [Server refactor inputs](README.md#server-refactor-input-insignia) cover aliases, database names and host inspector routing. Preserve deployment history and wait for the planned refactor. |
