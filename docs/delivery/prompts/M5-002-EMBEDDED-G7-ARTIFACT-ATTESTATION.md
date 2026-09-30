# M5-002 — live embedded G7 qualification and Function artifact-attestation boundary

## Status

Authorized only after the exact approved normal merge of PR #27.

Use **actual GPT-6.1-sol high throughout**:
- local orchestrator/integrator;
- all writers/subagents;
- Spec/correctness reviewer;
- Standards/security reviewer.

This slice does not activate ProductConfig publication and does not implement
the all-channel commerce hold.

## Goal

1. Exercise the real embedded Admin/editor flow on the designated dev store
   using Shopify's isolated dev-preview mechanism.
2. Introduce an explicit Function artifact-attestation contract so readiness
   can distinguish source-only, dev-preview and later release-bound evidence.

## Shopify dev preview

Shopify currently documents that `shopify app dev` creates a development
preview isolated to the chosen dev store and that `shopify app dev clean`
restores the active released version.

Authorized target only:
- app resource `429028933633`;
- client ID `1443cf6d03d39edae7c101a943c5c684`;
- `insignia-rewrite-dev.myshopify.com`.

Before start:
- record current preview/released-version state;
- verify exact app/store;
- verify no unrelated operator preview will be overwritten.

After testing:
- run `shopify app dev clean`;
- verify preview removed and released version restored.

No `shopify app deploy`.
No `shopify app release`.
Do not globally upgrade Shopify CLI just for this slice.

## Live embedded G7 matrix

Capture:
- cold embedded launch;
- product list;
- direct deep link to retained archived product `gid://shopify/Product/10485042479387`;
- reload;
- Admin navigation away/back where practical;
- bearer token replacement/failure recovery;
- concurrent `idToken()` single-flight behavior;
- desktop and mobile;
- an actual browser context with third-party cookies blocked/disabled if the harness supports it;
- Polaris upgrade, Preact hydration and direct Konva construction;
- real product title/variant/image metadata;
- typed editor control → preview synchronization;
- no private config/product JSON in unauthenticated SSR.

Using a disposable local PostgreSQL DB:
- seed only the verified designated shop/install;
- create/save/reload one local ProductConfig;
- one CAS conflict;
- one ambiguous-save recovery.

Local DB mutations are authorized.

## External ceiling

During the live preview:
- max 30 Admin GraphQL reads;
- max 4 existing-scope Admin auth/token exchanges;
- max 4 Partner activeSubscription reads;
- ZERO Shopify GraphQL mutations;
- ZERO App Events;
- ZERO product/metafield/publication/Market/inventory/cart/order mutation.

Credential files may be read only by the sole serialized operator:
- `/home/serveradmin/.local/share/insignia-public-app/server.env`
- `/home/serveradmin/.local/share/insignia-public-app/partner-read.env`

Never print, copy into evidence, modify or commit secrets.

## Function artifact-attestation model

Current Shopify `ShopifyFunction` observations can attest app ownership,
Function ID/handle/API type/version and input query, but not a deployed Wasm
hash. Keep that limitation explicit.

Create a typed application contract approximately:

```ts
FunctionArtifactAttestation {
  schemaVersion
  shopId
  installationGeneration
  appClientId
  sourceCommit
  appVersionRef | devPreviewRef
  transform: { functionId, handle, apiVersion, inputQuerySha256, wasmSha256 }
  validation: { functionId, handle, apiVersion, inputQuerySha256, wasmSha256 }
  evidenceKind
  observedAt
  expiresAt
}
```

Trust classes must distinguish at least:
- `SOURCE_ONLY`: local source/build only; never readiness-authoritative.
- `DEV_PREVIEW_OBSERVED`: exact build + current dev-preview Function object observation; development diagnostics only.
- `RELEASE_BOUND`: reserved for later trusted deployment/app-version evidence; required for production activation.
- `BEHAVIORALLY_VERIFIED`: optional later controlled commerce/Function probe evidence.

Do not collapse these classes.

If persisted, attestations are append-only, versioned, tenant/install scoped,
immutable and secret-free.

## Readiness integration

Replace the hard-coded runtime-identity dead-end with a port consuming:
- observed owned Function identity/query information;
- expected build/source identity;
- trusted artifact attestation.

Rules:
- source-only rejects;
- dev-preview evidence may enable a **development diagnostic** path only;
- no production activation from dev-preview evidence;
- absent/stale/mismatched attestation rejects.

Keep exact public-config/key/effective-revision requirements.

Do not call M3 activation in this slice.

## Browser-flake stress

PR #27 foundation attempt 1 failed one dirty-geometry preservation assertion
and then passed unchanged.

Add a no-retry stress harness for:

`dirty or ambiguous geometry edit -> publication continuation success/failure
 -> draft + canvas + exact pending save remain unchanged`

Run the four dirty/ambiguous × success/failure cases repeatedly (for example
10 iterations each).

On first failure capture:
- owner state version;
- selected placement;
- numeric input value;
- projected geometry;
- publication metadata.

Do not hide failures with automatic test retry.

If it reproduces, fix the underlying race before returning.

## G7 evidence register

Record PASS/PARTIAL/NOT_RUN/FAIL for:
- cold launch;
- deep link;
- reload;
- cookie-blocked/mobile;
- expired identity;
- staff authorization;
- mutation origin/CSRF;
- private SSR;
- Polaris/Preact;
- token refresh concurrency;
- SDK bundling;
- grant cache/reinstall invalidation;
- ambiguous-save recovery.

Do not mark G7 complete unless every required shipping-scope criterion is
actually evidenced and principal-adjudicated.

## Tests

Attestation:
- wrong source commit/Wasm/query hash/Function ID/handle/app ID;
- stale/prior-install evidence;
- dev-preview evidence rejected by production readiness;
- matching dev-preview evidence accepted only by diagnostic path.

Regression:
- full M1–M5-001 suite;
- PostgreSQL;
- Shopify adapters;
- Function replays;
- boundaries/secrets/history;
- geometry stress.

## Review method

At most two non-overlapping GPT-6.1-sol high writers:
- Writer A: artifact attestation/readiness;
- Writer B: embedded/live G7 harness.

One GPT-6.1-sol high integrator owns shared root/CI/evidence.

Fresh independent read-only GPT-6.1-sol high:
- Spec/correctness;
- Standards/security.

## Acceptance

M5-002 is principal-reviewable when:
1. dev preview is isolated to the designated store and fully cleaned;
2. real embedded Admin/editor evidence is captured;
3. cookie-blocking state is measured or explicitly NOT_RUN with reason;
4. local CAS/recovery works under the embedded flow;
5. Function ownership observations bind to typed artifact evidence;
6. dev-preview evidence cannot become production activation authority;
7. production readiness fails closed without RELEASE_BOUND evidence;
8. the PR #27 geometry path passes repeated no-retry stress or is fixed;
9. prior CI remains green;
10. fresh GPT-6.1-sol high reviewers find no unresolved material issue.

## Out of scope

No Shopify mutations, actual policy/public-config writes, ProductConfig
activation, cart/checkout/order, app-version release, production keys/FX,
artwork/R2, M6/M7 or billing events.

## Handoff

Return one PR with exact refs, model/session evidence, dev-preview cleanup
receipt, G7 matrix, browser/cookie evidence, artifact-attestation examples,
geometry stress results, external-read register, final-head CI and fresh
reviewer dispositions.

Stop for principal review.

No M5-002 merge, activation slice, Function release, M6/M7, gate pass or launch
is authorized.
