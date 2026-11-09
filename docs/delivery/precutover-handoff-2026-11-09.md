# Pre-cutover handoff, 9 November 2026

Development changes are integrated and qualified within the recorded scope. Production readiness remains blocked by the owner and qualification gates below. Final production cutover and rollout were not performed.

The [cutover preparation procedure](cutover-preparation-2026-11-09.md) describes the remaining sequence. The existing dirty instruction, documentation, skill and task files remain preserved in the shared checkout.

## App purpose and implementation

Insignia lets merchants configure product artwork placements, production choices and decoration prices. Buyers upload artwork, review an authoritative complete quote and add the customized items to Shopify's cart. Retained quotes, payment facts and artwork custody support later order processing and artwork completion.

| Component | Current responsibility |
| --- | --- |
| `apps/web` | Astro server, authenticated merchant APIs, buyer preparation and acceptance, durable command recovery, secure artwork links and the disabled customer-notification dispatcher. |
| `frontend/admin`, `frontend/designer`, `apps/storefront` | Selected Preact screens and reducers, authenticated containers, theme custom elements, hidden preparation and the isolated Designer frame. |
| `apps/worker`, PostgreSQL 18, private storage | pg-boss jobs, durable state and immutable purchase facts. The separate immutable host inspector decodes artwork. The ordinary worker has independent core and queue pools capped at two connections each. |
| Shopify theme and Functions | Native placement and cart handoff. Whole-quote v2 authorization uses the preserved Function binaries and app-owned public configuration. Required-product policy and final purchase checks remain independent of UI preparation. |

The reported duplication and complexity leads were checked against consumers:

- `apps/web/src/shared/admin-request.ts` now re-exports the canonical frontend implementation. Cancellation, token deduplication and ordinary 401 recovery remain. Only the single-use signing POST suppresses automatic resend.
- Production imports under `frontend/admin/examples/admin/support` are intentional shared presentation and workflow owners. Their production consumers remain connected.
- `SelectedProductEditor.tsx` has substantial state/effect coordination. Existing photo-picker and Methods reducers remain the owners. File size did not justify a broad refactor.
- Theme fallback styles did suppress interactions. The correction preserves idle fallback, hover, focus, transitions and manual placement. Chromium and Firefox fixtures pass. Earlier 9 November native investigation observed theme interaction behavior; those checks were not all repeated on the final artifact.

## Exact development baseline

The final runtime source is PR265 head `19bd48754e3e708cc5bbb7e82b525e3c5520b080`, merged as `48df80e5d79d63afa16f6dd3ab6be19d8d8423c3`. Its tree is `738511b3ac4d74de1cb18f51275556e78ae5b97a`. CI source `6189526162e7770182752f632c96dd71dc3f94ae` has the same tree.

[Foundation42601384634](https://github.com/Optidigi/insignia/actions/runs/42601384634), [runtime42601384992](https://github.com/Optidigi/insignia/actions/runs/42601384992) and [durable-core42601384951](https://github.com/Optidigi/insignia/actions/runs/42601384951) passed on the reviewed head. Documentation added after this baseline does not identify a new runtime deployment.

The complete inventory read at **12:20:17.776 UTC** contained 27 versions. `1200333160449 / native-startup-771bb8f` was sole Active. All 14 module identities and 13 non-theme configurations match the closed baseline. All 21 theme files match frozen staging, including 12 CI assets. Function source remains `9b94149272d1b62c34f44dda3bde209e80b4ae22`.

The public configuration retains 32 buckets, 10,000 physical units, `allowNoMarket: false`, and a maximum of four retained keys. These limits are not sustained-throughput qualification.

Versions `1158837927937`, `1198938357761` and `1199165767681` remain NEVER_RELEASE and inactive.

| Service | Native immutable image ID | Current state |
| --- | --- | --- |
| Web | `sha256:7e545f4390e3e6a235a47e2f90842a2bbe60ce86bbfdf1c83881a5a8c379ac40` | Healthy, read-only root, restart `unless-stopped`, owner mounts absent. |
| Worker | `sha256:2abbfa02896df81ddab35bc2729b0ca883994975e44196f7b2cf262528307e96` | Healthy, read-only root, restart `unless-stopped`, LOGIN ceiling four unchanged. |
| Verifier | `sha256:d0012bc868836a4766d3dc107f0130529ea6c3d8009d8a295e2c376b26f056d7` | One receiver, reachable Unix socket, read-only root, restart `no`. |

The database container remains on image `sha256:9551dd5bf356409a21b31248f49b33bba9bb1877365f3a7e933aecd9af3cf52d`. Its volume remains `insignia-rewrite-m5-019_database` at `/var/lib/postgresql`. The database container was not recreated.

The original inspector package `3a07f51e151d9f3fa1ddd2bc4bd975d55ff3a9ca` remains enabled and active. Its integrity check passed against manifest `b9609e126696e2b22e9f575a4803ad1eb2f93db45848a027868bbd1724bd5599`.

Schema 52 is applied. The runtime retains column-scoped `buyer_commands` updates for application linkage and terminal decline; it has no full-table UPDATE grant. Worker and inspector do not gain decline updates. The migration source SHA256 is `a49df4133fec233a35bdd33576684eda3e6b8fb0be306b6b404582ae44ff1bc1`. This identifies the qualified source file, not a migration-ledger checksum.

The **12:20:18 UTC** readback matched all five protected purchase-fact digests. There are still five purchase orders, four paid facts and two refund facts. Operational history now contains 18 APPLIED cart applications and the one pre-existing PENDING application. The new successful Add is expected history. No pending operation was reset or declared settled from the empty test cart.

Customer email dispatch remains disabled. No EUR qualification profile is configured. The observed native journey is USD on rewrite-dev; broader merchant and currency eligibility is unqualified.

## Verified outcomes and limits

| Work | Evidence and practical limit |
| --- | --- |
| Theme and modal startup | The final cleanup correction passed 14 startup cases in Chromium and Firefox. A gated late abort reproduced stale cleanup before the fix. Native loader/Escape/reopen, focus and theme scrolling observations came from the earlier 9 November investigation. The later final-artifact journey opened Designer and completed quote/cart, but did not repeat every startup interaction. |
| Q1 acceptance recovery | Serialized terminal-decline authority, original-result replay, client repair and fresh explicit consent are integrated. Unknown acceptance keeps its identity. Tests cover races, retained reads, postcommit failures and cancellation. Native changed-price recovery was not forced. |
| QA009 and Copy | Shared dialog lifecycle regressions pass. Native Copy discovery, selected review, Cancel, scrim removal and repeated pointer reopening pass without a product write. The visible review showed four views and six placements. It did not show numeric prices or Method names. |
| Signing rotation | One native setup POST returned 202 and durable PROVISIONED. Independent database/provider readback found key 2 solely active, key 1 retiring with unchanged material and dates, unchanged epoch 0 and exact public configuration. Temporary owner mounts were removed. |
| Quote and cart | Native authoritative Review was USD 24.95 for Zwart XS ×1. One Add navigated to Shopify cart and readback matched. One native Remove restored the exact empty baseline. No checkout, order or payment occurred. |
| Performance | Copy discovery avoids eager hydration of every product; selected snapshots retain full review checks. The quote request measured6660.2 ms in one native sample. The approximately 8.1-second Review observation interval includes tool timing. These are not percentile or sustained-throughput results. |
| Runtime and recovery | Exact OCI archive linkage, loaded image configuration/RootFS and replacement settings passed. A fresh encrypted development DB/configuration checkpoint restored schema 52 and protected facts before replacement. Local recovery tests also restored two synthetic byte objects with HOLD and expiry replay. These do not establish native off-host recovery or physical erasure. |

The merged UI/startup source passed a full pinned Node 24.21 repository check with explicit exit 0. The web suite reported 382 passed and 89 skipped. The storefront suite reported 137 passed and 2 skipped. Isolated PostgreSQL 18 reported 345 passed and 5 skipped. The binding review independently repeated 104 collector/worker tests and 20 runtime-profile tests. All 48 compiler projects passed. Skips remain unqualified.

Native early-aftershow QA009 ordering, leave/resume, busy-copy behavior, successful uncancellable late responses and representative sustained worker throughput remain explicit qualification limits. Local cases are not native event-order proof. The original same-tab cart report remains unattributed because its event context is unavailable. The later reproduced signing-window failure and successful current journey do not establish that original cause.

Fresh release-reader evidence was correlated across web and a quiesced worker image/role probe. Those finite records expired normally. The probe does not prove a running-worker purchase-processing path on this release and supplies no continuing authority.

## Signing and recovery custody

Development key 2 uses shop days 20766 through 20797, ending 10 December 2026. This follows the approved formula `lastDay = trusted provisioning shop day + 31`. Key 1 keeps its original days 20736 through 20767. Authorization epoch remains 0.

The next development rotation must finish **before 9 December 2026 05:00 UTC**, New York midnight. Nothing is scheduled. Production key-horizon policy and production allocation are separate owner decisions.

The consumed allocation and journal remain private. They must not be reused. The canonical web configuration omits both signing-owner mounts. The embedded control enters read-only recovery after submission and reports no purchase authorization of its own.

After new signing authority or terminal declines exist, an old database snapshot or schema 51 writer is unsafe recovery. Preserve current keys, accepted commands, decline markers, purchase facts and original operation outcomes. Recovery requires a compatible schema 52 candidate and reconciled current state.

Exact CI archives and qualification receipts are retained locally and on the shared VPS under `~/.local/share/insignia/recovery-release-20261109/startup-final-42601384992-1/`. This custody is not separately controlled production backup. The three exported image tar SHA256 values are:

- Web `e623682bd0fda579169b1246a446c9b0b31d70e764107ad9a725e96b3429691e`.
- Worker `7a60f21f529437682c6ca319a611eba24c27950471f3a649f7d7eb4cd2f6f53e`.
- Verifier `6233947f973421bc237fcc55fc1c085dd65db532c1ad5b12607b9d21b0736125`.

The verifier code manifest is `36cb4ce93fc7a6cd99c26d781f566ab6e556b4ec622ed2a08812a79ee2c9b4bb`. Config IDs and native manifest IDs are distinct and linked by the retained archive proofs.

## Retention disposition

Ten exact overdue capture paths were removed after 388 guards and source-field comparisons. Four minimal historical projections preserve original provenance, identity, schema/fact digests, inspector observations and grant booleans. Five inventories and 363 original operation records remain unchanged because their actual schemas contain necessary metadata and no identified payload requiring further projection.

The expired deploy217 dump and two redundant deploy219 captures were also removed. Both rounds of Nov9 temporary checkpoint payloads were disposed before their deadlines. The original certificate/key custody and unexpired Nov6 checkpoint remain. That checkpoint is not a current restore-qualified production backup.

The ten-file unlink completed before a receipt byte-total calculation failed. Read-only reconciliation verified all ten names absent and all retained guards/configuration hashes before receipt finalization. Deletion was not repeated. Pathname disposal does not assert physical erasure.

Four 57-byte local auth files remain under `/tmp/insignia-canonical-native-20261019/`: `Xauthority`, `fixed-mobile.Xauthority`, `diagnostic.Xauthority` and `final.Xauthority`. The user-manager environment has no matching reference. Environments/file references for processes 2420, 2423 and 1559945 were unreadable; noninteractive privileged access was unavailable. Their safe disposition requires existing owner access or separately authorized retirement of the relevant consumers. No auth bytes were read and no session was stopped.

## Owner and production gates

| Gate | Responsible party and exact missing evidence/resource |
| --- | --- |
| Final production cutover and rollout | Owner authorization remains excluded. Actual production consumers, credentials, storage, installation and supported release envelope require an explicit allocation. |
| Complete recovery | Owner/operator source and off-host credentials, separately controlled recovery key, installed backup/replication and actual DB plus non-empty object loss recovery. Required RPO 24h/RTO 4h and deletion/expiry replay remain unproved. |
| Monitoring and received email | Operator installation/relay custody and original receiver SPF/DKIM/DMARC results. Existing test sends and alert drills are consumed. Connected Gmail search found no matching original sender-to-admin test; that does not establish non-delivery. No resend is authorized. |
| Customer notification enablement | The existing paid-plan declaration and prepared profiles remain. Actual receiver evidence and the remaining qualified runtime/sender requirements must close before customer dispatch. Dispatch stays disabled. |
| VAT uninstall/privacy | Provider settlement and genuine generation-bound callback evidence for installation998524223812/gen1, original 18 October 22:19:55.728 UTC intent. Status remains UNRESOLVED_NO_RETRY. No retry or reinstall. |
| Commercial/distribution and currency | Actual applicable USD 49.99/30-day contract/invoice/trial-to-paid, app distribution/protected-data approval and supported real-merchant envelope. EUR/NL needs a suitable explicit allocation. Rewrite-dev stays USD/US. No new shop, stock/gateway change or payment follows from this handoff. |
| Host recovery and operational ownership | A shared-host maintenance allocation, full-role reboot/recovery proof and a qualified verifier startup policy. Its current restart policy is `no`. Recurring key rotation, monitoring and four-key capacity management have no installed schedule. |
| UI acceptance and remaining native evidence | Owner visual acceptance is open. The native event-order and running-worker purchase/throughput limits above need their exact supported observation or allocation; previous source tests do not close them. |
| Local auth-file hygiene | Existing owner access to the three unreadable processes or separately authorized consumer retirement. The four auth originals remain held. |

## Evidence

- [Development activation and image proof](evidence/technical-merchant-completion/native-startup-development-2026-11-09.json).
- [Signing rotation](evidence/technical-merchant-completion/native-signing-rotation-development-2026-11-09.json).
- [Native quote, cart and exact cleanup](evidence/technical-merchant-completion/native-startup-quote-cart-development-2026-11-09.json).
- [Retention disposition](evidence/technical-merchant-completion/development-retention-disposition-2026-11-09.json).

The relevant code owners are the [selected editor](../../frontend/admin/src/islands/SelectedProductEditor.tsx), [buyer service](../../apps/web/src/server/buyer/service.ts), [Designer runtime](../../frontend/designer/src/runtime.ts), [theme integration](../../apps/storefront/src/theme-integration.ts) and [worker pool composition](../../apps/worker/src/database.ts).
