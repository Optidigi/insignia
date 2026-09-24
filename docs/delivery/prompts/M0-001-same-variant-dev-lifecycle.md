# M0-001 — same-variant expansion: development-store lifecycle

Principal-issued: 24 September 2026. Executor: local sol-6-high orchestrator.

## Outcome and authority

Build and run the smallest reproducible Rust Cart Transform experiment that tests a real garment variant expanded into exactly one child of that same variant, at a fixed higher unit price. Follow it through Shopify Online Store checkout, test payment, inventory, native fulfillment, refund and restock. Return one implementation/evidence PR.

This is the first implementation slice, not another preflight. It contributes development-store evidence to G1. It does not implement or accept G2–G8, the complete app, production checkout security, or the pricing engine.

The principal approved PR #2 at base/effective merge base `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb` and head `dda65d4f0570123035dd09ec3c9f9922d6df4ebf`. Start repository changes from the actual remote main after the maintainer merges that reviewed PR. A merge by the agent requires the user's separate, exact-PR delegation. This new principal instruction supersedes the historical PF-002-only routing for M0-001 after these prerequisites; update the operational pointers accordingly.

Local implementation is authorized after the merge. Remote staging actions are authorized only when the user explicitly accepts the permission envelope below, for example by sending the companion launch message. Missing remote permission does not block local code/tests; it does block installation and store mutations.

## 1. Resume the reviewed project

Read root AGENTS, decision ledger, operating model, PF-002 evidence, this slice, and implementation-plan sections 5, 6, 13–16 relevant to the experiment. Use pinned writing-for-agents for documents, tdd for behavior, diagnosing-bugs when a reproducible defect appears, and code-review for the fresh local review. Their defaults do not expand this slice.

Verify the repository identity, actual merge, working tree and base SHA. Preserve user work. Create `spike/m0-001-same-variant` or an equivalent clearly named new branch; do not append to PR #2. Record the principal's attributed approval and the real merge result in delivery state.

Use the **actual verified** Codex execution route with explicit model `gpt-6-sol`, reasoning effort `high` and native multi-agent disabled. Use bounded workspace-write for implementation and a fresh read-only session for review. Shell sandbox controls do not authorize MCP/network mutations; expose only the approved tools/credentials to the mutation operator. Keep mutation-capable connectors disabled in the reviewer. Use the proven Rust/CARGO_HOME/RUSTUP_HOME and explicit host-linker settings; do not require default `cc` or repeat model-attestation probes. Recheck only capabilities affected by this harness.

One writer; one serialized staging operator; fresh sequential local review. No parallel store mutations.

**Complete when:** the merged base, branch, current slice, runtime and active test-resource ownership are recorded without repeating answered setup questions.

## 2. Named resources and permission envelope

Use only:

| Resource | Identity |
|---|---|
| Rewrite repository | `Optidigi/insignia`, ID `1386102402` |
| Shopify organization | `212732011` |
| Existing app | `insignia` |
| OAuth client ID | `942e6668fd1177524c0fc48b104b0ac3` |
| Owner-attested Dashboard binding | `https://dev.shopify.com/dashboard/212732011/apps/427859050497` |
| Development store | `insignia-staging.myshopify.com` |
| Expected shop ID | `gid://shopify/Shop/78935261342` |

After user acceptance, permitted remote work is narrowly:

- Configure a development preview of this existing app; install/reauthorize it on this staging store; use a temporary developer-hosted app URL/tunnel if the CLI requires it; upload the spike Function through the dev-preview route and activate one spike-owned Cart Transform.
- Request only justified scopes within this ceiling: `write_cart_transforms`, `write_products`, `write_inventory`, `read_locations`, `read_orders`, and `read_merchant_managed_fulfillment_orders`, including read counterparts where the API requires them. Start with the smallest subset. Record each scope's actual API use. Prefer native Shopify Admin for fulfillment/refund actions rather than requesting extra write scopes. No `read_customers`, `read_all_orders`, billing, theme-write or fulfillment-service-management scopes.
- Create a clearly tagged synthetic product, ordinary real size/color variants, and limited fixture inventory at an existing designated merchant-managed test location. Publish only the fixture product to the staging Online Store as necessary; use native admin rather than granting publication-write scopes solely for convenience.
- Create test carts and a small number of test orders through the Online Store; perform native test fulfillment, partial/full refunds and restocking for these exact orders. Use synthetic buyer data, suppress notifications where possible and never use a real customer's email, payment instrument or address.
- Use the staging store's existing documented test-payment route. Enabling a built-in test-only gateway on this confirmed dev store is within this envelope when no live credentials, fees or real payment processing are involved; record the change and previous test state. A live gateway/account change, real charge, paid label or ambiguous payment path is not authorized.
- Clean up only this slice's artifacts: delete its own transform, end its own dev preview, archive/unpublish its fixture product, and appropriately finish/archive the synthetic orders after preserving sanitized evidence. Keep an explicit resource ledger. Do not erase unrelated test work or historical order evidence.

The app installation and narrowly granted scopes may remain on staging for subsequent reviewed work; disclose them. Do not uninstall the app as blanket cleanup or revoke unrelated existing scopes.

**Not permitted:** new app/store creation; public/custom distribution selection; App Store submission; released app versions/`app deploy`; changing the store's plan; production access; real billing; disabling other apps' Functions; theme redesign; arbitrary inventory correction to hide a test failure; broad credential collection; privileged host changes; merging M0-001. Stop the affected action if the supported development path requires one of these.

Check the store/app IDs immediately before mutation. If ownership, preexisting installs or other active app versions contradict the staging-only assumption, isolate the affected action and report the contradiction. Owner designation is not permission to affect other installations.

## 3. Freeze the hypothesis and build only its harness

Use a self-contained directory such as `spikes/m0-001/` with a minimal Shopify development project, Rust Function, local fixtures/tests and scripts. Put the test cases under its `gates/nonplus-same-variant/` directory. Keep gate evidence at the plan's `spikes/evidence/G1.md`. Necessary top-level changes are operational routing, a safe `.gitignore`, and a single offline CI workflow. Do not initialize the complete apps/packages/database/admin workspace.

Use the existing app configuration, not a new app. In particular, do not select Shopify's formal **extension-only/App Home UI extension** template: current documentation restricts that route to custom distribution. A small ordinary developer-hosted app stub is acceptable if needed for CLI development/install; it proves nothing about final embedded-admin authentication. Use the smallest Node/TypeScript stub needed, with no authenticated data or admin API exposed through it. No React/SPA template, fee-product template or legacy application copy.

Pin the harness's relevant package, Rust SDK, CLI and schema versions with lockfiles. Start with Admin/Function API `2026-07`, verify the actual schema through the working Shopify developer route, and record the version returned. If unavailable or incompatible, report the exact contract change; do not silently use unstable or an older operation. Keep host-specific linker paths in documented environment inputs rather than committing `/home/serveradmin/...` as a requirement for every checkout. The local Zig linker is optional tooling, not application architecture.

The only price operation under test is:

```text
lineExpand
  exactly one expanded child
  child merchandise ID = the original real variant ID
  child quantity = 1 relative to the parent
  child fixedPricePerUnit = a predetermined fixture price
```

No `lineUpdate`, `linesMerge`, synthetic fee variant, second child, catalog-price mutation, static-bundle substitution or silent `requiresComponents` change may be used to obtain a passing result. A visible parent/group wrapper is evidence to evaluate, not automatically an extra physical purchase; inspect its actual line, inventory and fulfillment semantics rather than double-counting or hiding it.

Scope the Function to an explicit fixture variant allowlist and a namespaced M0-001 line marker. Ignore buyer-supplied price values. Unmarked/unknown merchandise must be untouched. Keep each physical-quantity multiplier in one place and output O(cart lines), not O(garment quantity). Preserve a small opaque fixture correlation property through the observed cart/order path. This marker is **not authorization**. Production pricing, Ed25519, quote acceptance, missing-token enforcement, and the independent Validation Function remain unimplemented and cannot be claimed secure by this spike.

Use fixed shop-currency values in a matching presentment context. Read the real currency; do not assume EUR or change Markets. Example: fixture catalog unit 20, fixed customized unit 30, quantity 3 gives pre-discount merchandise 90 rather than 60. Keep taxes, discounts and shipping separate in observations. Exact decimal/minor-unit assertions are required; no tolerance. General currency conversion, setup rounding and SDK decimal hardening are later gates.

**Complete when:** committed input/output fixtures and tests describe the exact hypothesis, the build produces real Shopify Function Wasm, and the only price-changing path is the intended same-variant expansion.

## 4. Local checks before staging

Write failing tests first. Cover: empty/unmarked cart; a marked allowlisted variant at quantities 1 and 3; two allowlisted variants; a plain line mixed with customized lines; unexpected marker/variant; and a large input quantity whose output stays bounded. Verify exactly one child, same variant and relative child quantity 1 in every positive case. Do not characterize the large local fixture as accepted real-store cart capacity.

Run Rust formatting, clippy, native tests, the actual release Wasm build, schema/fixture validation and Wasm execution through Shopify's runner or test helpers. Record the binary hash and basic resource measurements, without claiming G2 capacity. Add a minimal GitHub Actions job running only these local deterministic checks with pinned actions/tool versions and `contents: read`; no Shopify secrets, store mutations, `pull_request_target` execution or automatic deployment. Other future suites are not prerequisite boilerplate.

**Complete when:** the exact built Function has reproducible local outputs and relevant offline checks. If API output is rejected locally, fix or report that concrete result before store testing.

## 5. Establish the development installation and test the lifecycle

Current distribution is `UNVERIFIED`. Keep it that way unless actually observed. Current Shopify docs provide Function testing through `app dev`; attempt that supported development route without selecting a distribution method. Do not demand a missing Dashboard section repeatedly or silently classify the app. If the route is rejected because of app type/distribution/permissions, preserve the exact error, finish independent local work, and return a blocked gate result. Do not select Custom, create another app or switch to `lineUpdate` as a workaround.

With accepted permissions, link the existing app, apply the minimum development scopes and complete test-store installation. Independently read the installed app identity/scopes and exact shop through this app's authorized API route, not an unrelated admin token. Verify app dev is using this store and does not release changes to other installations. Use a unique Function handle. Query existing transforms; do not replace another transform. Activate the spike Function using the current schema, with `blockOnFailure=true`, and record the returned handle/resource and userErrors. This prevents runtime fallthrough in the experiment; it does not prove G6 integrity.

Exercise these cases with release-built Wasm and exact observed inputs/outputs:

| Case | Required observation |
|---|---|
| Control | Unmarked fixture remains at its catalog price; unrelated merchandise remains untouched. |
| Quantity 1 then 3 | Parent quantities produce 1 then 3 real units, not 1 total and not quantity squared; customized pre-discount price is exact. |
| Cart edit | Change quantity and remove/re-add the fixture using native Ajax cart behavior; operation remains deterministic and no unwanted merge/double expansion appears. |
| Multiple variants/plain coexistence | Two real size/color variants retain their IDs and quantities; a plain line stays plain, including same-variant coexistence where supported. |
| Test order A | Complete Online Store checkout with test payment; inspect original/current pre-discount prices, real variant/SKU IDs, purchased quantities, group/component structure, custom attributes and fulfillment order mapping. Inventory falls exactly once by the purchased physical quantities at the expected location. |
| Native partial/full fulfillment | Fulfill part and then the remainder of A through Shopify's ordinary UI, without shipping/charging anything real. IDs, quantities and inventory commitments remain correct. |
| Refund/restock and repeat | On A and, where needed to cover unfulfilled cancellation, a second test checkout B, perform a one-unit refund with restock and a remaining/full refund/cancellation with the appropriate restock choice. Confirm correct monetary basis, original real variant/location and no double restock. Repeated checkout uses the same merchant variants, not an allocated catalog slot. |

Initial orders must come from actual Online Store checkout, not `orderCreate`, draft-order pricing or a fabricated order JSON. Keep the number of tests small and record any unexercised G1 cases. Snapshot available/committed/on-hand quantities at relevant lifecycle points; do not equate fulfillment with a second available-stock decrement. Distinguish native refund calculations from a manually entered amount. Record all parents/components needed for honest interpretation, not just a filtered child view.

Capture sanitized Ajax cart responses, Function inputs/outputs, Admin order/fulfillment/refund/inventory projections and representative native UI evidence. Preserve fixture correlation identifiers but omit cookies, cart-key secrets, bearer tokens, addresses and other buyer data. Larger evidence must have an approved retrieval route, integrity hash and retention handling.

**Complete when:** the tested cases have expected-versus-observed evidence through the real development-store lifecycle, or a reproducible platform/access/semantic failure is isolated. A failed lifecycle is a valid spike result; do not repair inventory or rewrite prices afterward to hide it.

## 6. Qualification, cleanup and handoff

Keep one gate record at `spikes/evidence/G1.md`, with a machine-readable manifest under the spike: source/build commits; API/tool/package versions; Wasm hash; known store plan/development status; app/client identity and distribution uncertainty; granted scopes; test IDs; expected/actual prices and physical quantities; observations; cleanup; remaining cases; and the precise claim supported.

Use the existing gate states. G1 becomes `IN_PROGRESS` when execution starts; label each tested case PASS/FAIL/BLOCKED individually. A wholly blocked external run can leave G1 `BLOCKED` with its cause. This slice cannot mark overall G1 PASS because representative public-app/non-Plus production qualification is still outstanding. Development stores have exceptional capabilities. A successful development-store lifecycle is not App Store approval, public distribution or proof of non-Plus merchant availability. G2–G8 remain NOT_RUN; overlap observations are not gate executions.

A reproducible same-variant lifecycle failure reopens non-Plus materialization for principal review. A distribution/access error is not the same as a disproved algorithm. Report those separately. Do not build another pricing architecture or proceed to the full product on either basis.

Remove the spike-owned active transform and end its dev preview before handoff. Preserve sanitized order evidence; unpublish/archive fixture products and disclose residual test orders/install/scopes and any cleanup that was blocked. Cleanup touches only owned IDs from the resource ledger. Do not use blind store reset commands.

Run one fresh sequential read-only fixed-ref review, then rerun affected checks. Open one PR containing harness code, scoped offline CI, instructions and evidence. Bind the handoff to actual PR/base/head/effective merge base, not just a local path. Link this principal review as an attributed external predecessor; never manufacture a native approval. Keep both architecture files unchanged; clarify historical operating details in delivery state instead.

**Stop at principal review.** Do not merge M0-001, start M0-002/M1, execute the other gates, choose distribution or release the app. No automation or background completion is assumed.

## Checked source pointers

Use these as evidence and revalidate against the installed CLI/schema, not as substitutes for a run:

- Function dev-store testing and local/Wasm test layers: `https://shopify.dev/docs/apps/build/functions/test-debug-functions`
- Cart Transform contract, component pricing and exceptional development-store privileges: `https://shopify.dev/docs/api/functions/2026-07/cart-transform`
- Activation walkthrough: `https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-customized-bundle-function`
- Activation mutation and permissions: `https://shopify.dev/docs/api/admin-graphql/latest/mutations/cartTransformCreate`
- Development CLI: `https://shopify.dev/docs/api/shopify-cli/app/app-dev`
- Distribution selection (irreversible; not authorized here): `https://shopify.dev/docs/apps/launch/distribution/select-distribution-method`
- Formal extension-only/custom-distribution restriction: `https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app`
