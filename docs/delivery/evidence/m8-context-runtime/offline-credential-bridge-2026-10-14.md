# Verified merchant to offline credential bridge — 14 October 2026

Native buyer configuration previously failed at catalog credential acquisition; the exact active generation had no stored offline pair. This correction connects the existing verified merchant session to the existing encrypted credential lifecycle. Native issuance/deployment remains pending.

## Implemented behavior

The buyer-enabled server bootstraps from an authenticated account owner with product-read permission. Online staff authorization remains independent. It reuses existing credentials; missing or terminally reauthorization-required credentials reserve one durable acquisition lane shared with refresh. Acquisition does not happen on every request. A reserved lease can expire before dispatch; dispatched uncertainty cannot expire into a retry, including after restart. Existing active/refreshing/revoked credentials cannot be overwritten through initial installation.

The pinned SDK exchanges an expiring offline pair once. The adapter verifies the exact session identity, bounds transport and response size, rejects redirects, validates both tokens/returned expiration, and conservatively subtracts request time. The acquired token independently reads the current installation; exact shop/install and canonical scope equality with the online observation are required before atomic encrypted persistence. Completion rechecks generation, authorization generation/epoch and installation identity. Only a definite invalid-subject-token rejection clears dispatch. Malformed success, identity/scope mismatch, response loss or lost persistence acknowledgement remain fenced.

Migration32 adds the credential-specific lane; it does not add an infrastructure service or login. Existing web capability receives table SELECT/INSERT/UPDATE, existing queue consumer receives SELECT for refresh exclusion. Shops/generation locks serialize processes; the worker does not need UPDATE on acquisition records. Populated rollback refuses to erase evidence. Historical schema fixtures remain unchanged; only current migration-count checks/documentation moved to32.

## Verification and review

Meaningful RED included the verified merchant composition observing missing buyer credentials before integration, absent SDK offline exchange, stale-auth rejection incorrectly clearing a dispatched lane, and a real Node-fetch302 sending one request to a forbidden destination before redirect rejection. These failures led to corrections, not infrastructure reruns into a claimed native pass.

Local results on final production source: application276; Shopify424; observability5; targeted PostgreSQL18.6 acquisition/lifecycle/identity43; verified merchant→SDK→encrypted pair→buyer credential composition5; existing admin publication/readiness40; auth/buyer-bootstrap plus composition22. Web typecheck/build,18 boundary controls, style and secret/provenance checks passed. Database agent earlier full suite270pass/5explicit skips precedes its final role tests; final targeted43 includes those corrections. Environment skips remain limits. The wall-clock expiration assertion failed by1ms under a full run; a pinned clock plus100ms transport latency now verifies exact13:00 access/next-day12:00 refresh expiration from the12:00 issuance base. Production expiry logic was not weakened.

Fresh independent Spec/correctness review CLEAR at a3997b10281b42dfd56680e630d2c101f0b41bbf. Standards/security found redirect disclosure in the installation reader, independently reproduced with synthetic local servers. Correction7dab5ca21de04070c311d3ea7e2454d395d9c715 received independent CLEAR and23/23 focused rerun; original source review remains applicable. Follow-upf22127dbc7a0205e7d9fba542be561633f7e82c1 changes only the pinned-clock regression. No self-review is relabeled independent.

Both owner-allocated headed browser sessions were freshly checked at exact Admin Themes/Dev Dashboard URLs, screenshots inspected and no challenge/login signals. Dev Dashboard still shows m8-cookie-91b35ab Active and one installation. Contexts closed; no staff logout. Private screenshot paths are retained locally, never contain an exposed secret.

## Native continuation

After final-candidate CI and normal integration: qualify/apply only schema32 to the allocated Insignia database, import the actual qualified CI web image, quiesce/rebind the existing verifier around the exact web replacement, preserve other services and existing grants. Use the verified owner session to trigger one bounded native acquisition; independently verify encrypted metadata/credential reuse and buyer config. Stop on unresolved exchange, drift or renewed challenge. No new Shopify scope/version/reinstall is indicated by the researched direct-exchange contract; exact native eligibility remains untested.

Then real original upload/inspection, exact quote/cart, permitted test checkout, independently qualified creator/enforcement, intended worker admission, purchase/first-paid and merchant original retrieval. Native purchase admission stays disabled. Merchant publication timeout/stale-status and raw-ID label defects remain in the worklist. No artwork/cart/order effects, charge, native acceptance or rollout claimed by this correction.


## PR128 runtime CI correction

Exact head ef7f16895a800a81e000d9af5c62f518e88c8585: foundation38596516124 and durable-core38596515818 passed; runtime38596516199 failed in the existing worker credential recovery test. Its fixture attempted to install the old pair over the active refreshed pair, which the new acquisition guard correctly rejects. The same error was reproduced against an isolated local PostgreSQL18/schema32 database.

Correction dd4e723ca60a6c8da49768840d02049213da107c changes the fixture only. A synthetic refreshed pair has120s access validity; attempting old-pair overwrite must reject and leave the new access token intact. A180s minimum-validity request (within the existing300s bound) obtains the supported refresh claim, after which installation deactivation still rejects stale replacement. Lost-response retry using the same refresh token and cross-process single-flight assertions remain. No production guard, permission or expiry was changed.

Focused test1pass and full worker suite79pass/2explicit skips (81total). Independent impact review CLEAR at dd4e723, with its own focused PostgreSQL1pass/0skip rerun. The failed workflow remains evidence; fresh final-head CI is required. Native acquisition/deployment remains pending. The disposable local test database was dropped after checks/review; the shared PostgreSQL cluster and other resources were preserved.
