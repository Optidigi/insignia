# M5-019R — canonical bounded release proposal

**EXECUTE_READY — PROPOSAL ONLY, PRINCIPAL/OWNER AUTHORIZATION REQUIRED.** The owner explicitly locks the canonical hostname, provides manual native inactive-version readback and separately confirms designated-installation presence. Existing host/CLI/upload evidence and owner attestations now meet the proposal's evidence criteria. No new provider access was used. This does not authorize release, accept G7/M5 or replace required new completed-change CLEAR reviews/final CI in the external packet. Original inactive1158837927937/m5-019-a9717e1265ef is permanently SUPERSEDED_WRONG_CANONICAL_ORIGIN_NEVER_RELEASE. Original `.nl`/`.com` evidence remains immutable.

| Field | Exact candidate and evidence |
|---|---|
| App / org / client | 429028933633 / 200969036 / 1443cf6d03d39edae7c101a943c5c684 |
| Product/name | Insignia |
| Canonical origin / APP_URL | https://insignia-app.optidigi.nl |
| App Home | https://insignia-app.optidigi.nl/admin/products |
| Only proposed inactive target | **1158986629121 / m5-019r-9b94149272d1**; CLI-created once, inactive exact-list readback |
| Active / Shopify rollback | **1153019904001 / insignia-3**, unchanged after creation |
| Web image | sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5 |
| Reviewed package | f117be50d7bc106f1c943cdf75a8080fa63c26e0edd99b7ba0ddf3eaea697c2b |
| Embedded / legacy install | true / false, unchanged |
| Required / optional scopes | empty / write_products,read_publications,read_product_listings; unchanged |
| Redirects / API | [] / 2026-07; unchanged |
| Functions | Exact two reviewed transform/validation UIDs/config/query/Wasm/targets/exports; [upload bindings](evidence/m5-019r/owner-origin-uploaded-module-artifact-receipt.json) |
| Frozen source / gate | 9b94149272d1b62c34f44dda3bde209e80b4ae22;3921 hashes; two fresh actual GPT6.1-sol/high CLEAR reviews and10natural exact-head attempt1 successes before sole dispatch |
| Owner native config / installation | [Manual native owner readback](M5-019R-OWNER-ATTESTATION.md) matches displayed candidate fields; separate DESIGNATED_INSTALLATION_PRESENCE_CONFIRMED_BY_OWNER, no candidate version equality |
| Releases / fixtures / scope requests | 0 / 0 / 0 |

[Host readiness](evidence/m5-019r/host-routing-qualification.json) proves dedicated whole-host Traefik routing, public browser production bootstrap/client/CSP/private cache/assets/API401, public wildcard and strict owned-origin TLS, actual health/least-privilege PG18, restart and tested stop/start rollback. The same accepted image/package/entry are deployed; no source/Function rebuild or migration. Legacy insignia.optidigi.nl root/login and existing database/Traefik remain unchanged. Scripted urllib is blocked by Cloudflare1010/BIC while actual browser requests pass; no security setting or TLS override changed. Anonymous host readiness does not establish authenticated G7, readiness premises or merchant activation.

Host rollback stops only web in owner-private /home/serveradmin/insignia-rewrite-m5-019: docker compose stop web; restore same service with docker compose start web. Actual test returned404 on the dedicated hostname while legacy root/login stayed200 with identical hashes, then restored all public routes. No legacy/router/DB/volume restoration or deletion is needed. Temporary VPS key was revoked and local private key removed; future operations need newly authorized access.

The only future release delta is App Home example.com→https://insignia-app.optidigi.nl/admin/products plus the exact two frozen Function modules. No additional version creation/build/scopes/grant request/publication/product/availability mutation or automatic per-store Function enablement is included. Required/optional scopes/API/embedded/legacy/redirects remain recorded above. A release changes the exact app's global App Home and available modules; complete installation inventory is unknown. Prior supported Distribution was Draft, but no fresh absence/count claim is made. Current no-release installation impact is zero. Module availability does not establish per-store Function enablement or production activation.

[Creation](evidence/m5-019r/owner-origin-version-creation-receipt.json) and [post-create list](evidence/m5-019r/versions-postcreate-owner-origin.json) show exactly one inactive addition and byte-equal old rows/Active. Frozen seven upload inputs and all3921 gate hashes remained unchanged. Both base64-decoded Wasm and queries equal reviewed executables. The CLI creates fresh per-deployment module_id values with crypto.randomUUID(); these metadata IDs are distinct from stable Function UIDs. Exact new IDs and artifact/query hashes are recorded in the upload receipt. Owner-supplied native version-page fields and Function UIDs match these prior local/CLI bindings. The historical agent browser readback failed authentication and remains unchanged. No independent server Wasm/query checksum was supplied or claimed.

## Evidence provenance and remaining authorization

1. **Previously collected provider/CLI and local evidence:** settled sole creation, official version list (candidate inactive, superseded version inactive, Active1153019904001 unchanged), frozen app configuration with empty required scopes/redirects and exact optional scopes/flags/API, exact local upload Function UID/query/decoded-Wasm bindings, deployed image/package/admin identity and rollback. These are existing observations, not new live checks.
2. **Owner-supplied native version-page readback:** exact inactive1158986629121 name, canonical application_url, embedded=true, optional scopes, legacy=false, API2026-07 and both handles/UIDs. [Attestation](evidence/m5-019r/owner-native-attestation.json) contains precisely the supplied fields; observation time and screenshots/PDF/provider-native artifacts were not supplied. Empty required scopes/redirects and artifact hashes are not attributed to the owner version-page readback.
3. **Owner-supplied designated-installation presence:** DESIGNATED_INSTALLATION_PRESENCE_CONFIRMED_BY_OWNER. Presence is separate from version equality; an inactive candidate is not claimed to run on the store. Complete installation inventory remains unknown.

The owner canonical lock resolves the origin blocker, and these provenance-separated facts support EXECUTE_READY. The proposed release target is ONLY **1158986629121 / m5-019r-9b94149272d1**. Active remains **1153019904001 / insignia-3** until a separately authorized release. [Provider authority is closed](evidence/m5-019r/owner-attestation-provider-authority-close.json); pending writes0, no scope change. Final NEW completed-change CLEAR/CLEAR reviews and applicable exact-head attempt-1 CI must be recorded in the external principal packet before handback. **New principal/owner release authorization is required**; this proposal, the owner attestation and local reviews grant none.

A separately authorized release must reverify exact candidate and rollback identity and stop on mismatch. Shopify rollback is the previously active1153019904001/insignia-3, restoring the placeholder App Home/no candidate modules; it does not erase later merchant data or undo per-store resources. Host rollback remains independent. Neither release nor rollback is executed in M5-019R.

Upload bundle SHA256 72cf3948b24a04a876cd6cbe4e210e6ad47f82bd7113b719033ce3d6e75cac3f; manifest 3eb31bff6d55f7d68d0da91b31b335a88282e40fccd9d4dd3391ea22a87c42e0.

- insignia-experimental-v2-transform UIDc56038d4-146a-405e-b47d-a055249eeeb3; Wasm49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576; query8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053.
- insignia-experimental-v2-validation UID552059da-2dc1-47f8-8fc0-14a5ccb6f665; Wasm3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6; querya0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5.

## Exact post-release G7 qualification procedure


After separate explicit release/qualification authorization, reverify candidate ID/config/modules/scopes and old rollback ID, then release that existing version once. Require exact current Active candidate readback, unchanged scopes and designated installation before any fixture or admin mutation. A release failure/ambiguity stops with no second release/version attempt until independently adjudicated.

1. Freeze exact accepted production source/build, local harness/network guard where scripted provider access is needed, fresh full-source CLEAR reviews and exact-head CI. Use a fresh bounded register on insignia-rewrite-dev only. Capture native/browser/request attempts durably; do not reopen any historical availability/discovery run.
2. Verify deployed identity, exact installation/current grants, cache invalidation, trusted signing/commercial/release/Function readiness bindings and staff permissions read-only. Module availability does not establish per-store Function enablement or production activation. Missing readiness stops its dependent branch; obtain a separately bounded authorization for any additional provisioning/enablement, never infer it from app release.
3. Run real production embedded cold launch, exact deep link/reload, mobile/restricted-cookie and expired-identity controls. Prove installation/shop/staff isolation and private SSR/fragments/API responses. Test mutation origin/CSRF rejection before valid operations; no cross-install read/write.
4. With at most one newly authorized disposable product/config fixture, prove production Polaris/Preact hydration/events, editor↔canvas/native refresh and configure→preview→save. Record exact durable draft/version/idempotency identities, ambiguous-save reconciliation and two-tab stale-edit conflicts; no blind mutation retry.
5. Request publication through the real admin. Inspect durable immutable revision/publication operation and v3 activation evidence. Requested/pending/blocked state must remain truthful; the UI may show effective revision only after activation commits. Check late activation/readiness refresh and repeated idempotent save/publish without an extra immutable operation. Historical v1/v2 stay recovery-only.
6. Execute every remaining criterion/control in the accepted M5-018 matrix, record real outcomes versus offline evidence, stop on ambiguity and preserve receipts. Safely archive the one disposable fixture only under exact known ownership/settlement and the newly approved cleanup rules. Close/seal the new register and return one integrated evidence PR with fresh CLEAR reviews/final CI for principal adjudication. No M6/M7, launch or fabricated G7/M5 PASS.

Owner evidence resolves the native observation gaps for this proposal. No further Shopify browser/provider/credential access, second version attempt, merge, release, fixture, scope/publication/availability change, historical run reopening, M6/M7 or launch. Stop for principal rereview after fresh completed-change reviews and final CI. LXD removal remains administrator housekeeping and is not a product-release blocker.
