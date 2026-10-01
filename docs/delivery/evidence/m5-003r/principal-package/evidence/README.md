# Principal offline evidence — reviewed source, not a correction

The source snapshots were reconstructed from GitHub connector content at `a426719e5350f61ecb5620f6c90ab7a0e365e66b` and verified byte-for-byte by Git blob identity before execution:

| Snapshot | Original repository path | Git blob |
|---|---|---|
| availability-hold.ts | packages/shopify/src/availability-hold.ts | 4685b97caffa3b7c98600bceda5af9e5ff0f9d44 |
| production-activation.ts | packages/database/src/repositories/production-activation.ts | 15c9a83b957065b41bfb06eab929b9aaace6aa53 |

`probe.mjs` executes the complete unchanged hold adapter with synthetic HTTP, current-credential and clock dependencies. It extracts the exact `established` callback from the second hash-verified source file and supplies a synthetic store. Its scope-digest helper reproduces the application digest on the all-string scope fixture. It does not execute PostgreSQL or the entire activation coordinator.

Executed with Node v22.16.0 in an isolated review container:

```sh
node --experimental-transform-types probe.mjs
node --experimental-transform-types probe.mjs --assert-contract
node --experimental-transform-types probe.mjs --assert-status
```

The characterization exits 0 and produces `results.json`. The two contract assertions exit 1 as expected at this old source. `--assert-freshness` is also supported as the isolated R1 assertion. `contract-red.*` records the R1 failure; `status-red.*` records the R2 failure. The runtime's experimental warning is retained.

R1 uses a deterministic injected-clock model of a payload captured before 2,000 ms of transport delay, not an actual two-second sleep. The complete adapter reports age zero; the exact admission callback accepts under a 1,000 ms budget. R2 checks three valid existing statuses, UNLISTED and a genuinely unknown control. All HTTP responses and credentials are synthetic; no request leaves this process.

These are fixed-source diagnostics, not a full pinned-Node-24 test run or an evergreen test of future code. The local correction must reproduce them through real public application/database seams and commit regression tests against the actual corrected modules. No successful live hold, restoration, checkout, production artifact authority or merchant rollout is implied.
