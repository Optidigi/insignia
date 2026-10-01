# PR #28 principal review — CHANGES_REQUESTED (live-evidence blocker only)

## Binding

- Repository: `Optidigi/insignia`
- PR: `#28`
- Base/effective merge base: `28e69864ebb9796504861a541363880cc86a82f8`
- Reviewed head: `0b08c033d7a5609e2cfde219d5b76d4822d29723`
- Reviewed tree: `19a031897116f1a2a11384afc040dbcce19fd9fe`
- Synthetic merge: `d91c152fec6691a52a564c26d553a8bbd7010f3c`
- Synthetic merge parents: exact base + reviewed head
- Synthetic merge tree: exact reviewed tree

PR #27 merge `28e69864ebb9796504861a541363880cc86a82f8`
has the exact previously approved parents and tree.

The native GitHub REQUEST_CHANGES action returned HTTP 403 and was not posted.
This file is the external principal verdict.

## Source disposition

No material source defect was found in the reviewed M5-002 implementation.

Accepted source-side design includes:
- strict `FunctionArtifactAttestation` parsing and scope binding;
- distinct SOURCE_ONLY / DEV_PREVIEW_OBSERVED / RELEASE_BOUND trust classes;
- production readiness requiring RELEASE_BOUND;
- current owned Function-object observation remaining separate from expected build and attestation authority;
- no reconstruction of deployed Wasm identity from Shopify Admin observation;
- diagnostic preview composition fenced from publication;
- local disposable PostgreSQL editor/CAS/ambiguous-response recovery;
- per-attempt external accounting;
- zero-mutation diagnostic transport;
- 40-case no-retry dirty/ambiguous publication stress with real Konva construction and missing-renderer negative control.

All ten exact-head workflows succeeded.

Fresh GPT-6.1-sol/high Spec/correctness and Standards/security reviews found no unresolved material SOURCE defect.

## Blocking evidence finding

M5-002 cannot be accepted or merged yet because the corrected live runtime was never exercised in Shopify.

The one successful M5-002 dev preview ran against source
`dd880d36c9b653d83ec84ccddf7c202585b06408` plus CLI-generated extension UIDs.

That live run failed before hydration because CLI development mode caused the built Astro runtime to emit a hydration bootstrap not admitted by the existing CSP.

Consequences:
- cold embedded launch: FAIL;
- Preact hydration: not proved;
- authenticated staff identity/token exchange: not reached;
- product/catalog reads through the diagnostic app: not reached;
- local disposable-DB create/save/CAS/ambiguous recovery: not reached live;
- owned Function ID/query observation: not reached;
- deep-link/reload live path: not proved.

The preview was then cleaned successfully.

The final reviewed head adds the narrow correction:

`prepareBuiltPreviewRuntime(process.env) -> set NODE_ENV=production -> import built Astro server`

The correction reproduces the exact development-mode CSP failure locally and passes full built list/editor response checks without relaxing CSP.

However, that corrected launcher was not rerun live because the prior principal authorization allowed only one successful preview.

Therefore the final source is locally proven but the defining M5-002 live criterion remains unproved.

## Artifact-attestation judgment

The attestation model is accepted as source design.

Production quote readiness calls only the RELEASE_BOUND assertion.

A DEV_PREVIEW_OBSERVED attestation cannot satisfy production readiness.

No production release attester exists yet, which is correct at this stage.

Live Shopify Function handle display by itself is not accepted as typed artifact identity. The corrected preview must obtain the owned Function IDs, handles/API/query hashes through the authenticated diagnostic observation.

## Preview cleanup accepted

The prior preview cleanup is accepted:
- `shopify app dev clean` exited successfully;
- native Admin showed no active preview;
- active released version returned to `insignia-1` / `1146748534785`;
- application URL returned to `https://example.com`;
- embedded flag / API version matched prestate;
- installation ID remained `gid://shopify/AppInstallation/1054356963611`;
- the same nine actual grant handles remained.

No Shopify Admin GraphQL mutation, App Event, commerce operation or production release occurred.

## Required correction

Keep PR #28 open.

Run exactly one additional corrected development preview using the exact final runtime correction.

No new feature work is authorized.

The corrected live proof must, at minimum, establish:
1. hydration succeeds under the existing CSP;
2. embedded cold launch reaches authenticated UI;
3. retained archived-product deep link and reload work;
4. real Polaris/Preact/Konva editor shell initializes;
5. actual product metadata is read;
6. disposable local PostgreSQL create/save/reload succeeds;
7. one local CAS conflict is observed;
8. one post-commit ambiguous-save recovery replays exactly;
9. current owned Transform + Validation Function IDs/handles/API/query hashes are captured through the typed diagnostic path;
10. production readiness still rejects DEV_PREVIEW_OBSERVED evidence;
11. cleanup restores the exact released state and retained grants.

Cookie-blocked/mobile may remain NOT_RUN only if the available browser harness still cannot enforce/observe them; record the concrete limitation. Do not infer a pass.

## Verdict

CHANGES_REQUESTED for live evidence only.

The implementation should not be churned unless the corrected preview exposes a real defect.

No merge, activation, Function release, M6/M7, gate pass or launch is authorized.
