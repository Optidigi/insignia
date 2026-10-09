# Shared bounded inventory phase and fixed SSH caller

**OFFLINE_IMPLEMENTED / FIRST_NATIVE_RUN_PARTIAL_SEALED_STOP / NATIVE_SAFETY_UNQUALIFIED.** This module implements local accounting for the owner's granted bounded read-only envelope: three Admin attempts, three owner-selected app-management surfaces and twelve named metadata observations, under **one** deadline of at most thirty minutes. It does not grant resources, authenticate owner/reviewer identity, prove privacy/uninstall safety or pass M5/G7. Historical evidence remains unchanged.

The private parent/orchestrator must verify the actual owner grant, independent accepted source reviews, exact head/tree, natural CI, supported access and retention obligations before creating native declarations. SHA256 binding detects changed inputs; unsigned JSON classifications, hashes and reservation flags are not external authority or authenticated review. Protected local files are trusted only through parent-checked provenance and the current OS identity. Worktrees do not isolate credentials.

## Public interfaces and verification

```sh
python3 -B scripts/m5-inventory-phase/phase_test.py
python3 -B scripts/m5-inventory-phase/phase.py --help
```

Public APIs are `create_phase`, `reserve_admin`, `reserve_owner_surface`, `run_host_inventory`, `close_phase`, and the pure `frozen_remote_command(source_sha256)` helper. [Evidence](evidence/m5-inventory-phase/manifest.json) records real local subprocess/pipe tests and RED/GREEN cycles. Tests inject a local subprocess only for `LOCAL_TEST`, use a separately declared synthetic public host key and synthetic frozen source, and never execute SSH, inspect live services or read private identities. They do not qualify native host behavior.

CLI syntax (private input files must be regular, owner-owned `0600`, at most 64 KiB, in an owner-owned `0700` directory):

```text
phase.py create PRIVATE_PHASE_DIR PRIVATE_ALLOCATION_JSON PRIVATE_QUALIFICATION_JSON
phase.py admin PRIVATE_PHASE_DIR PRIVATE_EXISTING_COLLECTOR_ALLOCATION_JSON
phase.py owner-surface PRIVATE_PHASE_DIR ALLOCATED_SURFACE_ID
phase.py host PRIVATE_PHASE_DIR FROZEN_SOURCE_PY IDENTITY_PATH PRIVATE_TRUSTED_KNOWN_HOST_FILE
phase.py close PRIVATE_PHASE_DIR
phase.py frozen-command FROZEN_SOURCE_SHA256
```

The `host` CLI exposes no test transport or arbitrary SSH command. The pure command helper emits code/setup material, not a resource grant. Other commands emit only fixed classifications, reservation counts, `nativeSafety=UNQUALIFIED` and `retryAuthorized=false`; raw metadata, stderr, private input values and errors stay off public stdout.

## Private declarations and shared deadline

The orchestrator materializes an `insignia-inventory-phase-allocation-v1` declaration from the actual allocation/provenance, rather than copying a test fixture. Required fields are:

- `mode`: `LIVE` for native access; `LOCAL_TEST` permits only explicitly injected local subprocess transport.
- `classification=OWNER_GRANTED_BOUNDED_READ_ONLY`, `ownerApprovalReference`, `allowedMutations=[]`.
- `privatePhaseDirectory`: exact new absolute normalized path; changing directory cannot restart the same declaration. Its parent must be `0700`, owned by the caller and free of symlink ancestry. Paths use letters/digits, slash, underscore, period and hyphen, avoiding SSH path expansions or extra known-host files.
- `expiresAt`, `retentionOwner`, `retentionDeleteBy`: timezone-aware ISO timestamps; retention is future and no more than seven days, with earlier applicable erasure still binding.
- `ceilings`: positive integer `adminRequests<=3`, `ownerSurfaces<=3`, `metadataObservations<=12`, `bytesPerObservation<=1048576`, `activeSeconds<=1800`.
- `ownerSurfaceIds`: at most three unique, explicitly allocated labels. Reserve each **before** the owner starts its read; UI/network fan-out is not relabeled as three HTTP requests.

Native host access also requires `hostAllocation` matching the strict allocation schema in [host_inventory.py](../../scripts/m5-host-inventory/host_inventory.py): allocation ID, exact host/user/port/fingerprint, read-only and audit-effect declarations, fixed ten observation IDs, selector digest, expiry and retention. The fixed host is `65.109.22.104`, `serveradmin`, port22; native fingerprint is `SHA256:vttVPAISQypNdyfjFElTJ6ef8Q5S2YlC+XoUn599uq4`. The two remaining rows stay UNKNOWN without reads. Host collection uses the fixed 1 MiB observation cap; tighter unsupported host byte allocations stop before transport.

`hostAccess` accepts two distinct frozen declaration forms:

- The original forced-key form has exactly `identityPath`, `knownHostLineSha256` (exact single public host-key line without its newline), `forcedCommandSha256` and `forcedCommandAttestationRef`. Its server restriction still requires independently checked access evidence.
- The owner-authorized existing identity form has exactly `mode=EXISTING_IDENTITY_FIXED_COMMAND`, `identityPath`, `knownHostLineSha256`, `fixedCommandSha256`, `identityPublicKeyFingerprint`, `identityVerificationRef` and `ownerReuseApprovalReference`. Native use binds only `/home/serveradmin/.ssh/id_t3_prod` and public fingerprint `SHA256:Hwhydo5U9f8ZDJr9+INeksDq9DoKB+83TsRCyynmRRM`. Parent must check the actual latest owner reuse directive and public-key relationship to that exact identity, then bind those records through the two references before source qualification/use. A supplied fingerprint or unsigned reference does not prove the private-key relationship or owner authority. The writer did not read/derive any existing private identity or invoke native SSH.

The existing-identity form deliberately makes no claim that the remote key is restricted, that the server enforces a forced command, or that `serveradmin` is a read-only account. The existing credential may authorize a broader shell; this caller uses only its frozen literal command. Its private reservation records `accessMode`, `fixedCommandSha256`, public identity fingerprint and provenance references with `serverRestrictionProven=false`, and omits the forced-command attestation hash. This is an explicit owner-authorized policy change, not a restriction silently inferred from credential reuse. The original key form and its historical evidence remain unchanged.

Both forms are private frozen declarations. The command digest is computed from the same source-bound loader; unknown modes, mixed forms, missing references and binding drift stop before reservation/authentication. The identity path is checked only with filesystem metadata: absolute with only ASCII letters/digits, `/`, `_`, `.`, and `-`, no symlink, regular, owner-owned `0600`. Expansion syntax such as `%h`, `%d` and `${HOME}` is rejected before reservation or transport so OpenSSH cannot select a different identity through `IdentityFile` expansion. The caller never reads key contents itself; OpenSSH accesses the selected identity only during an independently authorized native invocation.

The private qualification has `classification=FROZEN_LOCAL_GATE`, `allocationSha256` over canonical encoded allocation JSON, `phaseSourceSha256` over this module's exact bytes, forty-hex `head/tree` and parent-verified `specReviewRef`, `standardsReviewRef`, `ciRef`. Its optional `hostQualification` has exactly the host operator's qualification fields, including exact source and selector digests. `encoded()` defines canonical sorted ASCII JSON serialization. Inputs are frozen to the private ledger; drift or an unavailable/expired/closed ledger prevents further reservation.

Creation exclusively makes the declared directory, stores immutable allocation/qualification copies and starts the shared deadline at `min(start+activeSeconds, allocation expiry, private retention expiry)`. State changes use an exclusive local file lock, `0600` exclusive temporary write, file fsync, atomic replace and directory fsync; the evidence parent is fsynced after creation. The local filesystem and current OS identity remain trusted.

## Admin and owner reads

`reserve_admin` consumes three request slots once, before any provider request. It emits private `admin-binding.json` and an exact `admin-allocation.json` suitable for the existing [native collector CLI](M5-NATIVE-INVENTORY-COLLECTOR.md). The allocation's output directory is exactly `PHASE_DIR/admin`; its `validUntil` is clamped to the shared deadline and its duration to the remaining phase time. The binding records the phase/input digests, reserved count and exact collector-allocation digest. Parent must check the actual binding/digests before using that file with the already approved existing-token descriptor channel. There is no provider invocation, credential acquisition, exchange, refresh, token persistence or new token store in this module.

An Admin reservation remains `RESERVED_NOT_OBSERVED`; three reserved slots do not mean three actual requests or a complete inventory. Parent reconciles the actual collector receipts separately. Likewise each owner-surface reservation is `RESERVED_NOT_OBSERVED`, never machine evidence or an owner attestation invented by this tool.

## Fixed SSH source delivery and access restriction

Before authentication, the caller verifies source bytes (regular bounded file, SHA match), derives the selector digest from the verified frozen module's exact plan/argv templates and checks it against both declarations. It verifies a single exact target host-key line by SHA256 of its SSH public-key blob and checks the blob's embedded algorithm. Native mode always requires the historical fixed fingerprint; no TOFU, keyscan, unknown-host acceptance or automatic key update occurs.

For the original forced-key form, the owner/parent must establish a temporary restricted access key with both `restrict` **and** `command="<exact frozen_remote_command output>"`, properly escaped for the authorized-keys format, before using it. `restrict` alone does not restrict which command a key can execute. The single-line helper embeds the expected source SHA as a literal in the fixed loader. Parent must verify the actual server access record/forced command against that artifact; neither an unsigned `forcedCommandAttestationRef` nor this caller proves server-side enforcement. This module creates no key or remote file and changes no authorized-keys record. Changed frozen source requires a newly qualified exact command/access binding, not an in-place failed-run patch.

For `EXISTING_IDENTITY_FIXED_COMMAND`, the latest owner directive supersedes the earlier restricted-key setup condition for that exact existing identity only. No new key/setup or remote authorized-keys changes are performed. The same command helper and compatibility-named local `forced-command.txt` contain the exact caller-transmitted command; that filename is not evidence of server enforcement. Parent must accept fresh independent Spec/correctness and Standards/security reviews plus natural exact-head CI for this policy/source change before using the existing credential. Old PR60 acceptance does not qualify the new mode. The original bounded read grant, ten active/two UNKNOWN metadata rows, Admin/page caps, shared deadline and zero-mutation conditions are unchanged. See [reuse directive and local evidence](evidence/m5-inventory-phase/existing-owner-access/manifest.json).

Before SSH, private pin/command files and empty `0600` capture files are durable; ten observations and one invocation are durably reserved. OpenSSH is invoked once with fixed host/user/port and options disabling configuration, agent, password/keyboard prompting, proxy/jump, forwarding, PTY, multiplexing, hostname canonicalization and automatic retries. Dedicated known-host trust and the verified host-key algorithm are mandatory. Environment is minimal and no secret environment is forwarded.

The verified source plus fixed request travel in a bounded JSON/base64 stdin envelope. The fixed remote command uses `env -i` and `/usr/bin/python3 -I -B`; its loader compares the exact source digest with its embedded literal **before** executing the received bytes, then calls `collect_verified_source(request, exact_source_bytes)` with `__name__` distinct from `__main__`. It writes no remote source file or bytecode. The request's reservation carries the actual phase/allocation/source/selector binding and shared deadline.

Local stdout/stderr are streamed into private files: combined maximum `12 MiB+64 KiB`, stderr at most64 KiB, process wall time at most300 seconds and no later than the shared/host expiry. Timeout or cap failure kills the local process group. Source metadata commands also enforce their own deadline. An SSH disconnect is not proof that remote observation stopped instantly; all ten reservations remain consumed and the remote loader/source has the fixed shared deadline.

Successful capture requires zero provider requests/host writes/production SQL, no retry/global-absence claim, exact ten attempted IDs, ten bounded metadata rows and two UNKNOWN rows. It returns `HOST_METADATA_CAPTURED_NATIVE_UNQUALIFIED`; all private values remain private. Unsupported shape, inconsistent counters, transport failure, lost response, cap, deadline or I/O failure stops and attempts to close the phase with uncertainty. No automatic retry occurs.

## Crash, closure and retention

A killed caller can leave a durable host `RESERVED` state and partial captures. That invocation and all ten observations are conservatively consumed; reinvocation is rejected and does not relabel the original run. Confirm the original process/transport is stopped, account for remote deadline/access effects and call `close_phase`. Closing after the deadline is supported. Closure is local accounting, not proof that remote work completed, stopped immediately, or that all reserved reads occurred. A failed fsync or conflicting `ledger.pending` can prevent durable closure; preserve the entire partial directory for parent adjudication. Do not overwrite/delete it to obtain a retry or restart the thirty-minute clock.

A closed phase cannot resume. Any later phase needs separately qualified allocation/accounting for prior failed/ambiguous attempts and its own explicitly bound directory; the tool does not manufacture that authority. Parent owns actual source freeze, authenticated access/approval provenance, external key cleanup, evidence reconciliation and remaining metadata/resource gaps. The named retention owner deletes all private capture/input/copy/backup material by the declared deadline, earlier when required. No background cleanup watcher is installed.

Sources: [owner read-only allocation](evidence/m5-native-inventory/owner-readonly-allocation.json), [operating model](operating-model.md), [M5-027 bounded sequence](M5-027-READ-ONLY-INVENTORY.md), [M5-026 gap matrix](M5-026-CALLBACK-AUTHORITY.md), [full plan](../architecture/implementation-plan.md) sections6.5/10.4/11/14/15.M5, and pinned TDD tests/mocking plus writing-for-agents conventions. The existing RED uninstall invariant, native evidence hierarchy, privacy obligations and resource/mutation boundaries remain binding.

PR60 review corrections are recorded separately in [the correction manifest](evidence/m5-inventory-phase/pr60-security-corrections/manifest.json). The original manifest/logs bind historical candidate `6f899be0a0eb226bb257d99be249a9e4a86fa54d`; they are not current-source qualification. The correction RED accepted all three existing expansion-bearing synthetic identity paths and invoked the local transport; GREEN rejects them before any observation reservation or transport. Native SSH remains NOT_RUN.

## First native use and optional metadata gaps

The independently frozen standalone existing-key source authenticated successfully. The exact fixed router read failed after two complete container observations; the original run closed without retry. [Partial receipt](evidence/m5-inventory-phase/existing-owner-access/first-native-run/partial-native-receipt.json) records actual accounting and limits. The original source, capture and failure are immutable historical evidence. Access is available; no further key setup is needed.

The revised host collector emits `UNAVAILABLE_COMMAND_FAILED` only for a nonzero exit from fixed router/legacy commands. Phase validation accepts that classification only for those two exact observation IDs with the exact UNKNOWN metadata shape; it is never container evidence or proof of absence. All other errors retain STOP behavior. No selectors, command sequence, retries or operation allowances are added. [Local correction](evidence/m5-inventory-phase/existing-owner-access/optional-metadata-gap/REPORT.md) binds actual RED/GREEN and parent checks. No native request has used this revised source. A closed run cannot resume; another pass requires fresh source qualification and a new explicit owner allocation accounting for previously consumed slots.
