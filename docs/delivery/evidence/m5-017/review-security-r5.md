Round5: **no unresolved material finding** on either axis.

Verified clean checkout:

- BASE `4bba14fb4415815557ffa5f1e600427a62128489`
- HEAD `424e4af4133993a6d61579e86f10d9138d3f40c2`
- Tree `dbd32e6e63ebff9ebd68ecb669f6900e3bb46da5`

Executed comparison:

```text
git diff 4bba14fb4415815557ffa5f1e600427a62128489...424e4af4133993a6d61579e86f10d9138d3f40c2
```

Actual commit subjects:

```text
12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold
2dde06d fix(m5-017): close review findings before live source freeze
316419d fix(m5-017): fence original hold authority and require all applicable CI
b06cc05 fix(m5-017): deny unheld incident ACK adoption and successful SQL receipts
424e4af fix(m5-017): qualify every supplied restoration ACK before durable success
```

## Standards/security

No unresolved material finding.

I inspected complete resulting contracts, adapters, activation/recovery repositories, migration, guarded harness and changed tests, plus publication/web interactions and historical operator interfaces. I checked malformed-data handling, identity/grant poisoning, tenant/product fences, immutable audit phases, mutation reservations, ambiguity, transport escape control, deadlines, freshness and cleanup authority.

The prior security objections have corresponding source corrections: scheduled originals cannot establish held authority; retained acquisition ACKs without held evidence cannot be adopted; supplied restoration ACKs require qualification even for original DRAFT; and the gate requires all eleven applicable workflows. Final dispatch checks occur after gate/accounting work, using conservative observation origins and private monotonic deadlines/expiry.

The smell baseline produced no material maintainability objection.

## Spec

No unresolved material finding.

The implementation preserves explicit v1/v2 dispatch and recovery meanings while introducing v3 effective-anchor semantics. Original anchors remain directly checked while held; visible schedules fail closed. Durable claims precede acquisition/restoration dispatch. Ambiguous writes cannot authorize replay, compensation or cleanup; settled restoration mismatch permits one conditional rehold.

The latest [coordinator correction](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/activation.ts:553) and [SQL predicate](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:116) agree: absent restoration ACK remains allowed for safe original DRAFT, while every supplied ACK must qualify for success. Unqualified ACK evidence is retained as conflict.

I read the required authority documents, historical reports, all four prior review rounds/settings, response claims, original encoded red receipts, neutral failure logs and named green logs. The original runtime CI failure, root history-check failure and behavioral reds remain failures. Earlier clear reviews and green executions did not override NOT_CLEAR findings.

**Inspected versus executed:** I executed only read-only Git/file searches, reads and evidence parsing/hash comparisons. I ran no tests, builds, database operations, provider/browser/network operations or mutations; accessed no credentials; and spawned no agents. Supplied green logs are inspected evidence from other executions.

Current exact-head qualification is not established by this review. Live remains **NOT_RUN**, and the canonical M5-017 run is absent. Principal approval remains external and ungranted.

Standards/security: **0 unresolved material findings**. Spec: **0 unresolved material findings**.