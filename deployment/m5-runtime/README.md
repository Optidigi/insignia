# Current runtime configuration and deployment boundaries

This directory retains the deployment configuration/data boundary; its `m5` name is historical. Since deploy AC (18 November 2026) production runs one Compose project from [deployment/production/compose.yaml](../production/compose.yaml). [Delivery state](../../docs/delivery/state.md) owns current deployed artifact identities, observations and the actionable owner/operator checklist. [The operating model](../../docs/delivery/operating-model.md) owns effective scoped permissions. This runbook describes deployment mechanics; it does not grant effects or establish readiness.

**Production layout (deploy AC, 18 November 2026).**
- **Stack:** `STACK=/srv/saas/infra/stacks/insignia`, project `insignia`. `$STACK/compose.yaml` (0640, no secrets) is installed from [deployment/production/compose.yaml](../production/compose.yaml), the single source of the runtime shape; its render control is [production-compose.test.mts](../../scripts/runtime/production-compose.test.mts). `$STACK/.env` (0600) holds the nine interpolated secrets (`${NAME:?}` fails closed); `$STACK/secrets/` (0700) holds the secret files (R2 profiles, email profiles, verifier startup file, monitor database file, relay secret, and the signer's wrapping key owned by uid 10101, 0400). Never print `docker compose config` without `-q`: it renders `.env`.
- **Containers:** `insignia-database`, `insignia-signer`, `insignia-web`, `insignia-worker`, `insignia-verifier`, `insignia-heartbeat`, `insignia-heartbeat-snapshot`. Networks `insignia_private` (10.0.7.0/24, internal), `insignia_worker-egress`, `insignia_verifier-egress`, external `proxy`. The database keeps 10.0.7.250 (the host inspector connects by IP) and the alias `insignia-rewrite-m5-019-database` (pinned in `deployment/release-verifier/artifact.mts` and `scripts/release/collector-native.mts`; removal is [server-refactor input](../../docs/backlog/README.md#server-refactor-input-insignia)). Traefik routers `insignia-web` and `insignia-uninstall-private` share the service `insignia-web` (renamed from `insignia-canonical-m5-019r`/`insignia-rewrite-m5-019` in deploy AH, 19 Nov 2026).
- **Data:** `DATA=/srv/data/saas/insignia` is the LUKS2 volume (`/dev/mapper/insignia`, fstab; the docker drop-in `insignia-volume.conf` orders Docker after `srv-data-saas-insignia.mount`; the bare mountpoint is `chattr +i`). It holds `postgres/`, `runtime-state/{signer-socket,artwork-readiness,m5-verify,verifier-state,verifier-auth}`, `monitor/{heartbeat.json,heartbeat-snapshot.json,aggregates,backup-marker}`, `artwork-inspector/{releases/<tree>,inspection.env}` and `releases/`. Every bind is long syntax with `create_host_path: false`, so an unmounted volume fails container creation instead of creating empty sources.
- **Commands:** `docker compose --project-directory $STACK ps|up -d --no-deps --pull never <service>|logs <service>`; `docker exec insignia-database psql …`. Recreate one service at a time with `--no-deps --force-recreate --pull never`.
- **Before deploy AC** the services ran in projects `insignia-production`, `insignia-rewrite-m5-019`, `insignia-uninstall-m5-024`, `insignia-release-verifier` and `insignia-heartbeat` from `%h/.local/share/insignia/runtime/*.private.json` with data on `/srv/insignia`; those files and the historical overlays in this directory are rollback evidence until the production cleanup pass, not deploy inputs.

## Current state

As of 26 November 2026 (production on host alias `prod`, deploy AX). [Delivery state](../../docs/delivery/state.md#deployed-identities) holds the exact image digests and custody locators.
- **Release profile.** `native-review-readiness-849a38e1` binds sole active version `1268027162625`. Web, worker, verifier, and EUR v2 use this version. Shopify's manifest declares the production R2 origin. For each release, read the asset URL from a live Shopify product page and compare the CDN bytes with the qualified build. See the [release binding](native-review-readiness-849a38e1-release-binding.json) and [module baseline](native-review-readiness-849a38e1-module-baseline.json).
- **Production database (16 Nov 2026):** fresh, data `/srv/data/saas/insignia/postgres` on the LUKS2 volume, container `insignia-database` (10.0.7.250, aliases `database` and `insignia-rewrite-m5-019-database`; the other clients use `database`, the verifier the pinned old alias). Artwork bucket `insignia-production` (EU), prefix `artwork`. Details in [delivery state](../../docs/delivery/state.md#production-cutover-16-november-2026).
- **Functions.** AW rebuilt both cart-line v3 Functions from `4991bcf9`. They use the existing registrations, queries, and API version 2026-07. The current pins are in [Deployed identities](../../docs/delivery/state.md#deployed-identities).
- **Application schema 75 and queue schema 48.** Migration `20261126000100` fixes the buyer cleanup batch bound. See the [queue cutover](pg-boss-48.md) for the pg-boss 12.40.0 upgrade, privileges and restore procedure.
- **`INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON`** in web is `{"appKey":…}` only since 13 November 2026 ([Expected Function configuration](#expected-function-configuration)). Worker and verifier never carried it.
- **Web grants on `buyer_visitor_admission`:** `SELECT, INSERT, DELETE` and `UPDATE(window_at,issued_at)`, as in [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql). The worker has no access.
- **Rollback limits:**
  - Web images up to `bf512171` are not rollback targets (#374): they cannot start a session for a visitor with a trusted address on schema 61 and later.
  - Do not roll back the worker alone to an image from before #371 while sessions above the old quotas exist.
  - Web and worker images pinned to pg-boss schema 43 cannot start on schema 48. Use the [queue recovery decision](pg-boss-48.md#recovery-decisions).
  - Database restores and down migrations are never an automatic rollback.
- **Any installed store (#520):** nothing is pinned to rewrite-dev. The verifier verifies the store a request names, reading it with that store's own offline token (its startup file carries the credential wrapping key; see the [verifier README](../release-verifier/README.md)). The worker admits orders from any store with its own release record and Functions.
- **`INSIGNIA_STORE_SETUP_ENABLED=1`** in web (#520): a store's first publish deploys its cart transform and validation when it has neither and no fresh release record, and creates its first non-expiring signing key, both with the publishing staff member's verified session. Partial or foreign Function deployments, revoked or retired keys and an owner's pending rotation are left to the owner. Unset (or any other value), web does neither; remove it to stop automatic setup.
- **`INSIGNIA_PUBLICATION_RELEASE_REFRESH`** in web (owner decision 3): unset, a publish in progress keeps its shop's trusted release record fresh in the background; `0` switches that off, and each publication step collects on its own when its record is stale, as before.
- **Worker health host:** the worker serves `/live`, `/ready` and `/metrics` on port 4301 on its own loopback. `INSIGNIA_WORKER_HEALTH_HOST=0.0.0.0` (the only other accepted value besides the default `127.0.0.1`; anything else is a startup error) lets the container listen on all interfaces so the deployment can publish `127.0.0.1:9464:4301` on the host loopback only, for the heartbeat producer's availability probe ([alerts README](../alerts/README.md#vps-producer-and-aggregate-sources)). Never publish it on a public interface.
- **Owner signing runs:** rotation and the one-step emergency revoke (#375) are in [Signing wrapping-key (KEK) custody](#signing-wrapping-key-kek-custody).

## Deploy next

Rewrite-dev deploys and theme releases run autonomously under the standing 13 November owner approval in the [operating model](../../docs/delivery/operating-model.md#effective-resource-scope); check its limits before any effect outside them. The deploys of 12–13 November followed these steps; their exact records are in [past transitions](#past-transitions) and the [deploy history](../../docs/delivery/history-2026-11-12-bug-batch.md).

**Server images (web, worker, verifier)** follow the [bounded deployment and recovery sequence](#bounded-deployment-and-recovery-sequence):
1. Freeze the baseline: applied migration ledger, ACL digests, protected facts, prior images and configurations.
2. Take a DB-only checkpoint (no configuration, so no wrapping key) and restore-verify it in isolated PostgreSQL, with a dry run of each new migration and grant. Shred its encrypted copies once the deploy is read back.
3. Apply each new migration on its own through the guarded schema owner with an explicit expected ledger. Order migrations against images as each migration's section says.
4. Replace the verifier (re-pinning its code manifest), then web (`--no-deps`), then the worker, under the current profile. Leave the signer and inspector alone unless their code changed.
5. Read back: no error-level lines, fresh web and quiesced worker reads of the same release record, expected ACL digests and unchanged protected facts.

**Shopify plan changes.** Deploy a web image that recognizes the annual Standard contract before
enabling the annual option on Shopify's existing Standard plan. The monthly and annual options
share the `insignia-standard` handle and entitlement policy. On an authorized test store, verify
that both switching directions return to Insignia with the correct effective Shopify cadence,
price and access. Read the Shopify charge history for both changes. See the
[resubmission checklist](../../docs/delivery/shopify-review-resubmission.md) for the review fixture and
evidence. Shopify plan pricing is managed in the Partner Dashboard.

**Migration 65: abandoned publication hold release (#466 part B).** Deployed 14 November 2026 (deploy D). The [design record](../../docs/architecture/design-466-abandoned-hold-release.md) holds the states and the fence.
1. Apply `20261114000100_publication_abandonment.sql` through the schema owner (schema 64 to 65) before any image. It adds the progress phase `abandoned`, the activation kinds `ABANDON_CLAIMED`/`ABANDON_RESTORED`, their triggers, the owner-only append-only `m5_publication_abandonment_audit`, and `m5_operator_claim_abandoned_hold(...)` for part A's command (EXECUTE revoked from PUBLIC; granted only if the operator role already exists). It creates no role. Running images never produce the new states, so it can go first.
2. Run [publication-operator-role.sql](../../scripts/database/publication-operator-role.sql) as the schema owner, after the migration. It is idempotent: it creates the `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` role `insignia_publication_operator` if absent, refuses if a runtime role holds it, and grants it EXECUTE on the operator function. Part A grants it to the command identity (below).
3. Apply [publication-abandonment-grants.sql](publication-abandonment-grants.sql) as the schema owner with `-v worker_role=insignia_queue_consume`. The worker gains `SELECT` and `UPDATE(kind, version, hold)` on `m5_activation_state`, `SELECT` and `UPDATE(phase, version)` on `m4_publication_progress`, `UPDATE(status, failed_at, failure_class, availability_resolved_at)` on `publication_operations`, `SELECT, DELETE` on `m5_current_publication_pointer`, and `SELECT` on `m5_availability_resolutions` and `m5_activation_evidence` (read by the transition triggers). It must not reach the audit table, the restoration consumptions or the operator function; the file checks that.
   Expected digests after steps 1–3, computed read-only on rewrite-dev from its current rows: function ACL `d4d878c2f0c78cb6208ba0bd8fe7dcf7`, column ACL `d87c8eeab55a3b187a4cfd3b059a2f7b`, relation ACL `4672e9ca992737d0f83f7ed00d29b22b`; schema ACL unchanged; the role list gains `insignia_publication_operator`. The membership digest stays `ecaa139dcbfa0804e836860644b9d830` because the role has no members and the schema owner `insignia_rewrite` is a superuser. A non-superuser owner with `CREATEROLE` would get an implicit admin membership on PostgreSQL 16 and later, which would change it.
4. Deploy web (ABANDONED short-circuits, projection, editor states), then the worker with `INSIGNIA_PUBLICATION_ABANDONMENT=off` (the default). Publish one test product to Active and confirm nothing else changed.
5. Set the worker to `flag`: it flags nothing on a healthy store and leaves `OPERATOR_HOLD` rows (such as `QA cover B – Tee`) untouched.
6. Set it to `restore` and run the native check with `INSIGNIA_PUBLICATION_ABANDON_AFTER_MS=300000`: stop a test publish after the hold (close the tab); the product returns to Active, the editor shows "Publishing didn't finish, so your product is back as it was", and Publish works again. Then remove the override (default 10 minutes).
7. While the worker is `off` (the default), nothing is flagged either: a post-activation `RESTORATION_CLAIMED` whose one no-dispatch retry (the N2 fix) is used up stays `ACTIVATED_RESTORATION_PENDING` until `flag` or `restore` applies the stale-claim rule.
8. Rollback: set the worker to `off` first; that stops every worker effect. A web rollback is possible while no `ABANDON_*` row exists; after the first one, recovery is fix-forward. The down migration refuses once abandonment evidence exists.

Bounds (startup errors when out of range): `INSIGNIA_PUBLICATION_ABANDON_AFTER_MS` 300000–86400000 (default 600000), `INSIGNIA_PUBLICATION_RELEASE_WAIT_FLAG_MS` (default 86400000), `ABANDON_CLAIM_STALE_MS` (default 120000). Log event `publication_abandonment` (info for restored/finalized, warn otherwise), counter `insignia_publication_abandonment_total{outcome}`, gauge `insignia_publication_holds_flagged`.

**#466 part A: publication hold operator command (owner-run, server only).** Deployed 14 November 2026 (deploy E). It handles a held product that B leaves alone (`OPERATOR_HOLD`), one shop and config per run, over SSH on the host, by the owner or by the lead or agents on the owner's instruction. There is no admin UI. It is `dist/publication-hold-main.js` in the worker image, run in a one-off container of the deployed worker by [publication-hold.sh](publication-hold.sh). The [design record](../../docs/architecture/design-466-abandoned-hold-release.md#9-part-a-operator-command-built-after-b) holds the rules.

*Install (once, after a worker image that contains the command is deployed).* Migration 65 and `publication-operator-role.sql` must already be applied. Apply migration 66, `20261115000100_operator_command_key.sql` (schema 65 to 66), through the schema owner first: a unique index that makes an operator claim's command key single-use per shop in the database. It is index-only; running images are unaffected, and down drops it.
1. Create the command's own LOGIN identity from private custody, as the schema owner (the password is typed at the prompt, never on a command line or in history):
   ```
   docker exec -it insignia-database psql -U insignia_rewrite -d insignia_rewrite
   CREATE ROLE insignia_publication_hold LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
   \password insignia_publication_hold
   ```
2. Apply [publication-hold-command-grants.sql](publication-hold-command-grants.sql) as the schema owner:
   ```
   docker exec -i insignia-database psql -U insignia_rewrite -d insignia_rewrite -v ON_ERROR_STOP=1 -v command_role=insignia_publication_hold < deployment/m5-runtime/publication-hold-command-grants.sql
   ```
   It grants the identity `insignia_publication_operator` (the only route to `m5_operator_claim_abandoned_hold`), `CONNECT`, `USAGE` on schema `public` (review note A3), and only what the command reads and writes:
   - `SELECT` on `shops`, `installation_generations`, `product_configs`, `publication_operations`, `m4_publication_progress`, `m5_activation_state`, `m5_current_publication_pointer`, `m5_availability_resolutions` and `m5_activation_evidence`;
   - row-lock columns, needed because B's T2/T3 and the existing resolution run unchanged with `FOR UPDATE`: `UPDATE(updated_at)` on `shops` and `product_configs`, and `UPDATE(created_at)` on `installation_generations`. These are provenance timestamps nothing reads as authority; `activated_at` and `deactivated_at` are excluded. A security-definer lock function would fork B's restore path, so it is not used;
   - B's T2/T3 and the resolution: `UPDATE(kind, version, hold, resolution_digest)` on `m5_activation_state`, `UPDATE(phase, version)` on `m4_publication_progress`, `UPDATE(status, failed_at, failure_class, availability_resolved_at)` on `publication_operations`, `DELETE` on `m5_current_publication_pointer`, `INSERT` on `m5_availability_resolutions`;
   - the offline token (as the worker): `SELECT, UPDATE` on `shop_credentials`, `SELECT` on `shop_credential_acquisitions`.

   It refuses a superuser, a runtime role or an identity that holds another role, and checks that the identity cannot reach the abandonment audit, the restoration consumptions, signing keys, `deactivated_at` or `shops.current_generation`. The role list gains `insignia_publication_hold`; the membership, relation-ACL and column-ACL digests change. Read them back with the deploy baseline's formulas and record them in [delivery state](../../docs/delivery/state.md).
3. Write the identity's URL into a private file on the host (same host and database as the worker's `DATABASE_URL`), and install the wrapper from the merged commit:
   ```
   umask 077; cat > /srv/saas/infra/stacks/insignia/secrets/publication-hold-database-url   # paste one line, then Ctrl-D:
   postgresql://insignia_publication_hold:<password>@database:5432/insignia_rewrite
   install -m 0700 deployment/m5-runtime/publication-hold.sh /srv/saas/infra/stacks/insignia/publication-hold.sh
   ```
   The wrapper refuses unless that file and the stack's `.env` are regular files owned by the login with mode 0600, the stack's `compose.yaml` is owned by the login with mode 0600 or 0640, and the URL names `insignia_publication_hold`. It passes the URL as an environment variable (never an argument), blanks the worker's `DATABASE_URL`, and the command itself refuses to run unless its identity is a member of the operator role and is no superuser or runtime role. The stack's `worker` service (`docker compose --project-directory /srv/saas/infra/stacks/insignia run … worker`) supplies the image, networks, credential wrapping key and `SHOPIFY_CLIENT_ID`/`SECRET`/`INSIGNIA_SHOPIFY_APP_ID` for the offline token. Nothing else is stored. The wrapper's own refusals are audited as well (`by: wrapper`).
   - **Token access:** like the worker, the command holds the credential wrapping key and grants on `shop_credentials`, so it can decrypt (and refresh) any installed shop's offline token. It uses only the scoped shop's token, for the reads and the one status-only restore, through a port bound to that token.
   - **Visible while it runs:** the one-off container's environment, including `INSIGNIA_PUBLICATION_HOLD_DATABASE_URL` (and, as for the worker, the wrapping key and app secret), is visible to `docker inspect` and to root while the container runs. It is removed with the container (`--rm`). Run the command only from the owner's login, and do not leave it waiting.

*Run.* `H=/srv/saas/infra/stacks/insignia/publication-hold.sh`
1. Inspect (read only): `$H inspect --shop <shopId> --config <configId>`. For each unresolved hold of that config it prints the operation, `activation.kind`/`version`, `hold.heldSince`, the `before`/`held` states, the committed phase and status, the installation, and the live Shopify state: the product (`state`, `equalsHeld`, `equalsBefore`) and `registration`, `policy` and `public_config` (present, `matchesPrior`; `public_config` is shop-wide and for information only). Then `safeToRestore` and `reasons`. "Safe" means all of: `OPERATOR_HOLD` with Insignia's owned held receipt and no restoration yet; committed phase `prepared` of the current `requested` operation; the store was not reinstalled since the hold; the live product equals the held snapshot exactly; live `registration` and `policy` equal their pre-publish values. Only then it prints `inspectDigest` (`<inspected-at ms>.<sha256>`), bound to the activation version, the hold, the installation, the live product and fields, and the inspection time.
2. Restore, within 10 minutes of that inspection: `$H restore --shop <shopId> --config <configId> --operation <operationId> --inspect-digest <inspectDigest> --command-key <key> --confirm`. Choose a new key per command, for example `owner-20261114-qa-cover-b`; a key is single-use per shop. Before claiming, it re-reads the product and fields and recomputes the digest; any difference refuses with nothing claimed. Then it claims `OPERATOR_HOLD → ABANDON_CLAIMED` (`SETTLED_BY_TRUSTED_OPERATOR`, with the key and digest) through the operator function and runs B's restore and finalize unchanged: one status-only write, receipts, one retry of a no-dispatch read. `outcome: restored` ends with `ABANDON_RESTORED`, phase `abandoned`, the request failed `publication-abandoned`; the merchant sees "your product is back as it was" and can publish again. B's worker never rearms or dispatches an operator claim. If the command dies, the worker only applies B's stale rule after 2 minutes (`OPERATOR_HOLD`, `claim_unsettled`, never a write) and runs a missing finalize, so the merchant is never left on "restoring".
3. Resolve: `$H resolve --shop <shopId> --config <configId> --operation <operationId> --command-key <key> --confirm`. The existing observation-only resolution: it never writes to Shopify, and it succeeds only when Shopify already shows the original (`before`) state. The confirmed command is its authority (`SETTLED_BY_TRUSTED_OPERATOR`). It records the resolution row, `RESOLVED` (or `RESTORED` for an activated operation), and fails the request `availability-resolved`.

*When restore refuses or stops* (exit 1; `outcome` and `reasons` in the line):
- `product_changed`, `registration_changed`, `policy_changed`, `fields_written` (a later-phase hold), `installation_changed` (reinstalled store), `restoration_started`, `hold_not_owned`, `superseded`: restore the product by hand in Shopify admin to its `before` state (the status inspect shows), confirm with `inspect` that `equalsBefore` is true, then run `resolve`.
- `inspection_stale`, `inspection_mismatch`, `claim_refused`: something moved since the inspection; inspect again and decide again.
- `credential_unavailable`, `observation_unavailable`, `fields_unavailable`: Shopify or the offline token could not be read; nothing was claimed. Retry later.
- `outcome: skipped`, `claim_in_flight`: an earlier run of this same command claimed and did not finish. `inspect` shows that claim's `commandKey` and `resumeInspectDigest`. Re-run the command with them after 2 minutes (or let the worker apply the stale rule): B's rules continue it (one rearm of a no-dispatch receipt, a finalize), or hand it to `OPERATOR_HOLD` (`claim_unsettled`) because a crash may have dispatched; it never writes twice.
- `outcome: flagged` (`restore_conflict`, `restore_ambiguous`, `claim_unsettled`, `claim_fenced`): back at `OPERATOR_HOLD` with a receipt. Check the product in Shopify admin, restore it by hand if needed, then `resolve` with a new key.

*Audit.* Every run, including `inspect` and refusals, prints one JSON line (`event: publication_hold_command`: identities, key, digest, outcome, reasons, findings; never a token or provider body), and the wrapper appends it to `/srv/data/saas/insignia/runtime-state/publication-hold-audit.jsonl` (mode 0600; before deploy AC `~/.local/share/insignia/runtime/publication-hold-audit.jsonl`). `restore` is also in `m5_publication_abandonment_audit` (`CLAIMED` from `OPERATOR_HOLD`, with the key and digest in the hold) and `resolve` in `m5_availability_resolutions`.

*First use:* `QA cover B – Tee` (operation `43db577d-…`): `OPERATOR_HOLD`, committed `prepared`, owned held receipt, a first publication (prior field digests null). If `inspect` shows `registration` and `policy` absent, it is safe and the owner can confirm `restore`.

**Migration 67: artwork cleanup backoff and review (#474).** Deployed 14 November 2026 (deploy F). Only the host inspector runs this code; web, worker and verifier images are unaffected.
1. Apply `20261116000100_artwork_cleanup_backoff.sql` through the schema owner (schema 66 to 67) before the new inspector. It adds six columns with constant defaults (no table rewrite): per kind, deletion (`cleanup_*`) and a USABLE row's quarantine key (`quarantine_cleanup_*`), `*_attempts`, `*_failure` (`STORAGE_UNAVAILABLE` or `STATE_UNAVAILABLE`) and `*_review_at`, plus the partial index `artwork_cleanup_review`. The running inspector ignores the columns. Down drops them.
2. Apply the delta [artwork-cleanup-backoff-grants.sql](artwork-cleanup-backoff-grants.sql) as the schema owner (`psql -v ON_ERROR_STOP=1 -f deployment/m5-runtime/artwork-cleanup-backoff-grants.sql`). `insignia_artwork_inspect` gains `UPDATE` on exactly those six columns; nothing else changes (it already reads the whole table, web has table-level `SELECT`, the monitor's column list is unchanged). Do not re-apply [artwork-runtime-grants.sql](../../scripts/database/artwork-runtime-grants.sql) on an existing installation: its access check refuses the merchant-preview grants the inspector also holds, and it aborts (deploy F dry run, 14 Nov 2026). The delta is idempotent; a fresh installation gets the same columns from the full file. The column-ACL digest changes by those six columns; function, membership and schema digests stay unchanged, and the relation digest moves only if its formula lists the new index. Read them back with the deploy baseline's formulas and record them in [delivery state](../../docs/delivery/state.md).
3. Hand over to the new immutable inspector package from CI per the [inspector README](../artwork-inspector/README.md). `qualifyArtworkRuntimeRole` runs only at startup and requires the exact update set: the new package refuses before step 2, and the old one refuses if it restarts after step 2. The running old inspector is unaffected, so do not restart it between step 2 and the handover.

*Rollback after step 2* (the old package refuses to start once the grant is applied). Either revoke the six columns as the schema owner, which keeps migration 67 and is enough for the old package:
```
REVOKE UPDATE(cleanup_attempts, cleanup_failure, cleanup_review_at,
  quarantine_cleanup_attempts, quarantine_cleanup_failure, quarantine_cleanup_review_at)
  ON public.artwork_assets FROM insignia_artwork_inspect;
```
or migrate 67 down through the guarded schema owner (dropping the columns drops their grants). Then start the old package and confirm readiness. Read back and record the column-ACL digest: after a down migration it should equal the pre-migration value; after a revoke the columns remain with an emptied ACL, so the digest may differ from it. The bookkeeping is lost with a down migration and is unused by the old package with a revoke; neither affects retention.

After handover, a failed cleanup attempt waits 5 s, doubling to 15 minutes. Each failure logs `queue_job_rejected` at warn with `errorClass` and `attempt` only. At the 12th consecutive failure the row gets `*_review_at` and later failures log `ARTWORK_CLEANUP_NEEDS_REVIEW`. A deletion keeps retrying every 15 minutes; a USABLE row's quarantine cleanup stops, and retention deletion removes that key with the asset. A success clears all three columns. The heartbeat's existing overdue check already counts a stuck deletion (`REJECTED`/`DELETING`, expired rows), but not a DELETED tombstone whose re-sweep needs review: the monitor role's column grants ([monitor-grants.sql](../alerts/monitor-grants.sql)) do not include `cleanup_review_at`, so adding it is a separate monitor-grant change, not part of this deploy. The gauge `insignia_artwork_cleanup_review_rows` is set after each sweep in the inspector's registry; the inspector serves no metrics endpoint, so read the rows directly: `SELECT asset_id,state,cleanup_attempts,cleanup_failure,cleanup_review_at,quarantine_cleanup_attempts,quarantine_cleanup_failure,quarantine_cleanup_review_at FROM artwork_assets WHERE cleanup_review_at IS NOT NULL OR quarantine_cleanup_review_at IS NOT NULL`. After fixing the cause, resume a stopped quarantine row as the schema owner with `UPDATE artwork_assets SET quarantine_cleanup_attempts=0,quarantine_cleanup_failure=NULL,quarantine_cleanup_review_at=NULL WHERE asset_id=...`.

**Migration 68: settled order receipts leave the retention alert (#488).** Deployed 14 November 2026 (deploy G). Apply `20261117000100_webhook_obligation_discovery_closure.sql` through the schema owner (schema 67 to 68), in any order relative to images: it only replaces the body of `pending_shopify_webhook_obligations(integer)`, which the running worker calls. `CREATE OR REPLACE` keeps the function's owner, `SECURITY DEFINER` and its EXECUTE grant, so no grant delta and no ACL digest changes; no worker, web, verifier or inspector image change. From the next 30-second retention pass, an erased receipt no longer counts toward `UnsupportedPayloadRetentionBlocked` when it was processed, or when the evidence of its own effect is recorded for its order (the captured `id`) under the same shop generation: `orders/create` when the order is in `purchase_orders`; `orders/paid` when that purchase has its `purchase_paid_facts` row; `orders/updated` when that purchase has a `purchase_observations` row observed at or after the receipt arrived. A discovery watermark alone never closes one (Shopify returns only orders created in the 60 days before the query, so a stalled discovery can pass a change it no longer reads). A failed `refunds/create` keeps alerting (its facts carry no order ID; capturing `order_id` is a possible later improvement). After the 180-day fact erasure empties the captured `id`, an unprocessed receipt counts again. No row is written: such a receipt keeps its `failed` state, attempts and failure class. The three 7 November receipts of order #1005 stop alerting on their own: discovery recorded the order, its paid fact and an observation at `21:09:15Z` that day, after all three arrived (checked read-only on rewrite-dev). No owner step is needed. Read back: the line stops, and `SELECT category_count FROM pending_shopify_webhook_obligations(100) WHERE topic LIKE 'orders/%' OR topic='refunds/create'` returns no rows. Any other unprocessed receipt keeps alerting at error. Down restores the previous body (every fact counted).

**Migration 69: order receipt retry backoff (#491).** Deployed 15 November 2026 (deploy H). Only the worker image runs this code; web, verifier, signer and inspector are unaffected.
1. Apply `20261118000100_order_receipt_retry_backoff.sql` through the schema owner (schema 68 to 69). It adds the nullable column `inbox_messages.next_attempt_at` (no default, no table rewrite). The running worker ignores it.
2. Apply the delta [order-receipt-backoff-grants.sql](order-receipt-backoff-grants.sql) as the schema owner (`psql -v ON_ERROR_STOP=1 -f deployment/m5-runtime/order-receipt-backoff-grants.sql`). `insignia_queue_consume` gains `UPDATE(next_attempt_at)` on `inbox_messages`; nothing else changes (it already reads the whole table; web and monitor are unchanged). The delta is idempotent; a fresh installation gets the same grant from [purchase-runtime-grants.sql](../../scripts/database/purchase-runtime-grants.sql). The column-ACL digest changes by that one column; relation, function, membership and schema digests stay unchanged.
3. Replace the worker with the binding-head image. Steps 1 and 2 must come first: the new worker writes the column when an attempt fails, and without the grant that write is refused and the receipt stays leased until its one-minute lease expires.

After the worker change, a failed `orders/create`, `orders/paid`, `orders/updated` or `refunds/create` attempt waits 5 s, doubling to a 15-minute cap (5, 10, 20, 40, 80, 160, 320, 640, 900, 900, 900 s; the 30-second recovery pass rounds the short ones up), for 12 attempts in all instead of 5 back-to-back ones. A pg-boss retry that arrives before the receipt is due completes as `deferred`. After the 12th failure the receipt stays `failed` with its attempts and failure class and is not retried; recurring discovery reconciles the order and the migration-68 rule decides whether it alerts after payload erasure. Receipts already failed with 5 attempts and still retained get their remaining 7 attempts; on rewrite-dev the only such receipts are the three erased 7 November ones, which are never reselected (checked read-only, 15 Nov 2026). Rollback: the old worker ignores the column; migrate 69 down only after the old worker is back (dropping the column drops its grant).

**Migration 70: store setting for automatic customer artwork email (D7).** Deployed in S. The procedure below records the web rollout.
1. Apply `20261119000100_merchant_customer_artwork_email.sql` through the schema owner (schema 69 to 70) before the new web image. It adds `merchant_preferences.notifications_version` and `customer_artwork_email` (constant defaults, no table rewrite) and adds `SUPPRESSED` to the `customer_artwork_notifications` state check. Running images ignore the columns and never write the new state.
2. No grant delta: web already has table-level `SELECT, INSERT, UPDATE` on `merchant_preferences` (which covers new columns and `FOR SHARE`) and `UPDATE(state, settled_at)` on `customer_artwork_notifications`. ACL digests stay unchanged; the monitor's column grants are unchanged and `SUPPRESSED` is not counted as stalled.
3. Replace web with the new image. Read back: Settings shows "Customer emails" on by default for every store; no notice changes until a merchant turns it off.
4. Rollback: an older web image ignores the setting, so stores that turned it off would get automatic email again; check `SELECT count(*) FROM merchant_preferences WHERE NOT customer_artwork_email` first. Already-suppressed notices stay settled. Migrating 70 down (after the old web is back) rewrites `SUPPRESSED` to `CANCELLED` (both terminal no-send states), restores the old check and drops the two columns, losing the stores' choices.

**Migration 71: deactivation destroys the generation's signing keys (spec §5.5).** Deployed in W. The procedure below records the rollout and the separate cleanup for previously deactivated generations.
1. Apply `20261120000100_deactivated_installation_signing_keys.sql` through the schema owner (schema 70 to 71). It adds a `SECURITY DEFINER` trigger on `installation_generations`: when `deactivated_at` is first set (uninstall processing, or a reinstall deactivating the previous generation), the same transaction sets that generation's signing keys to `destroyed` and scrubs their private halves. Public keys, fingerprints and windows stay, so that generation's recorded orders still verify. The function is revoked from `PUBLIC` and granted to no role; no grant delta and no ACL digest change.
2. It does not sweep generations deactivated earlier. For one named generation, run the operator command as the schema owner, first as a dry run. The script imports `packages/database/dist`, so run it from a checkout of this commit after `corepack pnpm install --frozen-lockfile && corepack pnpm --filter @insignia/database build`:
   ```
   DATABASE_URL=<schema owner> node scripts/database/destroy-generation-signing-keys.mts --shop <tenant shop uuid> --generation <n>
   DATABASE_URL=<schema owner> node scripts/database/destroy-generation-signing-keys.mts --shop <tenant shop uuid> --generation <n> --apply
   ```
   The dry run prints the keys (id, state, whether a private half remains) and the ids it would destroy. It refuses an active or unknown generation, in both modes. `--apply` destroys through `destroyInactiveInstallationKeys`, which re-checks the deactivation under row locks, and prints the count. Output is one JSON line with no key material.
3. Rollback: migrate 71 down drops the trigger and function; keys already destroyed stay destroyed.

**Migration 72: a recorded order keeps its artwork six months (spec §10.4).** Deployed in AD. The web image locks artwork before attaching it to an order, which prevents simultaneous attachments of the same file from deadlocking when the attachment extends retention. The web image also updates the order page's deletion warning.
1. Apply `20261121000100_purchased_artwork_retention.sql` through the schema owner (schema 71 to 72), before the new web image. It changes a CHECK and the guards on `artwork_assets` and adds triggers on the purchase tables, which needs short exclusive locks behind running traffic: run it with `PGOPTIONS='-c lock_timeout=5s'` and retry on a lock timeout (the migration is one transaction; a timeout leaves nothing applied). Accepting a quote now keeps the accepted offer and its artwork until 72 hours after acceptance when that is later than the 7-day deadline, so an order processed late (a retried `orders/create`, or one found by reconciliation) is still recorded with its design; a quote never ordered loses both when the grace ends. When an order's design is recorded (`orders/create`, paid or not), `SECURITY DEFINER` triggers extend, in the same transaction, the design payload to its collection plus six calendar months and each USABLE artwork it references to its own upload plus six months, capped at the design's deadline; a later attachment (merchant replacement or customer link) extends that asset the same way. The deadline is computed in UTC less a 2-day margin, so the existing six-month CHECKs (evaluated in the session time zone) still hold when erasure rewrites the row. The customer upload link, previews and download links follow the design's deadline already, and the inspector deletes objects from `artwork_assets.expires_at` as before. Uploads not on an order keep 7 days (a new upload is refused above 7 days). The asset CHECK becomes six months; the expiry guards allow only a later deadline, only for live rows and only as the schema owner. Erasure is unchanged: redaction sets assets `DELETING` and payloads to tombstones, which the inspector and `cleanup_purchase_payloads` remove at once. The migration backfills live accepted offers (grace from their acceptance time) and orders whose design is still live (both bounded by the old 7-day deadlines; re-running changes nothing). It does not lengthen customer upload links already issued: such a link keeps its old expiry, and the merchant can issue a new one from the order page, which lasts as long as the design.
2. No grant delta: the seven new functions are revoked from `PUBLIC` and granted to no role. Function and relation ACL digests may move only if their formulas list every public function; read them back with the deploy baseline's formulas and record them in [delivery state](../../docs/delivery/state.md).
3. Read back (both return 0), and a new test order's artwork shows a deletion date about six months out:
   ```
   SELECT count(*) FROM purchase_design_payloads WHERE erased_at IS NULL AND expires_at>clock_timestamp() AND expires_at<=collected_at+interval '7 days';
   SELECT count(*) FROM artwork_assets a WHERE a.state='USABLE' AND a.expires_at>clock_timestamp() AND a.expires_at<=a.collected_at+interval '7 days' AND a.asset_id IN (
     SELECT r.asset_id FROM purchase_design_payloads p CROSS JOIN LATERAL customer_privacy_payload_assets(p.payload->'request') r WHERE p.erased_at IS NULL AND p.expires_at>clock_timestamp()
     UNION SELECT e.asset_id FROM purchase_artwork_events e WHERE e.kind='ATTACH' AND e.erased_at IS NULL AND e.expires_at>clock_timestamp());
   ```
4. Rollback is images only: the old web works with the extended deadlines (with the rare deadlock above). Migrate 72 down refuses as soon as any asset is kept past 7 days (any recorded order or recent acceptance), because shortening would delete artwork early; treat the migration as forward-only.

**Theme or other app-version change.** Do the server steps first under the current profile. Then:
1. Create the candidate once from the frozen staging of the current profile. Replace only the changed files: theme assets come from the foundation CI build of the source, byte-identical to a local build. Functions stay byte-identical unless the owner authorizes a Function change.
2. Read the candidate back: inactive, inventory and module baseline as expected.
3. Bind it in a PR from a `release/` branch in this repository so Runtime retains the qualified archives. Include the release-binding JSON, module baseline, verifier profile, Shopify runtime profile, release verification protocol target and worker purchase admission target. On the binding tree, run the native purchase qualification tests to check that the runtime can resolve the version and send an exact release verification request.
4. Phase B: replace verifier, web and worker with binding-head images and the new profile.
5. Run exactly one `app release`. Read back: sole Active is the candidate, inventory equals the binding, NEVER_RELEASE versions inactive, Active modules equal the baseline.
6. Obtain fresh admission: web and quiesced worker reads match one new release record.

**Fail-closed window.** Creating the candidate adds a version to the inventory, so the current profile fails closed. Quotes and Add to cart are unavailable from candidate creation until step 6. The windows on 12–13 November were 43, 33 and 33 minutes, with no buyer traffic. Plan for about 35 minutes.

**Native staging.** Staging must retain the prior qualified theme manifest's UID/name. The repository's `extensions/insignia-theme/shopify.extension.toml` is explicitly local-preview configuration, not the native registration manifest. Copy reviewed blocks/snippets/locales and exact CI assets into fresh staging while preserving that native manifest, original Function targets and `.shopify/project.json`; omit cached deploy bundles. Compare every module identity and non-theme configuration before release, not only file hashes.

CLI4.8.2's AppVersions query reads only20 nodes. The collector's bounded inventory reader uses that same official authenticated transport with first100 and requires returned length to equal provider count, unique IDs and one Active. The existing exact reviewed inventory/status checks still run at opening and closing. Counts above100 or incomplete results remain unavailable; SDK/auth adapter pins, authority and finite collection policy are unchanged.

## Expected Function configuration

Source from this change onward takes each Function's expected input-query fingerprint from the trusted release record (Active version plus module baseline, including the query), the same authority admin activation, signing and checkout admission already use. The private web value `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` needs only `{"appKey":"<SHOPIFY_CLIENT_ID>"}` and no longer changes at a Function release.

Live Shopify Admin returns `inputQuery: null` for both owned Functions. Observation v2 records that as not observable (`inputQuerySha256: null`) and does not compare it; the trusted release record is the query gate, and readiness still fails closed without a fresh release-bound record. If Admin returns a query, it must equal the record's.

Operator migration: none is required. The legacy `transformInputQuerySha256`, `validationInputQuerySha256` and `observationVersion` fields are still accepted (64-hex and `2` when present), then ignored. Images built before this change require them. Those images predate `bf512171`, so since #374 they are no longer rollback targets ([Current state](#current-state)). The rewrite-dev value was reduced to `appKey` only with the `9b5dbdee` web deploy (13 November 2026).

## Qualify an immutable candidate

Build web from [scripts/runtime/Dockerfile.web](../../scripts/runtime/Dockerfile.web) and its thin [build launcher](../../scripts/runtime/build-web.sh); worker uses [scripts/worker/Dockerfile](../../scripts/worker/Dockerfile) and [build launcher](../../scripts/worker/build-worker.sh). Use the accepted exact source/tree and natural final-head CI, including physical process/image checks. Retain image IDs, export hashes/size, artifact inventory, migration hashes, CI run/attempt and reviewed Compose hashes. A healthy `/live`, portable package or source test does not prove authenticated readiness or native acceptance. Local isolated PostgreSQL qualification does not replace physical process/image checks.

Privately freeze prior images, current applied migration ledger, roles/queue state, effective routing, mounts, consumers, independent release authority and protected purchase/paid facts. Compare the actual host against this baseline before selecting effects. Applied migrations are immutable. A fresh install uses the complete current schema-owner workflow; an existing installation applies only reviewed missing append migrations after backup/compatibility qualification. Use the current schema-owner path and derive the required migration set from `packages/database/migrations`; retired fixed-baseline helpers are not upgrade procedures.

The selected integration adds strict authoring/presentation fields and privately referenced merchant photo sources. Schema45 images are only a pre-write rollback: after selected authoring, publication, movement or customer-link writes, keep a backend/worker that understands those contracts. The old artwork/merchant-preview cleanup executor must be drained before new source references become writable; its pre-integration repository does not understand those references. That executor belongs to the existing immutable host inspector/artwork-main service, separately from the general queue-worker container. Inventory and qualify that consumer and its current role/view access too; replacing only the web and queue-worker images does not upgrade it. Database reference guards do not establish the old consumer’s cleanup fairness or complete runtime qualification. Upgrade the paired web/worker and least-privilege grants together after the additive migrations. Never restore an old image or database snapshot over newer purchases, accepted quotes, attachments or financial facts. After the first new-format write, recovery uses the qualified compatible candidate/fix-forward path or a separately reviewed data-aware recovery; retained old image bytes alone are not a rollback qualification.

For an existing installation that already has qualified M9 privacy/lifecycle permissions, the older M8 bootstrap grant preconditions are not an upgrade recipe: they deliberately reject every non-trigger SECURITY DEFINER function, including those later scoped APIs. Preserve the existing qualified permissions. Apply the reviewed selected-feature grant delta only (new preferences/order-label/capability tables, the asset-reference view read and queue order-label writes), and compare pre-existing relation/function ACLs and role memberships before/after. Never revoke later qualified APIs merely to make an earlier bootstrap guard pass. The inspector's runtime role check must explicitly recognize only the required asset_id reference view, with no draft-data access or view mutation authority.

For an existing selected-UI installation, apply [the order-label grant delta](order-label-runtime-grants.sql) as the schema owner with the actual existing `web_role` and queue `worker_role` identifiers. It adds only `SELECT(shop_id,order_id)` on customer order fences and `SELECT(shop_id,installation_generation)` on shop fences. These identifiers let verified order-name projection honor erasure; source receipts/timestamps, full-table reads and fence mutation remain unavailable. Fresh bootstrap grants contain the same columns. Do not rerun old bootstrap grants over later qualified privacy APIs, create roles, reset exhausted webhook attempts or submit a second checkout to repair ingestion. Normal independent discovery can reconcile the already verified order after the delta. Verify actual restricted facade calls, not merely table creation or a label-table SELECT.

## Preserve the existing topology

[deployment/production/compose.yaml](../production/compose.yaml) is the whole production runtime: database, signer, web, worker, verifier and the two monitor services in project `insignia`. Its secrets come from the stack's `.env` and `secrets/` in existing custody; do not create substitute credentials. A deploy changes only image tags, `INSIGNIA_RELEASE_PROFILE` and the verifier command (plus a reviewed environment change); any other delta is a reviewed change to this file first. The reviewed web command is `/usr/local/bin/node /srv/insignia/web/dist/server/entry.mjs`, with `init: true`, nonprivileged user and bounded stop grace. The generated application `.mjs` is a build artifact. [The Compose control](../../scripts/runtime/production-compose.test.mts) renders it and checks identities, custody paths, the signer boundary, routing and command/init semantics. Preserve `Host(app.insigniacustomizer.com)`, TLS, the database's address/aliases and the data binds. Changing the project name, `down -v` or creating containers while the data volume is unmounted (refused by `create_host_path: false`) would violate that boundary.

The worker runs on the private network plus its own outbound bridge (`insignia_worker-egress`); it adds no proxy network, capabilities or writable code mount, and publishes only its health port on host loopback `127.0.0.1:9464` for the heartbeat. The historical split-project files ([compose.yaml](compose.yaml) over [the canonical base](../m5-019r/compose.yaml), [scripts/worker/worker-compose.yaml](../../scripts/worker/worker-compose.yaml) with [worker-compose.yaml](worker-compose.yaml)) and their render controls describe the pre-AC layout only. The runtime guard checks independently rendered Compose against actual image/executable inventory and private same-database observations. The [pg-boss upgrade runbook](pg-boss-48.md) covers the owner migration, grants, and restore rehearsal for #670.

For exported artifacts, distinguish the OCI manifest selector from its image-config digest: CI may report the config digest as `imageId`, while the native containerd image store reports the manifest as its loaded image ID. Verify the export hash, every referenced OCI blob, config and uncompressed layer digest; compare Docker’s loaded `Id`, `Descriptor.digest`, configuration and root filesystem against those independently qualified bytes. Bind `INSIGNIA_WORKER_IMAGE` and web to the verified native full lowercase `sha256:<64 hex>` selector and retain both manifest/config identities in the deployment receipt. A qualified registry `name@sha256:<64 hex>` is a separate supported identity; do not invent a RepoDigest for a local export or substitute a mutable tag. The worker’s real offline-refresh transport needs allocated-host outbound DNS/TLS and bounded provider readiness; rendered topology alone cannot prove egress or Shopify success.

[Release-verification web](release-verification-compose.yaml) and [worker](release-verification-worker-compose.yaml) overlays mount only the prequalified shared metadata directory read-only at `/run/insignia/release-verification`, with host-path creation disabled. Apply each to its own project, preserving directory identity. Independent collector credentials, append custody, receiver and executable remain outside app runtimes. Inspect the actual verifier/consumer binding after recreating web; rebind only when that verified contract requires it, and obtain fresh correlated observations before admission; old evidence retains its real expiry.

Schema51 adds guarded recovery from a durable, exact NOT_DISPATCHED restoration receipt. Apply the reviewed append migration through the existing schema owner before deploying its compatible backend/worker. The owner-triggered append-only consumption audit grants no app direct DML; preserve original claims/receipts and all ordinary role restrictions. No down migration or database restoration may discard used recovery evidence. Resume the exact original publication identity under fresh authorization; unchanged provider readback alone never permits a retry.

## Cloudflare-only origin

Owner decision, 11 November 2026: Insignia's origin admits only Cloudflare's edge. Both Insignia routers (`insignia-web`, before deploy AH `insignia-canonical-m5-019r`, and `insignia-uninstall-private`) use the route-level `insignia-cloudflare-origin` `ipAllowList` middleware, defined on the web container's labels in [the production stack](../production/compose.yaml). It matches the TCP peer address; it sets no `ipStrategy`, so a client-supplied `X-Forwarded-For` cannot satisfy it. Other sites, the shared `websecure` entrypoint, Traefik's static configuration and its ACME HTTP-01 challenge on port 80 are unchanged. A direct request to the origin gets `403 Forbidden` from Traefik. Shopify (app proxy, webhooks, embedded admin, OAuth) reaches `app.insigniacustomizer.com` through Cloudflare's proxied DNS. Both routers serve only that host. The container health check (`127.0.0.1`) and Traefik's load-balancer health check (container network) do not pass through a router. The verifier uses its socket.

[cloudflare-ips.json](../m5-019r/cloudflare-ips.json) is the pinned copy of `https://api.cloudflare.com/client/v4/ips`, with its `etag`. The `sourcerange` label must equal its IPv4 then IPv6 CIDRs joined by commas; [the Compose control](../../scripts/runtime/production-compose.test.mts) enforces that. Cloudflare changes these ranges rarely and announces it in advance.

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

The [signing-owner overlay](signing-owner-compose.yaml) is armed only for an owner signing run (a rotation or an emergency run, below) and disarmed afterwards; an ordinary web deployment omits its two mounts. Preserve each run's plan, run root and binding under actual retention; do not rewrite old release receipts, extend validity or remove wrapping-key custody. Current trusted-release, Function, public-config, key and tenant admission checks remain mandatory.

**Separate signer** (the `signer` service of [the production stack](../production/compose.yaml); [signer-compose.yaml](signer-compose.yaml) is the historical overlay).
- The `signer` service (container `insignia-signer`) in project `insignia` runs the worker image with `node /srv/insignia/worker/dist/signer-main.js`. It runs as its own uid with web's group (`user: "10101:1000"`), read-only, `cap_drop: ALL`, on the `private` network only. It has no port and no Traefik labels.
- It serves `POST /v1/sign` and `POST /v1/provision` (and `GET /health`) on `/run/insignia/signer/signer.sock`.
  - The socket is mode 0660 in a directory owned `10101:1000`, mode 0710.
  - Web (uid 1000, group 1000) mounts that directory read-only and can connect. It can never read the key file.
  - Host directory: `/srv/data/saas/insignia/runtime-state/signer-socket` (before deploy AC `~/.local/share/insignia/runtime/signer-socket`).
- It logs one JSON line per request (`signer_sign`/`signer_provision`: outcome, shop, generation, key id, ms) and hourly counts. It never logs key material or messages.
- If the signer is down, quotes fail closed with a retryable 503 (`SignerUnavailable` in diagnostics).
- Each signature holds its key row `FOR SHARE` in a short transaction, from the active-key check until the signature exists, with no IO in between. A revoke, retirement or re-wrap therefore commits either before the check (which then refuses) or after the signature.

**Where the KEK lives (for separate backup custody).**
- **Host file (production on `prod`):** `/srv/saas/infra/stacks/insignia/secrets/signing-wrap-keys.json` (root writes it; before deploy AC `~/.local/share/insignia/runtime/signer-secrets/signing-wrap-keys.production.json`, kept until the cleanup pass).
  - It is a regular file, owner uid 10101 (the signer), mode 0400, at most 4096 bytes.
  - The host login (uid 1000) and web cannot read it, so reading it needs root or docker.
  - The stack's `compose.yaml` binds that path directly (the historical overlay used `INSIGNIA_SIGNING_WRAP_KEY_FILE`).
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
- Migration 64's trigger enforces the envelope split: a role that cannot SELECT `private_envelope` (web) may only clear the envelope and `wrapping_key_id`, and only in the statement that retires, revokes or destroys the key. It cannot overwrite the active key's envelope to stop signing silently. Web can still stop signing by revoking or retiring the active key (it keeps `UPDATE(state)`), but that change is visible and recorded, with a command key for a revoke; the guard closes only the silent form, where the key still looks active.
- The worker reaches signing keys only through `destroy_expired_signing_keys`, and cannot read envelopes.
- **Apply as the schema owner:**
  1. [signing-key-runtime-grants.sql](signing-key-runtime-grants.sql) (earlier delta);
  2. [signer-runtime-grants.sql](signer-runtime-grants.sql), before the signer starts;
  3. [web-signing-envelope-revoke.sql](web-signing-envelope-revoke.sql), after web runs the signer-client image.

**Re-wrap (KEK rotation).**
1. As root, write the new key into the file as `currentKeyId`, keep the old key in `keys`, and keep owner 10101 and mode 0400.
2. Recreate the signer.
3. Run `docker compose --project-directory /srv/saas/infra/stacks/insignia run --rm --no-deps signer /usr/local/bin/node /srv/insignia/worker/dist/signer-main.js --rewrap`. It re-seals every pending or active envelope under the current key and prints `signer_rewrap` counts. Retired keys have no envelope and are skipped.
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
- **Abandoning a pending key:** it cannot be deleted, only revoked (an emergency plan listing it, with `bumpEpoch: false`). The next rotation (with another key id) accepts a revoked key that was never published and publishes it as revoked.

**Emergency (suspected leak): one owner run.** The emergency plan revokes the named keys, optionally bumps the authorization epoch, and publishes the resulting stricter config by compare-and-set with an exact readback (`signing-emergency.ts`, #375).
1. Write the plan file and arm the [signing-owner overlay](signing-owner-compose.yaml) with it and a new empty run root:
   ```json
   {"version":"m5-signing-emergency-plan-v1",
    "plan":{"revokeKeyIds":[1,2],"bumpEpoch":true,"allowNoActiveKey":true,"reason":"suspected leak <date>"},
    "binding":{ ... the current binding, authorizationEpoch before the bump ... }}
   ```
   - List every leaked key, including any pending key of a stopped rotation.
   - `allowNoActiveKey: true` is required when the plan revokes the active key. Issuance then stops: Add to cart fails until the rotation in step 3. That is the intended emergency result. Without it, a plan that would leave no active key stops before any write.
2. Start the action from the embedded admin's signing page, as for a rotation. `PROVISIONED` means the run published and read back the stricter config. The run:
   1. reads the published config and checks that it differs from the stored one only by tightening. A pending key that the plan does not revoke and that is not published yet stops the run, because publishing would make it verifiable;
   2. bumps the epoch (if planned);
   3. revokes the listed keys;
   4. repeats the owner rotation's pre-check with no pending key;
   5. publishes by compare-and-set and reads back.

   Each step is reserved and settled in the run root. `emergency-precheck.json`, `emergency-publication.json` and `emergency-readback.json` record the replaced published digest and compare digest, the tolerated differences, the new digest, epoch and remaining active key, and the readback digest.
3. Disarm. If issuance should continue, rotate to a fresh key at once (above). The rotation's binding must carry the bumped `authorizationEpoch`.

**Publish-only.** Use the same plan with `revokeKeyIds: []` and `bumpEpoch: false` when the stored config is already stricter than the published one, for example a revocation that was saved but never published. It changes no key or epoch. The same pre-check gates it, and it publishes by compare-and-set and reads back. If the published config already equals the stored one, it only reads back.

**Interrupted or uncertain run.** Re-arm the same plan file with a new empty run root and start again. Every database step is idempotent for the plan:
- the epoch command is keyed by the plan digest (which includes the binding epoch), so a re-run returns the epoch this plan produced and never bumps twice;
- an already revoked key is skipped.

`UNCERTAIN` means only the publication's acknowledgement was lost; the re-run reads it back. A plan bound to an epoch another command has since bumped stops before any write.

**Boundaries.**
- The run never creates or activates a key, and needs no private key material. The signer and the KEK are not involved.
- It needs no Function release observation, because it only tightens what the Functions already verify.
- Product publication never starts it. While an emergency plan is armed, publication preparation waits until the run has completed.
- A concurrent writer is serialized by compare-and-set. A rotation that started before the bump stops at its next scope check or stale compare-and-set, and an emergency started during a rotation stops at its pre-check unless it revokes that rotation's pending key.
- The embedded signing page latches read-only in a browser after a start. For the next run (a resume, or the rotation that follows), use another browser profile or clear that page's site data. The server's run root, not the browser, enforces one run per plan.

**Why it still needs a staff session.** Every Shopify Admin write in the web app uses the staff's online grant; the publication needs one. An operator-only command would need two things that do not exist today:
- **A new owner write authority.** The command would publish with the stored offline token, which exists only with buyer mode on and serves only the buyer path today. No owner write uses it.
- **A new executable in the web image.** The image has one Astro server entry, and only web's database role (`insignia_runtime`) may revoke keys and bump the epoch. The worker and signer roles cannot.

Both are owner decisions; until then the staff-session route stays.

Bumping the epoch without revoking the leaked key is not enough: the following rotation only retires it (window to today + 3), so lines minted with it at the new epoch would verify for days.

**Blast radius.**

| Leak | What the attacker gets |
| --- | --- |
| Database or checkpoint only | Ciphertext of pending/active keys only; no seed. |
| KEK file only | Nothing without the envelopes. |
| Worker compromise | No KEK and no envelope access; no seed. |
| Web or host-login (uid 1000) compromise | No KEK and no envelope access. It can request signatures for real v3 headers of the active key, within the signer's rate limits and audit, for as long as it is compromised. Respond as under **Emergency**: one emergency run revokes the active (and any pending) key and bumps the epoch, then rotate. |
| Signer compromise | KEK plus envelopes, so the active (and any pending) seed. Retired keys have no envelope. Run the emergency plan for the active and any pending key with an epoch bump; install a new KEK (re-wrap steps 1–2; revoked keys have nothing to re-wrap); then rotate the key. |

An HSM- or KMS-held KEK remains a recommendation for a later change.

## Image custody (GHCR)

CI artifacts expire after three days, so rollback images are also kept in private GitHub Container Registry packages (owner decision D6). After every successful runtime qualification run on a push to `main`, the [Release image custody](../../.github/workflows/images.yml) workflow (`workflow_run`) copies that run's qualified archives, without rebuilding, to:

| Package | Archive (artifact) |
| --- | --- |
| `ghcr.io/optidigi/insignia-web:<commit>` | `web-image.tar` (`m5-web-image-…`) |
| `ghcr.io/optidigi/insignia-worker:<commit>` | `worker-image.tar` (`m5-024-worker-image-…`); the signer runs from a worker image |
| `ghcr.io/optidigi/insignia-verifier:<commit>` | `verifier-image.tar` (`release-verifier-…`) |
| `ghcr.io/optidigi/insignia-heartbeat:<commit>` | `heartbeat-image.tar` (`operations-runtime-…`) |

`<commit>` is the full `main` commit SHA. `skopeo copy --preserve-digests` pushes each OCI archive as is, and the job fails unless the registry's manifest digest equals the archive's single manifest digest, which is the `manifestId` that `qualify.mjs` records and the image ID Docker shows after loading the archive. The job summary lists each pushed digest. Only this workflow has `packages: write` (plus `actions: read` to fetch the run's artifacts); the qualification workflows are unchanged. A status-only run builds no images, and the workflow then pushes nothing. The artwork inspector is a host package, not an image, and stays a CI artifact only.

**Rollback from GHCR.** On the host, with a GitHub token that has only `read:packages` (kept outside the checkout, not in a compose file):

```sh
docker login ghcr.io -u <github-user> --password-stdin < <read-only-token-file>
docker pull ghcr.io/optidigi/insignia-web:<commit>
docker image inspect --format '{{.Id}}' ghcr.io/optidigi/insignia-web:<commit>   # must equal the recorded manifest ID
docker logout ghcr.io
```

Then deploy that image ID through the usual qualified path, exactly as with a loaded CI archive. Images built before this job existed are only in their deploy folders on the host.

**Local tags on the host (since deploy AC).** The stack names images by local tag, `insignia/<service>:<commit>` (`insignia/web`, `insignia/worker`, `insignia/signer`, `insignia/verifier`, `insignia/heartbeat`; `<commit>` is the 8-hex source commit), with `pull_policy: never`. A deploy tags the qualified image ID (`docker tag <image id> insignia/<service>:<commit>`) before editing the stack's `compose.yaml`. Tags are mutable, so deploy readback compares each running container's image ID with the recorded qualified ID; the database image stays pinned by digest.

**Owner, once:** in GitHub → Optidigi → Packages, confirm the four `insignia-*` packages are **private** (organisation packages are private by default) and linked to this repository.

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

## EUR admission

The selected integration supports USD shops and EUR shops, each using its own shop currency. EUR stays disabled unless the `INSIGNIA_EUR_NL_QUALIFICATION` web env variable (in the stack's `compose.yaml`; the name is historical) holds a qualification profile. Supplying a profile is a private deployment operation after an actual native qualification of the release; its presence alone is not proof.

**Release-level profile `eur-qualification-v2` (preferred; owner decision D4, 16 Nov 2026).** Qualify the exact release once on a real EUR store (Designer, quote, cart, Functions, test checkout), then EUR is sold by **any** shop whose shop currency is EUR, to buyers whose country is in `countries` and in the shop's own primary Market. No per-merchant step. Exact keys:

```json
{"version":"eur-qualification-v2","activeVersionRef":"<Active app version id>","functionsSourceCommit":"<40-hex Function source commit>","countries":["AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT","NL","PT","SK","SI","ES"],"qualifiedAt":"<UTC, e.g. 2026-11-16T22:00:00Z>","evidenceRef":"<reviewed evidence id>"}
```

`countries` is explicit, non-empty, two-letter uppercase ISO codes without duplicates (the euro area is the default list). `activeVersionRef` and `functionsSourceCommit` must equal the running release profile: after any app/theme release or Function change, write a new profile from a new qualification, or every EUR quote fails closed as an outage (not a buyer refusal). A buyer outside `countries`, a buyer outside the shop's primary Market, or a non-EUR shop gets `UNSUPPORTED_MARKET`.

**Legacy profile `eur-nl-qualification-v1`.** Still accepted unchanged: one shop (`shopId`, `shopifyShopGid`, installation and authorization generation/epoch, `primaryMarketGid`), Netherlands buyers only. Production used it for the review store `insignia-review-eu` on 16 Nov 2026 while the release was being qualified; replace it with v2.

Either way, admission still independently reads current primary-Market membership and shop currency, checks tenant authority before and after the provider read and the read's freshness, and keeps the normal quote, signature, Function/release and contextual-price checks. EUR must equal the shop currency. Same-shop multi-currency, FX, GBP and other currencies are out of scope.

The protected VAT installation (`stitchs-vat-verification-20261004`) stays `UNRESOLVED_NO_RETRY` and is never an EUR test resource.

## Past transitions

Each section below records one past transition: what it changed and the operator steps it needed then. They are history, not current instructions; [Current state](#current-state) and [Deploy next](#deploy-next) are current. Newest first.

### Designer candidate development transition

Standing owner grant, 13 November 2026, and the owner's go of 15 November 2026 for the QA issue batch (deploy K): ship the Designer changes merged up to main `d2002a28` (#509: #499, #501, #502, #503) to rewrite-dev as one theme-only app version. `native-designer-d2002a28` binds version `1222232834049` in [native-designer-release-binding.json](native-designer-release-binding.json) (41 versions) and the 14-module [baseline](native-designer-module-baseline.json) (canonical hash `6bade0652e0ebbca8099e71adc1a5874b8277245a0419c8707b05937d63f67cc`). It was created once at `2026-11-15T15:02:25Z` (CLI 4.9.4) from the frozen `native-merchant-batch-a03b41ba` staging with only `extensions/insignia-theme/assets` replaced by the foundation build of `d2002a28` (run 43726377630). Blocks, snippets, locales, every non-theme module and both Function modules are unchanged. Released `15:40:23Z` after Phase B (verifier, web, worker on binding-head `413fe864` images with the new profile; no migration, grant or other environment change).

### Merchant-batch candidate development transition

Standing owner grant, 13 November 2026 (deploy B of the merchant-issue batch): ship the Designer and storefront changes merged up to main `a03b41ba` (#430/#424 Designer fixes and the autosave 429 pause, #459/#445 pixel-limit reason copy) to rewrite-dev as one theme-only app version. The server side of `a03b41ba` (#455–#463) was deployed under `native-a11y-quantity-9b5dbdee` before the candidate was created, with the host inspector switched to the `a03b41ba` package (tree `782f474c`, #445 pixel-limit reason). No migration (schema 64, ACL digests unchanged).

`native-merchant-batch-a03b41ba` binds inactive version `1211378860033` in [native-merchant-batch-release-binding.json](native-merchant-batch-release-binding.json) (40 versions) and the 14-module [baseline](native-merchant-batch-module-baseline.json) (canonical hash `a3809ff58bcec22361d845c75fb7769f09f0b0f84ebfb1d7f67dad8f6eda72cd`).
- It was created once at `2026-11-14T08:07:28Z` (CLI 4.9.4) from the frozen `native-a11y-quantity-9b5dbdee` staging. Only `extensions/insignia-theme/assets` changed: its 15 files are the foundation build of `a03b41ba` (run 43572894686, attempt 1), byte-identical to a local build of the same tree; eight files differ from the Active version (six renamed chunks, `insignia-designer-frame.js` and `insignia-element.js`).
- Blocks, snippets, locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `a03b41ba` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608); the Function source still is `aa3b6166`.
- `1207622696961` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release: set `INSIGNIA_RELEASE_PROFILE=native-merchant-batch-a03b41ba` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-a11y-quantity-9b5dbdee` fail closed (inventory 40) until this step and the release complete. No migration, grant or other environment change.

### Signing envelope writer guard and signer revoke lock

Closes two signer review items: web could overwrite the active key's envelope (denial of service, no forgery), and a revoke could commit between the signer's key check and its signature.
1. Apply `20261113000200_signing_key_envelope_writer.sql` through the schema owner (schema 63 to 64). It adds the trigger `signing_keys_envelope_writer` and its invoker function `enforce_signing_key_envelope_writer()`, with EXECUTE revoked from PUBLIC. Running web, worker and signer images already write envelopes only as it allows, so it can go before any image. No grant changes: the column, relation, membership and schema ACL digests stay unchanged. The function ACL digest changes by exactly the new function's row; record the new value.
2. Recreate only the `signer` service from a worker image that contains this change. Web and worker need no new image for it. The previous signer image works on schema 64, so rollback is image-only.
3. Read back: a Designer Add to cart still signs (`signer_sign` `ok`), and no `key_unavailable` lines appear for the active key.

### A11y-quantity candidate development transition

Standing owner grant, 13 November 2026 (pre-public fix batch): ship the Designer and storefront changes merged up to main `9b5dbdee` (#419/#416 quantity field, #420/#412/#413 focus on open and Tab wrap, #421/#414/#415 accessible names, #423/#417 artwork fallback label) to rewrite-dev as one theme-only app version. The server side of `9b5dbdee` was deployed under `native-session-drafts-c78a8179` before the candidate was created, with migration 63 ([Batched erasure](#batched-erasure-of-a-shops-buyer-sessions-406)) applied first (schema 63, ACL digests unchanged) and web's `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` reduced to `appKey`.

`native-a11y-quantity-9b5dbdee` binds inactive version `1207622696961` in [native-a11y-quantity-release-binding.json](native-a11y-quantity-release-binding.json) (39 versions) and the 14-module [baseline](native-a11y-quantity-module-baseline.json) (canonical hash `43ee5457162e96740d3a2e2553b18388dc0e23e1fd16c3c34371267c4e10b6b9`).
- It was created once at `2026-11-13T19:05:02Z` (CLI 4.9.4) from the frozen `native-session-drafts-c78a8179` staging. Only `extensions/insignia-theme/assets` changed: its 15 files are the foundation build of `9b5dbdee` (run 43486269787, attempt 1), byte-identical to a local build of the same tree; six files differ from the Active version (three renamed chunks).
- Blocks, snippets, locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `9b5dbdee` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608); the Function source still is `aa3b6166`.
- `1206211837953` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release: set `INSIGNIA_RELEASE_PROFILE=native-a11y-quantity-9b5dbdee` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-session-drafts-c78a8179` fail closed (inventory 39) until this step and the release complete. No migration, grant or other environment change.

### Session-drafts candidate development transition

Owner approval, 12 November 2026 (deploy 3): ship the storefront and Designer changes merged up to main `c78a8179` (#395, #397/#403, #399, #401, #405, #407) and the German theme locale (#391, *Sie*) to rewrite-dev as one theme-only app version. The server side of `c78a8179` was deployed under `native-repair-messages-bf512171` before the candidate was created, with migrations 60 and 62 before it and 61 after it (schema 62; see [Drop the legacy visitor count](#drop-the-legacy-visitor-count-374) and [Larger buyer session quotas](#larger-buyer-session-quotas-371) below).

`native-session-drafts-c78a8179` binds inactive version `1206211837953` in [native-session-drafts-release-binding.json](native-session-drafts-release-binding.json) (38 versions) and the 14-module [baseline](native-session-drafts-module-baseline.json) (canonical hash `dc980bc16e722a846d63ded7e3443cb88dba9527d7cf3d30022385f6af598179`).
- It was created once at `2026-11-13T01:06:36Z` (CLI 4.9.4) from the frozen `native-repair-messages-bf512171` staging. Two things changed: the 15 files in `extensions/insignia-theme/assets` (the foundation build of `c78a8179`, run 43340293913, attempt 1, byte-identical to a local build of the same tree) and `locales/de.json` (from that source). The module baseline records the new German locale value.
- Blocks, snippets, the other five locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `c78a8179` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608); the Function source still is `aa3b6166`.
- `1205994881025` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release: set `INSIGNIA_RELEASE_PROFILE=native-session-drafts-c78a8179` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-repair-messages-bf512171` fail closed (inventory 38) until this step and the release complete. No migration, grant or other environment change.

### Repair-messages candidate development transition

Owner approval, 12 November 2026 (deploy 2): ship the storefront and Designer changes merged up to main `bf512171` (#378, #380, #387, #389) to rewrite-dev as one theme-only app version. The server side of `bf512171` (#377 verifier reuse rule and release diagnostics, #384 listen-failure exit, #385/#388 fences; no migration) was deployed under `native-buyer-fixes-fb436e16` before the candidate was created.

`native-repair-messages-bf512171` binds inactive version `1205994881025` in [native-repair-messages-release-binding.json](native-repair-messages-release-binding.json) (37 versions) and the 14-module [baseline](native-repair-messages-module-baseline.json) (canonical hash `eb500b6c214f220d99e63ba6eb41bc97054bf1d94d296226356672bda2892ef2`).
- It was created once at `2026-11-12T20:40:22Z` (CLI 4.9.4) from the frozen `native-buyer-fixes-fb436e16` staging. Only `extensions/insignia-theme/assets` changed: its 15 files are the foundation build of `bf512171` (run 43297757028, attempt 2), byte-identical to a local build of the same tree. The frame host and the Designer frame (#387) therefore ship from one build.
- Blocks, snippets, locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `bf512171` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608); the Function source still is `aa3b6166`.
- `1205760688129` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release: set `INSIGNIA_RELEASE_PROFILE=native-repair-messages-bf512171` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-buyer-fixes-fb436e16` fail closed (inventory 37) until this step and the release complete. No migration, grant or other environment change.

### Buyer-fixes candidate development transition

Owner approval, 12 November 2026: ship the storefront and Designer changes merged up to main `fb436e16` (#352–#365, #372, #373) to rewrite-dev as one theme-only app version.

`native-buyer-fixes-fb436e16` binds inactive version `1205760688129` in [native-buyer-fixes-release-binding.json](native-buyer-fixes-release-binding.json) (36 versions) and the 14-module [baseline](native-buyer-fixes-module-baseline.json) (canonical hash `83f73e0202c709902476dae6947257c981a6cadb41cfb5b82b0155144d616a81`).
- It was created once at `2026-11-12T17:15:23Z` (CLI 4.9.4, Node 24.21.0) from the frozen `native-canonical-host-aa3b6166` staging. Only `extensions/insignia-theme/assets` changed: its 15 files are the foundation build of `fb436e16` (run 43264310795, attempt 1), byte-identical to a local build of the same tree. The new chunk `insignia-buyer-session-*.js` raises the asset count from 14 to 15.
- Blocks, snippets, locales, every non-theme module and both Function modules are unchanged, including module ids, wasm and input queries. The foundation wasm of `fb436e16` equals the Active pins (transform `5c8708b5…`/183604, validation `6c362b36…`/181608), and the Function source still is `aa3b6166`.
- `1203782746113` stays the sole Active version until the release; all NEVER_RELEASE versions are inactive.

Phase B operator changes, made together with the single release:
1. Set `INSIGNIA_RELEASE_PROFILE=native-buyer-fixes-fb436e16` in web and worker, and the same profile with the matching manifest in the verifier, using binding-head images. Creating the candidate makes `native-canonical-host-aa3b6166` fail closed (inventory 36), so quotes fail until this step and the release complete.
2. No migration, grant or other environment change. Migration 59 and its web grant were applied with the `fb436e16` server deploy before the candidate was created.

### Larger buyer session quotas (#371)

Owner decision, 12 November 2026 (deploy 3):
1. Apply `20261112000600_buyer_session_quota_indexes.sql` through the schema owner (schema 61 to 62) before replacing web or worker. It only adds indexes on `session_id` to `design_drafts`, `quote_proposals` and `cart_applications`, so no grant changes and the ACL digests stay unchanged. Without the indexes, each draft, proposal or cart write counts its session's rows by scanning the whole table, and erasing an expired session scans each of them.
2. Replace web and worker with the images that contain #371. Web raises the per-session lifetime quotas (100 drafts, 1,000 proposals, 250 cart applications). Worker erases at most ten expired sessions per statement and keeps the 100-session pass. Previous images run unchanged on schema 62, so rollback is image-only. Do not roll back worker alone while sessions above the old quotas exist: its single 100-session statement can outlast the 10 s statement timeout.

### Batched erasure of a shop's buyer sessions (#406)

1. Apply `20261113000100_batched_buyer_session_erasure.sql` through the schema owner (schema 62 to 63). It replaces only the bodies of `stage_shop_privacy_inbox` and `recover_uninstall_privacy`; signatures, owners and grants are unchanged, so the ACL digests stay unchanged. Neither function deletes buyer sessions any more, because a full session cascades to some 1,600 rows and a shop's sessions in one statement outlast the worker's 10 s statement timeout. Each still records the `shop_privacy_fences` row, so the generation cannot take private data again. The worker's existing `cleanup_buyer_payloads` pass removes the sessions ten per statement (it already removes sessions of every deactivated or superseded generation).
2. No image change. Apply it before or after the worker; a worker that predates it only runs the unchanged cleanup. Rolling the migration back restores the single-statement deletion.

### Drop the legacy visitor count (#374)

Owner decision, 12 November 2026: no rollback to a web image from before #348 (deploy 3). Web images up to `bf512171` still write `buyer_visitor_admission.issued`; the new image writes only `window_at` and `issued_at`. Apply the two migrations one at a time, not as one `dbmate up`:
1. Apply only `20261112000400_buyer_visitor_issued_optional.sql` through the schema owner (schema 59 to 60). It drops `NOT NULL` from `issued`. The running `bf512171` image keeps working, because it still writes the column.
2. Replace web with the image that contains #374. It works on schema 60 and 61. Rollback to `bf512171` is still possible until step 3.
3. Once no web instance runs `bf512171` or older, apply `20261112000500_buyer_visitor_drop_issued.sql` (schema 60 to 61). It drops `issued` with its check. Dropping the column also removes the web role's `UPDATE(issued)`, so no grant or revoke statement runs. [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql) now reads `UPDATE(window_at,issued_at)`; re-running that line is a no-op.
4. Record the new expected column-ACL digest: only `issued` leaves; relation, function, membership and schema digests stay unchanged. From here, `bf512171` and older web images can no longer start sessions for a visitor with a trusted address, so they are not rollback targets.

If both migrations are applied before web is replaced, the old image fails every per-visitor session until the new image runs.

### Sliding per-visitor window (#348)

Owner decision, 12 November 2026 (deploy 1), deployed with the web image that contains it:
1. Apply migration `20261112000300_buyer_visitor_sliding_window.sql` through the schema owner (schema 58 to 59). It adds `issued_at`, backfills open windows so their sessions keep counting until the fixed window would have ended, and relaxes the `issued` bound.
2. Apply the changed web grant from [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql): `UPDATE(window_at,issued,issued_at)` on `public.buyer_visitor_admission`. Both steps come before the new web image, which writes `issued_at`.
3. Replace web. The previous image still works on the migrated table (it writes only the old columns and counts at most 20), so rollback is web-only.

### Canonical-host candidate development transition

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

### Per-visitor session limit (11 November 2026)

Owner decision B, 11 November 2026, deployed after the canonical-host release:
1. Apply migration `20261111000100_buyer_visitor_address_limit.sql` through the schema owner, so schema goes from 53 to 54.
2. Apply only the new web grants from [web-runtime-grants.sql](../m8-journey/web-runtime-grants.sql): `SELECT, INSERT, DELETE` and `UPDATE(window_at,issued)` on `public.buyer_visitor_admission`.
3. Replace web only, and remove `INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC`. The previous web image ignores the new table, so rollback is web-only.

### Cart-line v3 candidate development transition

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

### Functions renew candidate development transition

`native-functions-renew-8fffc9de` binds inactive version 1202733449217, the complete 33-version inventory in [native-functions-renew-release-binding.json](native-functions-renew-release-binding.json) and the exact 14-module [baseline](native-functions-renew-module-baseline.json). Canonical hash is `6bbac54719093f8ab867fe199e70bddf5b7e40f4b6404c046d4deb74b573cb9a`. Source is merge 8fffc9de/tree 00b71102: PR293 (a stale quote with no marked line checks out as a plain cart; one checkout message localized by `localization.language`) and PR294 (cart renewal and context notice). All 23 theme files, including 14 assets, match foundation run 42887198952/attempt 1. Prior 1202503778305 remains sole Active; all NEVER_RELEASE versions remain inactive.

**This transition changes Function bytes and behavior.** The owner authorized that change on 10 November 2026. Both Function modules keep their registration UUIDs and handles but carry new wasm, built from 8fffc9de with `node scripts/functions/build-wasm.mts {transform,validation}` (Rust 1.98.1, trampoline 2.0.1). The Function source is identical at PR293 merge c19069bc.

| Function | wasm SHA256 (bytes) | input query SHA256 | Shopify module id |
| --- | --- | --- | --- |
| transform | `f5979b61ba46c9ca315324500b1bedf806949ebf8fb8979494e0bdaf68e392f6` (181233) | `8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053` (unchanged) | `cf3f4c5b-6e51-4140-a542-35aa352a7c9c` |
| validation | `4a3e7495245e8716b976ff3c3816c4e144114883edd317afc38fdf84b369f9ec` (183624) | `5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4` (was `a0cd5d72…`) | `4416125b-6b7d-40b2-a283-5090c0fe2540` |

Shopify exposes no wasm hash. It reports `module_wasm_size_bytes` and a new `module_id`, and both match this build. The CI foundation wasm of that source differs from these bytes because it embeds `/home/runner/.cargo` registry paths. It is not the release artifact. Later source remaps `$CARGO_HOME` to `/cargo` in `build-wasm.mts` and rejects Wasm that still embeds the workspace, `CARGO_HOME` or home path, so CI and local builds are byte-identical. The same Function source then builds to different bytes (transform `6e1429d8a42322783e9941ff70c37f973c386cac635fcb59b902cc7e2e4953d3`/181041, validation `208351f9be0070677e2e66a4d7165be2e464c59247102c3c30bd907d0ff7a98b`/183432). The next Function release carries new hashes; existing release profiles keep their recorded pins. Each release profile now names its own Function source and artifacts (`scripts/release/profiles.mts`); every earlier profile keeps the original 9b94149 pins.

At activation (Phase B) the operator must also change the private web `runtime.env` value `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` (required by images of this source; later source no longer reads the query fields, see [Expected Function configuration](#expected-function-configuration)): set `validationInputQuerySha256` to `5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4`. Keep `transformInputQuerySha256` at `8d93a086…`, and keep `appKey` and `observationVersion: 2`. That JSON contains no wasm hashes. Set `INSIGNIA_RELEASE_PROFILE=native-functions-renew-8fffc9de` in web, worker and verifier together. If an `eur-nl-qualification-v1` profile is configured, its `activeVersionRef`/`functionsSourceCommit` no longer match and EUR stays fail-closed; EUR is not currently enabled. Use matching binding-head images and verifier manifest, release once, then obtain fresh independent admission. This binding is not activation or native acceptance.

### Cart repair candidate development transition

`native-cart-repair-eb386d22` binds inactive version 1202503778305, the complete 32-version inventory in [native-cart-repair-release-binding.json](native-cart-repair-release-binding.json) and the exact 14-module [baseline](native-cart-repair-module-baseline.json). Canonical hash is `b90b62c0ebd602c4b20141379feaa9d3c6d33e615103e991da5d04bd13817064`. All 22 theme files, including 13 assets, match foundation run 42852820780/attempt1 and merge eb386d22/tree c2989b3f (PR289 artwork policy, PR290 cart repair/notice/stale-quote cleanup). The foundation build adds one storefront chunk, so the asset count grows from 12 to 13. All 14 identities, 13 non-theme configurations and original 9b941 Function bytes remain unchanged. Prior 1201385144321 remains sole Active; all NEVER_RELEASE versions remain inactive.

Use matching final binding-head images and verifier manifest. Preserve schema 52/key 2/grants/current protected facts and private mounts/configuration; checkpoint and restore-verify before exclusive consumer replacement. Reconcile the single release, then obtain fresh independent admission. This binding is not activation or native acceptance. Expanded inventory intentionally makes `native-canonical-313b12ad` fail closed until the coherent transition completes; keep historical profiles/freshness unchanged.

### Canonical combined UI development transition

`native-canonical-313b12ad` binds inactive version 1201385144321, the complete 31-version inventory and exact 14-module baseline. All 21 theme files/12 assets match frozen canonical foundation run 42725808639 and merge 313b12ad. All 14 identities, 13 non-theme configurations and original 9b941 Function bytes remain unchanged. Prior 1201192632321 remains sole Active; all NEVER_RELEASE versions remain inactive.

Use matching final binding-head images and verifier manifest. Preserve schema 52/key 2/grants/current protected facts and private mounts/configuration; checkpoint and restore-verify before exclusive consumer replacement. Reconcile the single release, then obtain fresh independent admission. This binding is not activation or native acceptance. Keep historical profiles/freshness unchanged; use compatible fix-forward rather than stale database restoration.

### Review navigation candidate development transition

`native-review-nav-8a7ee446` binds inactive version1201192632321 and the complete30-version inventory in [native-review-nav-release-binding.json](native-review-nav-release-binding.json), with the exact 14-module [baseline](native-review-nav-module-baseline.json). Canonical hash is `0b8452cc5cfbe750f9bb871f03ae6a2474daaec3a30c5158cee4d0dd37e29dab`. All21 theme files and12 assets match foundation42694038939/attempt1, synthetic105dfcf9 and PR276 merge8a7ee446/tree740b2a1a4bc43d310a4e05493816745495a3b7e7. All 14 identities, 13 non-theme configurations and original 9b941 Function binaries match the loading baseline. Version1201128341505 remains sole Active; all three NEVER_RELEASE versions remain inactive. Creation and this binding supply no activation, latency, fresh independent admission or native acceptance proof.

The next qualified transition must preserve schema52, key2, current protected facts, exclusive verifier ownership, passive authority and compatible recovery custody. Every consumer still requires its own fresh admission evidence; grants, TTL and tenant guards remain unchanged.

### Loading/handoff candidate development transition

`native-loading-defd05b0` binds inactive version1201128341505, the complete29-version inventory and exact 14-module baseline in [native-loading-release-binding.json](native-loading-release-binding.json) and [native-loading-module-baseline.json](native-loading-module-baseline.json). All21 theme files, including12 assets, match frozen foundation42684743827/attempt1 and PR274 merged source defd05b0/tree df7b967e. All14 native identities,13 non-theme configurations and original 9b941 Function binaries remain unchanged. Prior version1200729554945 remains sole Active; all three NEVER_RELEASE versions remain inactive. This binding alone is not activation, fresh independent admission or native acceptance.

Qualify matching final binding-head immutable web/worker/verifier artifacts before any coordinated transition. Preserve schema52, existing grants, signing key2, protected purchase/financial facts, tenant fences and pending/ambiguous operations. Replace the verifier exclusively with its private custody and actual consumer bindings preserved; use compatible schema52 recovery/fix-forward. Inventory expansion intentionally makes the existing live prior closed profile fail closed. Preserve all historical profiles and exact inventory/freshness/independent admission checks; no runtime-v2 protocol change or Function configuration drift exception is introduced.

### Review/cart candidate development transition

`native-review-cart-1f4595f` binds inactive version1200729554945, the complete28-version inventory and exact 14-module baseline. All21 theme files, including12 assets, match qualified foundation42639352594/attempt1 and PR271 merge1f4595fa/tree148c93f0. The13 non-theme configurations, native module identities and original 9b941 Function binaries remain unchanged. Candidate creation is not activation, admission, native UI acceptance or measured latency improvement.

Use matching final binding-head web/worker/verifier artifacts, preserve schema52/grants, signing key2 and compatible recovery custody, and replace the verifier exclusively. Reconcile the single development release before obtaining fresh independent admission. Expanded inventory intentionally invalidates the prior closed profile; do not weaken inventory or freshness checks. Keep all NEVER_RELEASE versions inactive and owner signing mounts absent. Measure Review, acceptance and Ajax cart stages after deployment; no checkout/order/payment, consumed sender drill, VAT retry or production cutover is authorized by this transition.

### Startup candidate development transition

`native-startup-771bb8f` binds inactive version1200333160449, the complete27-version inventory and exact 14-module baseline. Its21 theme files (12 CI assets) are frozen from foundation42595259659/attempt1 and PR264 mergea58d8025/tree198bd77c. All13 non-theme configurations, original native registration identities and9b941 Function binaries remain unchanged. This is candidate custody, not activation, independent admission, signing completion or native acceptance.

Use matching final binding-head web/worker/verifier artifacts and the closed profile in all consumers, preserve schema52/grants and compatible recovery, and reconcile the single development release before fresh independent admission. Creating this inactive candidate expands inventory; the preceding closed profile now intentionally fails admission. Never widen inventory/freshness checks or restamp an old receipt. All NEVER_RELEASE versions remain inactive. The signing allocation stays unmounted and undispatched until its separately qualified first-party invocation; key1 dates remain unchanged and replacement development lastDay is trusted provisioning shop day+31.

### Recovery candidate development transition

`native-recovery-e2c3dc5` binds the independently observed inactive version1199953805313, all26 observed versions and the exact 14-module baseline. All13 non-theme configurations and original 9b941 Function identities/binaries remain unchanged. Its21 theme files, including12 CI assets, are frozen from foundation42548633865/attempt1 and merged sourcee2c3dc51/treec5ad8fed. The binding is not activation or admission evidence. Preserve historical profiles and every NEVER_RELEASE version.

Qualify final binding-head web/worker/verifier artifacts and verify their theme files remain byte-identical to the frozen candidate. Before Q1 activation, apply append migration52 and the narrowly scoped `declined_at` grant through the existing development schema/role owners. Drain every old eligible acceptance writer before exposing terminal outcomes; enumerate actual consumers rather than assuming web is the only writer. Recheck roles, immutable image/configuration, active mounts, protected facts, pending/ambiguous operations and fresh independent admission. Replace the verifier exclusively, preserving its private startup/authentication/state custody and rechecking actual consumer bindings.

Once a terminal decline marker exists, schema rollback refuses and schema51/old-writer images are unsafe rollback targets. Preserve command/accepted/purchase authority and use compatible schema52 recovery or fix-forward artifacts. Before any effect, retain compatible artifact/configuration custody and qualify the applicable recovery path. A database snapshot restore or down migration is never an automatic application rollback. Native wide/narrow UI, theme interactions, rapid dismissal and cart recovery still require actual observation after the single qualified development release. No extra checkout/order/payment, mail resend, protected VAT retry or production cutover follows from this transition.

### Selected storefront release profiles (7 November 2026 and earlier)

The `native-selected-fixed-81830c6` profile was recorded with1199166783489 inactive and then bound that Active version (Active until the next release), with the complete21-version inventory in [native-selected-fixed-release-binding.json](native-selected-fixed-release-binding.json) and [native-selected-fixed-module-baseline.json](native-selected-fixed-module-baseline.json) frozen in canonical handle order. Its20 theme files include11 exact CI241 assets, independently equal to final foundation42424127963/attempt1. Every original identity,13 non-theme configs, original 9b941 Function bytes and selected CSS remain unchanged. PR242 matching web/worker/verifier artifacts were promoted, the corrected version released once, and independent SDK readback plus fresh same-record web/worker admission and native customer/merchant checks passed. See [activation evidence](../../docs/delivery/evidence/technical-merchant-completion/native-selected-retirement-activation-2026-11-07.json). Earlier1199122513921 is inactive; bad1199165767681/native-selected-81830c6 remains inactive/**NEVER_RELEASE**. Never repeat this settled release or checkout#1005. Future admission obtains fresh evidence under the unchanged finite policy.

The historical `native-cart-fd9cc61` profile qualified1199122513921 Active before the cleanup transition and retains its original binding, exact19 versions in [native-cart-release-binding.json](native-cart-release-binding.json), and14 canonical modules in [native-cart-module-baseline.json](native-cart-module-baseline.json). All 21 theme files/12 assets match qualified CI239 and CI240; original 9b941 Function bytes and all13 non-theme configurations remain unchanged. PR240 matching web/worker/verifier artifacts were promoted at that historical transition. The candidate was released once and independently read Active; the old1198986199041 version is inactive. Both consumers admitted the same finite fresh record, and the live Designer passed first-load, inspected artwork, authoritative USD12.50 quote, automatic native cart navigation and owned-design restoration. See [activation evidence](../../docs/delivery/evidence/technical-merchant-completion/native-cart-activation-2026-11-07.json). Later admission still requires fresh evidence. Existing order#1005 verifies native purchased-title presentation; never repeat its consumed checkout allocation. PR241 retired the standalone element and other unused UI; PR242 deployed its new native-selected-fixed binding without mutating this historical profile.

The corrected `native-fixed-5c04fa8` profile was recorded with version1198986199041 inactive, subsequently qualified it Active, and is now historical after the native-cart release. It retains the exact eighteen-version inventory in [native-fixed-release-binding.json](native-fixed-release-binding.json), and fourteen modules in [native-fixed-module-baseline.json](native-fixed-module-baseline.json). Its20 theme files include11 assets frozen from foundation42394179634/attempt1 and the merged PR236 complete-element Liquid/locale sources, merge93a56c27/tree2789e5cf. All11 built theme assets are byte-identical to the preceding candidate; the renderer correction is in Liquid. All thirteen non-theme configs and fourteen identities remain unchanged; original Function binaries/source9b941 remain selected. Keep1198938357761 inactive/NEVER_RELEASE and preserve historical bindings. PR237 matching web/worker/verifier artifacts were promoted and the corrected version released once on7November; SDK Active readback and same-record web/worker admission are recorded in current state. Do not release it again to repeat qualification. Native rendering and subscription eligibility passed at that observation; the dedicated first-publication visibility hold then blocked buyer E2E. PR238 subsequently restored the original publication, and PR240 qualified the active cart handoff as recorded in current state. Obtain fresh correlated evidence for every later admission; historical receipts expire. No profile is widened to admit the restored Active version or conceal the transition.

The `native-theme-ced0143` profile binds inactive version1198938357761 and the exact seventeen-version inventory in [native-theme-release-binding.json](native-theme-release-binding.json), with fourteen modules in [native-theme-module-baseline.json](native-theme-module-baseline.json). Only the theme configuration differs from `selected-ui-aab4a4b`; its eleven built assets are frozen from foundation42387489858/attempt1, source merge5487aa9c/treee26d6100352690e9af5b8777566e113fac9e11bc. Blocks, snippets and six locale files come from that reviewed source. Preserve the original Function binaries and registration identities below: the current-tree CI Function builds are different bytes and are not selected for this theme-only transition. Historical profiles remain unchanged. Use matching final-head web/worker/verifier artifacts, a single reconciled release, and fresh independent admission/readback before claiming native deployment or E2E. Creating the inactive candidate expands the inventory, so the prior sixteen-version profile intentionally fails closed until the coordinated transition completes.

**Native incident disposition:** version1198938357761 was activated once on7November, exposed the app-snippet comment/start-tag defect, and was restored once to1197668466689. Treat1198938357761 as **NEVER_RELEASE**. Its immutable module/profile observations remain historical evidence, not a new deployment target. The source correction renders complete elements and requires a new qualified candidate and matching binding. The PR235 images and mismatch observation are retained as history. PR237 matching images and corrected Active version have superseded that transition. Do not widen or restamp an old profile to conceal this mismatch.

The closed `selected-ui-f48efa2` profile binds version `1196974997505` and the complete fifteen-version inventory in [selected-ui-release-binding.json](selected-ui-release-binding.json), plus the exact fourteen modules in [selected-ui-module-baseline.json](selected-ui-module-baseline.json). The binding was read while the candidate was inactive; it is not proof of activation. Historical profiles and receipts remain immutable. Adding an inactive version intentionally invalidates their exact inventory check until the coordinated transition completes.

Use qualified final-candidate web/worker/verifier artifacts containing this profile. Preserve the independent verifier's permanent authentication/startup/state custody; the app receives only its metadata socket. Select the same closed profile in the consumers and verifier, release the already-created candidate under the current development allocation, then independently re-read Active inventory, modules, installation/grants and Function ownership and obtain fresh correlated evidence. A short fail-closed transition is expected; never widen inventory checks or restamp prior evidence to conceal it. Reconcile a dispatched release before any retry.

The follow-up `selected-ui-aab4a4b` profile binds the inactive version1197668466689 and sixteen-version inventory in [selected-refresh-release-binding.json](selected-refresh-release-binding.json), with [selected-refresh-module-baseline.json](selected-refresh-module-baseline.json). Only theme asset config differs from the preceding selected UI profile. Its assets are frozen from foundation42219651610/attempt1; a rebuild after the web-only preview corrections produces identical theme bytes. Preserve the same original Function pins below. Apply the same coordinated immutable consumer/verifier promotion, single reconciled release and fresh independent admission procedure; staging is not activation evidence.

The staged theme assets come from foundation CI42140234608/attempt1. Preserve both Function modules, their registration identities and original source `9b94149272d1b62c34f44dda3bde209e80b4ae22`. The rebuilt transform SHA256 is `49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576` (181378 bytes); validation is `3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6` (182968 bytes). These match the existing immutable pins. Root/preproduction Shopify TOMLs are not the native deployment recipe. [Current state](../../docs/delivery/state.md) owns activation and native acceptance status.
