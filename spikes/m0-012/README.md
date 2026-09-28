# M0-012 isolated real-contract metering prototype

This package targets only app `gid://shopify/App/429028933633`, shop
`gid://shopify/Shop/105501393179`, the retained private draft
`insignia-dev-zero-20260928`, and its `customized_order_paid` meter. It does
not change the historical M0-010/011 adapters or qualify a commercial plan.

`evidence/baseline/operator-report.md` and
`evidence/baseline/partner-active-after-approval.json` are byte-for-byte copies
of the local operator handoff. Their SHA-256 values are respectively
`51455d03486082ce2dc61fc0056e3990e0484bdedb5fe9736359247a0f19a9d2`
and `60585fbd45f378f17d8402e81a1efe36d120f1969917a68c857f4ba9d65f38de`.
The approval narrative is a native UI observation; the JSON is an actual
Partner 2026-07 read at `2026-09-28T16:53:10Z`. The reported subscription GID
is **`legacySubscriptionId`**, not a returned top-level `id`. Its field name
does not establish migration history. Draft nominal USD 0.01 per event and
effective dev-contract zero pricing are separate observations.

The prototype preserves both `price.active:false` values, whose cause remains
unknown, while requiring a non-null exact active subscription, zero USD flat
and VOLUME tier prices, a current unchanged 30-day cycle, no trial/pending
change/cancellation, and app/shop/plan/meter identities. Missing usage remains
UNKNOWN. Fresh Partner reads occur before token acquisition and again after
it; changed terms stop the event POST.

The event route is pinned to `https://api.shopify.com/app/2026-07/events`.
Shopify's [current App Events reference](https://shopify.dev/docs/api/app-events/latest)
shows this endpoint, one event per request, and HTTP 202 `success:true` as
receipt only. Billing processing requires the Dev Dashboard **App Billing
Event** log and a separate Partner quantity/cost read. Missing token scope or
expiry is retained as UNKNOWN under the principal's immediate-use prototype
exception, while explicit Bearer type is required; a supplied contradiction
rejects. The old strict token guard stays unchanged.

The single fixed operator CLI is `node spikes/m0-012/src/operator.ts` with
`read`, `init`, `inspect`, or `send E1|E2|E3`. Its private run locator and
register live at `/home/serveradmin/.local/share/insignia-public-app/m0-012-run`.
The CLI reads the two existing 0600 credential files as data, checks owner
and directory mode, and prints only sanitized observations. `init` is
single-use. It requires a clean fixed implementation commit and observed zero
usage. The register fixes one source SHA, one endpoint and run ID, stores exact
event bytes before acquisition, and counts uncertain dispatches. A lost or
corrupt register or held lock blocks the run; do not reset it. Each `send`
call makes at most one token acquisition and one event POST. E1 duplicate
reuses its exact key/body/time. E2/E3 only proceed after the expected Partner
quantity; the remote operator must also verify an actual App Billing Event
processing entry before advancing. No event is a real order assertion.

Local proof: `corepack pnpm install --frozen-lockfile && corepack pnpm check`
under this directory. No credential, token, live POST, or browser is required
for tests or CI.
