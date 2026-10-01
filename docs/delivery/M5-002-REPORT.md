> **M5-002R correction — 1 October 2026.** The 1 October correction is recorded in [M5-002R-REPORT.md](M5-002R-REPORT.md): corrected hydration and local create/open were observed, but live recovery/Function binding remain incomplete and exact retained-grant cleanup is ambiguous. The original report below is preserved as a historical receipt.

# M5-002 outcome — diagnostic implementation, cleaned preview, live G7 blocked

## Disposition

Implementation and local regressions are reviewable. **Live G7 is not closed.** The one successful temporary development preview exposed a built-server runtime/CSP mismatch before Preact hydration, identity exchange or draft access. Its narrow correction passes a complete built-server regression locally. It was not rerun live after cleanup: the one-preview limit is preserved. No publication activation, release, commerce operation or full gate is claimed.

The principal decides whether to accept the implementation and authorize a bounded corrected live qualification. There is no current login, credential-placement or scope-expansion request.

## Fixed refs and execution provenance

PR #27 was normally merged only after exact base/effective merge base `f8fff36fca749c6b2b6666550e48c7e347b6d65f`, head `506f2b39e5713563dc4f5b2beed3937489985bd7`, tree `5ef7c9337177da96b6589589c8468a3c823f389e`, external principal approval and ten successful exact-head workflows were verified. Actual remote merge is `28e69864ebb9796504861a541363880cc86a82f8`; ordered parents are those exact base/head and resulting tree is the approved tree. This is this slice's base. No native approval was manufactured. See [merge receipt](evidence/m5-002/PR-027-actual-merge.json).

Root runs actual GPT-6.1-sol/high through the trusted T3 runtime. Writer A used explicit `codex exec --model gpt-6.1-sol -c 'model_reasoning_effort="high"' --sandbox workspace-write`, network disabled, in a separate worktree. Root integrated it and wrote the non-overlapping diagnostic/UI/CI surfaces; root alone operated Shopify. Fresh independent reviewers used actual GPT-6.1-sol/high with read-only sandboxes. Selected same-launch session metadata, full-source review dispositions and isolation qualifications are in [reviews](evidence/m5-002/reviews/) and [root runtime](evidence/m5-002/root-runtime.json). Restricted filesystem write policy does not prove every outside file unreadable. Credentials were prohibited to workers/reviewers; only the root operator had permission for designated credential use.

CLI version 0.159.2, Node 24.21.0, pnpm 12.6.0, Rust 1.98.1, PostgreSQL 18.6 and pinned workspace dependencies were reused. No host package/security changes.

## Artifact authority and readiness

The application exports schema-version-1 immutable, strictly parsed artifact contracts, with separate `SOURCE_ONLY`, `DEV_PREVIEW_OBSERVED` and `RELEASE_BOUND` classes. Expected build/source/hash/Function/app/installation identity comes through an independent port. Current owned Function objects remain a separate observation. Admin object observations cannot attest uploaded Wasm bytes or propagation.

Development diagnostics may accept matching fresh development evidence. Production readiness requires `RELEASE_BOUND`, current owned observations, exact build/source/query/Wasm identity, installation generation, existing public configuration, keys, effective revision and active owned Function pair. Missing/stale/drifted evidence fails closed. No production release attester or activation operation is implemented.

The [synthetic executable example](evidence/m5-002/synthetic-attestation-example.json) was accepted only by the diagnostic assertion and rejected by production. It is **not live attestation**. Local tests cover changed source/query/Wasm/IDs/handles/app/install, malformed evidence, stale observation and prior installations. No actual live Function ID/query binding was obtained because hydration stopped the diagnostic query. The native dev console did show both expected handles, but that alone cannot satisfy the typed identity contract.

[Actual CLI artifact receipt](evidence/m5-002/actual-preview-artifacts.json) binds the attempted live source to `dd880d36c9b653d83ec84ccddf7c202585b06408`, with only CLI-generated extension UID differences. Actual final Wasm hashes were:

- Transform: `76e890cf702a6bc182e8ca8b55942260f33a5bc5e072d42c2f104a72161a4ddb`, 181570 bytes.
- Validation: `51cd4867fa5c8181eac421c65e3e7fd210662213c3705ffe5cfc8c8d4a085207`, 183160 bytes.

`wasm_opt=false`; CLI source-build hashes matched the prelaunch artifacts. No Function source/schema/wire change. Generated UIDs were recorded and reverted locally after cleanup; they were not adopted as production Function identity. Uploaded Wasm identity is not independently returned by Shopify.

## Actual preview and cleanup

Exact app/client/shop/install were verified before and after:

- App `gid://shopify/App/429028933633`, client `1443cf6d03d39edae7c101a943c5c684`.
- `insignia-rewrite-dev.myshopify.com`, Shop `gid://shopify/Shop/105501393179`.
- Installation `gid://shopify/AppInstallation/1054356963611`.

Before start, the active released version was `insignia-1` / `1146748534785`, embedded, URL `https://example.com`, API `2026-07`. The native Admin showed the known stopped M0-014 preview, old handles and a failed old tunnel; no current local operator was found. No unrelated preview was overwritten.

First CLI invocation aborted during local compilation because the established scoped native linker was omitted from that command's environment. Native Admin still showed the unchanged old preview afterward; no new M5 preview and no diagnostic request occurred. The known terminated local lock owner and unchanged durable register were verified before recovering that owned lock. Failure is preserved in [receipt](evidence/m5-002/failed-cli-start.json) and [log](evidence/m5-002/dev-aborted-sanitized.log).

The corrected environment built both Functions, and **one successful M5 preview** became active with the nine existing scopes and the two expected handles. No `app deploy` or `app release`. Native embedded launch reached `/apps/insignia-1/admin/products` and displayed the development/local-draft/publication-disabled shell.

However, CLI `NODE_ENV=development` caused Astro's built renderer to emit a development hydration bootstrap whose SHA-256 `SHXg3YtOAVshUMT3f+eElYDgbV0kaujWj8DSaXSS4Vs=` was absent from the existing CSP. The screen's “Verifying Shopify Admin session…” was SSR text, **not authenticated or hydrated evidence**. No diagnostic SDK request or local tenant seed occurred. The actual iframe scripts were not inspected by exporting tokens/session data. Local direct HTTP inspection identified the exact emitted-script/header conflict.

Correction: the diagnostic launcher now invokes `prepareBuiltPreviewRuntime` before importing built Astro output, explicitly selecting production **runtime mode**. This does not change the preview's diagnostic authority. Both complete built list/editor responses now allow their actual inline script hashes; CSP is unchanged, with no script `unsafe-inline` or `unsafe-eval`. The [red regression](evidence/m5-002/csp-runtime-red.log) fails before this correction; [green regression](evidence/m5-002/csp-runtime-green.log) includes the uncorrected-development negative control. A normal-coordinate click worked; iframe-locator clicks returned T3 client automation errors. Main-frame snapshots do not inspect iframe text/console, so their wait results are not credited as inner-frame proof.

The preview was stopped, `shopify app dev clean --config m5-002 --store insignia-rewrite-dev.myshopify.com` succeeded, and native Admin reload showed **no preview**. Native Dev Dashboard verified the same active release resource, URL `https://example.com`, embedded flag and API version. A fixed post-clean query returned the same installation and **same nine scope handles**. Released Dashboard scope display and retained actual grants are separately recorded. No repair preview, reinstall or scope cycle was run. See [cleanup receipt](evidence/m5-002/cleanup-receipt.json), [clean log](evidence/m5-002/clean-sanitized.log), [identity readback](evidence/m5-002/identity-after.json).

## External accounting and final resources

[Durable register](evidence/m5-002/external-register-sanitized.json): **2 Admin read operations; 2 conservative CLI authentication reservations; 0 diagnostic token requests; 0 Partner reads**. CLI transient authentication internals are opaque; reservations are not provider-private wire attestation. The custom diagnostic transport durably reserves every underlying fetch attempt, including SDK retries, serializes them and rejects unauthorized targets/operations and exhausted ceilings. No diagnostic fetch occurred in this stopped live run.

Zero Shopify Admin GraphQL mutations, App Events, product/metafield/publication/Market/inventory/cart/order mutation. No billing calls, scope expansion, production key/FX activation or unrelated cleanup. No local tenant/config was seeded in the diagnostic DB. Only the package preview/config override was cleaned; historical commerce, billing/run registers, other apps/stores and unrelated preview holding states remain unchanged. Deliberately retained stopped operator lock/register is not silently reset or reused.

## G7 register — shipping criterion is separate from local tests

| Criterion | Actual live result | Local result / remaining obligation |
|---|---|---|
| Cold embedded launch / list | **FAIL**: static shell; hydration blocked | Built-runtime red/green closes source defect; corrected live qualification pending |
| Archived-product direct deep link / reload / away-back | **NOT_RUN** authenticated | Local browser navigation passes; no live claim |
| Cookie-blocked / mobile | **NOT_RUN** live | Shared tools expose no third-party-cookie policy; resize is desktop CSS, not mobile UA. Synthetic mobile/cookie-free tests retained |
| Expired identity / bearer replacement / staff permissions | **NOT_RUN** live | SDK/auth failures, scopes and replacement covered with synthetic identity; live shipping coverage pending |
| Origin/CSRF | **NOT_RUN** live | Existing authenticated HTTP negative tests retained; diagnostic cannot publish |
| Private SSR | **PASS**, unauthenticated local HTTP to actual preview process | No private draft/config payload, only route props/public client metadata |
| Polaris/Preact/Konva | **NOT_PROVED / FAIL hydration** live | Real registered-component controls and Konva browser tests pass locally; CSS appearance is not credited |
| Token single-flight / grant-cache / reinstall invalidation | **NOT_RUN** live | Exact-token bounded cache, verification per call, fresh current installation, rejected exchange/expiry/token replacement and generation change tests pass |
| SDK bundling | **PASS local**, live initialization not reached | Server-only adapter; browser/server dependency and secrets checks pass |
| Local create/save/reload/CAS/ambiguous recovery under embedded flow | **NOT_RUN** live | Complete SDK + disposable PG test passes; post-commit loss survives and exact replay remains stable |
| Current owned Function identity/query → typed evidence | **NOT_RUN** live | Independent contract/normalization and rejection tests pass; native handle display alone insufficient |

## Stress and local reviews

Strict no-retry stress: **40/40** (ten each dirty/ambiguous × publication success/failure). It waits for three real Konva canvases, ready renderer and actual edited projection before baseline, then checks draft, canvas, owner/selection and exact pending request preservation. Missing-renderer control fails as intended. Failure capture includes owner version, placement, numeric input, projected scene and publication metadata.

Preserved failures: old PR #27 unchanged-pass-on-retry history; an initial local projection capture regression; two earlier server-start failures (cause **unestablished**, not attributed to EADDRINUSE); missing-renderer expected failure; missing-fsync red; CLI linker abort; real live CSP mismatch and its complete-server red. Startup now uses an OS-assigned port and actual listening address with bounded diagnostics. The historical geometry race was **not reproduced** in the corrected forty cases; its original cause remains undetermined.

Fresh initial Spec/security full-source reviews found missing fsync, function-versus-scene capture and empty-canvas false positive. They were fixed; fresh rereviews read all current changed source and found no material issue. Final exact-head review/CI refs belong in the PR body, not a self-referential commit. Local reviewers do not adjudicate G7 or replace principal review.

Remaining acceptance: corrected live embedded matrix, live local DB recovery, real Function ID/query diagnostic binding, supported cookie/mobile/staff/expiry coverage, release-bound Function evidence, publication activation and all-channel admission contract. No invented hold, large-history query-plan benchmark, merchant capacity, M6/M7, full gate or launch claim. v1.4 plan/ledger and prior historical artifacts remain unchanged.
