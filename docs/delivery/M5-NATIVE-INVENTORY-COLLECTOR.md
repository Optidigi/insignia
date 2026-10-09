# Bounded existing-installation inventory collector

**OWNER_READ_ONLY_ENVELOPE_GRANTED / OFFLINE_IMPLEMENTED_NATIVE_NOT_RUN.** This standalone Node 24 collector implements only the direct existing-shop read in [M5-027](M5-027-READ-ONLY-INVENTORY.md). It is not an application authentication path, credential store, registration tool or authority source. Milestone autonomy authorizes local implementation and test design. The owner subsequently granted the exact consolidated bounded read-only envelope ("you have full acess yes"); the orchestrator owns its [allocation/provenance record](evidence/m5-native-inventory/owner-readonly-allocation.json). This does not authorize mutation or establish usable credentials, current exact IDs, processors or commercial facts. Source freeze, independent review and technical qualification still precede credentialed collection. No live request was made during implementation.

A completed run returns `COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED` with `STOP_PRE_INSTALL_DESTINATION_EFFECTS_UNQUALIFIED`. This means an error-free, bounded **shop-scoped** connection and matching boundary identities were collected. Stable identity bracketing does not make the subscription inventory atomic, exclude concurrent reconcilers, establish app-wide/compliance coverage, qualify any receiver/privacy processor, satisfy the M5-026 registration-gap matrix, repair the retained uninstall RED invariant, or pass M5/G7. The tool never turns a mock result into runtime generation authority.

## Local verification and public seams

Run from the repository root with pinned Node `24.21.0`:

```sh
node --test scripts/m5-native-inventory/collector.test.mjs
node scripts/m5-native-inventory/cli.mjs --help
```

The owner delegated local test design. The public seams are `collectInventory({ allocation, token, privateDirectory, testEndpoint? })`, `sealAbandonedRun({ privateDirectory })`, and the CLI. Tests use real HTTP bound to `127.0.0.1` with explicit injected test endpoints and synthetic tokens. They exercise durable attempt reservations, private evidence, pagination/500 records, caps, incomplete/unknown response shapes, drift, provider errors, redirects, API fallback, timeouts, lost responses, crash, credential reflection and I/O failures. No dependencies, global fetch, SDK, database, service or external network fixture is required.

Retained [evidence](evidence/m5-native-inventory/manifest.json) records RED-before-GREEN cycles and final commands. The writer's checks are not independent review; the orchestrator owns integration and fresh independent completed-change reviews.

## Exact future owner inputs

The orchestrator must materialize the actual granted allocation from the explicit owner instruction and independently established resource identities. It also needs a supported **already valid** exact-app Admin token through a private inherited descriptor and a private evidence directory. The collector does not create grants, obtain/exchange/refresh tokens, infer approval from milestone authority, or verify that a declaration was actually approved by its claimed author. The allocation is an owner attestation; the orchestrator must independently establish its provenance and frozen collector approval before invoking native transport. An unsigned JSON status is not permission by itself.

The CLI accepts only:

```text
node scripts/m5-native-inventory/cli.mjs \
  --allocation PRIVATE_OWNER_JSON \
  --private-directory NEW_PRIVATE_DIRECTORY \
  --token-fd INHERITED_DESCRIPTOR
```

The descriptor must be an inherited FIFO/pipe or socket, numbered 3–255, reach EOF within five seconds and carry at most 4,096 token characters plus one optional trailing newline (maximum 4,097 bytes). Supply it using the owner's existing approved secret broker/channel. Do not put token bytes in arguments, shell history, environment dumps or a new token file. The CLI never echoes its inputs or raw errors. A fixed Node child receives the inherited descriptor as fd 3 and reads at most 4,097 bytes; its bounded output travels only over a private in-memory pipe to the CLI. The child receives no token argument/environment/file and an empty environment. Descriptor metadata rejects regular files, directories and devices before spawning the reader; these cannot substitute for the supported private pipe/socket channel. At the five-second credential deadline a surviving CLI kills and reaps that reader, including a blocking OS-pipe read whose writer supplies neither bytes nor EOF. The reader independently self-terminates with SIGKILL after five seconds even if the CLI disappears; it keeps this timer after stream errors. A SIGKILLed CLI cannot reap the child: the operating system handles its termination/reparenting, and an unreaped zombie may remain without an executing reader or open pipe descriptor. Runtime `process.exit` alone can hang waiting on the blocked read during cleanup. Collection and run creation begin only after a successful bounded read and EOF. This adds no credential store. JavaScript strings/HTTP header memory cannot be securely erased; no token is intentionally persisted. Exact plaintext token reflection in a response is withheld from disk and stops collection. This check is a containment measure, not a general secret or PII detector.

The private allocation must be an owner-owned regular file with no group/other permission bits and at most 64 KiB; symlink inputs are rejected. `--private-directory` must exactly match the allocation, be an absolute normalized **new** path, and have an owner-owned `0700` parent with no symlink ancestry. The collector creates the new directory at `0700`, private files at `0600`, and refuses existing directories. Use a local filesystem supporting file/directory fsync. Host administrators and the current OS identity remain trusted; worktrees/file modes do not isolate credentials from that identity.

The following is a **request shape, deliberately rejected**, not a generated permission file. The orchestrator may supply the actual values/status from the explicit owner allocation and independently proven exact identities; it cannot invent that authority or infer missing facts from this example. Query/schema support is still a native unknown; unsupported results stop without repairing documents or broadening scopes.

```json
{
  "schema": "insignia-native-inventory-allocation-v1",
  "status": "REQUEST_NOT_PERMISSION",
  "ownerApprovalReference": "OWNER-SUPPLIED-EXACT-ALLOCATION-REFERENCE",
  "purpose": "M5-027 existing shop subscription read",
  "endpoint": "https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json",
  "expectedShopId": "OWNER-SUPPLIED-CURRENT-SHOP-GID",
  "expectedInstallationId": "OWNER-SUPPLIED-CURRENT-APP-INSTALLATION-GID",
  "expectedGrants": [],
  "requiredScopes": [],
  "optionalScopes": ["write_products", "read_publications", "read_product_listings"],
  "allowedOperations": ["M5027WebhookInventory", "M5027InstallationBoundary"],
  "allowedMutations": [],
  "incidentalEffects": ["provider-access-audit"],
  "privateCredentialChannel": "inherited-file-descriptor",
  "credentialCapability": "EXISTING_SUPPORTED_EXACT_APP_ADMIN_TOKEN",
  "privateEvidenceDirectory": "/owner-private/allocated-new-run-directory",
  "retentionOwner": "OWNER-SUPPLIED-ACCOUNTABLE-PRIVATE-EVIDENCE-OWNER",
  "retentionDeleteBy": "OWNER-SUPPLIED-ISO-TIMESTAMP",
  "validUntil": "OWNER-SUPPLIED-ISO-TIMESTAMP",
  "ceilings": {
    "requests": 3, "pages": 2, "records": 500,
    "responseBytes": 1048576, "durationMs": 1800000,
    "responseTimeoutMs": 30000
  }
}
```

Native status is exactly `OWNER_ALLOCATED`. `expectedGrants` must name the **independently observed existing** grant set, a duplicate-free subset of the three historical optional handles; it is not a request for those grants. Required scopes stay empty and optional configuration stays exactly those three. The fixed expected app is `gid://shopify/App/429028933633`, client `1443cf6d03d39edae7c101a943c5c684`, and domain `insignia-rewrite-dev.myshopify.com`. Shop/current external installation GIDs are supplied privately and must match every page and final identity. The collector cannot observe accepted Active version, app-wide configuration or native consent provenance; those remain separately allocated owner reads.

Every ceiling is a positive integer no greater than the shown maximum. The owner may tighten it. The allocation must still be valid and private retention deletion must be future and within seven days at collection start; collection also stops at either expiry. Unknown allocation fields, operations, mutations, scope expansion or credential-store fields are rejected.

For local tests only, the allocation has `LOOPBACK_TEST` status and the caller explicitly passes `--test-endpoint http://127.0.0.1:PORT/admin/api/2026-07/graphql.json`. This flag accepts only numeric loopback HTTP, an explicit port, the exact API path, and no credentials/query/fragment. `LOOPBACK_TEST` cannot select native transport and `OWNER_ALLOCATED` cannot select a test endpoint. Tests never establish native allocation or field feasibility.

## Execution, private evidence and sealing

The queries are fixed copies of the retained [inventory documents](evidence/m5-027/inventory.graphql). A test compares the actual outgoing documents with that source. There is no arbitrary query or endpoint switch, redirect handling, retry, token exchange/refresh, browser session extraction, installation transition, SQL, canonical runtime probe, callback request, bootstrap, queue or service startup. At most two inventory pages of 250 records, 500 total, are followed by one final identity read: at most **three attempted Admin requests**, failed/ambiguous attempts included. The API response header and each subscription API version must be `2026-07`; serialization must be JSON. HTTPS/PubSub/EventBridge URI shapes are classified locally, not experimentally qualified.

Before each transport the collector appends a `RESERVED` attempt to its private journal, fsyncs the temporary file, atomically replaces the journal and fsyncs the directory. It also fsyncs the evidence parent after directory creation. The journal excludes tokens, cursors, callback URIs and bodies. Response bytes are saved privately before parsing, at most the allocated byte cap; oversized/failed responses may contain only the bounded received prefix. A detected literal token reflection leaves an empty body file. A private `allocation.json` copy records the declared resource/retention inputs, never the token. No raw response/header/cursor/URI/hash is published.

A request's status becomes `RECEIVED` or `UNCERTAIN`. Missing fields, unsupported/unknown shape, HTTP/provider errors, identity/grant drift, duplicate IDs or repeated URI/topic binding conflicts, cursor cycles, missing next cursor, third page, cap/deadline exhaustion, secret reflection or private I/O failure stops immediately. No subsequent page or boundary read is sent after a stop. An incomplete connection is never reported complete. Distinct topics may share the same coherent URI; the collector retains both subscriptions. Repeated subscription IDs or repeated exact URI/topic bindings stop. Public success includes opaque per-subscription `destination-NNN` labels (not a claim of distinct physical receivers), allowlisted topic categories (`OTHER_TOPIC` for other topic bytes), transport/format/API categories and counters. Public failure includes only fixed classifications and counters.

Normal completion/failure seals the journal. Abrupt termination can leave `RESERVED` or an unsealed journal; the reservation is conservatively consumed, even if the caller cannot prove transport began. A private write failure may prevent the seal from becoming durable. The public outcome then remains uncertainty; preserve the original evidence and do not repair/reinvoke the run. Never delete or reuse its directory to obtain a retry. A new run needs a new independently approved owner allocation/reference and explicit accounting for all earlier failed/ambiguous attempts; it is not an automatic retry.

After the original process is independently confirmed dead, this optional local-only operation can seal an abandoned journal without network access:

```text
node scripts/m5-native-inventory/cli.mjs --seal-abandoned PRIVATE_DIRECTORY
```

It refuses an apparently live/reused PID, an already sealed journal, unsafe file/directory input, or an unusable journal. It changes remaining reservations to `UNCERTAIN`, returns `STOP_ABANDONED_RUN_UNCERTAIN`, and never resumes collection. PID checks are conservative local guards, not complete cross-host liveness proof. A stale/conflicting `journal.pending` or failed fsync makes sealing unavailable; preserve the partial run for private operator adjudication rather than overwriting it. Sealing does not resolve the request's provider outcome or authorize another attempt.

The owner named in `retentionOwner` must delete **all** private collection copies, backups and handoff material by `retentionDeleteBy` (at most seven days), earlier when required by an applicable request. No background erasure service or delayed watcher is installed by this standalone tool. Account for provider access/audit effects separately under the allocation. Public code/tests/evidence contain synthetic fixtures and fixed categories, not native private collection.

## Binding sources and remaining qualification

- Owner decision: `insignia-milestone-autonomy-2026-10-09/authority/OWNER-DECISION-2026-10-09.md`; adopted repository [operating model](operating-model.md). This supersedes historical per-PR stops prospectively, preserves resource boundaries and delegates local test design.
- [Decision ledger](../architecture/decision-ledger.md), [full plan](../architecture/implementation-plan.md) sections 6.5, 10.4, 11, 14 and 15.M5: durable privacy receipt/erasure, generation fences, evidence hierarchy and M5/G7 acceptance remain binding.
- [M5-027 bounded inventory](M5-027-READ-ONLY-INVENTORY.md), [destination/effect/privacy report](M5-027-DESTINATION-EFFECT-PRIVACY.md), and [fixed documents](evidence/m5-027/inventory.graphql): the historical native allocation was closed; the new owner read-only grant changes resource permission prospectively while exact access/current downstream facts remain unqualified.
- [M5-026 callback authority and registration-gap matrix](M5-026-CALLBACK-AUTHORITY.md): subscription enumeration excludes app-scoped/TOML subscriptions and cannot establish genuine-uninstall completeness or authority.
- Pinned `.agents/skills/tdd/{SKILL.md,tests.md,mocking.md}`, `.agents/skills/diagnosing-bugs/SKILL.md` and `.agents/skills/writing-for-agents/SKILL.md` guided local behavioral testing, failure containment and this operator documentation. No existing production source, historical evidence or uninstall security assertion was changed.

Native collection, existing supported token/current IDs, current Active/config/compliance surfaces, every receiver/reconciler/processor and retention/backup owner, privacy closure, independent uninstall authority and complete M5/G7 remain **NOT_RUN/UNQUALIFIED**. This collector narrows one future observation step; it grants none of those resources and clears none of those gates.

PR60 review corrections are recorded separately in [the correction manifest](evidence/m5-native-inventory/pr60-security-corrections/manifest.json). Original manifests/logs bind historical candidate `6f899be0a0eb226bb257d99be249a9e4a86fa54d`; they are not current-source qualification. A public CLI RED using a real inherited OS pipe with its writer kept open exceeded the external 6.5-second deadline despite the old five-second stream-destroy timer. GREEN terminates with sanitized zero-request rejection, no HTTP attempt and no run directory while the writer remains open. A separate descriptor-type RED showed a synthetic regular file still permitted successful loopback collection; GREEN rejects it before run creation or HTTP. Native collection remains NOT_RUN.

R2 corrections are recorded separately in [the R2 correction manifest](evidence/m5-native-inventory/pr60-r2-corrections/manifest.json). Original and R1 manifests/logs retain their historical inputs at `c5b3ad9d2a82d5fae88a2026eac2946de4adaf93`; they do not qualify this changed source. Both private allocation and abandoned-journal opens use `O_NONBLOCK | O_NOFOLLOW` before inspecting the opened descriptor, then retain their regular-file, owner, permission and size checks. Writerless FIFO inputs promptly return sanitized rejection. The actual parent-SIGKILL control retains partial synthetic private token bytes without EOF, verifies the independent reader deadline, and checks that the pipe is released; native collection remains NOT_RUN.

The [CI correction evidence](evidence/m5-native-inventory/pr60-ci-corrections/manifest.json) preserves failed foundation run `37957210768` at `9c2b8ec84da0d96fb86e9bbd68108e210064a6b4`: the synthetic Python helper exited 1, and its original traceback was unavailable because the assertion discarded stderr. Both local Python executables are 3.14.4; no actual Python 3.12 validation or recovered CI traceback is claimed. An actual Linux child-subreaper fixture retains the terminated reader as a zombie, and strict `/proc` descriptor inspection reproduces `PermissionError`. The corrected test inspects descriptors only for nonterminal processes, requires `Z`/absence plus an independent `EPIPE` observation on the original token pipe, and exercises both normal reaping and a retained zombie. It reports full `sys.version` and nonsecret system/kernel/machine values on success and preserves those runtime details with synthetic tracebacks on helper failure, excluding arguments, environment, host names and private child stdout. The deadline and live-reader rejection remain unchanged. This correction changes tests/documentation only; CLI and collector bytes remain frozen at that historical head. Fresh natural CI and independent reviews are still required.
