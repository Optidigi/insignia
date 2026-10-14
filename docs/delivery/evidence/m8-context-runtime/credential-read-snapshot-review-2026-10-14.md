# Valid credential read during quote acceptance

Reviewed code candidate `41af021a06bb4b2eed737dc096191fc4b8386634` against integrated base `640346e5ac6a120733a48ebb320900cbd146da68`. Subsequent changes are documentation only.

The native USD15 review succeeded, but acceptance timed out without an accepted quote/application or cart lines. A real PostgreSQL regression reproduces the lock cycle: acceptance owns shop/installation locks, then readiness acquires the same locks through a separate credential connection. Test-only lock_timeout500ms/statement_timeout2s bounds the failure. The unchanged test becomes GREEN when a valid pair is read from one current-installation snapshot without exclusive refresh/acquisition locks.

Actual checks: four affected PostgreSQL files/23 tests PASS (acceptance, offline acquisition, runtime credentials, renewal); database typecheck, changed-file Biome, diff whitespace and secret/fixture checks PASS. RED/initial harness failures and GREEN logs remain private in the existing handoff directory. The persistence regression uses synthetic release evidence; it does not prove native release or checkout acceptance.

Independent Spec/correctness reviewer `accept_read_spec`: CLEAR for the narrow valid-credential correction. Current installation/generation, active credential/schema, actual expiry, pending acquisition exclusion and authenticated envelope identity remain exact; final quote installation/publication/key/economics fences are unchanged.

Independent Standards/security reviewer `offline_bridge_security`: CLEAR at the same candidate. No documented standard breach or material security finding. The repeated eligibility/decryption checks protect distinct read/state-changing boundaries. Its stale current-index config phrase was corrected afterward as documentation only. Reviewers inspected source/evidence read-only and did not independently rerun shared tests/native effects; instruction-only read isolation is not a network/credential sandbox.

Complete lifecycle composition remains unqualified: a near-expiry token can require exclusive refresh inside acceptance, and stale/missing release evidence can require an append whose installation foreign key conflicts with acceptance. These need preparation outside the serialized window and passive final checks without weakening freshness/authority. Native acceptance/cart/checkout/purchase/original access remain due; purchase admission stays disabled.
