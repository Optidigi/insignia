# M5-025 qualification matrix

All current behavioral evidence is synthetic/offline. The invariant's failing control remains RED. A passing characterization establishes the blocker, not a production security correction.

| Criterion | Executed seam / evidence | Result and limit |
|---|---|---|
| PR55 approved entry | Live GitHub refs,11 workflows, review hashes, normal merge parents/tree/main | VERIFIED already merged; no repeat merge |
| Old signed-body replay | Built HTTP → durable PG18 inbox → actual production worker process | REPRODUCED; explicit safe-generation assertion RED |
| Changed delivery/event IDs | New keys with same body/HMAC; same-ID event change | New keys admit; same-key conflict503; no independent authority |
| Changed topic/time/API/domain | Actual verifier + HTTP/DB | HMAC unchanged; later time can rebind; another signed Shop mismatch is unverified; topic relabelling admitted |
| Genuine identical-body later uninstall | Synthetic hypothetical later event with identical body/HMAC | Indistinguishable from replay; no native emission claim |
| HTTP process isolation | Retained reused-database timeout; fresh dedicated HTTP database red/green | PASS dedicated control; timeout is not relabelled as expected security RED |
| Missing metadata / changed bytes | HTTP401 and verifier negatives | PASS admission validation; not generation protection |
| Missing/out-of-order delivery | Existing runtime preinstall/delayed receipt, unresolved recovery controls; full PG18 | Existing semantics regress; missed native subscription coverage NOT_RUN |
| Uninstall/reinstall/bootstrap races | Full managed-install PG18 races; new replay/no-replay bootstrap pair | Existing locks/generation fences regress; replay blocks bootstrap; authority gap remains |
| Provider unavailability | Existing online-identity/credential failure controls; uninstall source has no independent provider verification | Fail-closed auth regression only; new uninstall verification fallback NOT_IMPLEMENTED |
| Crash/retry | Existing real process/pg-boss controls killed around handler transaction | PASS retained queue/handler semantics; does not fix chosen-generation authority |
| Receipt admission vs deactivation | Real HTTP/durable inbox/production handler analysis and failing invariant | Admission already durable; authority separation in production NOT_IMPLEMENTED because missing independent input |
| Capability destination API/public app | Pinned public API/topic/input documents; source inventory | DOCUMENTED_CANDIDATE, no exact-app native acceptance/delivery proof |
| Callback secret/generation isolation | Threat/contract analysis | PROPOSED only; secrecy/proxy logs/rotation/recovery NOT_LIVE_QUALIFIED |
| Registration gaps/coexistence/reinstall | Public management/uninstall/retry docs, existing first-auth composition | UNQUALIFIED; no remote registration, inventory, uninstall or declarative change |
| Independent Partner/event-bus authority | Public object/query shape and trade-off analysis | UNQUALIFIED; no credentials, API or infrastructure added |
| Privacy/erasure | Separate signed synthetic `shop/redact` durable admission; handler deferral; retention metadata | Admission qualified; erasure/deadlines/backup tombstones NOT_PASSED; no waiver |
| Full local regression | Root check with real PG18, full database200, existing worker/HTTP/browser/activation suites | PASS commands in manifest; no live G7 claim |
| Publication/renderer | Existing100/100 stress and missing-renderer control | Local regression only; unchanged availability/whole-quote semantics |
| Production/build/history integrity | Git baseline comparison; local build inventory | Production source/config/history unchanged; local Astro build differs by path/chunk identity, not a deployment |
| New reviews and final CI | Two actual independent full-source reports + exact-head natural runs attached to PR | Required before handoff; principal authority remains separate |

The hard-stop deliverable deliberately does not substitute a mocked callback service for required platform authority. A failing-then-passing **production security correction** is NOT_RUN: the authenticated inputs needed to make it sound are not established. The red control and green blocker characterization remain separately named and hashed.
