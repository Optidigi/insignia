# M5 local slice — generic uninstall authority quarantine

Locally authorized engineering under [milestone autonomy](../authority/milestone-autonomy-2026-10-09.md) and [operating model](../operating-model.md). This is an internal implementation specification, not a new external principal verdict. Base: PR63 merge `5ce5911d124bf2727e8e5d390f53086d6e578d78`.

## Invariant and scope

A previously HMAC-authenticated Shopify body must never acquire authority to deactivate an installation solely from unsigned topic, delivery/event IDs, timestamp or domain metadata. Signed Shop identity is diagnostic, not independent uninstall-purpose/installation-generation authority. The current generic route has no qualified independent authority and must visibly defer irreversible processing.

Separate receipt admission/transport settlement from generation binding, credential revocation, publication-pointer clearing and inbox business completion. Newly received generic uninstalls and historical pending header-derived bindings must remain unqualified; do not bind a current generation or mark them processed/stale merely from claimed chronology. Preserve existing historical processed bytes and duplicate facts, bounded metadata/HMAC checks, deadline/lock-wait checks, queue handoff/exhaustion, credential/tenant lifecycle, immutable publication/availability v1/v2/v3 and retention contracts. Existing malformed/mismatched signed-Shop outcomes remain fail closed.

Return a truthful typed disposition through the existing facade/handler. Worker transport may defer/settle without business success; the durable receipt/privacy obligation remains unresolved. Preserve the conservative bootstrap fence and explicitly describe its denial/availability limitation: unsigned chronology is not independent authority or absence proof. Do not add provider calls, callback admission, authority markers, credentials, unlimited retry/recreation or destructive erasure.

### Recovery correction after rejected round 1

The first security review reproduced a separate recovery defect: 100 older pending quarantines with completed jobs repeatedly fill the recovery batch, starving a later receipt committed before ingress crashed without a queue job. Round 1 remains rejected even though all eleven natural exact-head attempt-1 workflows passed. Its reviews, candidate manifest and CI remain immutable evidence.

The orchestrator explicitly expands the earlier no-migration scope only for one nullable transport-selection timestamp, its database type and least-privilege column grant. This is mutable audit scheduling metadata, never generation authority, business completion, a successful queue check or acknowledgement. Preserve raw delivery metadata, historical authority records and the pure pending-receipt read API.

A new explicit selection operation commits at most 100 selected IDs before external queue audit. Order by the oldest `COALESCE(queue_recovery_selected_at, inbox.received_at)` and deterministic ID so new arrivals do not permanently outrank older audit work. Use trusted database clock only; no delivery header, CAS or timestamp tolerance. Lock inbox rows first with `FOR UPDATE SKIP LOCKED`, then recheck routing/deadline eligibility under that mutex and acquire the delivery row lock on its diagnostic update. Preserve the existing inbox-to-delivery order. Concurrent selectors skip rows while their inbox locks are held; overlapping stale joined snapshots after lock release may repeat an audit, so no globally disjoint call guarantee is claimed. Selection grants no permission to send: preserve the existing durable one-shot reservation, exact singleton audit, unknown/confirmed missing-job exhaustion and no recreation/retry contracts.

Crash after selection may delay that audit behind older unchecked work; restart must continue from durable selection evidence. Queue unavailability must not mark obligations fulfilled or manufacture an acknowledgement. Repeated bounded cycles must rotate confirmed and unknown tails as well as new unconfirmed receipts. Down migration must fail closed when selection evidence exists, preserve its relation/guards exactly and allow an empty/unselected down/up rehearsal. No production migration is authorized.

This safeguards one unsafe effect. It does not meet genuine-uninstall, registration-gap, privacy or full M5/G7 acceptance. Permanent quarantine is not an accepted replacement product policy. Independent authority and native qualification remain required; overdue raw obligations remain blockers, not waived retention.

## Tests and acceptance

Use repository-pinned TDD/diagnosis at the existing public durable webhook/tenant facade, real HTTP ingress, actual worker/pg-boss and isolated PostgreSQL18 seams. Parent selected these existing seams under delegated engineering authority; no new interview is needed.

Reproduce the original unchanged strict active-generation assertion RED before correction. Preserve it and all historical execution records. Make the same literal security assertion unconditionally GREEN through corrected production source; CI must never select weaker vulnerability-characterization expectations by default.

Cover changed metadata/body/topic/domain, old signed-body replay, identical legitimate later body without authority, duplicates/conflicts, absent/out-of-order delivery, legacy pending binding and processed history, reinstall/bootstrap lock races, no provider authority/unavailability, expired lock waits, retries/exhaustion and actual SIGKILL/recovery. Assert no deactivation, credential revocation, pointer clearing or business processed/stale-success for unqualified inputs. Deferred transport leaves an explicit pending/unqualified obligation; privacy is not fulfilled. Preserve original wait/timeout/assertion bounds and isolate owned process/DB fixtures with settled children and clean teardown.

For recovery correction, reproduce the 100-completed-plus-101-unqueued counterexample RED through the real public worker/queue interface, then GREEN after an independent queue/core restart. Cover durable selection across crash/restart, concurrent disjoint selection, deterministic ties and new arrivals, unknown/confirmed missing or terminal singleton jobs, failed acknowledgement and actual queue errors, deadlines/exhaustion, migration down/up/evidence preservation and role fences. Renew full relevant PostgreSQL18, root, HTTP/worker and portable controls, both independent completed-change reviews and natural exact-head CI. Prior controls may be reused only with explicit unchanged-input provenance.

Run full relevant database/root/runtime/browser/operator/boundary/style/secret/history controls, fresh portable worker where its source changed, applicable publication/renderer regression, two fresh actual independent GPT-6.1-sol/high enforced read-only full-source reviews and all naturally applicable exact-head attempt-1 CI. Record failures and corrections honestly. Normally merge only when locally qualified, verify parents/tree/main and continue M5. No routine principal slice gate.

## Native facts and boundary

Record [permanent read-only VPS allocation](../authority/permanent-vps-readonly-2026-10-09.md) and selected new native metadata without private values or unrelated topology. Existing identity works. Preserve the third full pass's sealed process-metadata STOP and subsequent independent focused reads; no retrospective cause inference or old-run retry. Canonical commercial policy/features are absent, not invented. Process/container name listings do not prove global processor absence or queue/privacy ownership.

No source correction is deployed under this slice. No production SQL, queue/schema provisioning, worker/web deployment, Shopify/provider/browser access, token acquisition, installation/subscription/version/scope mutation, merchant fixture, M6/M7 or rollout. The permission to inspect VPS is not permission for those actions. Prepare concrete missing resource/commercial proposals while continuing useful safe work.
