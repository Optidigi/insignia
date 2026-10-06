# M5-015R — STOPPED, fixture remains ACTIVE

The one fresh live attempt stopped at `provider_shape` on the production v2 ACTIVE snapshot. The independent production v2 cleanup-prestate snapshot failed the same way. **No archive mutation was dispatched. Fresh fixture `gid://shopify/Product/10495813091611` is last verified ACTIVE and remains unarchived.** No further provider, credential, resume or cleanup operation is authorized in this closed run.

Marker: `insignia-m5-015r-746f0a94-9ce4-4679-a324-6647f59c6c0f`.

The outcome is **STOPPED**, not PASS or PARTIAL. The raw harness cleanup label is `UNSETTLED_CLEANUP`: this means cleanup could not be qualified, not an unknown archive write. Both actual mutations (create and ACTIVE setup) have settled acknowledgements. There are no pending requests or unknown mutation settlements.

## Exact observed rejection

The valid DRAFT v2 snapshot had empty configured intent, empty effective membership, no schedule and held-safe visibility. `FUTURE_CAPABILITY_NOT_OBSERVED` refers to included Publications in that valid DRAFT snapshot; an ambient future-capable Publication that did not include the product is not coverage.

Both saved ACTIVE responses report legacy `resourcePublications` membership `gid://shopify/Publication/339456917787`, `isPublished=true`, `publishDate=2026-10-06T21:27:58Z`. The complete enumerated `publications` connection contains only `339456885019`, `339456950555` and `339456983323`; their filtered `includedProducts` connections are empty. The effective Publication is absent from that enumeration. All saved connections have `hasNextPage=false` and `hasPreviousPage=false`.

The unchanged application [v2 validator](../../packages/application/src/publication/availability-v2.ts) requires effective IDs and publication evidence to be contained in configured-intent IDs. The unchanged production [v2 read](../../packages/shopify/src/availability-hold-v2.ts) therefore rejects this assembled snapshot as `provider_shape`. [Exact saved-field observations](evidence/m5-015r/publication-coverage-observations.json) and a [memory-only replay](evidence/m5-015r/saved-active-replay.json) reproduce the failure through the production factory with zero external requests.

This does not establish why the Publication is missing, or its configured intent. No extra publication lookup, broader listing, reinterpretation, invariant weakening or production correction was performed. A complete enumerated connection did not provide the configured-intent authority needed for the observed effective membership.

## Closed lifecycle and accounting

| Stage | Result |
|---|---|
| Exact app/shop/installation/development/current minimum grants | PASS; additional valid `read_product_listings` recorded |
| One fresh DRAFT create / ownership | ACKNOWLEDGED / exact |
| Production DRAFT v2 snapshot | Valid, held-safe, no schedule |
| One direct DRAFT → ACTIVE setup / ownership | ACKNOWLEDGED / exact ACTIVE |
| Production ACTIVE v2 snapshot | `provider_shape`; no validated ACTIVE v2 snapshot returned |
| Hold intent / acquire / returned hold | NOT_RUN |
| Fresh live resume / observe / restore | NOT_RUN |
| Independent cleanup-prestate snapshot | `provider_shape` |
| Archive mutation / final ARCHIVED v2 snapshot | NOT_RUN; fixture remains last verified ACTIVE |

All **10 actual outbound attempts** have matching durable events/transport ordinals and PID: auth1 + GraphQL9, create1, direct status1, adapter status0. All responses were HTTP200 and passed the operator's data/error envelope checks; production semantic validation rejected ACTIVE. Native dispatch/reservation counts are both10 with no mismatch; no retries occurred. All other mutation categories are0. [Exact raw register](evidence/m5-015r/run/register.json), [qualification output](evidence/m5-015r/run/qualification.json) and [closure](evidence/m5-015r/closure.json).

Create ACK `updatedAt=2026-10-06T21:27:54Z`, next owned read `21:27:55Z`; ACTIVE setup ACK `21:27:58Z`, next owned read `21:27:59Z`. Both diagnostic deltas are exactly+1000ms. No timestamp tolerance/CAS change was introduced. Acquire/restore ACK diagnostics are NOT_RUN. [Diagnostics](evidence/m5-015r/timestamp-diagnostics.json).

## Gate before credentials

PR45 was normally merged as `6a186bea8e5d1c01a66f7ab683c06393fe81e991`; ordered parents/tree and remote main matched external approval. [Receipt](evidence/m5-015r/pr45-merge-receipt.json). M5-015 remains permanently STOPPED with historical source/raw records unchanged; its six reconstructed incident reads do not consume fresh M5-015R budgets.

Live source was frozen at `c7ff662b01c20aea2b60c677a47b093a1c48b9f0`, tree `120d331e00cb95d56bc4712947a61f06683a2640`, with3,166 source/build hashes. The canonical live directory was absent until the entire gate verified. Two fresh actual GPT-6.1-sol/high read-only/never full-source reviews found no unresolved material findings, and all ten exact-source attempt1 workflows passed before credential access. [Freeze receipt](evidence/m5-015r/preinitialize-receipt.json), [exact binding](evidence/m5-015r/run/binding.json), [gate](evidence/m5-015r/run/gate.json), [source CI](evidence/m5-015r/source-r2-ci.json).

The process privately captures native fetch, makes global fetch immutable/fail-closed as `network_escape_denied`, and gives production v2 only `fetchImpl: op.fetch`. Durable reservation, ledger equality, counter and PID checks precede dispatch. Omitted/typo transport tests deny locally with native0; correct private-native auth/create/status/snapshot proof uses eight loopback requests; imports make zero calls. Both separate synthetic start/resume processes install the guard before their credential loader. This is fetch escape control, not OS network isolation. [Red](evidence/m5-015r/guard-red.log), [green](evidence/m5-015r/guard-green.log), [full proof](evidence/m5-015r/guard-final-proof.log).

Local qualification passed: focused36, v1/v2 adapters170, recovery20, two complete root regressions, publication stress100/100, expected renderer negative control. Applicable source CI ran PostgreSQL18.6 with161 database tests in each PostgreSQL workflow, runtime/integration/migration and actual-plan coverage. Local PostgreSQL remained unavailable without DATABASE_URL, not passed. [Offline report](evidence/m5-015r/offline-report.json), [raw/copy provenance](evidence/m5-015r/offline-log-provenance.json), [PostgreSQL evidence](evidence/m5-015r/postgresql18-source-evidence.json).

The first Spec review found two cleanup defects, reproduced red and corrected before credentials: lost archive ACK must remain UNKNOWN/STOPPED and permits at most one ownership/status classification read. Both fresh full-source reviews were repeated on corrected source. [Findings/responses](evidence/m5-015r/review-findings-responses.md), [Spec](evidence/m5-015r/review-spec-r2.md), [Standards/security](evidence/m5-015r/review-security-r2.md).

All3,166 bound source/build files were unchanged at run closure. Canonical raw bytes are copied exactly and hashed; files are owner-read-only inside the private directory, not claimed filesystem-immutable. All39 historical canonical hashes and historical M5-015 source/evidence remain unchanged. No historical fixture was touched.

## Principal boundary

PR46 integrates this truthful STOPPED evidence. Fresh completed-change reviews and final-head CI must be supplied in its external review packet, without creating a self-referential commit. No successor merge.

The principal must adjudicate the unarchived ACTIVE fixture and the Publication coverage gap. A future authorized cleanup should qualify a separate fixed status-only disposable-fixture cleanup path; the closed/frozen M5-015R run cannot be reopened or bypassed. A future read-only investigation may qualify exact omitted-Publication resolution and configured-intent authority before any production correction. These are proposals, not new execution authority.

Core ACTIVE → DRAFT → ACTIVE membership semantics, fresh-process live recovery, restoration, final archive, live future-capable included intent and scheduled behavior are NOT_PROVEN. No production activation, RELEASE_BOUND/G7, M6/M7, full gate acceptance or launch is claimed. No publication mutation, deletion, app scope/version, inventory/variant/price/media, billing/cart/order operation occurred.
