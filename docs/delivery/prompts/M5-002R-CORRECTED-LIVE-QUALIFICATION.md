# M5-002R — corrected live embedded qualification

## Scope

Continue EXISTING PR #28.

The M5-002 source implementation is already review-clean.

This correction exists only because the final runtime-mode fix was never executed in a real Shopify dev preview.

Use actual GPT-6.1-sol high throughout:
- sole orchestrator/operator;
- any necessary writer;
- fresh final Spec/correctness reviewer;
- fresh final Standards/security reviewer.

Do not start M5 activation, M6 or M7.

## One additional preview authorization

Authorize exactly ONE new successful `shopify app dev` preview against:
- app resource `429028933633`;
- client ID `1443cf6d03d39edae7c101a943c5c684`;
- store `insignia-rewrite-dev.myshopify.com`.

Before starting:
1. verify PR #28 exact source/head;
2. verify exact app/store/install IDs;
3. verify no unrelated active dev preview/operator will be overwritten;
4. create a new correction-specific durable attempt register;
5. record active released version and current actual grants.

The final launcher must use `prepareBuiltPreviewRuntime()` before importing the built Astro server.

No source change merely to obtain a different preview result.

## External ceiling for this correction

Additional correction-specific ceiling:
- maximum 20 Admin GraphQL read attempts;
- maximum 6 Admin auth/token-exchange attempts or conservative reservations;
- zero Partner API reads;
- zero Shopify Admin GraphQL mutations;
- zero App Events;
- zero product/metafield/publication/Market/inventory/cart/order mutations.

The diagnostic transport must reserve before every attempt, including retries.

Existing credential files may be read only by the sole operator as already authorized:
- `/home/serveradmin/.local/share/insignia-public-app/server.env`
- `/home/serveradmin/.local/share/insignia-public-app/partner-read.env`

Never print, modify, commit, or copy credentials/tokens/session values into evidence.

## Required live proof

### Hydration / shell
Prove the actual embedded iframe reaches a hydrated state, not merely SSR text.
Capture bounded evidence that:
- Preact hydration executed;
- Polaris custom elements upgraded;
- direct Konva renderer constructed;
- no CSP error blocked the bootstrap;
- CSP itself was not relaxed.

### Authenticated embedded flow
Prove:
- cold launch;
- archived product list/detail;
- direct deep link to `gid://shopify/Product/10485042479387`;
- page reload;
- fresh identity recovery if the session token changes/expires naturally during the bounded run.

### Local disposable PostgreSQL flow
Use only the diagnostic disposable database.
Prove through the live embedded UI:
- create/open local ProductConfig;
- save;
- reload;
- one CAS conflict;
- one committed-save response loss and exact replay/recovery.

No remote publication call.

### Function observation
Through the authenticated diagnostic server path, capture the normalized owned Function observation for both adopted v2 Functions:
- provider Function ID;
- handle;
- API type/version;
- input-query SHA-256;
- app/client binding;
- tenant/install binding.

Do not claim uploaded Wasm hash from Admin.

Construct DEV_PREVIEW_OBSERVED evidence only if expected build, actual dev preview reference and normalized Function observation match.

Then prove:
- development diagnostic assertion accepts it;
- production readiness rejects it because it is not RELEASE_BOUND.

## Browser conditions

Attempt:
- desktop embedded;
- mobile viewport;
- third-party-cookie blocked context.

If the tool does not expose a reliable cookie policy, record NOT_RUN with the exact limitation. Do not infer PASS from bearer design.

Mobile resize alone is PARTIAL unless an actual mobile/browser context is used.

## Cleanup

After live observations:
1. stop the dev process;
2. run `shopify app dev clean --config m5-002 --store insignia-rewrite-dev.myshopify.com`;
3. verify no preview remains;
4. verify exact released app version/resource;
5. verify application URL / embedded flag / API version;
6. verify installation ID;
7. verify retained grant set;
8. verify no owned local processes remain.

If cleanup fails or remote state is ambiguous, stop and return for principal direction. Do not start another preview.

## Code-change rule

If the corrected live proof passes:
- do not change production code;
- update only sanitized evidence/report as needed;
- rerun exact-head CI if the PR head changes for evidence.

If the live proof exposes a material defect:
- fix it on the same PR;
- run local red/green;
- obtain fresh GPT-6.1-sol high full-source reviews;
- rerun complete final-head CI;
- no second additional preview is authorized automatically.

Return to principal review.

## Acceptance

M5-002R is complete only if:
- corrected hydration is actually observed live;
- authenticated embedded list/detail/deep/reload is observed;
- live diagnostic local DB recovery is exercised;
- owned Function identity/query binding is obtained;
- dev-preview evidence remains non-production;
- exact cleanup/restoration succeeds;
- no unauthorized external operation occurs.

No M5 activation or G7 gate pass is implied automatically.
