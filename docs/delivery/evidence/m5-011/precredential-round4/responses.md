# Response to precredential round4

The gate stayed closed; no credentials or authenticated Shopify calls occurred.

Spec found one additional material path: HTTP503 headers were treated as a settled transport while the unconsumed body remained active. Security independently reported no source finding; neither report was treated as sufficient to open the gate.

The wrapper now awaits disposal of every non-200 body under the existing deadline. Oversized200 cancellation and abort-triggered cancellation are also awaited. The underlying settlement latch requires both response headers and body consumption/disposal; cancellation rejection or non-settlement retains pending/UNKNOWN and prevents any bounded read. No cancellation retry, mutation retry or parallel provider call is added. Normally disposed HTTP responses retain the unchanged production adapter's failure kind.

Regressions cover a never-resolving fetch, open503 with hanging cancellation, oversized200 with hanging cancellation, aborted200 body with hanging cancellation, and rejected503 cancellation. They prove reads remain15, only the archive attempt is last, and UNKNOWN/pending remains. Current focused suite36/36, including100 serial synthetic cases. Fresh root checks, reviews and exact-source CI remain required.
