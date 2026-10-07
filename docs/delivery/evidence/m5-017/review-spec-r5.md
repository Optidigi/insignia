**Fresh round5: no unresolved material finding on either axis.** Principal approval remains external and ungranted.

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

## Standards

No unresolved material documented-standard breach or actionable baseline smell.

I inspected the complete affected implementation, migration, tests and guarded harness, including interacting publication admission, recovery and web composition—not only changed hunks.

The explicit application/adapter/persistence boundaries remain intact. Git comparison confirms historical v1/v2 contracts, adapters, recovery tests, migrations and old guarded operators are unchanged. The additive migration preserves historical predicates and adds v3 identity, ownership, immutable audit and downgrade fences.

## Spec

No unresolved material finding.

The review covered acquire/observe/restore, direct anchor inclusion and capability drift, schedules, durable claims, crash/replay, conditional compensation, recovery, SQL equivalence, tenant fences, freshness/deadlines, process guard, accounting and the exact-source gate.

I independently inspected every prior correction:

- Scheduled originals, unsafe original DRAFT and retained acquisition ACKs without held evidence cannot regain successful held authority. Adapter rejection precedes transport; coordinator admission and SQL enforce corresponding boundaries while preserving incidents.
- Every supplied successful restoration ACK requires qualification, including original DRAFT. The coordinator normalizes an unqualified RESTORED response to CONFLICT **before persistence**, retains ACK/readback evidence and enters OPERATOR_HOLD. SQL rejects successful scheduled-ACK receipts; ACK-free safe DRAFT restoration remains supported.
- Ambiguous writes cannot authorize replay, compensation or automatic cleanup. Settled semantic mismatch permits one reserved compensation with immutable audit.
- Final native dispatch rechecks freshness, credential expiry and request/mode deadlines after gate/fsync/accounting work. Identity/grant contradictions poison authority before malformed or error projections. Known unsent denials retain matching accounting.
- The precredential gate requires both independently bound reviews, frozen source/build and all eleven unique exact-source attempt-one workflow successes.

I read required authority/history documents, rounds1–4 reports/settings/responses, all encoded original red receipts and relevant neutral failure/green logs. Original TDD failures, the first root history-hash failure and failed runtime CI remain **failures**. Earlier greens and clear Spec verdicts do not override NOT_CLEAR findings or qualify this HEAD.

Executed only read-only Git/file inspection and evidence parsing/hash comparisons. **No tests, builds, database operations, credentials, network/provider/browser operations, mutations or delegation.** [Same-launch settings](/home/serveradmin/insignia-m5-017-handoff/review-spec-r5.settings.json) record `gpt-6.1-sol`/`high`, read-only/never.

Exact-head qualification remains pending. Live is **NOT_RUN**; canonical run is absent. Local mocks establish no live evidence.

**Totals: Standards 0 material findings; Spec 0 material findings; no worst issue on either axis.**