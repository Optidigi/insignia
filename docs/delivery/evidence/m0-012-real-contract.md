# M0-012 — actual new-app contract and no-charge metering

Checked 28 September 2026 UTC. The source for the live sends was fixed clean
commit `ef9d50c6e77fe87913c3fd6242c6c4f2782875ae` on
`spike/m0-012-real-contract`, branched from verified remote `main`
`e77e4e42f8858662889f9814eeb7d0c4ed3713ab` (the normal PR #16 merge).
The implementation/evidence PR is for principal review and is **not** merged.
The [principal's prototype disposition](../M0-012-principal-disposition.md)
and [issued execution brief](../prompts/M0-012-real-contract-and-metering.md)
are imported as records, without amending v1.2 architecture.

## Baseline identity and economics

The [actual pre-run operator report](../../../spikes/m0-012/evidence/baseline/operator-report.md)
and [Partner HTTP 200 response](../../../spikes/m0-012/evidence/baseline/partner-active-after-approval.json)
were copied byte for byte from the local handoff. Their hashes are recorded in
the spike README. The subscription GID `gid://shopify/AppSubscription/38085427483`
appears as `legacySubscriptionId` and matched the native approval redirect; no
top-level subscription ID was invented.

Immediately before the run, an authenticated **read-only** Partner 2026-07
query scoped to Optidigi org `4697030` returned the exact new app
`gid://shopify/App/429028933633` and shop `gid://shopify/Shop/105501393179` /
`insignia-rewrite-dev.myshopify.com`, current cycle
`2026-09-28T16:53:01Z..2026-10-28T16:53:01Z`, no trial, scheduled
cancellation or pending update. Plan `insignia-dev-zero-20260928` was one
`FlatRatePrice` with USD `0.0`; meter `customized_order_paid` was one VOLUME
tier with `upTo:null`, USD `0.0` per unit and USD `0.0` flat. Both price
records had `active:false`; the value is preserved and its cause is **unknown**.
Initial observed usage was quantity 0, cost USD `0.0`.

The native private-plan editor showed only the designated store under Stores
with plan access, both subscription-fee and broad free-development-store
checkboxes off, and nominal USD `0.01` per event under the single meter. The
nominal draft charge is **separate** from this development subscription's
effective zero tariff. After the run, the native pricing setup still showed
**Draft and test plans** current, **App Pricing enabled** not started, one
private plan, zero public plans, and the same one-store restriction. No
subscription, plan, meter or app-wide pricing setting was changed by M0-012.

## Guarded execution and direct results

The current official [App Events reference](https://shopify.dev/docs/api/app-events/latest)
documented `POST https://api.shopify.com/app/2026-07/events`; this URL was
pinned before E1. The direct HTTPS token boundary required explicit Bearer
type, did not cache a token and imposed its own 30-second use deadline. On each
of four acquisitions, top-level scope and expiry were absent and remained
`UNKNOWN`; the resource server accepted the one-use bearer. No JWT-derived
scope/lease was asserted. The historical strict M0-011 guard was untouched.

The [durable register](../../../spikes/m0-012/evidence/live/run-register.json)
and [independent receipt](../../../spikes/m0-012/evidence/live/run-receipt.json)
bind the run ID, one source commit and endpoint. Exact payload bytes were
reserved before token acquisition, possible POSTs before dispatch. Their
operator-owned originals remain outside the worktree. The run used **3**
distinct synthetic value:1 events, **4** POST attempts and **4** token
acquisitions; ceilings were 3/6/6. No uncertain dispatch occurred.

| Attempt | Key | Transport | Native billing observation | Partner quantity/cost |
| --- | --- | --- | --- | --- |
| E1 | `6d2be512e4f3ddb18f6d4980a0b4ba76` | HTTP 202, `success:true` | App Billing Event **SUCCESS**, exact key/shop/handle/value; [detail](https://dev.shopify.com/dashboard/200969036/apps/429028933633/logs/next_show?highid=117349984705016875&lowid=13436888381465704697&time=now-7d..now&timestamp=2026-09-28T18%3A04%3A21Z&type=APP_BILLING_EVENT) | 0 → 1 / USD `0.0` |
| E1 exact replay | Same key, body and occurrence time | HTTP 202, `success:true`; no replay header observed | No second processed App Billing Event row appeared in the immediate observation | 1 → 1 / USD `0.0` |
| E2 | `5df5ab2456f020705f9d2cf87dfd602f` | HTTP 202, `success:true` | App Billing Event **SUCCESS**, exact key/shop/handle/value; [detail](https://dev.shopify.com/dashboard/200969036/apps/429028933633/logs/next_show?highid=117349994797036541&lowid=11734444553274286991&time=now-7d..now&timestamp=2026-09-28T18%3A06%3A55Z&type=APP_BILLING_EVENT) | 1 → 2 / USD `0.0` |
| E3 | `b69dc64a35db4ac8bd5357973e928b94` | HTTP 202, `success:true` | App Billing Event **SUCCESS**, exact key/shop/handle/value; [detail](https://dev.shopify.com/dashboard/200969036/apps/429028933633/logs/next_show?highid=117349997693663656&lowid=12836214746424942647&time=now-7d..now&timestamp=2026-09-28T18%3A07%3A39Z&type=APP_BILLING_EVENT) | 2 → 3 / USD `0.0` |

The [six-round operator log](../../../spikes/m0-012/evidence/live/observation-rounds.md)
records each paired Partner read and native filtered-log inspection, including
the short lag before E3's log appeared. The final [sanitized live contract
read](../../../spikes/m0-012/evidence/live/final-contract.json) at
`2026-09-28T18:10:01.787Z` still had exact identities, cycle and zero
effective prices, and numerical usage quantity **3**, cost USD **0.0**. These
are distinct claims: each HTTP 202 was **RECEIVED**, native SUCCESS established
**BILLING_PROCESSED**, and the Partner read established **METER_COUNT_OBSERVED**.

## Local verification and scope limit

Pinned Node `v24.21.0`, pnpm `12.6.0`:
`corepack pnpm install --frozen-lockfile` and `corepack pnpm check` passed
strict TypeScript and **33** synthetic tests on the fixed live source. Tests
cover the actual imported contract, both fresh-read positions, wrong identity,
price/cycle/transition rejection, one-use token and metadata handling, exact
replay, budget exhaustion, concurrent lock, whole-directory loss and mandatory
billing attestation. `python3 -B spikes/m0-007/scripts/check-history.py`
passed: v1.2 plan/ledger, 41 earlier sources and 120 historical receipts were
unchanged. `git diff --check` passed. Fresh read-only Spec and security reviews
identified and then verified corrections to the independent receipt, native
billing evidence gate, full tracked-source binding, safe log URL and 40-character
Git HEAD acceptance. Both returned PASS on the fixed source before E1.

This is one effective-zero development subscription and one cycle, with an
immediate exact-key replay. It does **not** prove lifetime deduplication,
commercial tariffs or invoices, three production plans, allowance/trial
qualification, historical billing reconstruction, or a complete G8 gate. The
new app stays in draft pricing; no final Enable/Switch/Publish, subscription
change, public plan, new credential/scope, preview/deployment, buyer order or
legacy/staging mutation occurred. Orders #1001–#1006 remain untouched. The
principal retains gate and architecture adjudication; M1 remains unauthorized.
