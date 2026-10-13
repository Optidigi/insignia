# M8 completed-source Standards/security review

Independent native reviewer `/root/m8_security_review`, candidate `8acd574537f131af58d9eae86e1a5faec176cea0`, base `3ae4b8505d4c383fbb874694ef870454b6a074ef`. Read-only instruction, not enforced filesystem/connector isolation. No edits/tests/credential access/native writes.

Concrete P2 findings:

1. `appendArtwork`/`lockArtwork` call outer-DB `get`/`ready` while retaining a transaction connection/row lock. Four requests exhaust production's four-connection pool, then wait for another connection. Use the same transaction executor throughout guarded reads; real small-pool regression required.
2. Expired replacement can fall back to original in HTTP view until cleanup sets `erasedAt`; null masked ATTACH identity must be an erasure barrier.
3. Raw production groups returned after normalized groups were validated; preserve validated accepted grouping.

Additional contract concern: provider `Order.test` disappears from durable facts. M9's non-test qualification must not depend on a later potentially unavailable 60-day order read. Preserve immutable provider test status, conservatively unknown for preexisting records; no usage billing in M8.

Non-blocking judgement calls: `purchase.ts` has multiple reasons to change (possible Divergent Change); repeated current-artwork resolution already diverged (possible Duplicated Code). Repo rules outrank skill heuristics.

Cumulative architecture consistent: Shopify network/SDK in adapter, application binding rules, independent domain and renderer; server identity/ownership, signatures/history, safe raster/original lifetimes and collection deadlines preserved. Candidate needs concrete corrections. Native context, grants, historical images and carried M5–M7 limits remain explicit.

Root corrections and independent impact verdict recorded separately.
