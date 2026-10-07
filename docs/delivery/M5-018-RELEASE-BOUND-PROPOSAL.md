# M5-018 — single bounded release proposal

Status: NOT_EXECUTE_READY. The real stable admin entry is BLOCKED_RELEASE_BOUND, but release has not been proven to be the sole activation blocker. No release/deploy/enablement/scope operation is authorized or executed. This document is a concrete candidate delta plus explicit missing prerequisites, not an approval or complete M5 exit.

## Verified current target

- Exact app429028933633, organization200969036; public client1443cf6d03d39edae7c101a943c5c684 is the previously approved client/build binding.
- Current Active version1153019904001, name insignia-3, freshly observed through native read-only UI. Its application URL is https://example.com; embedded=true; legacy installation=false; API2026-07.
- Optional scopes remain exactly `write_products,read_publications,read_product_listings`. Required scopes remain empty under the accepted immutable-version release record; current details display no required-scope field. Current per-installation grants were not read. No scope request or regrant is proposed.
- The exact designated development installation is present and launches an Insignia iframe at https://example.com/. This cannot expose the frozen admin. No Function extension/module label appears in the active version details. This is not a complete per-store ownership/enablement inventory.

[Current observation](evidence/m5-018/live/observation.json), [accepted same-version release-form record](evidence/m5-010/native-release-result.json), [frozen source/build gate](evidence/m5-018/precredential-gate.json).

## One candidate delta

Bind this exact app to the frozen M5-018 Node/Astro admin and reviewed Function build, retaining all existing scope/config fields except the explicitly reviewed application-origin/extension delta. No Function code correction, publication discovery, M6/M7 or launch is included.

1. Concrete candidate application URL: `https://insignia.optidigi.nl/admin/products`, using the frozen production picker route. The owner recalled `insignia.optidigi.nl` as an earlier install link, without confirming its current role. Independent public HEAD returned200; a root GET displayed “Logo customization for Shopify merchants” and a POST `/auth/login` form, with no production-editor/App Bridge/Polaris markers. No login/install link was followed and no cookies/credentials/query were sent. This proves a reachable candidate host, not hosting/routing authority, the deployed rewrite or permission to replace the existing application. Preserve its existing root/login behavior. Before release, verify ownership and safely route only the reviewed `/admin/products` pages, `/api/admin/products` endpoints and required self-hosted `/_astro/` assets to this exact frozen build, with collision/isolation checks. `APP_URL` must be `https://insignia.optidigi.nl`, matching the server Origin/SDK host, while Shopify application_url uses the exact picker path. Do not substitute an ephemeral preview or choose a deferred infrastructure topology. [Public HEAD](evidence/m5-018/public-origin-check.json), [sanitized root response](evidence/m5-018/public-origin-body-check.json).
2. Candidate modules, if an authorized release proceeds: `insignia-experimental-v2-transform`, target `cart.transform.run`, export `cart_transform_run`; `insignia-experimental-v2-validation`, target `cart.validations.generate.run`, export `cart_validations_generate_run`; both API2026-07. These are the existing reviewed preproduction artifacts, not deployed Functions. Theme/storefront launch is excluded.
3. Server composition must receive the genuine authenticated release-record/build/Function/calendar capability through the existing server-only interface. Default runtime intentionally supplies no such authority and remains WAITING_RELEASE. Unsigned environment JSON, browser payloads or synthetic test evidence cannot substitute. Implemented contracts and local synthetic injection do not prove that a deployed binding exists.
4. Current installation generation, staff/grants, feature-to-plan commercial policy, per-store owned Function identities/enablement, operation/scope support, and total app installation inventory must be qualified before claiming that this delta is sufficient. No commercial values, Function UID, missing permission or scope uplift is inferred. These inputs remain UNKNOWN, so an executable exact release and sole-blocker claim cannot be supplied truthfully in this slice.

## Installation impact and rollback boundary

The one known designated development installation would receive the new app-origin/module configuration; no uninstall/reinstall is proposed. Keeping scopes unchanged avoids an intentional new scope request, but actual prompt/enablement behavior was not exercised. A version release affects the app's installation set, whose full inventory was not observed; a development-only impact guarantee is therefore not established. No other store is authorized for qualification or mutation.

Retain current version1153019904001 and its exact configuration as the app-origin/module rollback reference. Any future release authorization must specify the platform's supported return-to-version procedure, deployment artifact retention and Function enablement rollback. Those operations were not tested. Returning to the placeholder would restore the observed release boundary, not preserve new merchant functionality. Do not delete/reinterpret immutable revisions, activation evidence, hold JSONB, keys or durable claims during rollback. Unsettled restoration remains operator-owned; rollback must never replay a claimed write.

## Exact local artifacts and tests

Production source is frozen at2c84d8feb95f8ec29ef90ed84d2c99b13aa22d6e. The [inventory](evidence/m5-018/freeze-round4-inventory.json) binds396 source/config/test files and225 build files. Manifest SHA256 is `a9dd6b1057a2d9ee4a5eb471cd23e64d74092f11b2b10eca4d37d40a70b07f8a`; all48 required artifacts were hashed. Local app-specific bundle and generic CI bundle are differently configured; bitwise equality is not claimed.

| Artifact | Bytes | SHA256 |
|---|---:|---|
| `extensions/insignia-cart-transform/target/cart-transform.wasm` |181378| `49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576` |
| `extensions/insignia-cart-validation/target/cart-validation.wasm` |182968| `3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6` |
| `extensions/insignia-cart-transform/src/cart_transform_run.graphql` |764| `8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053` |
| `extensions/insignia-cart-validation/src/cart_validations_generate_run.graphql` |833| `a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5` |
| `extensions/insignia-cart-transform/shopify.extension.toml` |494| `7d9817aaa24a3a7f4d40408a656683ac41e523acbc613d9eae0906f9ce00ddc4` |
| `extensions/insignia-cart-validation/shopify.extension.toml` |531| `9d24f9d1e768851f49c7a76a4e95a36a57a762e22975fb28cfd6482c1ddfc534` |
| `apps/web/dist/client/_astro/MerchantConfigEditor.DP-cRyvJ.js` |33131| `9beb6d7bfec68ff2f618cb2756c22833e568b86087ceb1537a91d869a47dbe66` |
| `apps/web/dist/server/entry.mjs` |637089| `5dab1e4f21a7033582c1c2a326c97d6dcadae66ca04566a73a2aca113b4077f7` |

Root/63web, PostgreSQL18.6/171, production publication/save-recovery stress200/200, expected renderer-negative rejection, actual built100k public-read query plans, both actual GPT-6.1-sol/high CLEAR full-source precredential reviews and11 exact-source attempt1 workflows passed. [Check receipt](evidence/m5-018/offline-checks-round4.json). Source/build hashes remained unchanged during the closed9-action native observation.

Principal/owner must first adjudicate the candidate and unresolved prerequisites. No authorization question for a speculative release is being issued. An eventual exact executable release proposal requires the missing facts and separate explicit owner/principal authorization; this document does not grant it.
