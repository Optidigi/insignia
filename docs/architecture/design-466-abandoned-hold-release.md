# Design: automatic release of an abandoned publication hold (#466 part B)

Status: **proposed, needs owner approval before implementation.** No runtime code exists for this design. The proposed requirement text is in the [specification](implementation-plan.md) (§6.1, §6.2, §10.1, §10.3, §11, §13.1); this document holds the mechanism, the state machines, the fence sequence, the UI states, the test plan, the migration outline and the interface for part A.

Owner decisions this design follows (14 November 2026):
- Build B. When a publish is abandoned, the system heals itself: after a bounded quiet time, if durable records **prove** that no policy, registration or shop-config write could have reached Shopify for that operation and Insignia owns the hold receipt, the worker restores the product's prior availability exactly as held, marks the publication failed and tells the merchant "Publishing didn't finish; your product is back as it was. Publish again."
- Cases that cannot be proven safe stay held, are logged at warn and are left for the operator command (part A). The merchant editor shows a support message. Real alerting is out of scope (phase 5).
- The background worker may change product availability with the app's offline token for this one effect only.
- Every new state and transition is an explicit state machine: database states with trigger-enforced transitions, one application transition function, and the admin UI state through the existing projection and classifier.
- Part A is server-only: a CLI command run over SSH on the host, like the signing emergency revoke. It reuses B's states and checks; it adds no new state.

## 1. Problem and evidence

A first publication or mode change takes an availability hold before it writes any Shopify field: the product goes to DRAFT (`m5_activation_state.kind = HELD`, owned `held` receipt), then `PgProductionPublication.advance` writes `public_config`, `registration` (pending), `policy` and `registration` (ready) in that order, then activation commits evidence and restores the product. Each write runs inside the `advance` transaction while it holds `FOR UPDATE` on `shops`, the installation and `product_configs`.

If the merchant's request stops after the hold and before activation (closed tab, lost response, Shopify throttling), nothing continues the operation. The product stays DRAFT, `prepare()` refuses any new publication (`Availability hold requires recovery before another publication`) and the editor shows "Publication requires operator review" with no next step. Operator recovery is not wired (#466).

Why the existing records do not prove "nothing dispatched" (the #452 reviewer's finding):
- `phase = 'prepared'` is not proof. The `public_config` write is dispatched while the phase is still `prepared`; the phase only moves after an exact readback. If the process dies mid-fetch, or the database connection fails after the fetch, the transaction rolls back and the row still says `prepared` while the request may already be at Shopify.
- `retry_count = 0`, `version = 0` and `last_observed IS NULL` are not proof for the same reason: they are written in the transaction that rolls back.
- `ACQUISITION_PENDING` without an owned `held` receipt never qualifies: the status mutation may be in flight, and there is no owned snapshot to restore against.

Live example (rewrite-dev, read-only, 14 Nov): operation `43db577d-…` (`QA cover B – Tee`), `publication_operations.status = requested`, progress `phase = prepared`, `version = 0`, `retry_count = 0`, `last_observed IS NULL`; activation `OPERATOR_HOLD` (version 5) with `before` ACTIVE (`available`), owned `held` DRAFT and a qualified acquisition acknowledgement; `mode = required`, `prior_mode = NULL` (first publication). Classification under this design: **not provable** (no dispatch gate existed when it was written, and it is already `OPERATOR_HOLD`). It is part A's first case.

## 2. Evidence rule: the dispatch gate

### 2.1 Choice

One durable marker per publication operation, `m4_publication_progress.remote_dispatch`, with three values:

| Value | Meaning | Set by |
|---|---|---|
| `NONE` | No Shopify field write has been or can be dispatched for this operation. | `prepare()` on insert (explicitly; it is not the column default) |
| `OPENED` | A field write may have been dispatched. Never reverts. | The gate transaction, before the first `advance` transaction that may dispatch |
| `UNKNOWN` | Written before the gate existed, or by code that does not open the gate. Never changes. | Column default; the migration backfills every existing row |

A per-field marker is not needed. The four field writes happen in a fixed order, the first one (`public_config`) is dispatched while the phase is `prepared`, and B needs only one fact: *no* write for this operation was ever dispatched. `NONE` gives exactly that. Part A needs more detail, and reads it from Shopify itself (§9).

`UNKNOWN` as the column default makes a mixed deployment safe: a web process still running old code inserts progress rows without naming the column, so its rows are `UNKNOWN`, never `NONE`.

### 2.2 Where the gate opens

`PgProductionPublication.advance` gets a short gate transaction that runs before its main transaction whenever the stored gate is `NONE`:

1. Lock in the canonical order (§4.1): `shops`, installation, `product_configs`, `publication_operations`, `m4_publication_progress`, `m5_activation_state` (if a row exists).
2. If the operation needs a hold (`prior_mode IS NULL OR prior_mode <> mode` on the progress row, i.e. `FIRST_PUBLICATION` or `MODE_CHANGE`), require activation `kind = 'HELD'`; if it is not `HELD`, leave the gate `NONE` and return `ADMISSION_PENDING` (no write is attempted without the hold anyway). This matters: the publish loop calls `publication.advance` before the hold exists, and opening the gate then would make every later hold unprovable. Same-mode operations open the gate without a hold.
3. `UPDATE m4_publication_progress SET remote_dispatch = 'OPENED', version = version + 1`. Commit.

The main transaction then requires `remote_dispatch = 'OPENED'` (read under its own lock) before `remote.set(...)`. This is a second, local check; the database trigger in §3.3 is the authority.

The gate opens at the start of the first `advance` that could write, not immediately before the fetch. That is conservative: an operation whose `public_config` already matched and needed no write still counts as `OPENED`. Opening it lazily just before the fetch would need a second pool connection while the main transaction holds the shop lock, which the runtime reference warns against (pool exhaustion under load). Conservative is the right side: a false `OPENED` sends a case to the operator; a false `NONE` would be unsafe.

Cost: one short transaction per publish, only while the gate is `NONE` (normally once).

### 2.3 Eligibility rule (all must hold, read under the fence locks)

| # | Fact | Source |
|---|---|---|
| E1 | `m4_publication_progress.remote_dispatch = 'NONE'` | gate |
| E2 | `m4_publication_progress.phase = 'prepared'` | progress (implied by E1; checked anyway) |
| E3 | `publication_operations.status = 'requested'` and `operation_sequence = product_configs.publication_sequence` | operation, config |
| E4 | The operation's installation generation is the shop's current, active generation | shops, installation |
| E5 | `m5_activation_state.kind = 'HELD'`, `evidence_digest IS NULL`, no `resolution_digest` | activation |
| E6 | `hold.version = 'm5-availability-hold-v3'`, `hold.operationId` = this operation, `availabilityV3OwnedHeld(hold)` (owned `held` snapshot, qualified acquisition acknowledgement when `before` was not already `unavailable`), no `restorationClaim`, no `restorationReceipt` | activation hold JSON |
| E7 | Quiet: `clock_timestamp() - greatest(o.requested_at, p.updated_at, a.updated_at) >= ABANDON_AFTER` | database clock |

E7 is not part of the safety proof; the fence (§4) is. E7 only avoids cutting off a merchant who is still publishing.

Not eligible, and what happens:

| Case | Outcome |
|---|---|
| `remote_dispatch` is `OPENED` or `UNKNOWN` | Flag: `HELD → OPERATOR_HOLD`, reason `dispatch_possible` or `dispatch_unknown` |
| `ACQUISITION_PENDING` older than `ABANDON_AFTER` | Flag: `ACQUISITION_PENDING → OPERATOR_HOLD`, reason `acquisition_unsettled` |
| `HELD` but E6 fails (legacy hold version, no owned receipt) | Flag: reason `hold_not_owned` |
| Installation changed, operation superseded | Existing activation fence already records `OPERATOR_HOLD`; B does nothing |
| `OPERATOR_HOLD` (any cause) | B does nothing; part A only |
| `HOLD_INTENT`, `WAITING_*` (no product effect) | B does nothing; see owner question Q4 |
| Activated operations (`RESTORATION_*`) | Out of scope; existing restoration path |

## 3. States and transitions

### 3.1 Activation state (`m5_activation_state.kind`)

New values: `ABANDON_CLAIMED`, `ABANDON_RESTORED`. "Needs operator" reuses the existing `OPERATOR_HOLD`; part A adds no state.

| From | To | Who | Trigger-enforced precondition |
|---|---|---|---|
| `HELD` | `ABANDON_CLAIMED` | worker | E1–E6 in the same row versions; `hold.abandonmentClaim.authority = 'PROVED_NOT_DISPATCHED'`; `hold.restorationClaim` added in the same update |
| `OPERATOR_HOLD` | `ABANDON_CLAIMED` | part A | E2–E6 except the kind; `abandonmentClaim.authority = 'SETTLED_BY_TRUSTED_OPERATOR'` with a `commandKey`; no earlier `restorationClaim` or `restorationReceipt` |
| `ABANDON_CLAIMED` | `ABANDON_CLAIMED` | worker / A | Only to add `restorationReceipt`, or to consume a `NOT_DISPATCHED` receipt digest once (the migration-51 rule, extended to this kind) |
| `ABANDON_CLAIMED` | `ABANDON_RESTORED` | worker / A | `restorationReceipt.kind = 'RESTORED'` and `m5_v3_same(receipt.current, hold.before)`; terminal |
| `ABANDON_CLAIMED` | `OPERATOR_HOLD` | worker / A | Receipt present (ambiguous, conflict, re-held), or the claim is older than the claim bound with no receipt |
| `HELD`, `ACQUISITION_PENDING` | `OPERATOR_HOLD` | worker | Already allowed (any → `OPERATOR_HOLD`); the worker adds `hold.abandonmentReview` with reason codes |
| `ABANDON_RESTORED` | anything | — | Rejected (terminal, like `RESTORED` and `RESOLVED`) |

Unchanged: every existing transition, the claim/receipt immutability of the v3 audit trigger, and `OPERATOR_HOLD → RESTORED | RESOLVED` with a resolution row (part A's observation-only path).

New hold JSON keys, validated by an extended `m5_v3_hold` (wrapped the way migration 51 wrapped it) and immutable once written:
- `abandonmentClaim`: `{ version: 'm5-publication-abandonment-claim-v1', operationId, scope, productId, authority: 'PROVED_NOT_DISPATCHED' | 'SETTLED_BY_TRUSTED_OPERATOR', commandKey?: string, quietSince, claimedAt }`. Appears only on `HELD | OPERATOR_HOLD → ABANDON_CLAIMED`.
- `restorationClaim`: the existing `m5-availability-restoration-claim-v3` shape, unchanged. The Shopify adapter's `restore()` requires it; reusing it keeps the adapter untouched. Its appearance is now also allowed on `→ ABANDON_CLAIMED`.
- `abandonmentReview`: `{ version: 'm5-publication-abandonment-review-v1', reasons: [...bounded codes], reviewedAt }`. Appears only on `HELD | ACQUISITION_PENDING → OPERATOR_HOLD` written by the worker. It marks "the worker looked and could not prove it", so the worker never evaluates that operation again.
- `restorationReceipt`: existing shape; now also allowed when `OLD.kind = 'ABANDON_CLAIMED'`.

The existing check `kind IN ('RESTORATION_PENDING','RESTORATION_CLAIMED','RESTORED') → evidence_digest IS NOT NULL` stays. The new kinds require `evidence_digest IS NULL` and `hold IS NOT NULL`.

### 3.2 Publication progress (`m4_publication_progress`)

New phase `abandoned` (terminal). New column `remote_dispatch` (§2).

| Field | Transition | Precondition (trigger) |
|---|---|---|
| `phase` | `prepared → abandoned` | `remote_dispatch = 'NONE'`, activation `kind = 'ABANDON_RESTORED'` |
| `phase` | `abandoned →` anything | rejected |
| `remote_dispatch` | `NONE → OPENED` | same-mode operation (`prior_mode IS NOT NULL AND prior_mode = mode`, no hold needed), or activation `kind = 'HELD'` |
| `remote_dispatch` | any other change | rejected |
| `phase` | `prepared → shop-config-written` | additionally requires `remote_dispatch = 'OPENED'` (a write that read back must have passed the gate) |

### 3.3 Publication operation (`publication_operations`)

No new status. `requested → failed` already exists; the worker sets `failure_class = 'publication-abandoned'` in the same transaction that writes `ABANDON_RESTORED`. A new check in `enforce_publication_transition`: `failure_class = 'publication-abandoned'` requires activation `ABANDON_RESTORED`. `availability_resolved_at` stays `NULL`, so the abandoned operation remains the config's current publication and the editor can say what happened until the next publish.

### 3.4 Cross-row fence in the database

The gate trigger (progress) and the claim trigger (activation) each read the other row `FOR SHARE`. Both application paths lock the two rows `FOR UPDATE` in the canonical order before updating, so the trigger locks are already held and cannot deadlock; the trigger read makes the rule hold even for a caller that forgot to lock (it then blocks or fails, never passes on stale data).

### 3.5 Audit and archival

New append-only table `m5_publication_abandonment_audit` (like `m5_restoration_no_dispatch_consumptions`): `shop_id, config_id, operation_id, event, from_kind, to_kind, hold jsonb, progress jsonb, created_at`, `event IN ('CLAIMED','RECEIPT','NO_DISPATCH_CONSUMED','RESTORED','FLAGGED')`, primary key `(shop_id, config_id, operation_id, event)` (`RECEIPT` may occur twice only through the existing consumption rule, so it is keyed with the receipt digest). Rows are written only by the `SECURITY DEFINER` activation audit trigger on each listed transition; the runtime roles get no DML on it; `UPDATE`/`DELETE` are rejected; RLS enabled; `REVOKE ALL FROM PUBLIC`. Retention follows `publication_operations` (cascade only with the operation, which is never deleted in normal operation).

### 3.6 Application transition function

One pure function owns the abandonment decision, in `packages/application/src/publication/abandonment.ts`:

```
decideAbandonment(input: { candidate, progress: { phase, remoteDispatch, updatedAt }, operation: { status, requestedAt, sequence }, configSequence, now, abandonAfterMs })
  → { kind: 'CLAIM', claim, restorationClaim }
  | { kind: 'FLAG', reasons }
  | { kind: 'SKIP', reason }            // not quiet yet, not ours, already terminal
```

and one for the receipt outcome:

```
settleAbandonmentReceipt(hold, receipt) → 'ABANDON_RESTORED' | 'OPERATOR_HOLD' | 'ABANDON_CLAIMED' (NOT_DISPATCHED only)
```

The database triggers are the authority; these functions decide what the worker attempts, and tests compare them against the trigger table row for row.

## 4. Fence

### 4.1 Lock order

The same order as `PgActivationStore.load`: `shops` → installation (`lockActiveAuthorizationScope`) → `product_configs` → `publication_operations` → `m4_publication_progress` → `m5_activation_state`. The worker takes a subset in this order (it does not need `signing_keys`). The gate transaction uses the same order. Taking a subset in the same order cannot deadlock against the full order.

### 4.2 Sequence

```
worker                                   DB                                         Shopify
------                                   --                                         -------
scan (no locks): candidates kind HELD/ACQUISITION_PENDING, quiet >= ABANDON_AFTER, LIMIT 10
acquire offline token for the shop (outside any lock)
T1 BEGIN
  lock shops, installation, config, operation, progress, activation (FOR UPDATE)
  re-read E1..E7 under the locks; decideAbandonment()
  FLAG  -> UPDATE activation kind=OPERATOR_HOLD, hold.abandonmentReview   (trigger audits FLAGGED)
  CLAIM -> UPDATE activation kind=ABANDON_CLAIMED, hold.abandonmentClaim + restorationClaim
           (trigger checks gate NONE etc., audits CLAIMED)
T1 COMMIT                                                                            (no call yet)
T2 BEGIN
  lock the same rows again; require kind=ABANDON_CLAIMED, this invocation's claim, no receipt
  restore(scope, hold, expected = hold.held, beforeSend)  --------------------------> read product
                                                                                      == held? status-only update to before.state
                                                                                      read back
  UPDATE activation hold.restorationReceipt                (trigger audits RECEIPT)
  RESTORED (exact before + qualified ack):
    UPDATE activation kind=ABANDON_RESTORED                (audits RESTORED)
    UPDATE progress phase=abandoned
    UPDATE operation status=failed, failure_class='publication-abandoned'
  NOT_DISPATCHED: stay ABANDON_CLAIMED (next run may consume the digest once)
  anything else: UPDATE activation kind=OPERATOR_HOLD     (audits FLAGGED)
T2 COMMIT
```

The provider call happens only in T2, after T1 committed the one-use claim, exactly like the existing `RESTORATION_PENDING → RESTORATION_CLAIMED` path. T2 holds the locks across the call, as activation and publication already do.

### 4.3 What each racer sees

| Racer | Arrives | Result |
|---|---|---|
| Merchant publish request (same or new tab, journal "Continue") | During T1/T2 | Blocks on the shop lock; afterwards `publication.advance` sees activation not `HELD`, so admission is refused and the gate cannot open; `activation.advance` returns the new terminal result `ABANDONED`. No write. |
| Merchant publish request | Before T1 | It holds the locks; T1 waits, then sees a newer `updated_at` (E7 fails) → `SKIP`. If its step opened the gate, E1 fails → `FLAG` on a later run only if it then goes quiet again. |
| #452 resume path (activation `held()` observing after a throttled read) | After T1 | `PgActivationStore.load` sees `ABANDON_CLAIMED` → returns `ABANDONED` without IO. The existing fence `catch` must exclude `ABANDON_CLAIMED`/`ABANDON_RESTORED` from its `OPERATOR_HOLD` rewrite (today it excludes only `RESTORED`, `RESOLVED`, `OPERATOR_HOLD`). |
| A late `public_config` write from a process that died before the gate change | n/a | Impossible for an eligible row: such a write required `OPENED`, and `OPENED` makes the row ineligible forever. This is the reason for the gate. |
| A second worker instance | Concurrent T1 | Serialized by the locks; the second sees `ABANDON_CLAIMED` → `SKIP`. |
| New publication `prepare()` | During `ABANDON_CLAIMED` | Refused by the existing unresolved-hold check (now `kind NOT IN ('RESTORED','RESOLVED','ABANDON_RESTORED')`). |

### 4.4 If the restore call itself is ambiguous

The adapter already classifies: a proved pre-fetch failure returns `NOT_DISPATCHED`; a timeout, lost acknowledgement or failed readback returns `RESTORATION_PENDING`; an exact readback that is not the original returns `CONFLICT` or (after the one allowed compensation) `REHELD_CONFLICT`. B stores the receipt and:
- `NOT_DISPATCHED`: stays `ABANDON_CLAIMED`; the next worker run may rearm once by consuming the receipt digest (migration 51, extended to `ABANDON_CLAIMED`).
- `RESTORATION_PENDING`, `CONFLICT`, `REHELD_CONFLICT`: `OPERATOR_HOLD`, never retried. Part A resolves it by observation only (§9).
- Crash between T1 and T2, or inside T2 before the receipt commits: the claim exists without a receipt. No later run may dispatch on it (the capability was local to the crashed invocation). After `ABANDON_CLAIM_STALE_MS` (default 2 minutes, longer than the 8 s adapter budget plus lock waits) the worker moves it to `OPERATOR_HOLD` with reason `claim_unsettled`.

## 5. Restore effect

The worker reuses `ProductAvailabilityHoldV3Port.restore()` unchanged:
- It reads the product and requires it to equal the owned `held` snapshot exactly and to be held-safe; otherwise `CONFLICT` with no write.
- It sends one status-only update to `before.state` and requires a qualified acknowledgement plus an exact readback of `before` (effective publication IDs, online-store presence, anchors; diagnostic timestamps ignored).
- On a semantic mismatch after a settled acknowledgement it uses the one reserved compensating re-hold, then stops.
- The adapter's per-process attempt set and quarantine stay in force; the worker creates one port per run.

`beforeSend` for B checks, synchronously and without IO: the installation scope captured under the lock is still the one in the claim, the offline token's expiry is more than 30 s away, and the T2 transaction is the one that holds the claim. B does **not** require Function release readiness or projection agreement: it returns the product to its prior state under the prior effective policy, which is what was live before the publish.

**Offline token, scoped.** The worker's port gets a credential port that returns one offline token acquired for this shop *before* T2 (the facade forbids re-entering `core.credentials.acquire` under the shop lock). That port is constructed only inside the abandonment job and exposes only `restore()` and the read it needs; it is never passed to publication, activation or any other job. The token's scope (`write_products`) is the existing one; no scope change.

## 6. Worker job

- **Where:** a new entry in the existing 30-second reconciliation loop (`apps/worker/src/reconciliation.ts`), error class `PUBLICATION_ABANDONMENT_UNAVAILABLE`. No pg-boss queue: the scan is cheap, the work is bounded and idempotent, and the loop already runs the other recovery passes.
- **Scan:** `m5_activation_state` joined to operation and progress, `kind IN ('HELD','ACQUISITION_PENDING','ABANDON_CLAIMED')`, `hold IS NOT NULL`, no `abandonmentReview`, quiet (or claim stale), current installation, ordered by `updated_at`, `LIMIT 10` per run. The existing partial index `m5_activation_unresolved_hold` covers it.
- **Bound:** `INSIGNIA_PUBLICATION_ABANDON_AFTER_MS`, default `900000` (15 min), accepted range 5 min to 24 h; values outside are a startup error. The floor keeps it well above the publish client's 60 s budget. See Q1.
- **Enable switch:** `INSIGNIA_PUBLICATION_ABANDONMENT=off|flag|restore`, default `off` in the first deploy. `flag` runs the scan and records `OPERATOR_HOLD` flags only; `restore` also claims and restores. This allows the first deploy to observe classification before any worker write to Shopify.
- **Idempotency:** the one-use claim, the immutable receipt and the terminal states. Re-running a run is a no-op on every row it already handled.
- **Logging:** `publication_abandonment` events with `shopId` (internal), `configId`, `operationId`, `outcome` (`restored | flagged | not_dispatched | ambiguous | conflict | skipped`) and `reasons`. `restored` at info; `flagged`, `ambiguous`, `conflict` at **warn**. No product titles, tokens or provider bodies.
- **Metrics:** counter `insignia_publication_abandonment_total{outcome}` (bounded labels, no shop label) and gauge `insignia_publication_holds_flagged` (count of `OPERATOR_HOLD` rows with a hold on current installations). Alerting on them is phase 5.
- **Failure policy:** a database or credential failure before T2's dispatch aborts the row for this run (no state change; next run retries). A provider failure after dispatch never retries (§4.4). Credential `reauth_required` or `inactive` → the row is skipped and logged at warn; it is not flagged, because nothing is known about the product.

## 7. Merchant UI

### 7.1 State machine

The server projection `projectActivationPublicationState` (`apps/web/src/server/admin/activation-state.ts`) stays the single owner of `PublicationState`. Two new values in `PublicationState` (`apps/web/src/shared/admin-view.ts` and its frontend copy):

| Activation kind / operation | New `PublicationState` | Classifier (`frontend/admin/src/islands/publication-state.ts`) |
|---|---|---|
| `ABANDON_CLAIMED` | `ABANDONMENT_RESTORING` | continuing (in `publicationInProgress`; blocks Publish; polling continues) |
| `ABANDON_RESTORED` (operation `failed`, `publication-abandoned`) | `ABANDONED_RESTORED` | settled; Publish allowed; the journaled request is cleared like `FAILED` |
| `OPERATOR_HOLD` with a pre-activation hold | `OPERATOR_HOLD` (existing) | operator-blocked (existing) |

The two new cases are handled before the existing `operationStatus === 'failed'` branch, which would otherwise map them to `OPERATOR_HOLD`.

The client derives the banner from one pure function next to the classifier, `publicationNotice(state) → { key, tone, actions }`, used by `SelectedProductContainer` in place of the inline ternary for publication states. The local `remote` state stays as it is (it describes this client's own write). No new flags in the container; `publicationFailed`, `publicationNeedsReview` and `publicationProgressing` are derived from `PublicationState` as today. The server's English `publication.reason` is not shown for these three states.

Server changes for the merchant path: `publication.advance` returns `{ kind: 'ABANDONED', phase: 'abandoned' }` for an abandoned operation; `activation.advance` returns a new `ActivationResult.kind = 'ABANDONED'`; the publish loop in `merchant-config.ts` stops on it; the new-revision conflict check (`existing.phase !== 'active'`) also accepts `abandoned`; `prepare()`'s gap check accepts an intervening operation that is `failed` with activation `ABANDON_RESTORED`.

### 7.2 Products list

`ProductConfigurationSummary` gains one derived field, `attention: 'publish_incomplete' | 'support_required' | null`, computed by the same projection (`ABANDONED_RESTORED`/`ABANDONMENT_RESTORING` → `publish_incomplete`; `OPERATOR_HOLD` with a hold → `support_required`). The products list shows it as a badge; the products reducer is unchanged (it renders the summary).

### 7.3 Copy (draft, for translation review)

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

`editor:placementWorkflowPreview.publicationSupportRequired` (replaces "Publication needs review." for a pre-activation hold)
- en: Publishing didn't finish and this product is temporarily unavailable in your store. Insignia support has to check it before it can be restored. Contact support and mention this product.
- nl: Het publiceren is niet afgerond en dit product is tijdelijk niet beschikbaar in je winkel. Insignia-support moet het controleren voordat het kan worden hersteld. Neem contact op met support en vermeld dit product.
- de: Die Veröffentlichung wurde nicht abgeschlossen, und dieses Produkt ist in Ihrem Shop vorübergehend nicht verfügbar. Der Insignia-Support muss es prüfen, bevor es wiederhergestellt werden kann. Wenden Sie sich an den Support und nennen Sie dieses Produkt.
- fr: La publication n’a pas abouti et ce produit est temporairement indisponible dans votre boutique. Le support Insignia doit le vérifier avant de pouvoir le rétablir. Contactez le support en indiquant ce produit.
- es: La publicación no se completó y este producto no está disponible temporalmente en tu tienda. El soporte de Insignia tiene que revisarlo antes de poder restaurarlo. Contacta con soporte e indica este producto.
- it: La pubblicazione non è stata completata e questo prodotto è temporaneamente non disponibile nel tuo negozio. L’assistenza Insignia deve verificarlo prima di poterlo ripristinare. Contatta l’assistenza indicando questo prodotto.

`products:attention.publishIncomplete` / `products:attention.supportRequired` (badges)
- en: Publish again / Needs support
- nl: Opnieuw publiceren / Support nodig
- de: Erneut veröffentlichen / Support erforderlich
- fr: À republier / Support requis
- es: Publicar de nuevo / Requiere soporte
- it: Ripubblica / Serve assistenza

## 8. Test plan (real seams)

Database (isolated PostgreSQL 18, real migrations and triggers, `packages/database/test`):
1. Trigger table: every row of §3.1 and §3.2, allowed and rejected, including `HELD → ABANDON_CLAIMED` with `remote_dispatch` `OPENED`/`UNKNOWN` (rejected), `OPERATOR_HOLD → ABANDON_CLAIMED` without operator authority (rejected), `ABANDON_RESTORED → *` (rejected), `NONE → OPENED` while `ABANDON_CLAIMED` (rejected), `prepared → shop-config-written` with `NONE` (rejected), immutability of `abandonmentClaim`/`abandonmentReview`, audit rows written by the trigger and not writable by the runtime role.
2. Default: an insert that omits `remote_dispatch` gets `UNKNOWN`; the migration backfills `UNKNOWN`.
3. `prepare()` after `ABANDON_RESTORED` succeeds for a first publication and for a mode change with an earlier effective operation (gap check).

Concurrency (two real connections, gated test doubles for Shopify):
4. Merchant retry vs worker claim, both orders: (a) worker T1 commits first → the merchant's `advance` returns `ADMISSION_PENDING`/`ABANDONED`, the gate stays `NONE`, zero field writes; (b) merchant gate transaction commits first → worker `FLAG`s or `SKIP`s, zero restores.
5. Late completion: a merchant `advance` blocked in a gated `remote.set` holds the shop lock; worker T1 waits; on release the worker sees `OPENED` → `FLAG` (never restores).
6. #452 resume: `activation.advance` after T1 returns `ABANDONED`, performs no observe, and does not rewrite the kind to `OPERATOR_HOLD`.
7. Two worker instances run T1 concurrently: one claim, one `SKIP`, one restore.
8. Crash injection: kill T2's connection after the adapter's fetch began → claim without receipt → after the stale bound `OPERATOR_HOLD`, never a second restore.

Application/adapter (`packages/application`, `packages/shopify`):
9. `decideAbandonment` and `settleAbandonmentReceipt` truth tables, matched against the trigger table.
10. Restore outcomes through the real v3 adapter with a fake Shopify: `RESTORED`, `NOT_DISPATCHED` (one rearm, then refused), `RESTORATION_PENDING` (timeout), `CONFLICT` (product changed by merchant), `REHELD_CONFLICT`.

Web and UI:
11. `projectActivationPublicationState` for the new kinds, including that `failed` + `ABANDON_RESTORED` is not `OPERATOR_HOLD`.
12. Editor (built UI, browser suite): each banner and its actions; Publish enabled after `ABANDONED_RESTORED`; a journaled publish request settles (cleared) on `ABANDONED_RESTORED`; polling moves `ABANDONMENT_RESTORING → ABANDONED_RESTORED` without losing local edits; keyboard focus on the banner action.
13. Localization: the new keys exist in all six catalogues (existing catalogue validators).

Native (rewrite-dev, test products only, standing approval):
14. Publish a test product, stop the request after the hold (close the tab after `HELD`), wait for the bound (set `ABANDON_AFTER` to 5 min for the check), confirm the product returns to Active, the editor shows `ABANDONED_RESTORED`, and Publish works again.

## 9. Part A: operator command (built after B)

Server-only CLI in the worker image, run over SSH on the host, like the signing emergency revoke. It adds no state; it uses B's states, triggers and evaluator.

```
insignia-publication-hold inspect --shop <shopId> --config <configId>
insignia-publication-hold restore --shop <shopId> --config <configId> --operation <operationId> --command-key <key> --confirm
insignia-publication-hold resolve --shop <shopId> --config <configId> --operation <operationId> --command-key <key> --confirm
```

- `inspect` (read-only): held since; activation kind and hold summary (`before`/`held` states, acknowledgement, claims, receipts); `remote_dispatch`; B's `decideAbandonment` verdict and reasons; a live Shopify read (offline token) of the product's availability and of the three metafields compared with the progress row's `prior_*_digest` values; a verdict "safe to restore: yes/no, because …".
- `restore`: only for `OPERATOR_HOLD` with an owned held receipt and no earlier restoration claim or receipt. It writes `OPERATOR_HOLD → ABANDON_CLAIMED` with `authority = 'SETTLED_BY_TRUSTED_OPERATOR'` and the command key (the operator's confirmation is the settlement decision the spec requires), then runs B's T2 unchanged. Outcomes and states are exactly B's.
- `resolve`: the existing observation-only path (`createAvailabilityRecovery` → `RESOLVED`, resolution row), for a product Shopify already shows in its original state (for example after an ambiguous restore that did land, or after the owner restored it by hand in Shopify admin). The CLI supplies the `TrustedAvailabilityRecoveryAuthorityPort` from the confirmed command.
- Every run, including `inspect`, writes one structured audit log line; `restore` and `resolve` are also audited by the database (abandonment audit table, resolution row). A command key is single-use per shop.
- Runbook in `deployment/m5-runtime/README.md`: when to use each subcommand, what "safe" means, and what to do if `inspect` says not safe.

First use: `QA cover B – Tee` (`OPERATOR_HOLD`, `remote_dispatch = UNKNOWN`). `inspect` shows whether the three metafields are still absent (`prior_mode` is null); if they are, the owner can confirm `restore`.

## 10. Migration outline (migration 65)

Up, one transaction, through the guarded schema owner:
1. `m4_publication_progress`: add `remote_dispatch text NOT NULL DEFAULT 'UNKNOWN' CHECK (remote_dispatch IN ('NONE','OPENED','UNKNOWN'))` (the default backfills every existing row to `UNKNOWN`); add `abandoned` to the phase check; replace `enforce_m4_publication_progress` with the §3.2 rules.
2. `m5_activation_state`: add `ABANDON_CLAIMED`, `ABANDON_RESTORED` to the kind check; add the `evidence_digest IS NULL` check for them; rebuild the partial index `m5_activation_unresolved_hold` with `ABANDON_RESTORED` excluded.
3. Copy-then-wrap (as migration 51 did) `m5_v3_hold` and `enforce_activation_v3_audit` to accept the new keys and the `ABANDON_CLAIMED` phase for `restorationClaim`/`restorationReceipt`/no-dispatch consumption; replace `enforce_activation_state` with the §3.1 table.
4. Create `m5_publication_abandonment_audit` (RLS, revoke all, immutable trigger).
5. `enforce_publication_transition`: the `publication-abandoned` failure-class check.
6. Grants: no new runtime DML; the worker role needs `SELECT, UPDATE` on `m5_activation_state`, `m4_publication_progress`, `publication_operations` (check current worker grants; web already has them). Update the expected ACL digests in the deployment README.

Down: refuses (raises) if any activation row has an `ABANDON_*` kind or an `abandonment*` hold key, any progress row is `abandoned`, or the audit table has rows. Otherwise it restores the copied functions and drops the column, phase and table (dropping `NONE`/`OPENED` values loses nothing that older code reads).

## 11. Rollout and rollback on rewrite-dev

1. Deploy migration 65, then web (gate-aware `prepare`/`advance`), then worker with `INSIGNIA_PUBLICATION_ABANDONMENT=off`. Read back: new progress rows are `NONE`; the existing rows are `UNKNOWN`.
2. Publish one test product to Active; confirm the gate opened (`OPENED`) and nothing else changed.
3. Set the worker to `flag`; confirm it flags nothing on a healthy store and leaves `QA cover B – Tee` alone (`OPERATOR_HOLD`, B never touches it).
4. Set the worker to `restore`; run native check 14 with a temporary 5-minute bound; restore the 15-minute default.
5. Rollback: set the switch to `off` (stops all worker effects at once). The web image can roll back to the previous one only while no row is `ABANDON_*` or `abandoned`: older code does not understand them. After the first abandonment, recovery is fix-forward, as for other new-format writes.

## 12. Open questions for the owner

Q1. **Time bound.** 15 minutes of no activity before the worker acts, configurable between 5 minutes and 24 hours. *Recommendation:* 15 minutes. It is long enough that no live publish (60 s client budget) is cut off and short enough that a product is not offline for long.

Q2. **Copy.** The drafts in §7.3, especially the support wording ("Contact support and mention this product"), since no alert reaches support automatically until phase 5. *Recommendation:* approve the English text now; translations go through the translation review before release.

Q3. **Flagged operations lose merchant resume.** When the worker cannot prove safety it moves `HELD` to `OPERATOR_HOLD`. A merchant who comes back later with the original request still journaled in the browser (up to 1 hour) can then no longer continue it. *Recommendation:* accept. Keeping it `HELD` would leave the merchant in today's "already in progress" dead end, and the operator path is explicit.

Q4. **Stale no-effect intents.** Operations stuck in `HOLD_INTENT`/`WAITING_*` (product never changed) and stuck same-mode operations also block the next publish. *Recommendation:* out of B; a small follow-up can close them as `failed` with no Shopify call, using the same quiet bound.

Q5. **Migration rollout.** First deploy with the worker `off`, then `flag`, then `restore` (§11). *Recommendation:* yes; the extra step costs one deploy-day read-back and gives an observed classification before the worker changes any product.

Needs owner approval before implementation.
