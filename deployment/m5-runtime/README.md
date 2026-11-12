# Current runtime configuration and deployment boundaries

This directory retains the actual deployment configuration/data boundary; its `m5` name and external Compose project/network identities remain intentional. [Delivery state](../../docs/delivery/state.md) owns current deployed artifact identities, observations and the actionable owner/operator checklist. [The operating model](../../docs/delivery/operating-model.md) owns effective scoped permissions. This runbook describes deployment mechanics; it does not grant effects or establish readiness.

Active VPS management custody is `%h/.local/share/insignia/runtime/`. Some live mounts and database Compose configuration still reference the older `insignia-m8-runtime-20261013-pr114` and `insignia-m5-verify-20261012-r2` directories. Their historical names do not make those dependencies disposable. Inspect current mounts/configuration before removing or relocating anything.

## Expected Function configuration

Source from this change onward takes each Function's expected input-query fingerprint from the trusted release record (Active version plus module baseline, including the query), the same authority admin activation, signing and checkout admission already use. The private web value `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` needs only `{"appKey":"<SHOPIFY_CLIENT_ID>"}` and no longer changes at a Function release.

Live Shopify Admin returns `inputQuery: null` for both owned Functions. Observation v2 records that as not observable (`inputQuerySha256: null`) and does not compare it; the trusted release record is the query gate, and readiness still fails closed without a fresh release-bound record. If Admin returns a query, it must equal the record's.

Operator migration: none is required. The legacy `transformInputQuerySha256`, `validationInputQuerySha256` and `observationVersion` fields are still accepted (64-hex and `2` when present), then ignored. Images built before this change require them, so keep them until rollback to such an image is no longer needed, then reduce the value to `appKey` only.

## Repair-messages candidate development transition

Owner approval, 12 November 2026 (deploy 2): ship the storefront and Designer changes merged up to main `bf512171` (#378, #380, #387, #389) to rewrite-dev as one theme-only app version. The server side of `bf512171` (#377 verifier reuse rule and release diagnostics, #384 listen-failure exit, #385/#388 fences; no migration) was deployed under `native-buyer-fixes-fb436e16` before the candidate was created.

`native-repair-messages-bf512171` binds inactive version `1205994881025` in [native-repair-messages-release-binding.json](native-repair-messages-release-binding.json) (37 versions) and the 14-module [baseline](native-repair-messages-module-baseline.json) (canonical hash `eb500b6c214f220d99e63ba6eb41bc97054bf1d94d296226356672bda2892ef2`).
- It was created once at `2026-11-12T20:40:22Z` (CLI 4.9.4) from the frozen `native-buyer-fixes-fb436e16` staging. Only `extensions/insignia-theme/assets` changed: its 15 files are the foundation build of `bf512171` (run 43297757028, attempt 2), byte-identical to a local build of the same tree. The frame host and the Designer frame (#387) therefore ship from one build.
- Blocks, snippets, locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `bf512171` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608); the Function source still is `aa3b6166`.
- `1205760688129` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release: set `INSIGNIA_RELEASE_PROFILE=native-repair-messages-bf512171` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-buyer-fixes-fb436e16` fail closed (inventory 37) until this step and the release complete. No migration, grant or other environment change.

## Buyer-fixes candidate development transition

Owner approval, 12 November 2026: ship the storefront and Designer changes merged up to main `fb436e16` (#352–#365, #372, #373) to rewrite-dev as one theme-only app version.

`native-buyer-fixes-fb436e16` binds inactive version `1205760688129` in [native-buyer-fixes-release-binding.json](native-buyer-fixes-release-binding.json) (36 versions) and the 14-module [baseline](native-buyer-fixes-module-baseline.json) (canonical hash `83f73e0202c709902476dae6947257c981a6cadb41cfb5b82b0155144d616a81`).
- It was created once at `2026-11-12T17:15:23Z` (CLI 4.9.4, Node 24.21.0) from the frozen `native-canonical-host-aa3b6166` staging. Only `extensions/insignia-theme/assets` changed: its 15 files are the foundation build of `fb436e16` (run 43264310795, attempt 1), byte-identical to a local build of the same tree. The new chunk `insignia-buyer-session-*.js` raises the asset count from 14 to 15.
- Blocks, snippets, locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `fb436e16` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608), and the Function source still is `aa3b6166`.
- `1203782746113` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release:
1. Set `INSIGNIA_RELEASE_PROFILE=native-buyer-fixes-fb436e16` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-canonical-host-aa3b6166` fail closed (inventory 36), so quotes fail until this step and the release complete.
2. No migration, grant or other environment change. Migration 59 and its web grant were applied with the `fb436e16` server deploy before the candidate was created.

## Canonical-host candidate development transition

Owner decision, 11 November 2026: Insignia's only app origin is `https://app.insigniacustomizer.com`. The old host `insignia-app.optidigi.nl` was served as a temporary fallback after the release, then removed from both routers (owner decision, same day).

`native-canonical-host-aa3b6166` binds inactive version `1203782746113` in [native-canonical-host-release-binding.json](native-canonical-host-release-binding.json) (35 versions) and the 14-module [baseline](native-canonical-host-module-baseline.json) (canonical hash `6599faf690ed74df94e4b99204de391f49990a39021abf8196fe4fbafee27714`).
- It was created once from the frozen `native-cart-line-v3-aa3b6166` staging. Only `shopify.app.toml` changed: `application_url`, the five webhook subscription URIs and the app proxy URL.
- Theme and both Functions are identical, including module ids, wasm and input queries.
- `app_home`, `app_proxy`, privacy compliance and the five webhook subscription modules differ only by host.
- Webhook subscription registrations are keyed by topic and URI, so those five have new registration identities.

Phase B operator changes, made together with the single release:
1. Set `INSIGNIA_RELEASE_PROFILE=native-canonical-host-aa3b6166` in web, worker and verifier together, using binding-head images and the matching verifier manifest.
2. Set `APP_URL=https://app.insigniacustomizer.com` in web and worker.
   - Correction to the first version of this step: existing old-origin subscriptions are not retired when `APP_URL` changes.
   - The uninstall capability is bound to the origin, so each installation enrolls a new per-shop subscription on the new origin (one Admin `webhookSubscriptionCreate`) beside the old one.
   - The old-origin destination stays `registered` and valid.
   - From migration 55, once the current-origin subscription is confirmed, enrollment deletes the old-origin subscription (`webhookSubscriptionDelete`) and records that destination as `superseded`. This happens only after Shopify confirms the deletion or re-reads it as gone. `superseded` is terminal and, unlike `retired`, does not change the installation's repair version.
3. No migration and no new grants. The temporary `INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC=1` on web was removed with the per-visitor limit.

Per-visitor session limit (owner decision B, 11 November 2026), deployed after the release:
1. Apply migration `20261111000100_buyer_visitor_address_limit.sql` through the schema owner, so schema goes from 53 to 54.
2. Apply only the new web grants from [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql): `SELECT, INSERT, DELETE` and `UPDATE(window_at,issued)` on `public.buyer_visitor_admission`.
3. Replace web only, and remove `INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC`. The previous web image ignores the new table, so rollback is web-only.

Sliding per-visitor window (owner decision, 12 November 2026, #348), deployed with the web image that contains it:
1. Apply migration `20261112000300_buyer_visitor_sliding_window.sql` through the schema owner (schema 58 to 59). It adds `issued_at`, backfills open windows so their sessions keep counting until the fixed window would have ended, and relaxes the `issued` bound.
2. Apply the changed web grant from [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql): `UPDATE(window_at,issued,issued_at)` on `public.buyer_visitor_admission`. Both steps come before the new web image, which writes `issued_at`.
3. Replace web. The previous image still works on the migrated table (it writes only the old columns and counts at most 20), so rollback is web-only.

## Cart-line v3 candidate development transition

`native-cart-line-v3-aa3b6166` binds inactive version 1202999689217, the complete 34-version inventory in [native-cart-line-v3-release-binding.json](native-cart-line-v3-release-binding.json) and the exact 14-module [baseline](native-cart-line-v3-module-baseline.json). Canonical hash is `dd76c50a573e7c6cdb7b42555fdbc36e1edda5189c75b876f4f81d92f66c447f`. Source is main merge aa3b6166/tree dc58ec46, which ships everything merged since the functions-renew release, PRs 298–306:
- expected Function queries derived from the release record;
- reproducible Function builds;
- Designer silent re-quote;
- per-visitor limits (migration 53);
- ordered-quantity views;
- buyer client and server performance;
- [signed-cart protocol v3](../../docs/architecture/CART-LINE-V3.md);
- the review-count fix.

All 23 theme files, including 14 assets, match foundation run 42932707400/attempt 1. Prior 1202733449217 remains the sole Active version; all NEVER_RELEASE versions remain inactive.

**This transition changes Function bytes, behavior and both input queries, and it is the single v3 cutover.** The owner authorized it on 10–11 November 2026. There is no dual-format Function. Both Function modules keep their registration UUIDs and handles but carry new wasm, built from aa3b6166 with `node scripts/functions/build-wasm.mts {transform,validation}` (Rust 1.98.1, trampoline 2.0.1). The CI foundation wasm and raw wasm are byte-identical to the local build.

| Function | wasm SHA256 (bytes) | input query SHA256 | Shopify module id |
| --- | --- | --- | --- |
| transform | `5c8708b578383d54f78b79534a3141515296f7b3864bce9852af0c678dbed677` (183604) | `02ab5bcee805fba94dff9309a2e55cb1998651ca42fdba8564872ba891fd16ac` (was `8d93a086…`) | `826a9059-f6c2-49ff-861a-7155b1f848fb` |
| validation | `6c362b36a5cf3eba77dcf9accc64bf0ae3225d77c97dd01bcc9d3e0e1ea83de4` (181608) | `5867e61f07dbb4d6417df401b5ffbc47f0175eca1d00f7792621150713b18d7e` (was `5baff05a…`) | `076bfef2-e925-4f68-bcb8-7398df7305c6` |

Phase B operator changes, made together with the single release:
1. **Release profile.** Set `INSIGNIA_RELEASE_PROFILE=native-cart-line-v3-aa3b6166` in web, worker and verifier together, using binding-head images and the matching verifier manifest. Before the release, readiness fails closed, as in earlier transitions.
2. **Migration 53.** Apply `20261110000100_buyer_visitor_limits.sql` through the existing schema owner before replacing consumers, so schema goes from 52 to 53. It widens the shop session ceiling, adds nullable `buyer_sessions.grant_expires_at` with an index, and replaces the `buyer_session_identity` trigger. A NULL grant keeps the old immutability rule, so the running pre-change writer stays compatible.
3. **Web runtime grant.** The web role now needs `UPDATE(expires_at)` on `public.buyer_sessions` (see [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql)). Apply only that column grant to the actual web role as the schema owner; do not rerun the bootstrap file over later qualified APIs. Afterwards the column-ACL digest changes by exactly that column; relation, function, membership and schema ACL digests stay unchanged. Record the new digest as the expected value.
4. **`INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON`.** Recommendation: leave it unchanged for this release (appKey, legacy `8d93a086…`/`5baff05a…` query fields, `observationVersion: 2`). This image accepts and ignores the legacy fields ([Expected Function configuration](#expected-function-configuration)). The rollback image (the deployed functions-renew build) still requires them, and they are correct for that image together with Active 1202733449217. Do not write the v3 query hashes into it. Reduce it to `{"appKey":…}` once rollback to a pre-PR298 image is retired.
5. **No new environment variables.** The buyer database pool rises from 4 to 10 in code. Check headroom against the actual `max_connections` (default 100) and current consumers.

Open carts still holding v2 carriers fail at checkout and need Designer repair, as the owner accepted. If an `eur-nl-qualification-v1` profile is configured, it no longer matches and EUR stays fail-closed; EUR is not enabled. Release once, then obtain fresh independent admission. This binding is not activation or native acceptance.

## Functions renew candidate development transition

`native-functions-renew-8fffc9de` binds inactive version 1202733449217, the complete 33-version inventory in [native-functions-renew-release-binding.json](native-functions-renew-release-binding.json) and the exact 14-module [baseline](native-functions-renew-module-baseline.json). Canonical hash is `6bbac54719093f8ab867fe199e70bddf5b7e40f4b6404c046d4deb74b573cb9a`. Source is merge 8fffc9de/tree 00b71102: PR293 (a stale quote with no marked line checks out as a plain cart; one checkout message localized by `localization.language`) and PR294 (cart renewal and context notice). All 23 theme files, including 14 assets, match foundation run 42887198952/attempt 1. Prior 1202503778305 remains sole Active; all NEVER_RELEASE versions remain inactive.

**This transition changes Function bytes and behavior.** The owner authorized that change on 10 November 2026. Both Function modules keep their registration UUIDs and handles but carry new wasm, built from 8fffc9de with `node scripts/functions/build-wasm.mts {transform,validation}` (Rust 1.98.1, trampoline 2.0.1). The Function source is identical at PR293 merge c19069bc.

| Function | wasm SHA256 (bytes) | input query SHA256 | Shopify module id |
| --- | --- | --- | --- |
| transform | `f5979b61ba46c9ca315324500b1bedf806949ebf8fb8979494e0bdaf68e392f6` (181233) | `8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053` (unchanged) | `cf3f4c5b-6e51-4140-a542-35aa352a7c9c` |
| validation | `4a3e7495245e8716b976ff3c3816c4e144114883edd317afc38fdf84b369f9ec` (183624) | `5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4` (was `a0cd5d72…`) | `4416125b-6b7d-40b2-a283-5090c0fe2540` |

Shopify exposes no wasm hash. It reports `module_wasm_size_bytes` and a new `module_id`, and both match this build. The CI foundation wasm of that source differs from these bytes because it embeds `/home/runner/.cargo` registry paths. It is not the release artifact. Later source remaps `$CARGO_HOME` to `/cargo` in `build-wasm.mts` and rejects Wasm that still embeds the workspace, `CARGO_HOME` or home path, so CI and local builds are byte-identical. The same Function source then builds to different bytes (transform `6e1429d8a42322783e9941ff70c37f973c386cac635fcb59b902cc7e2e4953d3`/181041, validation `208351f9be0070677e2e66a4d7165be2e464c59247102c3c30bd907d0ff7a98b`/183432). The next Function release carries new hashes; existing release profiles keep their recorded pins. Each release profile now names its own Function source and artifacts (`scripts/release/profiles.mts`); every earlier profile keeps the original 9b94149 pins.

At activation (Phase B) the operator must also change the private web `runtime.env` value `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` (required by images of this source; later source no longer reads the query fields, see [Expected Function configuration](#expected-function-configuration)): set `validationInputQuerySha256` to `5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4`. Keep `transformInputQuerySha256` at `8d93a086…`, and keep `appKey` and `observationVersion: 2`. That JSON contains no wasm hashes. Set `INSIGNIA_RELEASE_PROFILE=native-functions-renew-8fffc9de` in web, worker and verifier together. If an `eur-nl-qualification-v1` profile is configured, its `activeVersionRef`/`functionsSourceCommit` no longer match and EUR stays fail-closed; EUR is not currently enabled. Use matching binding-head images and verifier manifest, release once, then obtain fresh independent admission. This binding is not activation or native acceptance.

## Cart repair candidate development transition

`native-cart-repair-eb386d22` binds inactive version 1202503778305, the complete 32-version inventory in [native-cart-repair-release-binding.json](native-cart-repair-release-binding.json) and the exact 14-module [baseline](native-cart-repair-module-baseline.json). Canonical hash is `b90b62c0ebd602c4b20141379feaa9d3c6d33e615103e991da5d04bd13817064`. All 22 theme files, including 13 assets, match foundation run 42852820780/attempt1 and merge eb386d22/tree c2989b3f (PR289 artwork policy, PR290 cart repair/notice/stale-quote cleanup). The foundation build adds one storefront chunk, so the asset count grows from 12 to 13. All 14 identities, 13 non-theme configurations and original 9b941 Function bytes remain unchanged. Prior 1201385144321 remains sole Active; all NEVER_RELEASE versions remain inactive.

Use matching final binding-head images and verifier manifest. Preserve schema 52/key 2/grants/current protected facts and private mounts/configuration; checkpoint and restore-verify before exclusive consumer replacement. Reconcile the single release, then obtain fresh independent admission. This binding is not activation or native acceptance. Expanded inventory intentionally makes `native-canonical-313b12ad` fail closed until the coherent transition completes; keep historical profiles/freshness unchanged.

## Canonical combined UI development transition

`native-canonical-313b12ad` binds inactive version 1201385144321, the complete 31-version inventory and exact 14-module baseline. All 21 theme files/12 assets match frozen canonical foundation run 42725808639 and merge 313b12ad. All 14 identities, 13 non-theme configurations and original 9b941 Function bytes remain unchanged. Prior 1201192632321 remains sole Active; all NEVER_RELEASE versions remain inactive.

Use matching final binding-head images and verifier manifest. Preserve schema 52/key 2/grants/current protected facts and private mounts/configuration; checkpoint and restore-verify before exclusive consumer replacement. Reconcile the single release, then obtain fresh independent admission. This binding is not activation or native acceptance. Keep historical profiles/freshness unchanged; use compatible fix-forward rather than stale database restoration.

## Review navigation candidate development transition

`native-review-nav-8a7ee446` binds inactive version1201192632321 and the complete30-version inventory in [native-review-nav-release-binding.json](native-review-nav-release-binding.json), with the exact 14-module [baseline](native-review-nav-module-baseline.json). Canonical hash is `0b8452cc5cfbe750f9bb871f03ae6a2474daaec3a30c5158cee4d0dd37e29dab`. All21 theme files and12 assets match foundation42694038939/attempt1, synthetic105dfcf9 and PR276 merge8a7ee446/tree740b2a1a4bc43d310a4e05493816745495a3b7e7. All 14 identities, 13 non-theme configurations and original 9b941 Function binaries match the loading baseline. Version1201128341505 remains sole Active; all three NEVER_RELEASE versions remain inactive. Creation and this binding supply no activation, latency, fresh independent admission or native acceptance proof.

The next qualified transition must preserve schema52, key2, current protected facts, exclusive verifier ownership, passive authority and compatible recovery custody. Every consumer still requires its own fresh admission evidence; grants, TTL and tenant guards remain unchanged.

## Loading/handoff candidate development transition

`native-loading-defd05b0` binds inactive version1201128341505, the complete29-version inventory and exact 14-module baseline in [native-loading-release-binding.json](native-loading-release-binding.json) and [native-loading-module-baseline.json](native-loading-module-baseline.json). All21 theme files, including12 assets, match frozen foundation42684743827/attempt1 and PR274 merged source defd05b0/tree df7b967e. All14 native identities,13 non-theme configurations and original 9b941 Function binaries remain unchanged. Prior version1200729554945 remains sole Active; all three NEVER_RELEASE versions remain inactive. This binding alone is not activation, fresh independent admission or native acceptance.

Qualify matching final binding-head immutable web/worker/verifier artifacts before any coordinated transition. Preserve schema52, existing grants, signing key2, protected purchase/financial facts, tenant fences and pending/ambiguous operations. Replace the verifier exclusively with its private custody and actual consumer bindings preserved; use compatible schema52 recovery/fix-forward. Inventory expansion intentionally makes the existing live prior closed profile fail closed. Preserve all historical profiles and exact inventory/freshness/independent admission checks; no runtime-v2 protocol change or Function configuration drift exception is introduced.

## Review/cart candidate development transition

`native-review-cart-1f4595f` binds inactive version1200729554945, the complete28-version inventory and exact 14-module baseline. All21 theme files, including12 assets, match qualified foundation42639352594/attempt1 and PR271 merge1f4595fa/tree148c93f0. The13 non-theme configurations, native module identities and original 9b941 Function binaries remain unchanged. Candidate creation is not activation, admission, native UI acceptance or measured latency improvement.

Use matching final binding-head web/worker/verifier artifacts, preserve schema52/grants, signing key2 and compatible recovery custody, and replace the verifier exclusively. Reconcile the single development release before obtaining fresh independent admission. Expanded inventory intentionally invalidates the prior closed profile; do not weaken inventory or freshness checks. Keep all NEVER_RELEASE versions inactive and owner signing mounts absent. Measure Review, acceptance and Ajax cart stages after deployment; no checkout/order/payment, consumed sender drill, VAT retry or production cutover is authorized by this transition.

## Startup candidate development transition

`native-startup-771bb8f` binds inactive version1200333160449, the complete27-version inventory and exact 14-module baseline. Its21 theme files (12 CI assets) are frozen from foundation42595259659/attempt1 and PR264 mergea58d8025/tree198bd77c. All13 non-theme configurations, original native registration identities and9b941 Function binaries remain unchanged. This is candidate custody, not activation, independent admission, signing completion or native acceptance.

Use matching final binding-head web/worker/verifier artifacts and the closed profile in all consumers, preserve schema52/grants and compatible recovery, and reconcile the single development release before fresh independent admission. Creating this inactive candidate expands inventory; the preceding closed profile now intentionally fails admission. Never widen inventory/freshness checks or restamp an old receipt. All NEVER_RELEASE versions remain inactive. The signing allocation stays unmounted and undispatched until its separately qualified first-party invocation; key1 dates remain unchanged and replacement development lastDay is trusted provisioning shop day+31.

## Recovery candidate development transition

`native-recovery-e2c3dc5` binds the independently observed inactive version1199953805313, all26 observed versions and the exact 14-module baseline. All13 non-theme configurations and original 9b941 Function identities/binaries remain unchanged. Its21 theme files, including12 CI assets, are frozen from foundation42548633865/attempt1 and merged sourcee2c3dc51/treec5ad8fed. The binding is not activation or admission evidence. Preserve historical profiles and every NEVER_RELEASE version.

Qualify final binding-head web/worker/verifier artifacts and verify their theme files remain byte-identical to the frozen candidate. Before Q1 activation, apply append migration52 and the narrowly scoped `declined_at` grant through the existing development schema/role owners. Drain every old eligible acceptance writer before exposing terminal outcomes; enumerate actual consumers rather than assuming web is the only writer. Recheck roles, immutable image/configuration, active mounts, protected facts, pending/ambiguous operations and fresh independent admission. Replace the verifier exclusively, preserving its private startup/authentication/state custody and rechecking actual consumer bindings.

Once a terminal decline marker exists, schema rollback refuses and schema51/old-writer images are unsafe rollback targets. Preserve command/accepted/purchase authority and use compatible schema52 recovery or fix-forward artifacts. Before any effect, retain compatible artifact/configuration custody and qualify the applicable recovery path. A database snapshot restore or down migration is never an automatic application rollback. Native wide/narrow UI, theme interactions, rapid dismissal and cart recovery still require actual observation after the single qualified development release. No extra checkout/order/payment, mail resend, protected VAT retry or production cutover follows from this transition.

## Qualify an immutable candidate

Build web from [scripts/runtime/Dockerfile.web](../../scripts/runtime/Dockerfile.web) and its thin [build launcher](../../scripts/runtime/build-web.sh); worker uses [scripts/worker/Dockerfile](../../scripts/worker/Dockerfile) and [build launcher](../../scripts/worker/build-worker.sh). Use the accepted exact source/tree and natural final-head CI, including physical process/image checks. Retain image IDs, export hashes/size, artifact inventory, migration hashes, CI run/attempt and reviewed Compose hashes. A healthy `/live`, portable package or source test does not prove authenticated readiness or native acceptance. Local isolated PostgreSQL qualification does not replace physical process/image checks.

Privately freeze prior images, current applied migration ledger, roles/queue state, effective routing, mounts, consumers, independent release authority and protected purchase/paid facts. Compare the actual host against this baseline before selecting effects. Applied migrations are immutable. A fresh install uses the complete current schema-owner workflow; an existing installation applies only reviewed missing append migrations after backup/compatibility qualification. Use the current schema-owner path and derive the required migration set from `packages/database/migrations`; retired fixed-baseline helpers are not upgrade procedures.

The selected integration adds strict authoring/presentation fields and privately referenced merchant photo sources. Schema45 images are only a pre-write rollback: after selected authoring, publication, movement or customer-link writes, keep a backend/worker that understands those contracts. The old artwork/merchant-preview cleanup executor must be drained before new source references become writable; its pre-integration repository does not understand those references. That executor belongs to the existing immutable host inspector/artwork-main service, separately from the general queue-worker container. Inventory and qualify that consumer and its current role/view access too; replacing only the web and queue-worker images does not upgrade it. Database reference guards do not establish the old consumer’s cleanup fairness or complete runtime qualification. Upgrade the paired web/worker and least-privilege grants together after the additive migrations. Never restore an old image or database snapshot over newer purchases, accepted quotes, attachments or financial facts. After the first new-format write, recovery uses the qualified compatible candidate/fix-forward path or a separately reviewed data-aware recovery; retained old image bytes alone are not a rollback qualification.

For an existing installation that already has qualified M9 privacy/lifecycle permissions, the older M8 bootstrap grant preconditions are not an upgrade recipe: they deliberately reject every non-trigger SECURITY DEFINER function, including those later scoped APIs. Preserve the existing qualified permissions. Apply the reviewed selected-feature grant delta only (new preferences/order-label/capability tables, the asset-reference view read and queue order-label writes), and compare pre-existing relation/function ACLs and role memberships before/after. Never revoke later qualified APIs merely to make an earlier bootstrap guard pass. The inspector's runtime role check must explicitly recognize only the required asset_id reference view, with no draft-data access or view mutation authority.

For an existing selected-UI installation, apply [the order-label grant delta](order-label-runtime-grants.sql) as the schema owner with the actual existing `web_role` and queue `worker_role` identifiers. It adds only `SELECT(shop_id,order_id)` on customer order fences and `SELECT(shop_id,installation_generation)` on shop fences. These identifiers let verified order-name projection honor erasure; source receipts/timestamps, full-table reads and fence mutation remain unavailable. Fresh bootstrap grants contain the same columns. Do not rerun old bootstrap grants over later qualified privacy APIs, create roles, reset exhausted webhook attempts or submit a second checkout to repair ingestion. Normal independent discovery can reconcile the already verified order after the delta. Verify actual restricted facade calls, not merely table creation or a label-table SELECT.

## Preserve the existing topology

[compose.yaml](compose.yaml) overlays [the canonical base](../m5-019r/compose.yaml), in that order, under existing project `insignia-rewrite-m5-019`. Resolve its private `runtime.env` and `database.env` from existing custody; do not create substitute credentials. The reviewed web command is `/usr/local/bin/node /srv/insignia/web/dist/server/entry.mjs`, with `init: true`, nonprivileged user and bounded stop grace. The generated application `.mjs` is a build artifact. [The Compose control](../../scripts/runtime/web-compose.test.mts) checks the rendered real base/overlay against inherited database, networks, volumes, routing and command/init semantics. Preserve `Host(app.insigniacustomizer.com)`, TLS, database volume and the current routing-enabled state. Deploying this overlay alone, changing project/callback identity or `down -v` would violate that boundary.

The ordinary worker uses [scripts/worker/worker-compose.yaml](../../scripts/worker/worker-compose.yaml), existing private `worker.env`, then [worker-compose.yaml](worker-compose.yaml). Preserve external `insignia-rewrite-m5-019_private` and worker-owned `insignia-uninstall-m5-024_egress`; the source rename does not rename either resource. The outbound bridge adds no ports, proxy network, capabilities or writable code mount. The runtime guard checks independently rendered Compose against actual image/executable inventory and private same-database observations. Keep reviewed pg-boss43 queue semantics and least-privilege roles; [queue installer](../../scripts/database/install-queue.mts) and [grants](../../scripts/worker/queue-roles.sql) are owner operations for an actual identified gap, not automatic startup or an upgrade instruction.

For exported artifacts, distinguish the OCI manifest selector from its image-config digest: CI may report the config digest as `imageId`, while the native containerd image store reports the manifest as its loaded image ID. Verify the export hash, every referenced OCI blob, config and uncompressed layer digest; compare Docker’s loaded `Id`, `Descriptor.digest`, configuration and root filesystem against those independently qualified bytes. Bind `INSIGNIA_WORKER_IMAGE` and web to the verified native full lowercase `sha256:<64 hex>` selector and retain both manifest/config identities in the deployment receipt. A qualified registry `name@sha256:<64 hex>` is a separate supported identity; do not invent a RepoDigest for a local export or substitute a mutable tag. The worker’s real offline-refresh transport needs allocated-host outbound DNS/TLS and bounded provider readiness; rendered topology alone cannot prove egress or Shopify success.

[Release-verification web](release-verification-compose.yaml) and [worker](release-verification-worker-compose.yaml) overlays mount only the prequalified shared metadata directory read-only at `/run/insignia/release-verification`, with host-path creation disabled. Apply each to its own project, preserving directory identity. Independent collector credentials, append custody, receiver and executable remain outside app runtimes. Inspect the actual verifier/consumer binding after recreating web; rebind only when that verified contract requires it, and obtain fresh correlated observations before admission; old evidence retains its real expiry.

Schema51 adds guarded recovery from a durable, exact NOT_DISPATCHED restoration receipt. Apply the reviewed append migration through the existing schema owner before deploying its compatible backend/worker. The owner-triggered append-only consumption audit grants no app direct DML; preserve original claims/receipts and all ordinary role restrictions. No down migration or database restoration may discard used recovery evidence. Resume the exact original publication identity under fresh authorization; unchanged provider readback alone never permits a retry.

### Selected storefront release profile

The current `native-selected-fixed-81830c6` profile was recorded with1199166783489 inactive and now binds that sole Active version, with the complete21-version inventory in [native-selected-fixed-release-binding.json](native-selected-fixed-release-binding.json) and [native-selected-fixed-module-baseline.json](native-selected-fixed-module-baseline.json) frozen in canonical handle order. Its20 theme files include11 exact CI241 assets, independently equal to final foundation42424127963/attempt1. Every original identity,13 non-theme configs, original 9b941 Function bytes and selected CSS remain unchanged. PR242 matching web/worker/verifier artifacts were promoted, the corrected version released once, and independent SDK readback plus fresh same-record web/worker admission and native customer/merchant checks passed. See [activation evidence](../../docs/delivery/evidence/technical-merchant-completion/native-selected-retirement-activation-2026-11-07.json). Earlier1199122513921 is inactive; bad1199165767681/native-selected-81830c6 remains inactive/**NEVER_RELEASE**. Never repeat this settled release or checkout#1005. Future admission obtains fresh evidence under the unchanged finite policy.

Native staging must retain the prior qualified theme manifest's UID/name. The repository's `extensions/insignia-theme/shopify.extension.toml` is explicitly local-preview configuration, not the native registration manifest. Copy reviewed blocks/snippets/locales and exact CI assets into fresh staging while preserving that native manifest, original Function targets and `.shopify/project.json`; omit cached deploy bundles. Compare every module identity and non-theme configuration before release, not only file hashes.

CLI4.8.2's AppVersions query reads only20 nodes. The collector's bounded inventory reader uses that same official authenticated transport with first100 and requires returned length to equal provider count, unique IDs and one Active. The existing exact reviewed inventory/status checks still run at opening and closing. Counts above100 or incomplete results remain unavailable; SDK/auth adapter pins, authority and finite collection policy are unchanged.

The historical `native-cart-fd9cc61` profile qualified1199122513921 Active before the cleanup transition and retains its original binding, exact19 versions in [native-cart-release-binding.json](native-cart-release-binding.json), and14 canonical modules in [native-cart-module-baseline.json](native-cart-module-baseline.json). All 21 theme files/12 assets match qualified CI239 and CI240; original 9b941 Function bytes and all13 non-theme configurations remain unchanged. PR240 matching web/worker/verifier artifacts were promoted at that historical transition. The candidate was released once and independently read Active; the old1198986199041 version is inactive. Both consumers admitted the same finite fresh record, and the live Designer passed first-load, inspected artwork, authoritative USD12.50 quote, automatic native cart navigation and owned-design restoration. See [activation evidence](../../docs/delivery/evidence/technical-merchant-completion/native-cart-activation-2026-11-07.json). Later admission still requires fresh evidence. Existing order#1005 verifies native purchased-title presentation; never repeat its consumed checkout allocation. PR241 retired the standalone element and other unused UI; PR242 deployed its new native-selected-fixed binding without mutating this historical profile.

The corrected `native-fixed-5c04fa8` profile was recorded with version1198986199041 inactive, subsequently qualified it Active, and is now historical after the native-cart release. It retains the exact eighteen-version inventory in [native-fixed-release-binding.json](native-fixed-release-binding.json), and fourteen modules in [native-fixed-module-baseline.json](native-fixed-module-baseline.json). Its20 theme files include11 assets frozen from foundation42394179634/attempt1 and the merged PR236 complete-element Liquid/locale sources, merge93a56c27/tree2789e5cf. All11 built theme assets are byte-identical to the preceding candidate; the renderer correction is in Liquid. All thirteen non-theme configs and fourteen identities remain unchanged; original Function binaries/source9b941 remain selected. Keep1198938357761 inactive/NEVER_RELEASE and preserve historical bindings. PR237 matching web/worker/verifier artifacts were promoted and the corrected version released once on7November; SDK Active readback and same-record web/worker admission are recorded in current state. Do not release it again to repeat qualification. Native rendering and subscription eligibility passed at that observation; the dedicated first-publication visibility hold then blocked buyer E2E. PR238 subsequently restored the original publication, and PR240 qualified the active cart handoff as recorded in current state. Obtain fresh correlated evidence for every later admission; historical receipts expire. No profile is widened to admit the restored Active version or conceal the transition.

The `native-theme-ced0143` profile binds inactive version1198938357761 and the exact seventeen-version inventory in [native-theme-release-binding.json](native-theme-release-binding.json), with fourteen modules in [native-theme-module-baseline.json](native-theme-module-baseline.json). Only the theme configuration differs from `selected-ui-aab4a4b`; its eleven built assets are frozen from foundation42387489858/attempt1, source merge5487aa9c/treee26d6100352690e9af5b8777566e113fac9e11bc. Blocks, snippets and six locale files come from that reviewed source. Preserve the original Function binaries and registration identities below: the current-tree CI Function builds are different bytes and are not selected for this theme-only transition. Historical profiles remain unchanged. Use matching final-head web/worker/verifier artifacts, a single reconciled release, and fresh independent admission/readback before claiming native deployment or E2E. Creating the inactive candidate expands the inventory, so the prior sixteen-version profile intentionally fails closed until the coordinated transition completes.

**Native incident disposition:** version1198938357761 was activated once on7November, exposed the app-snippet comment/start-tag defect, and was restored once to1197668466689. Treat1198938357761 as **NEVER_RELEASE**. Its immutable module/profile observations remain historical evidence, not a new deployment target. The source correction renders complete elements and requires a new qualified candidate and matching binding. The PR235 images and mismatch observation are retained as history. PR237 matching images and corrected Active version have superseded that transition. Do not widen or restamp an old profile to conceal this mismatch.

The closed `selected-ui-f48efa2` profile binds version `1196974997505` and the complete fifteen-version inventory in [selected-ui-release-binding.json](selected-ui-release-binding.json), plus the exact fourteen modules in [selected-ui-module-baseline.json](selected-ui-module-baseline.json). The binding was read while the candidate was inactive; it is not proof of activation. Historical profiles and receipts remain immutable. Adding an inactive version intentionally invalidates their exact inventory check until the coordinated transition completes.

Use qualified final-candidate web/worker/verifier artifacts containing this profile. Preserve the independent verifier's permanent authentication/startup/state custody; the app receives only its metadata socket. Select the same closed profile in the consumers and verifier, release the already-created candidate under the current development allocation, then independently re-read Active inventory, modules, installation/grants and Function ownership and obtain fresh correlated evidence. A short fail-closed transition is expected; never widen inventory checks or restamp prior evidence to conceal it. Reconcile a dispatched release before any retry.

The follow-up `selected-ui-aab4a4b` profile binds the inactive version1197668466689 and sixteen-version inventory in [selected-refresh-release-binding.json](selected-refresh-release-binding.json), with [selected-refresh-module-baseline.json](selected-refresh-module-baseline.json). Only theme asset config differs from the preceding selected UI profile. Its assets are frozen from foundation42219651610/attempt1; a rebuild after the web-only preview corrections produces identical theme bytes. Preserve the same original Function pins below. Apply the same coordinated immutable consumer/verifier promotion, single reconciled release and fresh independent admission procedure; staging is not activation evidence.

The staged theme assets come from foundation CI42140234608/attempt1. Preserve both Function modules, their registration identities and original source `9b94149272d1b62c34f44dda3bde209e80b4ae22`. The rebuilt transform SHA256 is `49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576` (181378 bytes); validation is `3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6` (182968 bytes). These match the existing immutable pins. Root/preproduction Shopify TOMLs are not the native deployment recipe. [Current state](../../docs/delivery/state.md) owns activation and native acceptance status.

The [signing-owner overlay](signing-owner-compose.yaml) is one-time startup allocation. After independently settled provisioning, omit its two mounts from a later qualified ordinary web deployment. Preserve original plan/result/binding under actual retention; do not reprovision, rewrite old release receipts, extend validity or remove wrapping-key custody. Current trusted-release, Function, public-config, key and tenant admission checks remain mandatory.

## Cloudflare-only origin

Owner decision, 11 November 2026: Insignia's origin admits only Cloudflare's edge. Both Insignia routers (`insignia-canonical-m5-019r` and `insignia-uninstall-private`) use the route-level `insignia-cloudflare-origin` `ipAllowList` middleware, defined on the web container's labels in [the canonical base](../m5-019r/compose.yaml). It matches the TCP peer address; it sets no `ipStrategy`, so a client-supplied `X-Forwarded-For` cannot satisfy it. Other sites, the shared `websecure` entrypoint, Traefik's static configuration and its ACME HTTP-01 challenge on port 80 are unchanged. A direct request to the origin gets `403 Forbidden` from Traefik. Shopify (app proxy, webhooks, embedded admin, OAuth) reaches `app.insigniacustomizer.com` through Cloudflare's proxied DNS. Both routers serve only that host. The container health check (`127.0.0.1`) and Traefik's load-balancer health check (container network) do not pass through a router. The verifier uses its socket.

[cloudflare-ips.json](../m5-019r/cloudflare-ips.json) is the pinned copy of `https://api.cloudflare.com/client/v4/ips`, with its `etag`. The `sourcerange` label must equal its IPv4 then IPv6 CIDRs joined by commas; [the Compose control](../../scripts/runtime/web-compose.test.mts) enforces that. Cloudflare changes these ranges rarely and announces it in advance.

To refresh:
1. Fetch the API. If its `etag` equals the pinned one, stop.
2. Otherwise update the JSON (`etag`, `retrievedAt`, both lists in API order) and the label together, and merge them through CI.
3. Recreate only the web service (`--no-deps`). Check that a storefront app-proxy request succeeds and that a direct-origin request gets 403.

A stale list fails closed for the new edge addresses only. Traefik's access log shows those requests as 403s from addresses outside the pinned list.

## Signing wrapping-key (KEK) custody

Since keys no longer expire (spec §5.5), each key's Ed25519 seed is protected by its envelope, by custody of the wrapping key, and by holding a private half only while the key is pending or active.
- **Envelope:** `signing_keys.private_envelope` is AES-256-GCM with a random 96-bit nonce per seal and a 128-bit tag.
- **Associated data:** the AAD binds `['insignia-signing-key', 1, shop, installation generation, authorization generation, key id]`, so an envelope cannot be moved to another key or shop.
- **Kid:** `wrapping_key_id` equals the envelope `kid`. Opening checks that the derived public key equals the stored one.
- **Scrub at retirement:** a retiring, revoked or destroyed key has no envelope (migration 57, one-way). The worker destroys closed windows once per UTC day.
- **Memory:** the seed exists only in signer memory while signing and is zeroed afterwards.

**Separate signer** ([signer-compose.yaml](signer-compose.yaml)).
- The `signer` service in project `insignia-rewrite-m5-019` runs the worker image with `node /srv/insignia/worker/dist/signer-main.js`. It runs as its own uid with web's group (`user: "10101:1000"`), read-only, `cap_drop: ALL`, on the `private` network only. It has no port and no Traefik labels.
- It serves `POST /v1/sign` and `POST /v1/provision` (and `GET /health`) on `/run/insignia/signer/signer.sock`.
  - The socket is mode 0660 in a directory owned `10101:1000`, mode 0710.
  - Web (uid 1000, group 1000) mounts that directory read-only and can connect. It can never read the key file.
  - Host directory: `/home/serveradmin/.local/share/insignia/runtime/signer-socket`.
- It logs one JSON line per request (`signer_sign`/`signer_provision`: outcome, shop, generation, key id, ms) and hourly counts. It never logs key material or messages.
- If the signer is down, quotes fail closed with a retryable 503 (`SignerUnavailable` in diagnostics).

**Where the KEK lives (for separate backup custody).**
- **Host file (rewrite-dev on `prod`):** `/home/serveradmin/.local/share/insignia/runtime/signer-secrets/signing-wrap-keys.json`.
  - It is a regular file, owner uid 10101 (the signer), mode 0400, at most 4096 bytes.
  - The host login (uid 1000) and web cannot read it, so reading it needs root or docker.
  - The compose variable is `INSIGNIA_SIGNING_WRAP_KEY_FILE`.
- **In the container:** bind-mounted read-only at `/run/insignia/signing-wrap-keys.json`. The signer refuses a symlink, another owner, or any mode other than 0400/0600.
- **Format** (UTF-8 JSON, 1 to 4 keys):
  ```json
  {"version":1,"currentKeyId":"signing-20261111","keys":{"signing-20261111":"<base64 of exactly 32 random bytes>"}}
  ```
  `currentKeyId` seals new envelopes; the other keys only open envelopes during a KEK rotation.
- The file is the only copy outside the signer's memory. It is not in web or worker env, the images, the repository, logs or database checkpoints.
- **Backup:** back it up separately from database backups, under a different recipient or custody, so a database backup alone never yields a seed. Losing it costs availability only: rotate to a new key with a new KEK.

**Database access.**
- `insignia_signer` (LOGIN, password in the signer's private `DATABASE_URL`) is the only runtime role that reads `private_envelope`.
  - It has SELECT and INSERT on `signing_keys`, and `UPDATE(private_envelope, wrapping_key_id)`.
  - It has `SELECT(shop_id, generation, authorization_generation)` on `installation_generations`, for the identity trigger, and EXECUTE on `signing_key_scope`.
  - It cannot delete keys or change state, window or identity.
- Web (`insignia_runtime`) reads every signing-key column except `private_envelope`. It updates only lifecycle columns, including nulling the envelope at retirement, and cannot insert or delete keys.
- The worker reaches signing keys only through `destroy_expired_signing_keys`, and cannot read envelopes.
- **Apply as the schema owner:**
  1. [signing-key-runtime-grants.sql](signing-key-runtime-grants.sql) (earlier delta);
  2. [signer-runtime-grants.sql](signer-runtime-grants.sql), before the signer starts;
  3. [web-signing-envelope-revoke.sql](web-signing-envelope-revoke.sql), after web runs the signer-client image.

**Re-wrap (KEK rotation).**
1. As root, write the new key into the file as `currentKeyId`, keep the old key in `keys`, and keep owner 10101 and mode 0400.
2. Recreate the signer.
3. Run `docker compose -p insignia-rewrite-m5-019 -f <web composition> run --rm --no-deps signer /usr/local/bin/node /srv/insignia/worker/dist/signer-main.js --rewrap`. It re-seals every pending or active envelope under the current key and prints `signer_rewrap` counts. Retired keys have no envelope and are skipped.
4. Confirm that every remaining `wrapping_key_id` is the new id.
5. Remove the old key from the file and recreate the signer.

**Non-expiring rotation (owner action).**
1. Arm the [signing-owner overlay](signing-owner-compose.yaml) with a plan of `{keyId, firstDay: shop-local today, lastDay: 2147483647}`.
2. Start the action from the embedded admin. The flow runs:
   1. the signer creates the pending key and web receives only its public half;
   2. the outgoing key is scheduled to today + 3;
   3. both Functions are published;
   4. web reads them back;
   5. web activates, which scrubs the outgoing key's private half.
3. Disarm. The worker destroys the outgoing key once its window has closed.

**A stopped rotation.** While the pending key or the shortened window is stored but not published, Add to cart fails; `public_config_drift` is logged once Add to cart has been failing on drift for 5 minutes (buyer requests raise it, so a quiet shop logs nothing). Resume it: arm again with the same plan file and a new empty run root, keeping the stopped run root as evidence, and start the action again. It reuses the pending key (the signer creates no second seed) and publishes by compare-and-set. It journals the replaced published config's digest and each tolerated difference in `published-config-tolerance.json`. A different plan for that key id, or any other published difference, still stops it.
- **Activation went through but its acknowledgement was lost** (`ACTIVATE_KEY` uncertain): re-running stops, because an active key cannot be resumed. Check the key's state in `signing_keys`: if it is `active` and the published config equals the expected one, nothing more is needed.
- **Lost plan file:** rebuild the plan from the pending key's row (`key_id`, `first_valid_day`, `last_valid_day`) with the current binding.
- **Abandoning a pending key:** it cannot be deleted, only revoked. The next rotation (with another key id) accepts a revoked key that was never published and publishes it as revoked.

**Emergency (suspected leak).** An epoch bump or revocation changes the expected config without publishing it, so it takes effect only once published, and Add to cart fails until then. In this order:
1. Revoke the leaked key(s), including any pending key.
2. Bump the epoch.
3. Start a rotation (above) at once, with the plan file's binding carrying the bumped `authorizationEpoch`. Its one publication carries the higher epoch and every revoked flag; it accepts the earlier published config because these changes only tighten it.

Bumping the epoch without revoking the leaked key is not enough: the rotation only retires it (window to today + 3), so lines minted with it at the new epoch would verify for days.

**Blast radius.**

| Leak | What the attacker gets |
| --- | --- |
| Database or checkpoint only | Ciphertext of pending/active keys only; no seed. |
| KEK file only | Nothing without the envelopes. |
| Worker compromise | No KEK and no envelope access; no seed. |
| Web or host-login (uid 1000) compromise | No KEK and no envelope access. It can request signatures for real v3 headers of the active key, within the signer's rate limits and audit, for as long as it is compromised. Respond as under **Emergency**: revoke the active (and any pending) key, bump the epoch, then rotate. |
| Signer compromise | KEK plus envelopes, so the active (and any pending) seed. Retired keys have no envelope. Revoke the active and any pending key and bump the epoch; install a new KEK (re-wrap steps 1–2; revoked keys have nothing to re-wrap); then rotate the key, which publishes it all. |

An HSM- or KMS-held KEK remains a recommendation for a later change.

## Bounded deployment and recovery sequence

1. Qualify exact candidate CI/artifact/Compose identity, current privileges, same-database endpoints, actual schema and current source compatibility. Verify any existing permission covers named services/effects; group genuinely missing owner inputs once. Secret-bearing renders, tokens and credentials stay private.
2. Take a recoverable authorized backup and retain rollback image/configuration and protected-fact hashes. Account for pending/ambiguous operations, installation generations and actual cleanup deadlines before draining any writer.
3. Through the existing private channel, supply only independently qualified runtime identity, webhook/wrapping keys, scoped storage profile, Partner reads, signing/public configuration and current recurring-only entitlement mapping. Historical JSON is evidence/configuration for its actual consumer, not new provider/commercial authority. Verify effective values privately, including scopes/expiry; presence of keys is insufficient.
4. Render/compare the real host model, then perform only the allocated service recreation (`--no-deps` for a web-only change). Verify exact image/configuration, restricted roles, private readiness, current independent release/installation/Function admission, protected facts/services and graceful stop/restart. Stop on drift, failed readiness or unresolved external effect.
5. If qualification fails, quiesce affected consumers and reconcile effects before restoring prior compatible images/configuration. Preserve append migrations, immutable records, inbox/queues and sealed evidence. Database restoration is a separately qualified operation, never automatic down migration. Remove only owned temporary artifacts at their real deadlines, preserving active custody and shared networks.

## Credential rotation procedure

The [current checklist](../../docs/delivery/state.md) records authorization, status and closure evidence for actual credential cutover. This procedure requires a complete consumer/recovery inventory and private custody channel. Identify web/worker/inspector/verifier/backup/monitor/recovery consumers and their active startup dependencies; include storage/provider credentials only when separately allocated. Local rehearsals are not deployed credential rotation.

The owner allocation must name credentials/resources, permitted role/password/profile effects, private delivery, bounded drain/reconnect/rollback and cleanup ownership. Prepare new private credentials, rehearse exact consumers against an isolated target, and freeze old identity/grants/configuration and protected-fact hashes. Under that allocation, drain only identified consumers, cut over private configuration atomically, and verify each actual new connection/readiness/least-privilege path. Independently prove old credentials are rejected and retained facts, schema pins, installation/generation fences and unrelated services are unchanged. Reconcile any unknown operation before retry. Retire old private copies only after active-reference/mount checks and real retention accounting; permanent configuration custody does not extend credential/data lifetimes.

Use the current checklist for exact temporary-copy/data deadlines and recovery targets; this runbook neither extends them nor claims cleanup is scheduled. Preserve permanent configuration custody while enforcing the actual credential/data lifetime.

## EUR/Netherlands admission

The selected integration supports USD shops and qualified EUR/Netherlands shops, each using its own shop currency. EUR remains disabled unless the private `INSIGNIA_EUR_NL_QUALIFICATION` JSON profile is supplied after actual qualification. The profile version is `eur-nl-qualification-v1`; it binds the closed reviewed release (`activeVersionRef`, `functionsSourceCommit`), `shopId`, `shopifyShopGid`, `installationGeneration`, `authorizationGeneration`, `authorizationEpoch`, `primaryMarketGid`, UTC `qualifiedAt` and an `evidenceRef`. Populate these from the actual allocated shop/installation/Market and reviewed evidence, not a copied example or currency-name flag. A changed release/Function source, installation/authorization epoch or Market requires a matching qualified profile.

Admission still independently reads current primary-Market membership and shop currency, checks before/after tenant authority and finite provider freshness, and retains normal quote, signature, Function/release and contextual-price checks. EUR must equal shop currency and the buyer country must be NL. Same-shop multi-currency, FX, GBP and broader Markets are outside this profile. Supplying a profile is a private qualified deployment operation; configuration presence alone is not native proof.

The 5 November read-only development-web inspection showed no EUR qualification profile configured. The owner's final allocation is the existing `insignia-rewrite-dev.myshopify.com` development store. Its bounded read-only observation found USD/United States with primary US Market 106410115355. Keep that store and currency unchanged. An unchanged USD shop cannot prove the EUR/Netherlands own-currency path; native EUR qualification and enablement remain deferred until a concrete suitable resource is allocated. Do not flip the store currency, create another shop, start billing or make a payment to manufacture that proof.

The earlier read-only observation of `stitchs-vat-verification-20261004.myshopify.com` is historical context, not the current EUR allocation. It found EUR/Netherlands and the protected original VAT installation 998524223812. Preserve `UNRESOLVED_NO_RETRY`: installed/active provider state and zero recorded authoritative uninstall deliveries do not settle its unknown-dispatch uninstall. No uninstall retry, reinstall or credential bootstrap is authorized by that observation. Exact release/Function, tenant/Market and quote/cart/checkout/purchase proof is still required before any EUR profile is supplied.
