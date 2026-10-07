Two unresolved material findings.

Verified BASE `4bba14fb4415815557ffa5f1e600427a62128489`, HEAD `12c422b5fdba75e92c70df7735b03a3a8ef65469`, tree `f708e3d00b0f709d2df19584ea5b9f85fb6d641e`; working tree clean. Actual commit subject:

`12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold`

Comparison command:

```sh
git diff 4bba14fb4415815557ffa5f1e600427a62128489...12c422b5fdba75e92c70df7735b03a3a8ef65469
```

## Standards

**P2 — Required PostgreSQL web integrations still use the superseded new-activation contract.**

At [activation.ts:457](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/activation.ts:457), new activation correctly requires v3. However, [activation-integration.test.mjs:108](/home/serveradmin/insignia-m5-017-worktree/apps/web/test/admin/activation-integration.test.mjs:108) still constructs the v2 adapter and later expects v2 evidence. The merchant-publication helper likewise supplies a v2 snapshot at [synthetic-activation.mjs:73](/home/serveradmin/insignia-m5-017-worktree/apps/web/test/admin/support/synthetic-activation.mjs:73), with no acquisition acknowledgement.

Requirement: M5-017 §13, **“Run full regression, PostgreSQL18 CI…”** The mandatory [runtime workflow:79](/home/serveradmin/insignia-m5-017-worktree/.github/workflows/m3-runtime.yml:79) executes both integrations with PostgreSQL enabled.

Concrete failure: both fixtures reach the v3-only guard and throw `Hold snapshot malformed or future intent unqualified`. The preserved [web-v3-integration-red.log](/home/serveradmin/insignia-m5-017-handoff/web-v3-integration-red.log) records exactly these two failures, with zero passes. The incompatible fixtures remain at this HEAD. This is a source regression, separate from still-pending CI.

Smallest correction: upgrade these **new-activation** fixtures, adapter selection and evidence assertions to v3, including valid acquisition ACKs. Preserve separate historical v1/v2 coverage. Rerun both integrations through the required PostgreSQL runtime step.

No additional material smell finding from the supplied baseline.

## Spec

**P2 — Visible schedule evidence in mutation ACKs does not prevent v3 success.**

[availability-hold-v3.ts:543](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:543) checks only the subsequent snapshot before returning HELD. [Line 597](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:597) similarly checks only the subsequent snapshot before returning RESTORED.

The ACK validator accepts structurally valid staged/future publication evidence; it does not require schedule absence. The [SQL ACK/hold predicates:89](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:89) also allow these success records.

Requirement: M5-017 §9, **“If present before acquire, while held, or after restore: … never claim v3 success.”**

Concrete counterexample: the status mutation returns an exact-product ACK containing `isPublished:false` and a future `publishDate`. The following complete read contains no schedule and otherwise matches the required state. Acquisition returns HELD, or restoration returns RESTORED, despite having observed unsupported schedule evidence. This is a source-derived counterexample; I did not execute it.

Smallest correction: gate success on absence of visible schedules in the retained ACK as well as the complete readback. Preserve the settled ACK for conflict/operator handling; do not relabel it ambiguous or authorize compensation without the required readback mismatch. Add acquisition/restoration ACK-only schedule tests and SQL success-record rejection tests, while permitting conflicting ACKs to remain in audit evidence.

## Inspection and execution

Inspected full changed implementation, migration, tests and guarded harness source, plus interacting activation/publication/recovery paths, original v1/v2 contracts/adapters/migrations, required authority documents and prior adjudication reports. Reviewed durable dispatch claims, ambiguity handling, compensation, anchors, freshness/deadlines, tenant fences, SQL immutability, transport accounting and the precredential gate. Byte comparisons confirmed the original v1/v2 contracts, adapters, adapter tests and migrations are unchanged.

Executed only read-only Git, source/log inspection and hashing commands. No tests, builds, database, credentials, network/provider/browser operations, mutations or delegation.

Original red/setup failures and the first root-check architecture-hash failure remain failures. Inspected subsequent green logs do not constitute my execution or live evidence. The second root pass predates the final quiescent-deadline test; final exact-head qualification is not attested here. Live remains **NOT_RUN**, with no canonical run.

Standards: **1 finding, worst P2**. Spec: **1 finding, worst P2**. Principal approval remains external and ungranted.