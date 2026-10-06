# Responses to precredential round 3

The gate remained closed. No credentials or authenticated Shopify calls occurred.

1. Required grant loss: every production adapter read now checks all four grants and equality to the captured baseline before a status dispatch. A regression strips read_product_listings and proves zero mutations.
2. Newly appearing V2 membership: retention requires observed membership in ACTIVE and DRAFT. Newly appearing DRAFT membership is classified DIFFERENT_PLATFORM_BEHAVIOR.
3. Adapter error semantics: the wrapper records sanitized fields and returns original bounded bytes/status to the unchanged production port. Direct versus wrapped regressions cover userErrors, HTTP403, GraphQL ACCESS_DENIED, invalid JSON, absent body, malformed scopes and malformed nodes, with matching failure kinds and adapter read counts. Authority failures remain fail-closed.
4. Outstanding timed-out request: the underlying transport settlement controls the quarantine. A request ignoring abort keeps pending/UNKNOWN and prohibits the bounded read; no second provider call overlaps. The regression observes only15 reads and leaves cleanup UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING.

TDD red receipts review-findings-red.log and shape-parity-red.log; green review-findings-green-final.log has32/32 focused checks including100 serial synthetic runs. Fresh full-source reviews and exact-source CI are still mandatory before credentials.
