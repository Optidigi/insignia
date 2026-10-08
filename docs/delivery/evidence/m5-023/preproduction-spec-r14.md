CHANGES_REQUESTED — Spec/correctness, round14, bound only to head `8a37adcb06c49b32f624da650b15022f9cade621`.

Clean tree, expected tree and effective merge-base verified before and after inspection.

**P2 — Provisioning can qualify an operator that cannot append.** [trusted-release-roles.sql:13](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/trusted-release-roles.sql:13) grants schema/table/sequence privileges without granting or checking required function EXECUTE. [host-operator.py:435](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:435) likewise checks CONNECT/INSERT but no operator function privileges; lifecycle function checks cover only `insignia_runtime`.

Concrete counterexample: revoke EXECUTE on `pg_catalog.clock_timestamp()` from PUBLIC while retaining its explicit grant to `insignia_runtime`. Lifecycle qualification and operator provisioning can pass, allowing deployment and owner Search. The newly created operator nevertheless fails with `42501` at [release-append.mjs:171](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/release-append.mjs:171), where the deadline predicate directly calls that function. Migration16’s default also requires it.

This violates brief §6’s requirement that the dedicated operator can append. Smallest correction: grant and verify the exact function privileges required by the operator append path, including `clock_timestamp()`, in role provisioning/readback. Add an isolated PG18 control with PUBLIC EXECUTE revoked and runtime access retained, proving a fresh operator append succeeds.

The r1–r13 findings and root objections were reassessed against interacting source. The latest deadline/rollback and DBA-binding corrections are supported by static inspection and supplied local controls. Those controls do not cover this operator privilege case.

This review executed no tests or project scripts and used no network, credentials, delegation or live access. Supplied execution evidence remains distinct from my static inspection. No freeze, live-readiness or principal approval is granted.