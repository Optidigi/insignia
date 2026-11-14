# Design: automatic release of an abandoned publication hold (#466 part B)

Status: **proposed, needs owner approval before implementation.** No runtime code exists for this design. Revision 2 addresses the independent review of PR #471. The proposed requirement text is in the [specification](implementation-plan.md) (§3.1, §6.1, §6.2, §7.2, §10.1, §10.3, §11, §13.1, §13.2). This document holds the mechanism, state tables, fence sequence, UI states, test plan, migration outline and the interface for part A.

Owner decisions this design follows (14 November 2026):
- Build B. When a publish is abandoned, the system heals itself: after a bounded quiet time, if durable records **prove** that no policy, registration or shop-config write could have reached Shopify for that operation and Insignia owns the hold receipt, the worker restores the product's prior availability exactly as held, marks the publication failed and tells the merchant "Publishing didn't finish; your product is back as it was. Publish again."
- Cases that cannot be proven safe stay held, are logged at warn and are left for the operator command (part A). The merchant editor shows a support message. Real alerting is out of scope (phase 5).
- The background worker may change product availability with the app's offline token for this one effect only.
- Every new state and transition is an explicit state machine: database states with trigger-enforced transitions, one application transition function, and the admin UI state through the existing server projection and client classifier.
- Part A is server-only: a CLI run over SSH on the host, like the signing emergency revoke. It reuses B's states and checks and adds no state.

Q6 (§12) asks whether the owner accepts a simpler evidence rule that drops the dispatch gate. If the answer is yes, §2, the gate rows of §3.2, H1/H3 concerns and migration step 1 disappear; everything else stays.

## 1. Problem and evidence

A first publication or mode change takes an availability hold before it writes any Shopify field: the product goes to DRAFT (`m5_activation_state.kind = HELD`, owned `held` receipt). Then `PgProductionPublication.advance` writes `public_config` (shop), `registration` pending (product), `policy` (product) and `registration` ready (product), in that order; activation commits evidence and restores the product. Each write runs inside an `advance` transaction that holds `FOR UPDATE` on `shops`, the installation and `product_configs`. The phase moves only after an exact readback, in the same transaction.

If the merchant's request stops after the hold and before activation (closed tab, lost response, Shopify throttling), nothing continues the operation. The product stays DRAFT, `prepare()` refuses any new publication and the editor shows "Publication requires operator review" with no next step. Operator recovery is not wired (#466).

Why the existing records do not prove "nothing dispatched" (the #452 reviewer's finding):
- `phase = 'prepared'` does not prove that `public_config` was not sent. That write is dispatched while the phase is still `prepared`. If the process dies mid-fetch, or the transaction fails after the fetch, the row still says `prepared` while the request may already be at Shopify.
- `retry_count`, `version` and `last_observed` are written in the same transaction, so they prove nothing either.
- `ACQUISITION_PENDING` without an owned `held` receipt never qualifies: the status mutation may be in flight, and there is no owned snapshot to restore against.

What `phase = 'prepared'` *does* prove: no product-level `registration` or `policy` write was dispatched. Those writes are sent only by an `advance` transaction that read a committed later phase, and the progress trigger never moves a phase backwards. This is the basis of Q6.

Live example (rewrite-dev, read-only SELECT, 14 Nov): operation `43db577d-…` (`QA cover B – Tee`). `publication_operations.status = requested`; progress `phase = prepared`, `version = 0`, `retry_count = 0`, `last_observed IS NULL`; activation `OPERATOR_HOLD` (version 5) with `before` ACTIVE (`available`), owned `held` DRAFT and a qualified acquisition acknowledgement; `mode = required`, `prior_mode = NULL` (first publication). B never touches it, because it is `OPERATOR_HOLD`. It is part A's first case (§9).

## 2. Evidence rule: the dispatch gate

### 2.1 Values

One durable marker per publication operation, `m4_publication_progress.remote_dispatch`:

| Value | Meaning | Written by |
|---|---|---|
| `NONE` | No Shopify field write has been or can be dispatched for this operation. | `prepare()` on insert, explicitly (not the column default) |
| `OPENED` | A field write may have been dispatched. Never reverts. | `advance`, at the dispatch point (§2.2) |
| `UNKNOWN` | Written before the gate existed, or by code that does not know it. Never changes. | Column default; the migration backfills every existing row |

One marker per operation is enough. The four writes happen in a fixed order, and B needs only one fact: no write at all was dispatched. Part A needs per-field facts and reads them from Shopify (§9).

`UNKNOWN` as the column default makes mixed deployments safe: an old web process inserting progress rows without naming the column produces `UNKNOWN`, never `NONE`.

### 2.2 Where the gate opens

Inside the existing `advance` transaction, at the dispatch point. There is no separate gate transaction and no second pool connection.

`advance` runs all of its existing checks first: lock, load, `current()`, admission (`established()` and `isFresh()`), the remote reads, the per-field preconditions and the CAS prior comparison. Then:
- If the gate is `NONE`, it sets `remote_dispatch = 'OPENED'` (and `version + 1`), commits, and returns `PENDING` **without any write**. The next `advance` re-runs every check and dispatches.
- If the gate is `OPENED`, it dispatches as today.
- The same applies when the desired value already matches and no write is needed: a phase can leave `prepared` only when the gate is not `NONE`.

Therefore a throttle in admission, in `observe`, or in the metafield reads leaves the gate `NONE`. That was the #466 motivating case, and it stays provable. The cost is one extra `advance` round per publish (three metafield reads and an admission observe). The publish loop in `merchant-config.ts` already treats `PENDING` while `HELD` as "advance again without re-running activation". The repeated `prepared:HELD` token occurs at most once, below the loop's `unchanged >= 2` stop.

The gate update locks the activation row `FOR SHARE` through the trigger (§3.4). The transaction already holds the shop lock, so this follows the canonical order.

### 2.3 Eligibility rule

All of the following must hold, read under the fence locks:

| # | Fact | Source |
|---|---|---|
| E1 | `remote_dispatch = 'NONE'` | progress |
| E2 | `phase = 'prepared'` | progress |
| E3 | `status = 'requested'` and `operation_sequence = product_configs.publication_sequence` | operation, config |
| E4 | The operation's installation generation is the shop's current, active generation | shops, installation |
| E5 | `kind = 'HELD'`, `evidence_digest IS NULL`, `resolution_digest IS NULL` | activation |
| E6 | The hold is v3 for this operation, `availabilityV3OwnedHeld(hold)`, and has no `restorationClaim` or `restorationReceipt` | activation hold JSON |
| E7 | Quiet: `clock_timestamp() - greatest(o.requested_at, p.updated_at, a.updated_at) >= ABANDON_AFTER` | database clock |
| E8 | A fresh product observation in T1 equals the owned `held` snapshot (`observe()` returns `HELD`) | Shopify, read only |

E7 avoids cutting off a live publish; the fence (§4) is the safety mechanism. E8 makes a throttle or outage a `SKIP` before anything is claimed (§4.4).

Not eligible, and what happens once quiet:

| Case | Outcome |
|---|---|
| `HELD` with gate `OPENED` or `UNKNOWN` | Flag: `→ OPERATOR_HOLD`, reason `dispatch_possible` / `dispatch_unknown` |
| `WAITING_RELEASE` carrying an owned held receipt. This arises from `HELD → WAITING_RELEASE` at phase `activation-pending`, so the gate is always `OPENED`. | Flag: `→ OPERATOR_HOLD`, reason `release_wait_after_writes` |
| `ACQUISITION_PENDING` | Flag: `→ OPERATOR_HOLD`, reason `acquisition_unsettled` |
| `HELD` failing E6 (legacy hold version, no owned receipt) | Flag: reason `hold_not_owned` |
| E8 observation throttled or failed | `SKIP` (no change; next pass) |
| E8 observation is a definite conflict (product changed by someone else) | Flag: reason `product_changed` |
| Installation changed, operation superseded | The existing activation fence already records `OPERATOR_HOLD`; B does nothing |
| `OPERATOR_HOLD` (any cause) | B does nothing; part A only |
| `HOLD_INTENT`, `WAITING_HOLD`, `WAITING_RELEASE` without a hold (product never changed), stuck same-mode publishes | B does nothing; see Q4 |
| Activated operations (`RESTORATION_*`) | Out of scope; existing restoration path |

Flag reasons go to the warn log line and the audit row's `event`/`detail`. No hold JSON key is added for them.

## 3. States and transitions

### 3.1 Activation state (`m5_activation_state.kind`)

New values: `ABANDON_CLAIMED`, and `ABANDON_RESTORED` (terminal). "Needs operator" reuses `OPERATOR_HOLD`; part A adds no state.

| From | To | Who | Trigger-enforced precondition |
|---|---|---|---|
| `HELD` | `ABANDON_CLAIMED` | worker | E1–E6 on the current rows; `hold.abandonmentClaim.authority = 'PROVED_NOT_DISPATCHED'`; `hold.restorationClaim` added in the same update |
| `OPERATOR_HOLD` | `ABANDON_CLAIMED` | part A only | `current_user` is the schema owner, i.e. the update runs inside the operator `SECURITY DEFINER` function (§9). E2–E4 and E6 hold, with no earlier restoration claim or receipt; `abandonmentClaim.authority = 'SETTLED_BY_TRUSTED_OPERATOR'` with `commandKey` and `inspectDigest` |
| `ABANDON_CLAIMED` | `ABANDON_CLAIMED` | worker / A | Only to add `restorationReceipt`, or to consume a `NOT_DISPATCHED` receipt digest once (migration-51 rule, extended to this kind; §4.5) |
| `ABANDON_CLAIMED` | `ABANDON_RESTORED` | worker / A | `restorationReceipt.kind = 'RESTORED'`, `m5_v3_same(receipt.current, hold.before)` and a qualified acknowledgement (or `before` already `unavailable`) |
| `ABANDON_CLAIMED` | `OPERATOR_HOLD` | worker / A | A receipt other than `RESTORED`/`NOT_DISPATCHED`, a pre-dispatch recheck failure in T2, or a stale claim (§4.5) |
| `HELD`, `WAITING_RELEASE`, `ACQUISITION_PENDING` | `OPERATOR_HOLD` | worker | Already allowed (any → `OPERATOR_HOLD`) |
| `ABANDON_RESTORED` | anything | — | Rejected |

Unchanged: every existing transition, the claim and receipt immutability of the v3 audit trigger, and `OPERATOR_HOLD → RESTORED | RESOLVED` with a resolution row (part A's observation-only path).

Hold JSON, validated by an extended `m5_v3_hold` (copy-then-wrap, as migration 51 did). Each key is immutable once written:
- `abandonmentClaim` (new): `{ version: 'm5-publication-abandonment-claim-v1', operationId, scope, productId, authority, quietSince, claimedAt, commandKey?, inspectDigest? }`. Appears only on `→ ABANDON_CLAIMED`.
- `restorationClaim` (existing shape): the adapter's `restore()` requires it. Its appearance is now also allowed on `→ ABANDON_CLAIMED`.
- `restorationReceipt` (existing shape): now also allowed when `OLD.kind = 'ABANDON_CLAIMED'`.

The existing check that `RESTORATION_*`/`RESTORED` require `evidence_digest` stays. Both new kinds require `evidence_digest IS NULL` and `hold IS NOT NULL`.

### 3.2 Publication progress and operation while abandoning

New progress phase `abandoned` (terminal) and the `remote_dispatch` column (§2).

| Row | Transition | Precondition (trigger) |
|---|---|---|
| progress | any phase change out of `prepared` | `remote_dispatch <> 'NONE'` (so `UNKNOWN` rows from old code and rows already in flight still advance) |
| progress | `remote_dispatch NONE → OPENED` | same-mode operation (`prior_mode IS NOT NULL AND prior_mode = mode`), or activation `kind = 'HELD'` |
| progress | any other `remote_dispatch` change | rejected |
| progress, operation | any update while activation is `ABANDON_CLAIMED` | rejected. This freezes the rows against signing-provision drift writing `operator-hold`, `request()` superseding, and every other path. |
| progress | `prepared → abandoned` | activation `ABANDON_RESTORED` |
| operation | `requested → failed`, `failure_class = 'publication-abandoned'`, `availability_resolved_at` set in the same update | activation `ABANDON_RESTORED`; `availability_resolved_at = restorationReceipt.current.observedAt` |
| progress, operation | any other update while activation is `ABANDON_RESTORED` and the phase is not yet `abandoned` | rejected |
| progress | `abandoned →` anything | rejected |

`enforce_availability_resolution_marker` is extended to accept that `ABANDON_RESTORED` binding as an alternative to its existing `RESOLVED` resolution binding.

### 3.3 Visibility after restore (the resolve-path choice)

After restore, the abandoned operation leaves every "current publication" read, exactly as an operator resolution does today: T3 sets `availability_resolved_at` and deletes `m5_current_publication_pointer` (same statement as `availability-recovery.ts`). The other choice was keeping it visible and teaching each consumer about `abandoned`. That needs more edits in more places, so this design takes the resolve path.

Every predicate that names terminal activation kinds or terminal phases, and what changes:

| Location | Today | Change |
|---|---|---|
| `merchant-config.ts` `publicationSettled` (~50; used ~824, ~968) | phase `active` and kind `RESTORED`/null | None. The abandoned operation is invisible after T3; while `ABANDON_CLAIMED`, "in progress" is correct. |
| `merchant-config.ts` early-return phase list (~1062), new-revision conflict check (~1056) | `active`, `activation-pending`, `conflict`, `operator-hold` | None, for the same reason. The publish loop stops on the new `ABANDONED` results (§4.6). |
| `activation-state.ts` projection (~15) | `failed` → `FAILED` / `OPERATOR_HOLD` | `ABANDON_CLAIMED` → `ABANDONMENT_RESTORING`, before the `failed` branch; new inputs `abandonedLatest` and `holdPresent` (§7) |
| `durable-core.ts` `availabilityRecovery` (~415) | `kind NOT IN ('RESTORED','RESOLVED')` | add `ABANDON_RESTORED` |
| `production-publication.ts` `prepare` unresolved hold (~352) | same list | add `ABANDON_RESTORED` |
| `production-publication.ts` `prepare` gap check (~281) | `failed`/`superseded` + `availability_resolved_at` + `RESOLVED` + resolution digest | also accept `failed` + `availability_resolved_at` + `ABANDON_RESTORED` |
| `repositories/activation.ts` fence `catch` (~321) | rewrites to `OPERATOR_HOLD` unless `RESTORED`, `RESOLVED`, `OPERATOR_HOLD` | also exclude `ABANDON_CLAIMED`, `ABANDON_RESTORED` |
| `application/.../activation.ts` legacy-hold check (~414) | `!['RESTORED','RESOLVED'].includes(kind)` | Unreachable for the new kinds (§4.6 short-circuit precedes it); add `ABANDON_RESTORED` anyway |
| Partial index `m5_activation_unresolved_hold` | `kind NOT IN ('RESTORED','RESOLVED')` | add `ABANDON_RESTORED` |

### 3.4 Cross-row trigger reads and lock order

Two transitions read the other row, and only these. The rule is attached through `WHEN` clauses on the specific old/new values, so no other update pays for it or takes the extra lock:
- progress `remote_dispatch NONE → OPENED` reads the activation row `FOR SHARE`;
- activation `→ ABANDON_CLAIMED` and the freeze rule read progress and operation `FOR SHARE`.

Canonical order: `shops` → installation → `product_configs` → `publication_operations` → `m4_publication_progress` → `m5_activation_state`.
- The gate update runs in `advance`, which holds the shop lock, locks progress, then the trigger takes activation `FOR SHARE`. That is in order.
- The worker's T1 and T2, and part A, lock all six `FOR UPDATE` in order before any update. The trigger's `FOR SHARE` reads are then already covered.
- The existing fence `catch` updates activation to `OPERATOR_HOLD` without the shop lock. That transition has no cross-row read, so it holds only the activation row and cannot wait on progress. A concurrent gate update holding progress and waiting for activation `FOR SHARE` simply waits for it to commit. No cycle.
- Any other writer that updates progress or operation while abandonment holds the activation row waits; after the claim commits, the freeze rule rejects it.

### 3.5 Audit and archival

New append-only table `m5_publication_abandonment_audit`: `shop_id, config_id, operation_id, activation_version, event, from_kind, to_kind, hold jsonb, detail jsonb, created_at`, with primary key `(shop_id, config_id, operation_id, activation_version)`. `activation_version` is the activation row's new `version`, which advances by exactly one on every update, so two `FLAGGED` events for one operation never collide. `event IN ('CLAIMED','RECEIPT','RESTORED','FLAGGED')`. The existing `m5_restoration_no_dispatch_consumptions` table keeps recording digest consumption.

Rows are written only by the `SECURITY DEFINER` activation audit trigger; runtime roles get no DML. `UPDATE`/`DELETE` are rejected, RLS is enabled and `PUBLIC` has no access. `detail` holds bounded reason codes; the worker passes them in the update as a transaction-local setting the trigger reads. They are diagnostic only, never authority. Retention follows `publication_operations`.

### 3.6 Application transition functions

Pure functions in `packages/application/src/publication/abandonment.ts`:

```
decideAbandonment({ candidate, progress, operation, configSequence, observation, now, abandonAfterMs })
  → { kind: 'CLAIM', abandonmentClaim, restorationClaim } | { kind: 'FLAG', reasons } | { kind: 'SKIP', reason }
settleAbandonmentReceipt(hold, receipt, now, staleMs)
  → 'ABANDON_RESTORED' | 'OPERATOR_HOLD' | 'ABANDON_CLAIMED'
```

`settleAbandonmentReceipt` reuses the coordinator's acknowledgement qualification. That logic is extracted from `activation.ts` into one shared function, so restoration after activation and after abandonment judge a receipt identically. The triggers are the authority; tests compare these functions with the trigger tables row by row.

## 4. Fence

### 4.1 Lock order

Lock in the canonical order of §3.4, the same as `PgActivationStore.load` minus `signing_keys`. A subset in the same order cannot deadlock against the full order.

### 4.2 Sequence

```
worker pass (bounded: at most 2 claims and 20 s per pass; §6)
for each candidate (scan without locks):
  acquire the shop's offline token (outside locks)
  create a fresh availability port for this row only
  T1 BEGIN; lock six rows FOR UPDATE
    re-read E1-E7
    observe(scope, hold) under the lock (read only) = E8      -> throttle: ROLLBACK, SKIP
    decideAbandonment()
      FLAG  -> kind=OPERATOR_HOLD                           (audit FLAGGED; warn log)
      CLAIM -> kind=ABANDON_CLAIMED + abandonmentClaim + restorationClaim
               (trigger: gate NONE, phase prepared, ...; audit CLAIMED)
  T1 COMMIT                                               no Shopify write yet
  T2 BEGIN; lock six rows FOR UPDATE
    require ABANDON_CLAIMED, this invocation's claim, no receipt (or a consumed NOT_DISPATCHED one),
      progress phase prepared and gate NONE, operation requested and current, installation current
      -> any mismatch: kind=OPERATOR_HOLD (reason claim_fenced), no dispatch
    restore(scope, hold, expected = hold.held, beforeSend)  -> read; status-only write; read back
    UPDATE activation: restorationReceipt; then kind by settleAbandonmentReceipt()
      RESTORED                     -> ABANDON_RESTORED    (audit RECEIPT, RESTORED)
      NOT_DISPATCHED               -> stay ABANDON_CLAIMED (rearm on a later pass, §4.5)
      PENDING/CONFLICT/REHELD      -> OPERATOR_HOLD       (never retried)
  T2 COMMIT
  T3 (idempotent; also picked up by later scans of ABANDON_RESTORED rows not yet finalized)
    lock six rows; if kind=ABANDON_RESTORED and phase=prepared:
      progress phase=abandoned
      operation status=failed, failure_class='publication-abandoned', availability_resolved_at
      DELETE m5_current_publication_pointer (as availability-recovery.ts)
  T3 COMMIT
```

The provider write happens only in T2, after T1 committed the one-use claim. This is the pattern of the existing `RESTORATION_PENDING → RESTORATION_CLAIMED` path. T2 commits the receipt and the kind together, so no later update can roll back a dispatched outcome. The freeze rule (§3.2) guarantees that T3's updates are allowed whenever T2 succeeded.

### 4.3 What each racer sees

| Racer | Arrives | Result |
|---|---|---|
| Merchant publish request (journal "Continue" or another tab) | During T1/T2/T3 | Blocks on the shop lock. Afterwards `publication.advance` and `activation.advance` return `ABANDONED` before any fence or provider IO (§4.6). The gate stays `NONE`; no write. |
| Merchant publish request | Before T1 | It holds the locks; T1 waits, then E7 fails (fresh `updated_at`) → `SKIP`. If that request opened the gate, the operation is no longer eligible (flagged later only if it goes quiet again). |
| #452 resume path (activation re-observing after a throttled read) | After T1 | `ABANDONED` without observe. The fence `catch` no longer rewrites `ABANDON_*` to `OPERATOR_HOLD`. |
| Signing provisioning or emergency revoke (key or epoch drift) | While `ABANDON_CLAIMED` | Changes to keys and shop config proceed. `publication.advance` short-circuits before its `current()`/`hold()` drift handling, and the freeze rule rejects any progress/operation write. |
| Reinstall | Any time | T2's pre-dispatch recheck fails E4 → `OPERATOR_HOLD` (`claim_fenced`), no dispatch. After `ABANDON_RESTORED`, T3 only touches rows of that operation and is allowed by the freeze rule. |
| Late field write from a process that died | — | Impossible for an eligible row: every field write needs `OPENED`, which makes the row ineligible forever. |
| Second worker instance | Concurrent T1 | Serialized by the locks; the second sees `ABANDON_CLAIMED` → `SKIP`. |
| New publication `prepare()` | While `ABANDON_CLAIMED` | Refused by the unresolved-hold check |

### 4.4 Throttling and port quarantine

- **One port per claimed row.** The v3 adapter quarantines itself after any budget expiry and refuses all later calls. A per-row port keeps one timeout from poisoning the rest of the pass. Replay protection for the same operation remains the database claim.
- **E8 in T1:** a throttled or failed observation is a `SKIP` before any claim, so the common throttle case never reaches `OPERATOR_HOLD`.
- **Pre-write read failure in `restore()`:** today it throws from outside the adapter's `try`. The adapter change: catch a provider failure of the pre-write read and return `{ kind: 'NOT_DISPATCHED', current: null }`. No mutation fetch was started, so this is proved non-dispatch. Any throw after the mutation call still becomes `RESTORATION_PENDING` as today.

### 4.5 Ambiguous restore, rearm and stale claims

- `NOT_DISPATCHED`: the receipt is stored and the row stays `ABANDON_CLAIMED`. On a later pass, T2 may rearm by consuming that receipt's digest into the claim (migration-51 rule, extended to `ABANDON_CLAIMED`). For this kind the rearm also accepts `current = null`, because `restore()` re-reads and requires the owned `held` snapshot before any write. Each receipt is consumed once. There is no cap on proven non-dispatches: each retry is safe and happens at most once per pass.
- `RESTORATION_PENDING`, `CONFLICT`, `REHELD_CONFLICT`: the row goes to `OPERATOR_HOLD` and is never retried. Part A resolves it by observation only (§9).
- **Stale claim:** after `ABANDON_CLAIM_STALE_MS` (default 2 minutes; above the 8 s adapter budget plus lock waits) the worker moves `ABANDON_CLAIMED` to `OPERATOR_HOLD` with reason `claim_unsettled` in either case:
  - there is no receipt;
  - the receipt is a `NOT_DISPATCHED` whose digest is already consumed into the claim (`settledNoDispatchReceiptDigest` equals it) and no newer receipt exists. A crash after consumption may have dispatched.

  "Stale" is measured from the activation row's `updated_at`; consumption updates it.

### 4.6 `ABANDONED` short-circuits, ahead of every fence

- `PgActivationStore.load`: right after locking `publication_operations` and `m4_publication_progress`, and before the status, phase, projection and key checks (which throw for `failed`), read the activation `kind` with a plain SELECT. It is stable, because `ABANDON_*` is entered only under the shop lock that `load` already holds. If it is `ABANDON_*` or the phase is `abandoned`, throw `PublicationAbandoned`. Both coordinator `locked` blocks go through `load`, so both are covered, and both also run before `classifyPublicationAdmission`, which throws on `abandoned`.
- The coordinator maps `PublicationAbandoned` to a new `ActivationResult.kind = 'ABANDONED'`. The fence `catch` does not run for it.
- `PgProductionPublication.advance`: right after the shop lock and `load`, before `resolved`, `current()` and `hold()`, return `{ kind: 'ABANDONED', phase }` when the activation kind is `ABANDON_*` or the phase is `abandoned`.
- `merchant-config.ts`: the publish loop breaks on either `ABANDONED` and returns the projected state.

## 5. Restore effect

`ProductAvailabilityHoldV3Port.restore()` is reused, with only the §4.4 pre-write read change:
- It reads the product and requires it to equal the owned `held` snapshot exactly and to be held-safe; otherwise it returns `CONFLICT` with no write.
- It sends one status-only update to `before.state`, then requires a qualified acknowledgement plus an exact readback of `before` (effective publication IDs, online-store presence, anchors; diagnostic timestamps ignored).
- On a settled semantic mismatch it uses the one reserved compensating re-hold, then stops.

`beforeSend` is synchronous and does no IO. It requires that the T2 transaction is still open and owns the claim, that the installation scope locked in T2 equals the claim's, and that the offline token expires more than 30 s later. Function release and projection readiness are not required: the product returns to its prior state under the prior effective policy, which was live before the publish.

**Offline token.** It is acquired for the shop before T2 (the facade forbids re-entering `core.credentials.acquire` under the shop lock) and handed to a credential port that returns only that token. That port and its availability port exist only inside the abandonment job (and part A's command) and expose only `observe` and `restore`. Scopes are unchanged (`write_products`).

## 6. Worker job

- **Where:** a new pass in the existing 30-second reconciliation loop (`apps/worker/src/reconciliation.ts`), error class `PUBLICATION_ABANDONMENT_UNAVAILABLE`. No pg-boss queue.
- **Bounded pass:** at most 2 claims (T1 → T2 → T3) and a 20-second budget per pass, so restores never starve the other recovery passes. The pass also finalizes up to 10 pending T3s and flags up to 10 rows; neither of those calls Shopify except for E8. Flagging needs no observation.
- **Scan:** `kind IN ('HELD','WAITING_RELEASE','ACQUISITION_PENDING','ABANDON_CLAIMED','ABANDON_RESTORED')` with `hold IS NOT NULL`, current installation, quiet or stale or not finalized, ordered by `updated_at`. The partial index `m5_activation_unresolved_hold` covers it.
- **Bound:** `INSIGNIA_PUBLICATION_ABANDON_AFTER_MS`, default 900000 (15 min), accepted range 5 minutes to 24 hours; anything else is a startup error.
- **Switch:** `INSIGNIA_PUBLICATION_ABANDONMENT=off|flag|restore`, default `off`. `flag` records only `OPERATOR_HOLD` flags; `restore` also claims and restores.
- **Idempotency:** one-use claim, immutable receipt, terminal kinds and the idempotent T3.
- **Logging:** a `publication_abandonment` event with internal `shopId`, `configId`, `operationId`, `outcome` (`restored | flagged | not_dispatched | ambiguous | conflict | skipped | finalized`) and `reasons`. `restored`/`finalized` log at info; `flagged`, `ambiguous` and `conflict` at **warn**. No product titles, tokens or provider bodies.
- **Metrics:** counter `insignia_publication_abandonment_total{outcome}` (bounded labels, no shop label) and gauge `insignia_publication_holds_flagged`. Alerting is phase 5.
- **Failures:** a database or credential failure before T2's dispatch changes nothing (next pass). A credential that is `reauth_required` or `inactive` is a `SKIP` with a warn line; nothing is known about the product. A provider failure after dispatch is never retried (§4.5).

## 7. Merchant UI

### 7.1 State machine

`projectActivationPublicationState` remains the single owner of `PublicationState`. Three new values:

| Condition (server) | `PublicationState` | Classifier (`publication-state.ts`) |
|---|---|---|
| current operation's activation `ABANDON_CLAIMED` | `ABANDONMENT_RESTORING` | continuing: blocks Publish, keeps polling |
| `abandonedLatest`: the config's newest operation (`operation_sequence = product_configs.publication_sequence`, current generation) has activation `ABANDON_RESTORED` | `ABANDONED_RESTORED` | settled: Publish allowed; a journaled publish request settles (cleared) as for `FAILED` |
| activation `OPERATOR_HOLD`, operation not activated, `holdPresent` (`hold IS NOT NULL`); also a hold on another operation of this config | `HOLD_NEEDS_SUPPORT` | operator-blocked |

`OPERATOR_HOLD`, `CONFLICT` and `RESTORATION_CONFLICT` keep their meaning for every other case, so the support copy is never shown where Insignia holds nothing (for example a `phase = 'operator-hold'` field conflict without a hold).

`abandonedLatest` comes from one query beside `getCurrentPublication` (a derived input, not a stored flag). The next publication increments `publication_sequence`, which ends it. `holdPresent` is one more column on the existing current-publication query. The new cases are evaluated before the existing `operationStatus === 'failed'` branch.

Client: one pure function next to the classifier, `publicationNotice(state) → { key, tone, actions }`. `SelectedProductContainer` uses it for publication states instead of the inline ternary. The local `remote` state remains this client's own write state; `publicationFailed`, `publicationNeedsReview` and `publicationProgressing` are derived from `PublicationState` as today. The English server `publication.reason` is not shown for the three new states.

The products-list badge is deferred: the editor carries the message.

### 7.2 Copy (draft, for translation review)

Register follows each catalogue: Dutch *je*, German *Sie*, French *vous*, Spanish *tú*, Italian informal.

`editor:placementWorkflowPreview.publicationAbandonedRestored`
- en: Publishing didn't finish, so your product is back as it was. Publish again when you're ready.
- nl: Het publiceren is niet afgerond, dus je product staat weer zoals het was. Publiceer opnieuw wanneer je klaar bent.
- de: Die Veröffentlichung wurde nicht abgeschlossen, daher ist Ihr Produkt wieder wie vorher. Veröffentlichen Sie erneut, sobald Sie bereit sind.
- fr: La publication n’a pas abouti : votre produit est revenu à son état précédent. Publiez à nouveau quand vous êtes prêt.
- es: La publicación no se completó, así que tu producto ha vuelto a como estaba. Publica de nuevo cuando quieras.
- it: La pubblicazione non è stata completata, quindi il prodotto è tornato com’era. Pubblica di nuovo quando vuoi.

`editor:placementWorkflowPreview.publicationAbandonmentRestoring`
- en: Publishing didn't finish. Insignia is putting your product back as it was; this page updates when it's done.
- nl: Het publiceren is niet afgerond. Insignia zet je product terug zoals het was; deze pagina wordt bijgewerkt zodra dat klaar is.
- de: Die Veröffentlichung wurde nicht abgeschlossen. Insignia stellt Ihr Produkt wieder so her, wie es war; diese Seite wird aktualisiert, sobald das erledigt ist.
- fr: La publication n’a pas abouti. Insignia remet votre produit dans son état précédent ; cette page se met à jour une fois l’opération terminée.
- es: La publicación no se completó. Insignia está devolviendo tu producto a como estaba; esta página se actualizará cuando termine.
- it: La pubblicazione non è stata completata. Insignia sta ripristinando il prodotto com’era; questa pagina si aggiornerà al termine.

`editor:placementWorkflowPreview.publicationHoldNeedsSupport`
- en: Publishing didn't finish and this product may be unavailable in your store. Insignia support has to check it before it can be restored. Contact support and mention this product.
- nl: Het publiceren is niet afgerond en dit product is mogelijk niet beschikbaar in je winkel. Insignia-support moet het controleren voordat het kan worden hersteld. Neem contact op met support en vermeld dit product.
- de: Die Veröffentlichung wurde nicht abgeschlossen, und dieses Produkt ist in Ihrem Shop möglicherweise nicht verfügbar. Der Insignia-Support muss es prüfen, bevor es wiederhergestellt werden kann. Wenden Sie sich an den Support und nennen Sie dieses Produkt.
- fr: La publication n’a pas abouti et ce produit est peut-être indisponible dans votre boutique. Le support Insignia doit le vérifier avant de pouvoir le rétablir. Contactez le support en indiquant ce produit.
- es: La publicación no se completó y es posible que este producto no esté disponible en tu tienda. El soporte de Insignia tiene que revisarlo antes de poder restaurarlo. Contacta con soporte e indica este producto.
- it: La pubblicazione non è stata completata e questo prodotto potrebbe non essere disponibile nel tuo negozio. L’assistenza Insignia deve verificarlo prima di poterlo ripristinare. Contatta l’assistenza indicando questo prodotto.

## 8. Test plan (real seams)

Database (isolated PostgreSQL 18, real migrations and triggers):
1. Trigger tables §3.1 and §3.2: every allowed and rejected row. This includes:
   - `HELD → ABANDON_CLAIMED` with gate `OPENED`/`UNKNOWN`;
   - `OPERATOR_HOLD → ABANDON_CLAIMED` as the worker role (rejected) and through the operator function (allowed);
   - gate `NONE → OPENED` while `ABANDON_CLAIMED`;
   - a phase change out of `prepared` with `NONE` (rejected) and with `UNKNOWN` (allowed);
   - the freeze rule against a drift `operator-hold` write and a `request()` supersede;
   - `ABANDON_RESTORED → *`;
   - claim/receipt immutability;
   - two `FLAGGED` events for one operation (distinct audit rows);
   - audit and operator function inaccessible to runtime roles.
2. Defaults: an insert omitting `remote_dispatch` is `UNKNOWN`; the migration backfills `UNKNOWN`.
3. After T3: `getCurrentPublication` returns the prior effective operation (or none); `availabilityRecovery` returns null; `prepare()` succeeds for a first publication and for a mode change with an earlier effective operation (gap check).

Concurrency (two real connections, gated fake Shopify):

4. Merchant retry against worker claim, both orders. Worker first: the merchant's `advance` returns `ABANDONED`, the gate stays `NONE`, zero field writes. Merchant gate first: the worker `SKIP`s or `FLAG`s, zero restores.
5. Late completion: a merchant `advance` blocked inside a gated `remote.set` holds the shop lock; T1 waits, then sees `OPENED` and never restores.
6. #452 resume after T1 → `ABANDONED`, no observe, kind unchanged.
7. Signing provisioning bumps the epoch while `ABANDON_CLAIMED`: T2 and T3 still commit; `publication.advance` returns `ABANDONED`; no `operator-hold` write.
8. Two worker instances: one claim, one restore.
9. Crash injection: kill T2 after the adapter's fetch began → claim without receipt → `OPERATOR_HOLD` after the stale bound, never a second restore. Same after a consumed `NOT_DISPATCHED` digest.
10. Gate opening inside `advance`: admission throttled, `observe` throttled and a metafield read throttled each leave `NONE`. The first passing `advance` sets `OPENED` and writes nothing; the next one writes.
11. Composition test: count every `remote.set` and `availability.restore` dispatch through the real production composition; any field dispatch while the stored gate is `NONE` fails the test.

Application/adapter:

12. `decideAbandonment` and `settleAbandonmentReceipt` truth tables against the trigger tables; the shared acknowledgement qualification is used by both coordinators.
13. Adapter `restore()` with a fake Shopify: `RESTORED`, `NOT_DISPATCHED` from a throttled pre-write read (`current: null`), `RESTORATION_PENDING` (timeout), `CONFLICT`, `REHELD_CONFLICT`. Per-row ports: a quarantined port does not affect the next row.

Web and UI:

14. Projection for all three new states, including that `failed` + `ABANDON_RESTORED` is not `OPERATOR_HOLD`, and that an `operator-hold` phase without a hold is not `HOLD_NEEDS_SUPPORT`.
15. Editor (built UI, browser suite): each banner and its actions; Publish enabled after `ABANDONED_RESTORED`; a journaled request settles on it; polling moves `ABANDONMENT_RESTORING → ABANDONED_RESTORED` without losing local edits; keyboard focus.
16. Localization: the keys exist in all six catalogues.

Native (rewrite-dev, test products only):

17. Publish a test product and stop the request after `HELD` (close the tab). With the bound temporarily at 5 minutes, confirm: the product returns to Active, the editor shows `ABANDONED_RESTORED`, and Publish works again.

## 9. Part A: operator command (built after B)

A server-only CLI in the worker image, run over SSH on the host. It adds no state and uses B's states, triggers and evaluator.

```
insignia-publication-hold inspect --shop <shopId> --config <configId>
insignia-publication-hold restore --shop <shopId> --config <configId> --operation <id> --inspect-digest <digest> --command-key <key> --confirm
insignia-publication-hold resolve --shop <shopId> --config <configId> --operation <id> --command-key <key> --confirm
```

- **`inspect`** (read-only) shows:
  - held since; activation kind and version; a hold summary (`before`/`held`, acknowledgement, claims, receipts); `remote_dispatch`; B's verdict and reasons;
  - a live Shopify read (offline token) of the product's availability and of `public_config`, `registration` and `policy`, each compared with the progress row's `prior_*_digest`;
  - "safe to restore: yes/no, because …";
  - an `inspectDigest` over (activation version, hold digest, live product snapshot digest, live field digests).
- **`restore`:**
  - Allowed only for `OPERATOR_HOLD` with an owned held receipt and no earlier restoration claim or receipt.
  - Recomputes the digest and **hard-refuses** if it differs from the given `--inspect-digest`, if the activation version moved, if the inspect is older than 10 minutes, or if live `registration` or `policy` differs from the prior digests.
  - Then calls `m5_operator_claim_abandoned_hold(...)`. This `SECURITY DEFINER` function is owned by the schema owner, and only the dedicated operator role can execute it (not web, not worker). It writes `OPERATOR_HOLD → ABANDON_CLAIMED` with `SETTLED_BY_TRUSTED_OPERATOR`, the command key and the inspect digest.
  - Then runs B's T2 and T3 unchanged. Outcomes and states are B's.
- **`resolve`:** the existing observation-only path (`createAvailabilityRecovery` → `RESOLVED`). The CLI supplies the trusted authority port from the confirmed command. It is used when Shopify already shows the original state.
- **Audit:** every run, including `inspect`, writes one structured log line. `restore` and `resolve` are also recorded in the database (abandonment audit, resolution row). A command key is single-use per shop.
- **Runbook** (`deployment/m5-runtime/README.md`): when to use each subcommand and what "safe" means. For holds where product fields were already written (`registration` or `policy` differ from prior), `restore` refuses. The options are: the merchant continues the publish, or the owner restores the product by hand in Shopify admin and then runs `resolve`.
- **§6.1:** the spec covers this operator-authorized restore together with B's.

First use: `QA cover B – Tee` (`OPERATOR_HOLD`, gate `UNKNOWN`, first publication, so the prior field digests are null). If `inspect` shows `registration` and `policy` still absent, the owner can confirm `restore`.

## 10. Migration outline (migration 65)

Up, one transaction, through the guarded schema owner:
1. `m4_publication_progress`:
   - add `remote_dispatch text NOT NULL DEFAULT 'UNKNOWN' CHECK (remote_dispatch IN ('NONE','OPENED','UNKNOWN'))` (backfills `UNKNOWN`);
   - add `abandoned` to the phase check;
   - extend `enforce_m4_publication_progress` with §3.2.
2. `m5_activation_state`:
   - add `ABANDON_CLAIMED` and `ABANDON_RESTORED` with their checks;
   - rebuild `m5_activation_unresolved_hold` excluding `ABANDON_RESTORED`.
3. Triggers:
   - copy-then-wrap `m5_v3_hold` and `enforce_activation_v3_audit` (new keys, receipt and consumption on `ABANDON_CLAIMED`, `current = null` rearm for that kind);
   - replace `enforce_activation_state` with §3.1;
   - add the `WHEN`-scoped cross-row and freeze triggers (§3.2, §3.4) on progress and operations;
   - extend `enforce_publication_transition` and `enforce_availability_resolution_marker`.
4. Create `m5_publication_abandonment_audit` (RLS, revoke all, immutable).
5. Create the operator role (no login; granted to the owner's SSH-run command identity) and `m5_operator_claim_abandoned_hold`, executable only by it.
6. Grants: confirm the worker role has `SELECT, UPDATE` on `m5_activation_state`, `m4_publication_progress` and `publication_operations`, and `DELETE` on `m5_current_publication_pointer` (it may lack some today). Update the expected ACL digests in the deployment README.

Down: raises if any activation row has an `ABANDON_*` kind or an `abandonmentClaim`, any progress row is `abandoned`, or the audit table has rows. Otherwise it restores the copied functions and drops the column, phase, role, function and table.

## 11. Rollout and rollback on rewrite-dev

1. Apply migration 65. Deploy web (gate-aware `prepare`/`advance`, short-circuits, projection), then the worker with `INSIGNIA_PUBLICATION_ABANDONMENT=off`. Read back: new progress rows are `NONE`, existing rows are `UNKNOWN`. Rows already in flight with `UNKNOWN` still advance (the trigger allows `<> 'NONE'`).
2. Publish one test product to Active; confirm the gate went `NONE → OPENED` with one extra `advance` round and no other change.
3. Switch the worker to `flag`. It flags nothing on a healthy store and leaves `QA cover B – Tee` untouched.
4. Switch to `restore`; run native check 17 with a temporary 5-minute bound; restore the 15-minute default.
5. Rollback:
   - Set the worker to `off` **before** any web rollback. Older web code can advance a `NONE` row through `public_config` without opening the gate; the trigger rejects its phase change, but its fetch has already happened. With the worker off, nothing will restore that row.
   - After rolling web back, any rows left `NONE` by old code must stay out of B. Re-enabling B therefore requires redeploying gate-aware web and marking those rows `UNKNOWN` (a reviewed one-off statement through the schema owner).
   - After the first `ABANDON_*` row, recovery is fix-forward.

## 12. Open questions for the owner

Q1. **Time bound.** 15 minutes of no activity before the worker acts, configurable from 5 minutes to 24 hours. *Recommendation:* 15 minutes. No live publish (60 s client budget) is cut off, and the product is not offline for long.

Q2. **Copy.** The drafts in §7.2, especially "Contact support and mention this product", given that no alert reaches support automatically until phase 5. *Recommendation:* approve the English now; translations go through the translation review before release.

Q3. **Flagging ends merchant resume.** An unprovable `HELD` row becomes `OPERATOR_HOLD`. A merchant who returns later with the original request still journaled in the browser (up to 1 hour) can no longer continue it. *Recommendation:* accept. Keeping it `HELD` leaves today's "already in progress" dead end.

Q4. **Stale intents without product effect.** Operations stuck in `HOLD_INTENT`, `WAITING_HOLD` or `WAITING_RELEASE` without a hold (product never changed), and stuck same-mode publishes, also block the next publish. A `WAITING_RELEASE` row that carries an owned hold is not in this group: B flags it (§2.3). *Recommendation:* leave these out of B. A small follow-up can close them as `failed` with no Shopify call, using the same quiet bound and the same resolve-path visibility.

Q5. **Rollout.** Worker `off`, then `flag`, then `restore` (§11), with "worker off before any web rollback". *Recommendation:* yes.

Q6. **Simpler evidence rule: drop the dispatch gate?** The reviewer's proposal: eligibility = committed `phase = 'prepared'` + owned `HELD` (plus E3–E8), with no `remote_dispatch`. Analysis against the code:
- **What `prepared` proves.** No `registration` or `policy` write was dispatched; only the shop-level `public_config` write can have been sent (§1).
- **What `public_config` is.** The shop's key registry: `{generationHex, epoch, maxBuckets, maxPhysicalQuantity, allowNoMarket, keys[]}`, built by `buildPublicConfig` from the database keys at `prepare()`. `advance` sends it only after `current()` confirms that the database still has the same generation, epoch and keys. The signing provisioning and emergency routes write the same field with the same builder. The value an abandoned operation can write is therefore the registry the database already considers current, not anything specific to the new revision.
- **No rollback of a newer registry.** The write is a compare-and-set on `prior_public_config_digest` captured at `prepare()`. If a rotation or revoke wrote a newer registry since, a late landing fails the compare and changes nothing.
- **What the Functions read.** Cart Transform and validation decide a plain (unsigned) line only from the product's own `registration` and `policy` fields and the registry's `generationHex` (`product_policy::classify`). An abandoned `prepared` operation has not touched those product fields. Its registry has the same authorization generation as the product's existing fields: `prepare()` refuses anchors of another generation. So the restored product keeps exactly its prior classification. Absent fields stay `Unmanaged` (plain allowed, as before the publish); `ready:required` stays `Required` (plain rejected). The registry cannot make an unsigned line acceptable, because plain acceptance never depends on keys. It can only change which signed offers verify.
- **Do prior keys stay listed?** The registry lists every non-destroyed key (at most four), including retiring and revoked ones with their windows. Existing offers verify exactly as they would under any other current publication. The only keys dropped are destroyed keys whose window closed, which admit nothing.
- **Residual difference.** A landed `public_config` may publish a newer registry earlier than the next signing or publication run would have, for example a pending key becoming visible. That is the intended steady state, not a hazard.

*Consequences.*
- **Yes:** remove §2 (gate), the gate rows of §3.2, review items H1/H3 and migration step 1. The extra `advance` round disappears and rollback needs no gate caveat. More holds qualify: any `prepared` + owned `HELD` row, including ones written before migration 65. Part A's `inspect` still shows `public_config` for information.
- **No:** keep the gate as designed. Only operations whose gate stayed `NONE` qualify; pre-migration rows and rows where a `public_config` write may have started go to the operator.

*Recommendation:* **yes**. The analysis shows a landed `public_config` cannot change the restored product's plain or signed decision or roll back keys. This removes the largest moving part of B. It differs from the owner's original wording ("no … shop-config write"), so it needs an explicit owner decision. Until then this document specifies the gate.

Needs owner approval before implementation.
