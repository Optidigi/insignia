# Restricted operational alerts (source candidate)

This candidate sends only `Insignia Alerts <insignia-alerts@optidigi.nl>` to
`admin@optidigi.nl`. No Worker, DNS, destination verification, credential, image,
container or message has been created by adding these files. Alert delivery and
application readiness remain **unqualified**. Production deployment, public-app
review and storefront visual review are outside this change.

Run local behavioral checks from the repository root:

```sh
node node_modules/typescript/bin/tsc -p deployment/alerts/tsconfig.json
node --test deployment/alerts/worker.test.mts
```

The strict compiler project covers the Worker and its tests. Node24 executes the
erasable test source; it does not replace the separate compiler check. Wrangler's
`main` points to `worker.mts` and produces the deployment JavaScript from typed
source. No handwritten JavaScript Worker entrypoint is maintained.

The Node tests exercise public HTTP, scheduled monitor transitions and producer
contracts with a transactional storage double and email-binding double. The owned
PostgreSQL18 recovery integration test also exercises actual aggregate SQL against
all current migrations, specific outstanding cleanup fixtures and a dedicated
column-only monitor role; payload reads and mutations reject under that role.
The packaging tests additionally execute the relocated collector with private
synthetic inputs, load the actual R2/pg module closure and execute the copied
backup helper to a deliberately rejected database boundary and copied replica
pruner to a deliberately rejected transport boundary without provider calls.
Set `M5_WORKER_PACKAGE_ENTRY` to the current portable worker entrypoint to run the
actual artifact case. Native Docker is unavailable locally; CI must build and
qualify the standalone operations image. These checks do not prove Cloudflare
transaction behavior, binding restrictions
or email delivery.

## Worker contract

`wrangler.toml` configures one SQLite-backed Durable Object and minute cron.
Authenticated `POST /v1/heartbeat` records evidence without sending mail;
`POST /v1/alerts` handles component incidents. Authenticated `GET /v1/status`
reports arming, latest aggregate observations, duplicate/cap counters and the latest acknowledged provider message reference. Successful explicit-alert responses and exact duplicates also return that opaque reference so an authenticated operator can query actual provider delivery; acknowledgement still does not establish inbox receipt. The latest reference expires after seven days. It always
reports readiness unqualified; a live heartbeat is not application acceptance.
The configured route must terminate HTTPS. There is no public tick endpoint.

Provision a dedicated random printable ASCII `RELAY_SECRET`, 32–128 characters,
privately in the Worker and the VPS credential file. Rotation is replacement on
both ends; transient mismatch intentionally rejects requests. No Cloudflare account
email token goes on the VPS. Authenticate before reading content. JSON bodies
are bounded to 4096 bytes; unknown fields, arbitrary text/URLs/mail fields and
noncanonical event types reject. Timestamps are integer Unix milliseconds within
five minutes of Worker time; clocks must be synchronized. Event and incident IDs
are opaque 1–128 ASCII letters/digits/underscore/hyphen, never customer identifiers.
Counts are integers from zero through one billion.

Heartbeat JSON has exactly `version:1`, `eventId`, `timestamp`, `signals`.
`signals` contains exactly `availability`, `backup`, `processing`, `deletion`, each
with `{status:"ok"|"problem"|"unknown",count:<integer>}`. Alerts have exactly
`version:1`, `eventId`, `timestamp`, `component` (one of those four),
`event:"problem"|"recovery"`, `severity` (`warning`/`critical` for problem,
`info` for recovery), `incidentId`, `count`. One active incident per component is
maintained; same-incident repetition is suppressed for six hours and recovery must
match it. Heartbeat aggregates are authoritative for the current component state;
configure their source accordingly rather than mix unrelated incident producers.
Unknown aggregate observations warn and never count as recovery.

Before the first heartbeat the watchdog is unarmed. At five minutes since the
last accepted source timestamp, cron claims one outage notice. It reminds at most
once per six hours and claims one recovery after heartbeat resumes. Heartbeat
ordering is monotonic; delayed evidence cannot move the clock backwards. Cron
also translates aggregate problems/unknowns and recoveries to notices. An explicit
alert may operate while the watchdog remains unarmed.

Transactions persist claims and incident/cap transitions **before** external send.
No email send occurs inside a retriable transaction. Submitted records retain the
provider message ID; this means submission, never inbox receipt. A thrown or
malformed send result becomes unknown. A crash can leave a durable claimed record;
replay exposes that as unknown and never resends. Reconcile provider activity
before deliberate intervention; later six-hour reminders have separate identities
and may duplicate an earlier ambiguous delivery. No undocumented provider error
is assumed to prove rejection/no effect.

Canonical payload hashes bind event IDs across both endpoints. Conflicting ID
reuse returns409, exact replay returns its prior result. Event identities, claims,
suppression and cap results persist seven days. Expiry is swept in bounded batches;
20,000 retained records is a hard admission limit, reserving space for monitor
notices. Healthy one-minute heartbeats fit seven days. Exhaustion returns429 and
remains an operational fault, never permission to evict live dedup identities.
The shared UTC cap is20 mail attempts/day, including outage and recovery. Capped
notices are recorded, not silently queued or automatically retried. Inspect and
resolve persistent faults; this is a small single-installation monitor.

## VPS producer and aggregate sources

Create the immutable operations package from the existing built portable worker:

```sh
node scripts/ci/package-operations.mts WORKER_PACKAGE NEW_BUILD_CONTEXT/operations-package
```

This packages the validated portable worker at `apps/worker`, allowlisted operation
and privacy sources (including the replica transport/pruner), Node24 binary/license and a controlled `packages/storage`
link into that closure. The backup helper resolves the physical installed storage
package for its aws4fetch dependency. Every runtime/dependency file and link is
inventoried in a head/tree-bound SHA256 manifest; receipt.json reports packaging
only, never native qualification. No credentials, snapshots, private inputs or
historical evidence enter the artifact. Retain the external CI manifest digest.

Build `Dockerfile.heartbeat` with that new directory as its context. It uses the
same pinned Node24.21.0 base digest as the web/worker images and copies only the
operations package, preserving complete module paths. Reference the resulting
immutable image digest in `compose.heartbeat.yaml`. The snapshot service executes
the packaged Node binary and collector path. No mutable checkout or host
application-service dependency is required. Linux host networking reaches the
configured existing worker loopback `/ready` probe; this is a worker/durable
readiness observation, not complete merchant readiness.
The template's port9464 is an example and must match the actual qualified worker.
No probe configured means availability unknown.

Copy/adapt `heartbeat.example.json` into protected deployment configuration. The
backup24-hour policy is an **example requiring an agreed actual backup schedule**,
not an assertion that backups run. It must be explicitly configured between one
minute and seven days. Secret custody must be regular file, UID1000, mode0600,
maximum128 bytes, without a newline; mount it read-only. Protect configuration and
aggregate parent directories against untrusted replacement. Configuration contains
paths/origin/policy only. Aggregate sources must atomically replace bounded JSON
files (maximum4096 bytes), using trustworthy maintenance observations:

* `backup.json`: `{ "completedAt": <last verified successful backup Unix ms> }`;
  a failed attempt must not refresh this timestamp.
* `processing.json`: `{ "observedAt": <Unix ms>, "stalledCount": <aggregate> }`;
  derive from actual overdue/failed processing under the qualified worker policy,
  not merely process existence.
* `deletion.json`: `{ "observedAt": <Unix ms>, "overdueCount": <aggregate> }`;
  derive from actual privacy deadlines, including outstanding object/payload work.

Processing/deletion snapshots expire after120 seconds. Missing, malformed, future
or stale evidence is unknown. Backup age above the configured policy is a problem.
The producer probes, reads these local aggregates and sends one heartbeat per
minute. Responses/timeouts are not retried; the next interval has a new event ID.
It follows no redirects, sends only to the configured HTTPS origin's fixed
heartbeat path and emits only fixed acknowledgement/configuration log codes.
The producer reads no database, customer payloads or provider account credentials.

`scripts/operations/heartbeat-snapshot.mjs` is the implemented aggregate exporter.
The separate snapshot container uses the existing pinned pg8.23 dependency from
the qualified application runtime and a dedicated SELECT-only role. Its protected
startup JSON has exactly the operational connection setting
`{"databaseUrl":"<private monitor connection>"}`; never use the app/owner credential.
`monitor-grants.sql` is a reviewable column-level grant template for separately
authorized provisioning, not an applied migration. No payload columns are granted.

The exporter queries actual application tables in one repeatable-read read-only
transaction, with a5-second statement timeout. `stalledAfterSeconds` is explicit
(default/example900 seconds, configurable60–86400); it counts failed inbox/outbox,
expired queue leases, dispatchable pending work beyond that age, overdue artwork
inspection work and stale preview WRITING claims. The age is an operator alert
threshold and does not change retry/lease/deletion contracts. It counts actual
privacy/retention deadlines in inbox/outbox, retained webhook obligation facts,
artwork (including abandoned uploads, rejected assets and uncleaned quarantine),
previews, purchase offers,
designs and attachments, buyer sessions/drafts/proposals and inactive-generation
cleanup, including unexpired sessions whose installation is inactive. Multiple rows/copies may count separately: these are outstanding work
items, never unique customers. No usage table or contiguous migration assumption
is used. Query failures, missing schema/grants and unqualified database clock
replace old healthy snapshots with unknown; they never fabricate zero backlog.

The backup source scans a private bounded inventory of the actual backup.py store,
validates UUID intents/successful receipts and matching private ciphertext file
sizes,
uses their successful completedAt (older createdAt is conservative fallback) and
includes expired retained artifacts and interrupted intents/ciphertext in
overdue-deletion count. Orphan ciphertext or malformed/unaccounted inventory
makes the source unknown, even when another completed backup exists. It does not decrypt
or rehash full backup ciphertext on each heartbeat, so metadata freshness is not a
restore/integrity proof. Malformed/missing artifacts make the source unknown.
Actual backup scheduling and restore qualification remain required separately.
For the required off-host route, the snapshot configuration sets
`replicaRequired:true`, `replicaJournalDirectory` and the exact approved
`replicaRemoteIdentity` (`endpoint`, `bucket`, `prefix`). The example target is a
placeholder requiring authorized configuration. Mount only that private replica
journal read-only into the collector; no remote credential is needed by monitoring.
A local backup refreshes required backup freshness only with its unexpired
`<id>.complete.json` marker binding the original source hash, byte count, expiry,
source completion time and exact remote identity. Replication completion does not
reset the original backup's age. Missing, malformed, wrong-source or wrong-target
completion keeps that backup unqualified; an older genuinely qualified backup
may still contribute its original freshness.

Required remote retention is independently observed through target-bound
`retention.json`, with a nonnegative count and observation no more than120 seconds
old. The replica pruner writes unknown before provider work and zero only after
qualified completion. Missing, stale, null or wrong-target evidence makes deletion
unknown even when local backup and database aggregates are healthy. Numeric remote
backlog joins the local/database deletion aggregate. This consumes protected local
receipts only; the collector makes no remote calls. Native completion/prune source
custody and the actual independent destination still need qualification.

Snapshot files are atomically replaced mode0600 in an owned0700 directory. No
exporter starts or external grants are applied merely by adding these templates.
Native monitor-role/source wiring, actual backup scheduling and native
source observations remain due before the respective signal can be called healthy.

## Native prerequisites (no action authorized here)

1. Pin/qualify Wrangler and generated Env types supporting the documented structured
   Email Sending binding; validate/bundle this config without deploying. Qualify
   the real SQLite Durable Object runtime, concurrent requests and process crash
   windows. No new dependencies or provider entitlement are inferred here.
2. Establish account entitlement and scoped deployment/binding permission without a
   paid upgrade. Preserve existing root MX/SPF/DKIM/DMARC and preview policy.
   Confirm the existing sender domain and exact fixed-recipient destination.
   Read existing/pending verification state first; the owner completes any required
   mailbox verification. Do not initiate/resend verification implicitly.
3. Provision protected relay custody, the exact HTTPS route, synchronized clocks,
   qualified immutable producer image and actual loopback port. Provision the dedicated column-level monitor grants, and wire/qualify the
   implemented backup, stalled-processing and overdue-deletion exporter/policies.
4. Under separate effect permission, qualify the actual binding's rejection of
   alternative recipient/sender behavior, malformed/auth/replay cases, durable
   dedup and ambiguous dispatch. Obtain sanitized inbox receipt with SPF/DKIM/DMARC
   headers and distinguish submission, recipient-server acceptance and inbox receipt.
5. Confirm minute cron execution (changes may take15 minutes to propagate), arm
   with a real heartbeat, stop the producer for an outage drill, observe outage,
   restart and observe one recovery. Verify duplicate/reminder/cap behavior and
   independent VPS failure coverage. Monitor this external route's own operation;
   it cannot prove its own email/Cloudflare outage absent another observation.

Contract provenance: [agreed research](../../docs/delivery/notes/cloudflare-alert-worker-contract-2026-10-18.md).
Current official contracts checked during implementation:
[storage and transactions](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/),
[namespace binding](https://developers.cloudflare.com/durable-objects/api/namespace/),
[structured send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
SQLite-backed objects support the asynchronous storage KV API used here; the
migration explicitly selects SQLite, without introducing a separate KV service.
