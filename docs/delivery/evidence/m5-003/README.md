# M5-003 evidence index

All new provider observations here are synthetic. No real Shopify/provider operation, owner credential read or real activation occurred.

## Executed evidence

- `pr28-premerge.json`, `principal-verification.json`, `pr28-merge.json`: exact approved PR28 inputs, ten successful attempt1 runs, external principal verdict and verified remote merge parents/tree.
- `query-plan.json`: final built public read-seam SQL and PG18.6 EXPLAIN ANALYZE BUFFERS over100,001 history rows foroneconfig plus5,000 current configs. Exact source/output hashes, rows, indexes and machine timings included. `query-plan-initial.json` retains earlier pre-integration measurement; it is not the final binary proof. `query-plan-fixture-red.log` retains incorrect benchmark-fixture ordering, subsequently corrected.
- `activation-example.json`: actual sanitized immutable public readback from real PG plus synthetic release/Function/Shopify transport integration. A synthetic RELEASE_BOUND premise is not release evidence.
- `pg-full.log`: all73 PG tests, including21 new activation tests, with migrations run twice. The first new-suite run collided on a reused synthetic unique ShopID (`pg-activation-first.log`); `pg-activation-green.log` records21 passes after only the fixture identity correction.
- `http-pg-final.log`: all14 real PG/HTTP/server composition tests. Earlier failing build/state/module integration attempts remain in `root-first.log`, `http-pg.log`, `http-pg-green.log`.
- `writer-a-receipts.json`, `hold-red.log`: meaningful behavior failures and writer corrections. Writer prerequisite limitations are explicit; integrated results supersede skipped PG/unbuilt-root claims.
- `digest-red.log` / `digest-green.log`: an evidence-array getter was incorrectly invoked; exact hashing now rejects accessors, sparse arrays and extra array properties without execution.
- `release-red.log` / `release-green.log`: absent production trusted source remains null; dev/mismatched records fail closed.
- `database-api-final.log`:18 compiler negative API probes and4 runtime deep-import rejections, including no activation store, raw commit/session or lower-level publication.activate on the public facade.
- `renderer-control.log`: deliberately missing renderer fails the actual component/canvas readiness test; the normal control command requires this failure.
- `root-integrated-green.log` and `stress-100.log` preserve executed passing root and100-case results. `log-provenance.json` records raw/sanitized hashes; ANSI/trailing whitespace normalization changes no substantive result. The final frozen-root run and review dispositions are added after completion. Final candidate refs/workflow URLs are in the actual PR body, avoiding self-referential committed head claims.

## Crash/recovery and race matrix

| Boundary | Executed test source | Result |
|---|---|---|
| Before hold / persisted intent | application/publication/activation.test.ts; database/test/activation.test.ts | No dispatch before committed intent; unknown dispatch observes, never blindly sends |
| Acquisition response lost | both activation suites + shopify/availability-hold.test.ts | Reobserve owned snapshot; no second acquisition. No durable ownership => operator hold |
| Held before publication | PG and web activation-integration | Fresh hold evidence gates publication; resume publication then independently verify activation |
| Evidence inserted then commit failure | PG activation injected trigger failure | Evidence/effective operation both roll back |
| Concurrent activation | PG activation race | One immutable evidence/effective activation |
| Commit before restoration | PG + web integration | Effective revision committed; RESTORATION_PENDING retained until observed restore |
| Restore response lost / merchant drift | application/PG/hold suites | Observation only; exact owned state required; explicit operator conflict, immutable evidence retained |
| Reinstall / epoch / supersession / revocation | application and PG locked races | Current tenant/key/op locks fence; no restore after authority changes; old hold remains visible in recovery read model |
| Remote projection drift before activation or restoration | application + PG | Fail closed; no restore to availability over drift |
| Function presence/build/release stale or missing; preview/source evidence | application/readiness/release suites | Production blocked; trusted synthetic premises accepted only in tests |
| Merchant-local day crosses key interval during reads | application activation | Final clock/day readiness rechecked |
| Same-mode vs first/mode-change | application + PG | Same-mode acquires no hold; first and both transitions require owned hold |

The status adapter is a candidate without native atomic version CAS. Pre-read/write races and in-flight cart/checkout propagation remain unproved. Operator-held unknown ownership is deliberately not resolved by another automatic mutation. No real release-source implementation is wired; production requires independently trusted RELEASE_BOUND evidence.
