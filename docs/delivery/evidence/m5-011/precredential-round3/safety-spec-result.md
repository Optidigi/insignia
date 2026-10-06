Material findings remain. The precredential gate should stay closed.

Base: `1fffcb3048952ff762f1f9805f86aceed90f228f`  
Head: `26e109aa58d514592c4a93de280a20d355aaeab5`  
Head tree: `b1c5f1e5cd78be81ace6e03f4011194c8c8b2715`

## Spec

- **P1 — Observed required-grant loss still permits DRAFT dispatch.** [operator.mjs:532](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/operator.mjs:532) checks only two grants on production adapter reads and keeps the previous full identity cached. The requirement mandates all four grants and stopping on drift. **Executed counterexample:** initial identity/projections contain all four; every adapter read subsequently lacks `read_product_listings`. The unchanged production adapter still dispatches one synthetic DRAFT mutation. **Smallest correction:** validate each adapter-read grant set against all four required grants and the captured baseline before allowing dispatch.

- **P2 — Newly appearing V2 membership is reported as retained membership.** [qualification.mjs:45](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/qualification.mjs:45) defines retention solely from the DRAFT projection. The requirement asks whether V2 “retain[s] publication” and says “Do not infer beyond captured evidence.” **Executed counterexample:** publication absent from every ACTIVE V2 partition, present only in DRAFT; classification is nevertheless `SNAPSHOT_FIELD_DEFECT_SUPPORTED`. **Smallest correction:** require observed V2 membership before and after; classify newly appearing membership as different platform behavior.

## Standards/security

- **P2 — The transport changes the production adapter’s failure behavior.** [operator.mjs:546](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/operator.mjs:546) throws a generic transport exception for provider user errors; HTTP/GraphQL errors follow the same pattern. This compromises the required recording of the actual “adapter result (HELD/CONFLICT/failure).” **Executed counterexample:** identical `productUpdate` rejection produces `user_error` directly, but `NOT_HELD` through the new operator, with an additional adapter read. **Smallest correction:** retain sanitized evidence while delivering provider statuses and classification-preserving error envelopes to the adapter; keep settlement and cleanup guards separate.

Counts: **Spec 2, worst P1; Standards/security 1, worst P2.** These are material findings, not optional smell concerns.

## Evidence

Examined all six `scripts/m5-011/*` files in full; production availability source and built JavaScript; interacting M5-004 operator/binding/qualification, M5-009 operator, M5-010 operator/qualification/recovery; package scripts, CI, configuration, authority documents, report/research and supplied evidence. Applied the pinned code-review and TDD/tests/mocking guidance without delegation.

**Executed read-only checks:**

- Requested full diff and commit log; diff whitespace check passed.
- Checkout clean and exact head confirmed.
- Production packages, inherited operator sources and prior evidence directories unchanged against base.
- Production adapter source SHA-256 matches base: `aeb68cf151fc5b3fba0974e7fb659a8bcc422c0b2e517f478e0f2b185e7ab421`.
- All six new modules passed syntax checks.
- TypeScript 5.9.3 compilation with output captured entirely in memory reproduced the existing availability JavaScript byte-for-byte.
- Three counterexamples above executed successfully. Synthetic HTTP and in-memory filesystem boundaries caused zero external requests or filesystem writes.

**Supplied evidence inspected:** combined operator log reports focused **22/22**, including 100 synthetic cases; browser stress **100/100**; preserved negative controls; ten-document schema validation. The standalone focused log remains at **20/20**. Root receipt names earlier head `f0b9176…`; final exact-head root checks and CI were not independently verified.

Repository test suites and live experiment: **NOT_RUN by this reviewer**. A Node child-process verification attempt was denied with `EPERM`; the full freeze verifier was not executed. Actual same-launch reviewer model settings were not exposed here.

No credentials, closed registers or authenticated tools were accessed. This is a local review report, not external principal approval.