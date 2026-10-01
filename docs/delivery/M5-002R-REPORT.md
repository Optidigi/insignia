# M5-002R — corrected hydration observed; qualification remains blocked

## Disposition

Continue existing [PR #28](https://github.com/Optidigi/insignia/pull/28). **BLOCKED_EVIDENCE; exact cleanup is ambiguous.** One additional corrected development preview was run and stopped. Production source and tests are unchanged. New CI/local regression failures are retained below. No second preview, scope repair, release, publication or further Shopify request was performed after the cleanup discrepancy.

The [external principal review](PR-028-principal-review.md) accepted source at base/effective merge base `28e69864ebb9796504861a541363880cc86a82f8`, head `0b08c033d7a5609e2cfde219d5b76d4822d29723`, tree `19a031897116f1a2a11384afc040dbcce19fd9fe`. All ten reviewed-head workflows were green before work. The [correction authority](prompts/M5-002R-CORRECTED-LIVE-QUALIFICATION.md) authorized one further preview, not merge or gate acceptance. The full original [report](M5-002-REPORT.md) remains a historical receipt; this dated correction supersedes its current live disposition, without replacing its failed run or local evidence.

## Actual launch and accounting

On 1 October 2026 UTC the sole operator used actual GPT-6.1-sol/high through the trusted T3 runtime. No implementation writer or second remote operator was used. The exact reviewed launcher called `prepareBuiltPreviewRuntime(process.env)` before importing built Astro output. Existing scoped Rust/linker tooling was used; no CSP relaxation, host change or production source change.

Executed:

```text
PUBLIC_SHOPIFY_API_KEY=1443cf6d03d39edae7c101a943c5c684 corepack pnpm --filter @insignia/web build
node --test scripts/m5-002/read-register.test.mjs scripts/m5-002/built-runtime.test.mjs
shopify app execute --config m5-002 --store insignia-rewrite-dev.myshopify.com --query <fixed M5002RIdentity read>
shopify app dev --config m5-002 --store insignia-rewrite-dev.myshopify.com --skip-dependencies-installation
shopify app dev clean --config m5-002 --store insignia-rewrite-dev.myshopify.com
shopify app execute --config m5-002 --store insignia-rewrite-dev.myshopify.com --query <same fixed identity read>
```

All CLI commands used the verified rewrite worktree through `--path`; private raw CLI output stayed in ignored local files. The pre/post identity query is recorded in the receipts: shop id/domain plus current installation id, app id/client and grant handles. No token/session export or owner credential-file copy occurred.

The previous operator directory/register was archived intact in the local handoff. A **new correction register** enforced 20 reads / 6 auth attempts-or-reservations / zero Partner reads. The reviewed launcher retains its old 30/4/4 compatibility register; a temporary operator-only `NODE_OPTIONS` preimport installs a stricter outer transport only in `preview-server.mjs`. Its actual [guard](evidence/m5-002r/correction-operator-guard.mjs) and [durable correction register](evidence/m5-002r/correction-register.json) are exported for audit. It does not substitute provider data or alter application authority. Every diagnostic underlying attempt reserves and fsyncs before fetch; retries remain accounted. Wrong target, GraphQL mutation and App Events negative controls produced zero underlying fetches.

Actual totals: **15 Admin GraphQL reads** (13 diagnostic, two CLI identity reads), **six auth attempts/reservations** (two diagnostic online token-exchange HTTP attempts, four conservative opaque-CLI reservations for identity-before, dev, clean and identity-after), **zero Partner reads/mutations/events**. Cleanup reservations were held before launch and then executed. Two subsequent launcher auth reservations were blocked by the stricter correction guard before underlying HTTP; these do not represent additional sent token requests. The legacy mirror is separately retained, rather than presented as the correction budget.

The six-auth ceiling was reached after creating/opening the local draft. Further exchange-dependent actions stopped. Unused read allowance does not permit extra auth or another preview. No successful live save, conflict, response-loss or replay is claimed.

## Actual live observations

| Criterion | Result and direct evidence |
|---|---|
| Corrected cold embedded hydration | **PASS bounded**: native Admin reached `/apps/insignia-1/admin/products`; authenticated server events and populated archived-product list replace the static bootstrap. Preact execution is demonstrated by authenticated loading and create/open interaction. No hydration-blocking CSP failure was observed; complete local served-response checks pass with unchanged CSP. Native tools do not expose the iframe console, so this is not a claim that every iframe console entry was inspected. |
| Real retained product | **PASS**: list/detail showed archived `M0-014 Optional Checkout Fixture`, `gid://shopify/Product/10485042479387`, Small/Large variants; no product image was present. No metadata was fabricated or written. |
| Product navigation | **PARTIAL**: actual Configure-product click reached the retained-product editor route and authenticated detail. A separate cold direct-deep-link launch and authenticated full page reload were not completed before the auth stop. |
| Disposable PostgreSQL create/open | **PASS bounded**: DB started with zero shops/configs; verified provider identity bootstrapped the designated installation; live Create configuration committed one product draft, version 1, then the UI opened it. [Readback](evidence/m5-002r/local-db-readback.json) confirms that version. No production database used. |
| Save/reload/CAS/conflict/committed-response-loss exact replay | **NOT_RUN live**: no save committed. Existing complete SDK/PG and browser regressions remain local evidence only. The loss flag was not armed. No current-read recovery is mislabeled as exact replay. |
| Polaris / direct Konva | **PARTIAL, not qualified**: UI sections/controls rendered, and the visualizer displayed its unavailable-image fallback. The shared tool inspects only the main frame; iframe locators failed and coordinate interactions were used. Actual `customElements` upgrade and Konva instance/canvas identity were not independently inspected. Appearance/fallback is not accepted as real-component proof. |
| Fresh identity | **PARTIAL**: two real diagnostic online exchanges occurred at 08:40:45 and 08:42:21 UTC, with verified authenticated reads. No arbitrary staff/expiry/reinstall scenario is claimed. |
| Mobile / third-party cookies | **NOT_RUN live**: the available resize tool changes desktop CSS viewport only; it cannot supply a mobile browser context or enforce third-party-cookie policy. The bounded run stopped at auth exhaustion before a responsive diagnostic sweep. Local synthetic coverage remains separate. |
| Owned Function observation | **BLOCKED**: authenticated `InsigniaOwnedFunctions` returned a normalized observation with both Function identities **null**, `runtimeIdentity=unverifiable`, readiness unknown. The exact [observation](evidence/m5-002r/owned-function-observation.json) binds the verified tenant/install/client. Native dev console displayed expected handles but cannot replace actual Function IDs/API/query binding. The underlying cause is unestablished; absence, drift and provider representation must not be guessed. |
| DEV_PREVIEW_OBSERVED / RELEASE_BOUND | **No live attestation constructed** because actual Function identity did not match the expected build. Existing diagnostic-positive and production-rejection regressions remain synthetic/local. Production readiness was not enabled; no release-bound evidence exists. |

[Diagnostic events](evidence/m5-002r/diagnostic-events.json) record actual authenticated requests and the failed identity qualification. Native main-frame evaluate returned only sanitized iframe origin/path, never its token-bearing query string. Screenshots containing account details were not exported to Git. Source/API/build and operator observations are kept separate.

## Final artifacts

The [actual CLI receipt](evidence/m5-002r/preview-artifact-receipt.json) binds this corrected run to the reviewed source plus only CLI-generated extension UIDs, removed locally after stop:

| Function | Final Wasm SHA-256 | Bytes |
|---|---|---|
| Transform | `76e890cf702a6bc182e8ca8b55942260f33a5bc5e072d42c2f104a72161a4ddb` | 181570 |
| Validation | `51cd4867fa5c8181eac421c65e3e7fd210662213c3705ffe5cfc8c8d4a085207` | 183160 |

`wasm_opt=false`; CLI final build hashes match the retained source artifacts. These are build/upload-process receipts, **not Shopify Admin confirmation of uploaded Wasm identity**. Query hashes remain exact current source hashes. No synthetic identity is substituted for the null live observation.

## Cleanup discrepancy — remote work stopped

Before preview, the native Dashboard showed active release `insignia-1` / `1146748534785`, URL `https://example.com`, embedded true, API `2026-07`. Native Admin had no preview and its iframe pointed to example.com. No local unrelated dev/operator process existed.

The fixed pre-preview read returned the designated app/shop/install **and an empty grant set**, differing from the nine-grant historical M5-002 receipt. The preview auto-granted the existing nine configured scope handles. After stopping the process, `app dev clean` exited 0 and said it restored the active version; native Admin showed no preview and iframe origin `https://example.com` again. No owned CLI/preview-server/tunnel process remained.

However, the fixed post-clean read returned **nine grant handles**, not the empty current prestate:

```text
read_cart_transforms, read_inventory, read_locations, read_products,
read_validations, write_cart_transforms, write_inventory,
write_products, write_validations
```

Exact [before](evidence/m5-002r/identity-before.json) / [after](evidence/m5-002r/identity-after.json) identity matches app `429028933633`, client `1443cf6d03d39edae7c101a943c5c684`, Shop `105501393179`, installation `1054356963611`; **grant equality fails**. The cause/timing of the discrepancy is not proven. This is **ambiguous exact restoration**, not successful cleanup. No additional query, scope change, reinstall or repair preview was attempted. Post-clean exact released-version resource was not independently reread after this stop; CLI restoration and native example.com/no-preview observations are the narrower evidence.

Retained local resources: correction register/terminated operator lock, sanitized receipts and disposable local draft version 1. Historical resources, billing fixtures, orders and preview holding states are unchanged by application operations. No product/metafield/commerce/Partner/App Events call occurred. No merchant GraphQL mutation was sent.

## Local verification, new regression failures and principal direction

Pinned Node 24.21.0 / pnpm 12.6.0 were used. Public-key web build: exit 0. Six operator/complete built-runtime tests: **6/6 PASS**, including the raw development-mode CSP negative control and corrected before-import launch. Governance/source integrity is verified against the reviewed head. Earlier root/PG/stress results remain historical local receipts; the new stress failure below supersedes any current clean-stress claim. Fresh GPT-6.1-sol/high read-only Spec/correctness and Standards/security dispositions and new exact-head CI are returned in the PR body and evidence directory.

New final-head CI at evidence head `0e946ab8ad04b74d90618da0aaf6f43b4551b9d6` exposed two additional local blockers:

- Runtime workflow [36839365228](https://github.com/Optidigi/insignia/actions/runs/36839365228) failed the production-composition `current` assertion. Its synthetic billing cycle ended at `2026-10-01T00:00:00Z`, while the composition uses the real clock. Pinned Node 24 + complete source + disposable PostgreSQL reproduces the failure. A temporary **test-only** rolling-cycle proposal passes locally; it was then restored, not adopted under this source-preserving evidence package. [Red](evidence/m5-002r/production-fixture-red.log), [proposal green](evidence/m5-002r/production-fixture-green.log), [unadopted patch](evidence/m5-002r/NOT-ADOPTED-test-date-proposal.patch). Production expiry enforcement is not relaxed.
- Foundation workflow [36839365241](https://github.com/Optidigi/insignia/actions/runs/36839365241) failed the ambiguous/success publication stress case before its baseline: after the test entered `0.6`, numeric input/projected center remained `0.5`; the geometry wait timed out. A separate unchanged-source **40-case no-retry run returned 39 PASS / 1 FAIL**, iteration 7 dirty/success, with the same observed `0.5`. [Actual stress failure](evidence/m5-002r/stress-no-retry-current.log) and both failed workflow logs are retained. This is an unresolved reproduced regression, not a successful 40-case qualification or a proven causal diagnosis. No blind retry or production handler edit was used to manufacture green CI.

The [failure disposition](evidence/m5-002r/new-failure-disposition.json) separates local date-fixture diagnosis from the unresolved browser regression. Fresh initial source reviews cleared the unchanged source before these new CI results; fresh final reviewers must consider these failures, so the earlier clear disposition does not erase them. Final-head CI is reported as actually observed, including any failing workflow.

Principal direction is needed for these local regression blockers, the grant discrepancy and the remaining bounded live qualification: save/reload/conflict/exact replay, actual Function ID/API/query observation, and real component/browser coverage. No owner login, credential placement or general preflight is requested. **No additional preview or grant repair is currently authorized.** PR #28 stays open for rereview; no merge, activation, Function release, complete G7 pass, M6/M7 or launch.
