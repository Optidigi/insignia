# PR61 CI2 crash-control diagnosis and fixture correction

Local base66b1ab75dd1d2e31c8adf40a903df299f38822d4. Source stayed read-only until both R2 reviews completed and parent authorized the one-file correction. Only scripts/m5-024/crash-recovery.test.mjs was edited by this writer; no commit, push, production/native/provider access, external credentials or historical-cluster reopen. The owned new loopback55450 cluster was initialized under SCRAM in this0700 directory using existing extracted PG18 tools. Synthetic-only allocation/password files are0600.

## Real RED and causal accounting

The database-affecting CI subsequence was run in order: migrations twice plus database suite219/219; Shopify/application/observability tests; worker28/28; then exact serial crash/permissions invocation. All preceding steps passed. The final invocation reproduced1PASS/1FAIL in22.04sec: crash target-phase wait failed at unchanged line76 after10.3sec, permissions control passed. Log10 preserves actual RED. Build/style/inventory/network installation stages were not rerun as part of this diagnosis; existing compiled outputs were used and hashed, not claimed as a new whole-CI qualification.

recoverPendingUninstalls scans the shared application inbox and sends into the default shared queue. The local sequence enqueued7 older pending receipts before its target. With batchSize1 and observed2sec polling, the child completed5 older jobs during the10sec wait. The subsequent permissions worker completed remaining2 older jobs plus the abandoned crash target. Metadata accounting16 binds the actual last newly-enqueued test target and prior job timestamps. Initial exploratory accounting13 mistakenly selected the first recovery enqueue; that private receipt remains retained and is superseded by16, not presented as target evidence.

Draining the shared queue through the unchanged public permissions control made the unchanged crash test pass1/1 in16.11sec. Its captured actual child IPC reported all4 ready phases with no stderr records. This is a diagnostic differential, not a proposed shared-data cleanup fix.

Two NEW migrated case databases sharpened the causal loop:

- Empty case, original source:1/1PASS16.02sec, four actual child ready messages, zero captured child errors, zero SQL-lock wait snapshots.
- Contaminated case: six predecessor receipts/jobs admitted through real tenant/inbox/queue contracts, original source:1/1FAIL10.82sec at the same target wait. Actual child reports ready;21 half-second metadata snapshots show target stillcreated and5 predecessor jobscompleted; no captured child stderr/error or SQL-lock waits. Log19 retains RED. This bounds observations, not a global proof that runtime locks/errors can never occur.

Thus the failure is fixture backlog/control isolation, not a reproduced child-authentication/startup/SQL-lock failure. Private preloads wrap the real fork only to pipe/capture bounded stdout/stderr, IPC, exit events and metadata; they never alter source, fetch, queue policy, handlers, dispatch or processing outcome. Existing test-child provider transport remains explicitly denied.

## Smallest implemented fixture correction

The crash test now creates one random disposable application database, runs existing migrations with no schema dump, and installs the existing defaultpgboss schema/policy there. Its core, queue producer, maintenance instance and all real children receive that local connectionString. It waits for a live failure-path child to close before database disposal and drops only its owned fixture database after the existing resource shutdown. Migration failure also closes/drops its own allocation. No shared inbox/queue rows are cleared or refreshed, no production queue or test policy is introduced, and neither existing10sec target wait nor60sec test timeout is increased. All original lease-expiry, retry, processed-state/attempts, deactivation and singleton assertions remain.

Corrected source against the contaminated case:1/1PASS, with exact inherited inbox/queue metadata unchanged before/after and zero remaining fixture databases (22). Exact CI crash/permissions step on that case:2/2PASS23.52sec, zero failures/cancellations/skips (23). Targeted style, syntax and diff checks PASS. The public-source original crash child, queue permissions test, production runtime, queue policy and workflow remain byte-identical to66b.

Only these selected local controls qualify the correction. Parent owns integrated full regression, independent reviews and naturally applicable exact-head CI. Generic uninstall authority remains RED; no genuine uninstall/privacy fulfillment or M5/G7/native deployment claim follows these synthetic controls.

## Resource closure and provenance

Final owned-cluster scan found no m5024_crash fixture database or other client session. pg_ctl faststop exited0; status exited3, no server running (25/26). Case databases and failed-state snapshots remain synthetic evidence in the stopped new cluster; no previous closed run was restarted. All private files are0600. This run has no pending subprocess. Source/artifact hashes and observed versions are bound in correction-receipt-private.json. Original CI failure log remains untouched under the parent's owned checks directory.
