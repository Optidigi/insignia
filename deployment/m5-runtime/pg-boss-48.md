# pg-boss 12.40.0 upgrade and recovery

Issue [#670](https://github.com/Optidigi/insignia/issues/670) records the App Store approval gate.
The original issue named schema 47. The reviewed candidate takes the queue directly from schema 43
(pg-boss 12.35.1) to schema 48 (12.40.0). The application migration ledger is independent.
Web and worker require the exact queue schema for their image and start with `migrate: false`
and `createSchema: false`. Use paired images during the transition.

## Migration review

| Schema | Changes and cost |
| --- | --- |
| 44 | Adds an empty instance registry and additive queue, stats and job columns. The constant default and nullable additions avoid heap rewrites. DDL still takes exclusive relation locks, including the job and stats partitions. |
| 45 | Adds the nullable upsert flag and replaces the queue-creation function. The unique index scans the common job table. Old jobs have a null flag and contribute no entries. |
| 46 | Adds nullable retained-job counters, replaces the queue-creation function and builds four common-table indexes. The full created-time index covers every job. |
| 47 | Adds a nullable schedule timestamp. |
| 48 | Adds a nullable pause timestamp. Both Insignia queues must be unpaused. |

The owner command uses the SQL exported by the exact pinned pg-boss package. It builds all five
indexes inside the DDL transaction using ordinary index builds during downtime. The transaction
rolls back the version, DDL and indexes together on error. No runtime index builder is needed.
Allow disk and WAL headroom and time for table scans based on a representative restore rehearsal.
DDL has a 30-second lock timeout. Inspect unexpected blockers before retrying. The consumer grants
cover three new maintenance fields and pruning of stale instance rows. Runtime instance registration
is disabled. Queue pause authority stays with the owner.

## Owner window

1. Retain the exact schema-43 web and worker images, matching operations bundle, private settings and
   role definitions. Build and qualify the matched schema-48 artifacts from the candidate. Follow the
   [bounded deployment and recovery sequence](README.md#bounded-deployment-and-recovery-sequence).
2. Hold public ingress and stop web, worker and any other queue clients. Quiesce database writers
   for the rollback checkpoint, including the inspector or verifier if they can write during the hold.
   Let in-flight work settle before proceeding. Resolve any `active` jobs and ambiguous external effects
   with the existing recovery rules. Pending or retry jobs may stay queued. Record queue names, per-state
   counts, protected application facts, application migration ledger, owner and ACLs.
3. From the quiesced database, take an encrypted, database-only custom-format checkpoint. Keep its role
   definitions under existing separate custody. Restore to a fresh isolated PostgreSQL 18 database with
   matching roles, owners and ACLs, check the schema-43 ledger and pending jobs, and dry-run the next step
   on that restored database. Use a private credential source for the owner connection. With libpq configured
   for the explicitly verified source and isolated restore endpoints, the commands are:

   ```sh
   umask 077
   pg_dump --format=custom --file="$QUEUE_CHECKPOINT" --dbname="$SOURCE_SERVICE"
   pg_restore --list "$QUEUE_CHECKPOINT"
   pg_restore --exit-on-error --single-transaction --dbname="$ISOLATED_RESTORE_SERVICE" "$QUEUE_CHECKPOINT"
   ```

   Store the dump only on approved encrypted storage. Prepare an empty restore target and reproduce
   roles before `pg_restore`. Preserve ownership and ACLs. Keep the restored database offline and follow
   the existing erasure, expiry and authority requalification rules before any restored database can serve traffic.
4. From the built candidate checkout, execute the migration and existing grants as the schema owner.
   Set `DATABASE_URL` privately for Node and configure libpq to address the same verified database as the owner
   (for example with a private service definition). The CLI's default mode serves fresh installs and
   current-schema checks. The upgrade mode accepts only schema 43 and requires both existing queues to match policy.

   ```sh
   INSIGNIA_QUEUE_OWNER_INSTALL=explicit-reviewed-owner-operation \
     node scripts/database/install-queue.mts --upgrade-from-43
   psql --dbname="$OWNER_SERVICE" -X -v ON_ERROR_STOP=1 -f scripts/worker/queue-roles.sql
   ```

5. With ingress still held, verify `pgboss.version` has exactly one row at 48, both queues are unpaused
   on `job_common` and the count by queue/state matches the checkpoint before any consumer resumes.
   Confirm all five new indexes `job_common_i13` through `job_common_i17` are ready and valid in
   `pg_index`. Compare the application ledger and ACLs with the frozen baseline and expected column grants.
   Verify enqueue, consume, supervision and role denials on the isolated upgraded copy. After live
   pre-start checks pass, choose whether to resume writers or restore the checkpoint while it is
   still current. Start the matched artifacts with ingress held, verify readiness and observe pending
   jobs and any permitted webhook replay and refresh before reopening. A running worker may already
   have produced database writes or external effects before ingress opens.

## Recovery decisions

- If the migration errors before commit, reconnect and read the queue version and index catalog. With
  schema 43 and the recorded baseline intact, address the blocker before retrying or restart the
  schema-43 artifacts. If it is unclear whether commit succeeded, use readback to decide.
- If schema 48 committed and the grants or readiness check failed, keep the hold. Fix the grants or
  images forward and verify again. A schema-43 image rejects schema 48.
- Restoring a checkpoint is an owner decision. Before admitting any new writes or external effects,
  restore the verified schema-43 checkpoint to a separate empty PostgreSQL 18 database using the
  same restore procedure, verify schema, pending jobs and ACLs, complete restore requalification
  with the matching schema-43 tooling, then switch the paired old artifacts together. If writers
  have resumed or an external action could have happened, preserve the current data and reconcile
  those effects. An older checkpoint can lose newer business facts and replay settled work.
- Use the existing checkpoint custody and deletion window. No pg-boss down migration is part of this procedure.
