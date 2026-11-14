# Design: automatic release of an abandoned publication hold (#466 part B)

Status: design for #466 part B, revised after two independent reviews of PR #471. The owner's decisions of 14 November 2026 are recorded in §12. No runtime code exists yet. The requirement text is in the [specification](implementation-plan.md) (§3.1, §6.1, §6.2, §7.2, §10.1, §10.3, §11, §13.1, §13.2). This document holds the mechanism, state tables, fence sequence, UI states, test plan, migration outline and the interface for part A.

What B does: when a publish is abandoned after Insignia took the availability hold, the system heals itself. After 10 minutes with no publish activity, if durable records prove that no product policy or registration write was dispatched for that operation and Insignia owns the hold receipt, the worker restores the product's prior availability exactly as held. It marks the publication failed, and the merchant sees "Publishing didn't finish; your product is back as it was. Publish again." A shop-wide `public_config` write may have been dispatched; the restore neither touches nor depends on it (§2.2). Cases that cannot be proven safe stay held. They are logged at warn and left for the owner-run operator command (part A); the editor shows a support message. Every new state and transition is an explicit state machine: database states with trigger-enforced transitions, one application transition function, and the admin UI state through the existing server projection and client classifier.

## 1. Problem and evidence

A first publication or mode change takes an availability hold before it writes any Shopify field: the product goes to DRAFT (`m5_activation_state.kind = HELD`, owned `held` receipt). Then `PgProductionPublication.advance` writes, in order: `public_config` (shop), `registration` pending (product), `policy` (product) and `registration` ready (product). Activation then commits evidence and restores the product. Each write runs inside an `advance` transaction that holds `FOR UPDATE` on `shops`, the installation and `product_configs`. The phase moves only after an exact readback, in that same transaction.

If the merchant's request stops after the hold and before activation (closed tab, lost response, Shopify throttling), nothing continues the operation. The product stays DRAFT, `prepare()` refuses any new publication, and the editor shows "Publication requires operator review" with no next step. Operator recovery is not wired (#466).

Live example (rewrite-dev, read-only SELECT, 14 November): operation `43db577d-…` (`QA cover B – Tee`):
- `publication_operations.status = requested`;
- progress `phase = prepared`, `version = 0`, `retry_count = 0`, `last_observed IS NULL`;
- activation `OPERATOR_HOLD` (version 5), with `before` ACTIVE (`available`), an owned `held` DRAFT and a qualified acquisition acknowledgement;
- `mode = required`, `prior_mode = NULL` (first publication).

Its facts meet B's evidence rule (committed `prepared`, owned held receipt). B still does not touch it, because B acts only on `HELD` and this row is already `OPERATOR_HOLD`. **Part A handles it** (§9). Its `inspect` should report "safe to restore" if live `registration` and `policy` are still absent.

## 2. Evidence rule

### 2.1 What a committed `prepared` proves

Product-level `registration` and `policy` are written only by an `advance` transaction that read a committed phase past `prepared` (`shop-config-written` or later). The progress trigger never moves a phase backwards. A committed `phase = 'prepared'` therefore proves that neither product field write was dispatched for the operation. That holds even if a process died mid-fetch, because the only fetch possible from `prepared` is `public_config`.

`retry_count`, `version` and `last_observed` are written in the same transaction as the phase and add nothing. `ACQUISITION_PENDING` never qualifies: the status mutation may be in flight, and there is no owned snapshot to restore against.

### 2.2 Why a possible `public_config` write does not matter

The only write that can have been dispatched from `prepared` is the shop-wide `public_config`.
- **The restore never touches it.** `public_config` is shop-wide, so its state is identical immediately before and after the restore. The restore cannot make it any more or less safe than it already is for every other product of the shop. This is the reviewer's main argument and the deciding one.
- **It is the current registry, not revision-specific.** The value is `{generationHex, epoch, maxBuckets, maxPhysicalQuantity, allowNoMarket, keys[]}`, built by `buildPublicConfig` from the database keys at `prepare()`. `advance` sends it only after `current()` confirms that the database still has the same generation, epoch and keys. The signing provisioning and emergency routes write the same field with the same builder.
- **It cannot roll back a newer registry.** The write is a compare-and-set on `prior_public_config_digest`. If a rotation or revoke wrote a newer registry since, a late landing fails the compare.
- **It cannot change the restored product's behavior.** Cart Transform and validation decide a plain (unsigned) line only from the product's own `registration` and `policy` fields and the registry's `generationHex` (`product_policy::classify`). Those product fields are unchanged (§2.1). `prepare()` refuses anchors of another authorization generation, so the generation matches the product's existing fields. Absent fields stay `Unmanaged` (plain allowed, as before the publish); `ready:required` stays `Required` (plain rejected). Plain acceptance never depends on keys.
- **Prior keys stay listed.** The registry lists every non-destroyed key (at most four), including retiring and revoked ones with their windows. The only keys omitted are destroyed keys whose window closed, which admit nothing.

The independent reviewer verified these points in the code.

### 2.3 Eligibility rule

All of the following must hold, read under the six-row lock (§4.1):

| # | Fact | Source |
|---|---|---|
| P1 | committed `phase = 'prepared'` | progress |
| E3 | `status = 'requested'` and `operation_sequence = product_configs.publication_sequence` | operation, config |
| E4 | The operation's installation generation is the shop's current, active generation | shops, installation |
| E5 | `kind = 'HELD'`, `evidence_digest IS NULL`, `resolution_digest IS NULL` | activation |
| E6 | The hold is v3 for this operation, `availabilityV3OwnedHeld(hold)`, and has no `restorationClaim` or `restorationReceipt` | activation hold JSON |
| E7 | Quiet: `clock_timestamp() - greatest(o.requested_at, p.updated_at, a.updated_at) >= ABANDON_AFTER` (default 10 minutes) | database clock |
| E8 | A fresh product observation in T1 equals the owned `held` snapshot (`observe()` returns `HELD`) | Shopify, read only |

E7 only avoids cutting off a live publish; the fence (§4) is the safety mechanism. E8 turns a throttle or outage into a `SKIP` before anything is claimed (§4.4).

Not eligible, and what happens once quiet:

| Case | Outcome |
|---|---|
| `HELD` past `prepared` (product fields may have been written) | Flag: `→ OPERATOR_HOLD`, reason `fields_written` |
| `WAITING_RELEASE` carrying an owned held receipt. This arises from `HELD → WAITING_RELEASE` at phase `activation-pending`. It can be a legitimate wait for a Function release deploy. | Flag only after `INSIGNIA_PUBLICATION_RELEASE_WAIT_FLAG_MS` (24 hours): `→ OPERATOR_HOLD`, reason `release_wait_after_writes` |
| `ACQUISITION_PENDING` | Flag: `→ OPERATOR_HOLD`, reason `acquisition_unsettled` |
| `HELD` failing E6 (legacy hold version, no owned receipt) | Flag: reason `hold_not_owned` |
| E8 observation throttled or failed (`AvailabilityProviderUnavailableError`), or `CONFLICT` with `current: null`. The latter covers non-transient read failures such as `credential_inactive` or `query_cost_exceeded`, which observe nothing. | `SKIP` (no change; next pass; warn log when it repeats) |
| E8 observation `CONFLICT` with a non-null `current` that differs from the owned held snapshot (product changed by someone else) | Flag: reason `product_changed` |
| Installation changed, operation superseded | The existing activation fence already records `OPERATOR_HOLD`; B does nothing |
| `OPERATOR_HOLD` (any cause) | B does nothing; part A only |
| `HOLD_INTENT`, `WAITING_HOLD`, `WAITING_RELEASE` without a hold (product never changed), stuck same-mode publishes | B does nothing; small follow-up later (§12) |
| Activated operations (`RESTORATION_*`) | Not restored by B; the stale-claim rule covers `RESTORATION_CLAIMED` (§4.4) |

Flag reasons go to the warn log line and the audit row's `detail`. No hold JSON key is added for them.

## 3. States and transitions

### 3.1 Activation state (`m5_activation_state.kind`)

New values: `ABANDON_CLAIMED`, and `ABANDON_RESTORED` (terminal). "Needs operator" reuses `OPERATOR_HOLD`; part A adds no state.

| From | To | Who | Trigger-enforced precondition |
|---|---|---|---|
| `HELD` | `ABANDON_CLAIMED` | worker | P1 and E3–E6 on the current rows; `hold.abandonmentClaim.authority = 'PROVED_NOT_DISPATCHED'`; `hold.restorationClaim` added in the same update |
| `OPERATOR_HOLD` | `ABANDON_CLAIMED` | part A only | A separate **`SECURITY INVOKER`** trigger checks that `current_user` is the schema owner, which is true only inside the operator `SECURITY DEFINER` function (§9). The check cannot live in the existing `SECURITY DEFINER` audit trigger, where `current_user` is always the owner. P1, E3, E4 and E6 hold, with no earlier restoration claim or receipt; `abandonmentClaim.authority = 'SETTLED_BY_TRUSTED_OPERATOR'` with `commandKey` and `inspectDigest` |
| `ABANDON_CLAIMED` | `ABANDON_CLAIMED` | worker / A | Only to add `restorationReceipt`, or to consume a `NOT_DISPATCHED` receipt digest (migration-51 rule, extended to this kind and to `current: null`; one rearm per distinct digest, §4.5) |
| `ABANDON_CLAIMED` | `ABANDON_RESTORED` | worker / A | `restorationReceipt.kind = 'RESTORED'`, `m5_v3_same(receipt.current, hold.before)`, and a qualified acknowledgement (or `before` already `unavailable`) |
| `ABANDON_CLAIMED` | `OPERATOR_HOLD` | worker / A | A receipt other than `RESTORED`/`NOT_DISPATCHED`, a pre-dispatch recheck failure in T2, or a stale claim (§4.5) |
| `HELD`, `WAITING_RELEASE`, `ACQUISITION_PENDING`, `RESTORATION_CLAIMED` | `OPERATOR_HOLD` | worker | Already allowed (any → `OPERATOR_HOLD`) |
| `ABANDON_RESTORED` | anything | — | Rejected |

Unchanged: every existing transition, the claim and receipt immutability of the v3 audit trigger, and `OPERATOR_HOLD → RESTORED | RESOLVED` with a resolution row (part A's observation-only path).

Hold JSON, validated by an extended `m5_v3_hold` (copy-then-wrap, as migration 51 did). Each key is immutable once written:
- `abandonmentClaim` (new): `{ version: 'm5-publication-abandonment-claim-v1', operationId, scope, productId, authority, quietSince, claimedAt, commandKey?, inspectDigest? }`. Appears only on `→ ABANDON_CLAIMED`.
- `restorationClaim` (existing shape): the adapter's `restore()` requires it. It may now also appear on `→ ABANDON_CLAIMED`.
- `restorationReceipt` (existing shape): now also allowed when `OLD.kind = 'ABANDON_CLAIMED'`.

The existing check that `RESTORATION_*`/`RESTORED` require `evidence_digest` stays. Both new kinds require `evidence_digest IS NULL` and `hold IS NOT NULL`.

### 3.2 Publication progress and operation while abandoning

There is one new progress phase, `abandoned` (terminal).

| Row | Transition | Precondition (trigger) |
|---|---|---|
| progress, operation | any update while activation is `ABANDON_CLAIMED` | Rejected. This freezes the rows against signing-provision drift writing `operator-hold`, `request()` superseding, and every other path. With no activation row (same-mode operation), nothing is frozen. |
| progress | `prepared → abandoned` | activation `ABANDON_RESTORED` |
| operation | `requested → failed` with `failure_class = 'publication-abandoned'`, `availability_resolved_at` set in the same update | activation `ABANDON_RESTORED`; `availability_resolved_at = restorationReceipt.current.observedAt` |
| progress, operation | any other update while activation is `ABANDON_RESTORED` and the phase is not yet `abandoned` | Rejected |
| progress | `abandoned →` anything | Rejected |

`enforce_availability_resolution_marker` is extended to accept that `ABANDON_RESTORED` binding as an alternative to its existing `RESOLVED` resolution binding.

### 3.3 Visibility after restore (the resolve-path choice)

After restore, the abandoned operation leaves every "current publication" read, exactly as an operator resolution does today: T3 sets `availability_resolved_at` and deletes `m5_current_publication_pointer` (the same statement as `availability-recovery.ts`). Keeping it visible would have meant teaching every consumer about `abandoned`, which needs more edits in more places.

Every predicate that names terminal activation kinds or terminal phases, and its change:

| Location | Today | Change |
|---|---|---|
| `merchant-config.ts` `publicationSettled` (~50; used ~824, ~968) | phase `active` and kind `RESTORED`/null | None. The abandoned operation is invisible after T3; while `ABANDON_CLAIMED`, "in progress" is correct. |
| `merchant-config.ts` early-return phase list (~1062), new-revision conflict check (~1056) | `active`, `activation-pending`, `conflict`, `operator-hold` | None, for the same reason. The publish loop stops on the new `ABANDONED` results (§4.6). |
| `activation-state.ts` projection (~15) | `failed` → `FAILED` / `OPERATOR_HOLD` | New states first, before the `failed` branch, using new inputs `abandonedLatest` and `holdPresent` (§7) |
| `durable-core.ts` `availabilityRecovery` (~415) | `kind NOT IN ('RESTORED','RESOLVED')` | Add `ABANDON_RESTORED` |
| `production-publication.ts` `prepare` unresolved hold (~352) | Same list | Add `ABANDON_RESTORED` |
| `production-publication.ts` `prepare` gap check (~281) | `failed`/`superseded` + `availability_resolved_at` + `RESOLVED` + resolution digest | Also accept `failed` + `availability_resolved_at` + `ABANDON_RESTORED` |
| `repositories/activation.ts` fence `catch` (~321) | Rewrites to `OPERATOR_HOLD` unless `RESTORED`, `RESOLVED`, `OPERATOR_HOLD` | Also exclude `ABANDON_CLAIMED`, `ABANDON_RESTORED` |
| `application/.../activation.ts` legacy-hold check (~414) | `!['RESTORED','RESOLVED'].includes(kind)` | Unreachable for the new kinds (the §4.6 short-circuit precedes it); add `ABANDON_RESTORED` anyway |
| Partial index `m5_activation_unresolved_hold` | `kind NOT IN ('RESTORED','RESOLVED')` | Add `ABANDON_RESTORED` |

### 3.4 Cross-row trigger reads and lock order

`WHEN` clauses can only see the row being updated, so:
- **One locking read:** the activation transition `→ ABANDON_CLAIMED` (selected by `WHEN` on the activation row's own old and new kind) reads progress and operation `FOR SHARE`.
- **The freeze rule** (§3.2) cannot be selected by `WHEN`, because it depends on the activation row. It runs on every progress and operation update as a plain non-locking read of the activation `kind`. A plain read is enough: every writer of these rows holds the shop lock (`advance`, `prepare`/`request()`, activation `load`, operator recovery, the worker), and `ABANDON_*` is entered only under that same lock. A missing activation row means no freeze. New writers of these rows must keep taking the shop lock; a test asserts it for the existing ones.

Canonical order: `shops` → installation → `product_configs` → `publication_operations` → `m4_publication_progress` → `m5_activation_state`.
- The worker's T1, T2 and T3, and the operator function, lock all six `FOR UPDATE` in this order before any update. The trigger's `FOR SHARE` read is then already covered.
- The existing fence `catch` updates activation to `OPERATOR_HOLD` without the shop lock. That transition takes no cross-row lock, so it holds only the activation row and cannot wait on progress. No cycle.

### 3.5 Audit and archival

New append-only table `m5_publication_abandonment_audit`:
- Columns: `shop_id, config_id, operation_id, activation_version, event, from_kind, to_kind, hold jsonb, detail jsonb, created_at`.
- Primary key `(shop_id, config_id, operation_id, activation_version)`. `activation_version` is the activation row's new `version`, which advances by exactly one on every update, so two `FLAGGED` events for one operation never collide.
- `event IN ('CLAIMED','RECEIPT','RESTORED','FLAGGED')`.

The existing `m5_restoration_no_dispatch_consumptions` table keeps recording digest consumption.

Rows are written only by the `SECURITY DEFINER` activation audit trigger; runtime roles get no DML. `UPDATE`/`DELETE` are rejected, RLS is enabled and `PUBLIC` has no access. `detail` holds bounded reason codes. The worker passes them in the update as a transaction-local setting the trigger reads; they are diagnostic only, never authority. Retention follows `publication_operations`.

### 3.6 Application transition functions

Pure functions in `packages/application/src/publication/abandonment.ts`:

```
decideAbandonment({ candidate, progress, operation, configSequence, observation, now, abandonAfterMs, releaseWaitFlagMs })
  → { kind: 'CLAIM', abandonmentClaim, restorationClaim } | { kind: 'FLAG', reasons } | { kind: 'SKIP', reason }
settleAbandonmentReceipt(hold, receipt, now, staleMs)
  → 'ABANDON_RESTORED' | 'OPERATOR_HOLD' | 'ABANDON_CLAIMED'
```

`settleAbandonmentReceipt` reuses the coordinator's acknowledgement qualification, extracted from `activation.ts` into one shared function. Restoration after activation and after abandonment then judge a receipt identically. The triggers are the authority; tests compare these functions with the trigger tables row by row.

## 4. Fence

### 4.1 Lock order

Locks follow the canonical order of §3.4: the same as `PgActivationStore.load`, minus `signing_keys`. A subset taken in the same order cannot deadlock against the full order.

### 4.2 Sequence

```
worker pass (bounded: at most 2 claims and 20 s per pass; §6)
for each candidate (scan without locks):
  acquire the shop's offline token (outside locks)
  create a fresh availability port for this row only
  T1 BEGIN; lock six rows FOR UPDATE
    re-read P1, E3-E7
    observe(scope, hold) under the lock (read only) = E8     -> throttle / current null: ROLLBACK, SKIP
    decideAbandonment()
      FLAG  -> kind=OPERATOR_HOLD                          (audit FLAGGED; warn log)
      CLAIM -> kind=ABANDON_CLAIMED + abandonmentClaim + restorationClaim
               (trigger: phase prepared, ...; audit CLAIMED)
  T1 COMMIT                                              no Shopify write yet
  T2 BEGIN; lock six rows FOR UPDATE
    require ABANDON_CLAIMED, this invocation's claim, no receipt (or a consumed NOT_DISPATCHED one),
      progress phase prepared, operation requested and current, installation current
      -> any mismatch: kind=OPERATOR_HOLD (reason claim_fenced), no dispatch
    restore(scope, hold, expected = hold.held, beforeSend)  -> read; status-only write; read back
    UPDATE activation: restorationReceipt; then kind from settleAbandonmentReceipt()
      RESTORED                    -> ABANDON_RESTORED     (audit RECEIPT, RESTORED)
      NOT_DISPATCHED              -> stay ABANDON_CLAIMED (rearm on a later pass, §4.5)
      PENDING/CONFLICT/REHELD     -> OPERATOR_HOLD        (never retried)
  T2 COMMIT
  T3 (idempotent; later scans also pick up ABANDON_RESTORED rows not yet finalized)
    lock six rows; if kind=ABANDON_RESTORED and phase=prepared (the UI shows ABANDONMENT_RESTORING until then):
      progress phase=abandoned
      operation status=failed, failure_class='publication-abandoned', availability_resolved_at
      DELETE m5_current_publication_pointer (as availability-recovery.ts)
  T3 COMMIT
```

The provider write happens only in T2, after T1 has committed the one-use claim. This is the pattern of the existing `RESTORATION_PENDING → RESTORATION_CLAIMED` path. T2 commits the receipt and the kind together, so no later update can roll back a dispatched outcome. The freeze rule (§3.2) guarantees that T3's updates are allowed whenever T2 succeeded.

### 4.3 What each racer sees

| Racer | Arrives | Result |
|---|---|---|
| Merchant publish request (journal "Continue" or another tab) | During T1/T2/T3 | Blocks on the shop lock. Afterwards `publication.advance` and `activation.advance` return `ABANDONED` before any fence or provider IO (§4.6). No write. |
| Merchant publish request | Before T1 | It holds the locks; T1 waits, then E7 fails (fresh `updated_at`) → `SKIP`. If that request advanced the phase, the row is no longer eligible (flagged later as `fields_written` only if it goes quiet again). |
| #452 resume path (activation re-observing after a throttled read) | After T1 | `ABANDONED` without observing. The fence `catch` no longer rewrites `ABANDON_*` to `OPERATOR_HOLD`. |
| Signing provisioning or emergency revoke (key or epoch drift) | While `ABANDON_CLAIMED` | Changes to keys and shop config proceed. `publication.advance` short-circuits before its `current()`/`hold()` drift handling, and the freeze rule rejects any progress or operation write. |
| Reinstall | Any time | T2's pre-dispatch recheck fails E4 → `OPERATOR_HOLD` (`claim_fenced`), no dispatch. After `ABANDON_RESTORED`, T3 only touches rows of that operation and is allowed by the freeze rule. |
| Late `public_config` write from a process that died at `prepared` | Any time | Harmless to the restore (§2.2). A late product-field write is impossible: those need a committed later phase. |
| Second worker instance | Concurrent T1 | Serialized by the locks; the second sees `ABANDON_CLAIMED` → `SKIP`. |
| New publication `prepare()` | While `ABANDON_CLAIMED` | Refused by the unresolved-hold check |

### 4.4 Throttling, port quarantine and the activated path

- **One port per claimed row.** The v3 adapter quarantines itself after any budget expiry and refuses all later calls. A per-row port keeps one timeout from poisoning the rest of the pass. Replay protection for the same operation remains the database claim.
- **E8 in T1:** a throttled or empty observation is a `SKIP` before any claim, so the common throttle case never reaches `OPERATOR_HOLD`.
- **Pre-write read failure in `restore()`.** Today that read throws from outside the adapter's `try`. The change: catch a provider failure of the pre-write read and return `{ kind: 'NOT_DISPATCHED', current: null }`. No mutation fetch was started, so this proves nothing was dispatched. Any throw after the mutation call still becomes `RESTORATION_PENDING`, as today.
- **The activated path shares this change, and B fixes an existing defect on main.** `restore()` is also used after activation (`RESTORATION_CLAIMED`). Today a throwing pre-write read there rolls back the activation transaction and leaves the committed claim without a receipt. Every later invocation then observes `HELD` and reports `ACTIVATED_RESTORATION_PENDING` forever, with no stale rule. The adapter change alone would not help: the coordinator's rearm (`activation.ts` ~432) and migration 51 require `receipt.current` to equal the held snapshot. B's implementation fixes both kinds the same way:
  - The coordinator's rearm and the migration-51 consumption rule accept a `NOT_DISPATCHED` receipt with `current: null` for `RESTORATION_CLAIMED` and `ABANDON_CLAIMED`. This is safe because `restore()` re-reads and requires the owned held snapshot before any write.
  - Rearm is limited to one per distinct receipt digest (§4.5).
  - The worker's stale-claim rule (§4.5) also covers `RESTORATION_CLAIMED`: no receipt, or a consumed `NOT_DISPATCHED` digest with no newer receipt, past `ABANDON_CLAIM_STALE_MS` → `OPERATOR_HOLD` (reason `claim_unsettled`), with a warn line.

### 4.5 Ambiguous restore, rearm and stale claims

- **`NOT_DISPATCHED`:** the receipt is stored and the row stays `ABANDON_CLAIMED`. On a later pass, T2 may rearm by consuming that receipt's digest into the claim (the migration-51 rule, extended as in §4.4). Every `current: null` receipt has the same digest, so migration 51's `IS DISTINCT FROM` check and the consumptions primary key allow exactly **one** rearm for that receipt shape. The rule is: **one retry, then `OPERATOR_HOLD` (`claim_unsettled`)** through the stale rule. A receipt with a non-null `current` has its own digest and follows the existing rule. Making receipts distinct per attempt would need a schema key change; E8 in T1 already turns most throttles into a `SKIP` before any claim.
- **`RESTORATION_PENDING`, `CONFLICT`, `REHELD_CONFLICT`:** the row goes to `OPERATOR_HOLD` and is never retried. Part A resolves it by observation only (§9).
- **Stale claim:** after `ABANDON_CLAIM_STALE_MS` (default 2 minutes, above the 8 s adapter budget plus lock waits), the worker moves the claim to `OPERATOR_HOLD` with reason `claim_unsettled`. This applies to `ABANDON_CLAIMED`, and to `RESTORATION_CLAIMED` (§4.4), in either case:
  - there is no receipt; or
  - the receipt is a `NOT_DISPATCHED` whose digest is already consumed into the claim and no newer receipt exists. A crash after consumption may have dispatched.

  "Stale" is measured from the activation row's `updated_at`, which consumption updates.

### 4.6 `ABANDONED` short-circuits, ahead of every fence

- **`PgActivationStore.load`:** right after locking `publication_operations` and `m4_publication_progress`, and before the status, phase, projection and key checks (which throw for `failed`), read the activation `kind` with a plain SELECT. The read is stable because `ABANDON_*` is entered only under the shop lock that `load` already holds. If the kind is `ABANDON_*` or the phase is `abandoned`, throw `PublicationAbandoned`. Both coordinator `locked` blocks go through `load`, so both are covered. Both also run before `classifyPublicationAdmission`, which throws on `abandoned`.
- **The coordinator** maps `PublicationAbandoned` to a new `ActivationResult.kind = 'ABANDONED'`; the fence `catch` does not run for it.
- **`PgProductionPublication.advance`:** right after the shop lock and `load`, before `resolved`, `current()` and `hold()`, return `{ kind: 'ABANDONED', phase }` when the activation kind is `ABANDON_*` or the phase is `abandoned`.
- **`merchant-config.ts`:** the publish loop breaks on either `ABANDONED` result and returns the projected state.

## 5. Restore effect

`ProductAvailabilityHoldV3Port.restore()` is reused, with only the §4.4 pre-write read change:
- It reads the product and requires it to equal the owned `held` snapshot exactly and to be held-safe; otherwise it returns `CONFLICT` with no write.
- It sends one status-only update to `before.state`, then requires a qualified acknowledgement plus an exact readback of `before` (effective publication IDs, online-store presence, anchors; diagnostic timestamps ignored).
- On a settled semantic mismatch it uses the one reserved compensating re-hold, then stops.

`beforeSend` is synchronous and does no IO. It requires:
- the T2 transaction is still open and owns the claim;
- the installation scope locked in T2 equals the claim's;
- the offline token expires more than 30 s later.

Function release and projection readiness are not required: the product returns to its prior state under the prior effective policy. The restore does not read or write `public_config`.

**Offline token.** It is acquired for the shop before T2 (the facade forbids re-entering `core.credentials.acquire` under the shop lock) and handed to a credential port that returns only that token. That port and its availability port exist only inside the abandonment job (and part A's command) and expose only `observe` and `restore`. Scopes are unchanged (`write_products`).

## 6. Worker job

- **Where:** a new pass in the existing 30-second reconciliation loop (`apps/worker/src/reconciliation.ts`), error class `PUBLICATION_ABANDONMENT_UNAVAILABLE`. No pg-boss queue.
- **Bounded pass:** at most 2 claims (T1 → T2 → T3) and a 20-second budget per pass, so restores never starve the other recovery passes. The pass also finalizes up to 10 pending T3s and flags up to 10 rows. Neither of those calls Shopify except for E8; flagging needs no observation.
- **Scan:** `kind IN ('HELD','WAITING_RELEASE','ACQUISITION_PENDING','ABANDON_CLAIMED','ABANDON_RESTORED','RESTORATION_CLAIMED')` with `hold IS NOT NULL`, current installation, quiet, stale or not yet finalized, ordered by `updated_at`. `RESTORATION_CLAIMED` is checked only by the stale-claim rule; the worker never restores an activated publication. The partial index `m5_activation_unresolved_hold` covers the scan.
- **Bounds:**
  - `INSIGNIA_PUBLICATION_ABANDON_AFTER_MS`: default 600000 (10 minutes), accepted range 5 minutes to 24 hours.
  - `INSIGNIA_PUBLICATION_RELEASE_WAIT_FLAG_MS`: default 86400000 (24 hours); applies to `WAITING_RELEASE` with a hold.
  - `ABANDON_CLAIM_STALE_MS`: default 2 minutes.
  - A value outside its range is a startup error.
- **Switch:** `INSIGNIA_PUBLICATION_ABANDONMENT=off|flag|restore`, default `off`. `flag` records only `OPERATOR_HOLD` flags; `restore` also claims and restores.
- **Idempotency:** the one-use claim, the immutable receipt, the terminal kinds and the idempotent T3.
- **Logging:** a `publication_abandonment` event with internal `shopId`, `configId`, `operationId`, `outcome` (`restored | flagged | not_dispatched | ambiguous | conflict | skipped | finalized`) and `reasons`. `restored`/`finalized` log at info; `flagged`, `ambiguous` and `conflict` at **warn**. No product titles, tokens or provider bodies.
- **Metrics:** counter `insignia_publication_abandonment_total{outcome}` (bounded labels, no shop label) and gauge `insignia_publication_holds_flagged`. Alerting is phase 5.
- **Failures:**
  - A database or credential failure before T2's dispatch changes nothing (next pass).
  - A credential that is `reauth_required` or `inactive` is a `SKIP` with a warn line.
  - A provider failure after dispatch is never retried (§4.5).

## 7. Merchant UI

### 7.1 State machine

`projectActivationPublicationState` remains the single owner of `PublicationState`. Three new values:

| Condition (server) | `PublicationState` | Classifier (`publication-state.ts`) |
|---|---|---|
| Current operation's activation is `ABANDON_CLAIMED`, or `ABANDON_RESTORED` before T3 has finalized (operation still `requested`) | `ABANDONMENT_RESTORING` | Continuing: blocks Publish, keeps polling |
| `abandonedLatest`: the config's newest operation (`operation_sequence = product_configs.publication_sequence`, current generation) has activation `ABANDON_RESTORED` | `ABANDONED_RESTORED` | Settled: Publish allowed; a journaled publish request settles (is cleared) as for `FAILED` |
| Activation `OPERATOR_HOLD`, operation not activated, `holdPresent` (`hold IS NOT NULL`); also a hold on another operation of this config | `HOLD_NEEDS_SUPPORT` | Operator-blocked |

`OPERATOR_HOLD`, `CONFLICT` and `RESTORATION_CONFLICT` keep their meaning in every other case. The support copy is therefore never shown where Insignia holds nothing, such as a `phase = 'operator-hold'` field conflict without a hold.

Two new inputs feed the projection:
- `abandonedLatest` comes from one query beside `getCurrentPublication`. It is a derived input, not a stored flag; the next publication increments `publication_sequence`, which ends it.
- `holdPresent` is one more column on the existing current-publication query.

The new cases are evaluated before the existing `operationStatus === 'failed'` branch.

Client:
- One pure function next to the classifier, `publicationNotice(state) → { key, tone, actions }`. `SelectedProductContainer` uses it for publication states instead of the inline ternary.
- The local `remote` state remains this client's own write state. `publicationFailed`, `publicationNeedsReview` and `publicationProgressing` are derived from `PublicationState` as today.
- The English server `publication.reason` is not shown for the three new states.
- The products-list badge is deferred; the editor carries the message.

### 7.2 Copy

The English is owner-approved (14 November 2026). The other languages are drafts for the translation review. Register follows each catalogue: Dutch *je*, German *Sie*, French *vous*, Spanish *tú*, Italian informal.

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
   - `HELD → ABANDON_CLAIMED` with a phase past `prepared` (rejected);
   - `OPERATOR_HOLD → ABANDON_CLAIMED` as the worker role (rejected) and through the operator function (allowed);
   - the freeze rule against a drift `operator-hold` write and a `request()` supersede, and with no activation row (no freeze);
   - `ABANDON_RESTORED → *`;
   - claim and receipt immutability;
   - two `FLAGGED` events for one operation (distinct audit rows);
   - the audit table and operator function inaccessible to runtime roles.
2. After T3: `getCurrentPublication` returns the prior effective operation (or none); `availabilityRecovery` returns null; `prepare()` succeeds for a first publication and for a mode change with an earlier effective operation (gap check).

Concurrency (two real connections, gated fake Shopify):

3. Merchant retry against worker claim, both orders.
   - Worker first: the merchant's `advance` returns `ABANDONED`, with zero field writes.
   - Merchant first: the worker `SKIP`s, or flags `fields_written` once the phase moved; zero restores.
4. Late completion: a merchant `advance` blocked inside a gated `remote.set` for `public_config` holds the shop lock; T1 waits, then sees either a fresh `updated_at` (`SKIP`) or, if that `advance` rolled back, a still-quiet `prepared` row, which it may claim (the §2.2 case).
5. #452 resume after T1 → `ABANDONED`, no observe, kind unchanged.
6. Signing provisioning bumps the epoch while `ABANDON_CLAIMED`: T2 and T3 still commit; `publication.advance` returns `ABANDONED`; no `operator-hold` write.
7. Two worker instances: one claim, one restore.
8. Crash injection: kill T2 after the adapter's fetch began → claim without receipt → `OPERATOR_HOLD` after the stale bound, never a second restore. The same after a consumed `NOT_DISPATCHED` digest.
9. **Structural evidence test** (replaces a dispatch counter):
   - Through the real production composition, a fake remote records the stored, committed phase at every `set`. Driving every phase, `registration` and `policy` are dispatched only when the committed phase is past `prepared`.
   - A source-level boundary check asserts that nothing but `PgProductionPublication.advance` calls `remote.set` for those fields.
   - The composition counts every `remote.set` and `availability.restore` call.
10. Activated path: a throttled pre-write read after `RESTORATION_CLAIMED` stores `NOT_DISPATCHED`/`current: null`. The next invocation rearms once and restores. A second such receipt cannot rearm, and the worker moves it to `OPERATOR_HOLD` after the stale bound. First reproduce the main defect (claim without receipt, `ACTIVATED_RESTORATION_PENDING` forever).
11. E8: `observe()` returning `CONFLICT` with `current: null` (credential inactive, query cost) is a `SKIP`, not a flag.
12. Operator claim: the invoker trigger rejects `OPERATOR_HOLD → ABANDON_CLAIMED` from the worker and web roles and accepts it from the operator function. The function locks the six rows in canonical order, concurrently with a merchant `advance`, without deadlock.
13. Every existing writer of progress and operation rows holds the shop lock (the freeze-rule assumption).

Application/adapter:

14. `decideAbandonment` and `settleAbandonmentReceipt` truth tables against the trigger tables, including the 24-hour `WAITING_RELEASE` bound. The shared acknowledgement qualification is used by both coordinators.
15. Adapter `restore()` with a fake Shopify: `RESTORED`, `NOT_DISPATCHED` from a throttled pre-write read (`current: null`), `RESTORATION_PENDING` (timeout), `CONFLICT`, `REHELD_CONFLICT`. With per-row ports, a quarantined port does not affect the next row.

Web and UI:

16. Projection for all three new states. Check that `failed` + `ABANDON_RESTORED` is not `OPERATOR_HOLD`, that `ABANDON_RESTORED` before T3 is `ABANDONMENT_RESTORING`, and that an `operator-hold` phase without a hold is not `HOLD_NEEDS_SUPPORT`.
17. Editor (built UI, browser suite):
   - each banner and its actions;
   - Publish enabled after `ABANDONED_RESTORED`;
   - a journaled request settles on it;
   - polling moves `ABANDONMENT_RESTORING → ABANDONED_RESTORED` without losing local edits;
   - keyboard focus.
18. Localization: the keys exist in all six catalogues.

Native (rewrite-dev, test products only):

19. Publish a test product and stop the request after `HELD` (close the tab). With the bound at its 5-minute minimum, confirm that the product returns to Active, the editor shows `ABANDONED_RESTORED`, and Publish works again.

## 9. Part A: operator command (built after B)

A server-only CLI in the worker image, run over SSH on the host. It adds no state and uses B's states, triggers and evaluator.

```
insignia-publication-hold inspect --shop <shopId> --config <configId>
insignia-publication-hold restore --shop <shopId> --config <configId> --operation <id> --inspect-digest <digest> --command-key <key> --confirm
insignia-publication-hold resolve --shop <shopId> --config <configId> --operation <id> --command-key <key> --confirm
```

- **`inspect`** (read-only) shows:
  - held since, activation kind and version, and a hold summary (`before`/`held`, acknowledgement, claims, receipts);
  - the committed phase, and B's verdict and reasons;
  - a live Shopify read (offline token) of the product's availability and of `registration`, `policy` and `public_config`, each compared with the progress row's `prior_*_digest` (`public_config` for information only, §2.2);
  - "safe to restore: yes/no, because …";
  - an `inspectDigest` over (activation version, hold digest, live product snapshot digest, live field digests).
- **`restore`:**
  - Allowed only for `OPERATOR_HOLD` with an owned held receipt and no earlier restoration claim or receipt.
  - Recomputes the digest and **hard-refuses** if it differs from `--inspect-digest`, if the activation version moved, if the inspect is older than 10 minutes, or if live `registration` or `policy` differs from the prior digests.
  - Then calls `m5_operator_claim_abandoned_hold(...)`. This `SECURITY DEFINER` function is owned by the schema owner, and only the dedicated operator role can execute it (not web, not worker). It locks the six rows `FOR UPDATE` in canonical order, rechecks the activation version, and writes `OPERATOR_HOLD → ABANDON_CLAIMED` with `SETTLED_BY_TRUSTED_OPERATOR`, the command key and the inspect digest.
  - Then runs B's T2 and T3. Outcomes and states are B's.
- **`resolve`:** the existing observation-only path (`createAvailabilityRecovery` → `RESOLVED`). The CLI supplies the trusted authority port from the confirmed command. Use it when Shopify already shows the original state.
- **Audit:** every run, including `inspect`, writes one structured log line. `restore` and `resolve` are also recorded in the database (abandonment audit, resolution row). A command key is single-use per shop.
- **Runbook** (`deployment/m5-runtime/README.md`): when to use each subcommand, and what "safe" means. For holds where product fields were already written (`registration` or `policy` differ from prior), `restore` refuses. Then either the merchant continues the publish, or the owner restores the product by hand in Shopify admin and runs `resolve`.

First use: `QA cover B – Tee`. It is `OPERATOR_HOLD`, committed `prepared`, with an owned held receipt and a first publication (prior field digests null). If `inspect` shows `registration` and `policy` still absent, it reports safe, and the owner can confirm `restore`.

## 10. Migration outline (migration 65)

Up, in one transaction, through the guarded schema owner:
1. `m4_publication_progress`: add `abandoned` to the phase check; extend `enforce_m4_publication_progress` with §3.2.
2. `m5_activation_state`: add `ABANDON_CLAIMED` and `ABANDON_RESTORED` with their checks; rebuild `m5_activation_unresolved_hold` excluding `ABANDON_RESTORED`.
3. Triggers:
   - copy-then-wrap `m5_v3_hold` and `enforce_activation_v3_audit` (new keys; receipt and consumption on `ABANDON_CLAIMED`; `current = null` rearm for `ABANDON_CLAIMED` and `RESTORATION_CLAIMED`);
   - replace `enforce_activation_state` with §3.1;
   - add the `WHEN`-scoped claim trigger, the `SECURITY INVOKER` operator-claim trigger and the freeze triggers (§3.2, §3.4);
   - extend `enforce_publication_transition` and `enforce_availability_resolution_marker`.
4. Create `m5_publication_abandonment_audit` (RLS, revoke all, immutable).
5. Create the operator role (no login; granted to the owner's SSH-run command identity) and `m5_operator_claim_abandoned_hold`, executable only by that role.
6. Grants: confirm the worker role has `SELECT, UPDATE` on `m5_activation_state`, `m4_publication_progress` and `publication_operations`, and `DELETE` on `m5_current_publication_pointer` (it may lack some today). Update the expected ACL digests in the deployment README.

Down: raises if any activation row has an `ABANDON_*` kind or an `abandonmentClaim`, any progress row is `abandoned`, or the audit table has rows. Otherwise it restores the copied functions and drops the phase, role, function and table.

## 11. Rollout and rollback on rewrite-dev

1. Apply migration 65. Deploy web (short-circuits, projection), then the worker with `INSIGNIA_PUBLICATION_ABANDONMENT=off`.
2. Publish one test product to Active and confirm that nothing else changed.
3. Switch the worker to `flag`. It flags nothing on a healthy store and leaves `QA cover B – Tee` untouched (it is `OPERATOR_HOLD`).
4. Switch to `restore` and run native check 19 with the bound at 5 minutes, then return to the 10-minute default.
5. Rollback: set the worker to `off` first (this stops all worker effects at once). A web rollback is possible while no `ABANDON_*` row exists. After the first one, recovery is fix-forward, because older code does not understand those states.

## 12. Owner decisions (14 November 2026)

- **B's shape** as described, with the worker restoring availability with the offline token for this one effect only (§6.1 of the specification).
- **Time bound:** 10 minutes of no activity, configurable from 5 minutes to 24 hours.
- **Copy:** the English in §7.2 is approved; the other languages go through the translation review.
- **Flagging:** an unprovable `HELD` row becomes `OPERATOR_HOLD`, which ends a later merchant resume of the original request; accepted. A `WAITING_RELEASE` row with a hold is flagged only after the separate 24-hour bound.
- **Out of scope:** stale operations that never changed the product (`HOLD_INTENT`, `WAITING_HOLD`, `WAITING_RELEASE` without a hold, stuck same-mode publishes) stay out of B; a small follow-up comes later.
- **Rollout:** worker `off`, then `flag`, then `restore`.
- **Evidence rule:** committed `prepared` + owned `HELD` + E3–E8 under the six-row lock, with no dispatch marker. This changes the original "no shop-config write" wording: a shop-wide `public_config` write may have been dispatched, and the restore neither touches nor depends on it (§2.2).
- **Part A:** a server-only CLI run over SSH (owner, or the lead or agents on the owner's instruction), audited, with a runbook. There is no admin staff page until there are real merchants. "Needs operator" is logged at warn and shown in the editor; real alerting is phase 5.
