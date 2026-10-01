# PR #27 principal rereview — APPROVED

## Binding

- Repository: `Optidigi/insignia`
- PR: `#27`
- Base/effective merge base: `f8fff36fca749c6b2b6666550e48c7e347b6d65f`
- Approved head: `506f2b39e5713563dc4f5b2beed3937489985bd7`
- Approved tree: `5ef7c9337177da96b6589589c8468a3c823f389e`
- Synthetic merge: `ed05c90094b970c1c6183e73880e7edea6d69868`
- Synthetic merge parents: exact base + approved head
- Synthetic merge tree: exact approved tree

This supersedes the external CHANGES_REQUESTED verdict on old head
`ec8e5ea9090579a6f101632552aaa843afb2c688`.

The native GitHub APPROVE attempt returned HTTP 403 and was not posted.
This file is the external principal verdict.

## Required-model correction closed

The execution-model requirement is now satisfied:
- orchestrator/integrator: `gpt-6.1-sol`, high;
- Spec/correctness reviewer: `gpt-6.1-sol`, high, read-only;
- Standards/security reviewer: `gpt-6.1-sol`, high, read-only;
- both final reviewers read all 65 PR paths and interacting M2/M3/M4 seams;
- both report no unresolved material finding.

Earlier GPT-6-sol reviews remain historical only.

## Corrected findings accepted

The required-model review found and corrected concrete defects:

1. Choice removal now removes associated label metadata, including nested option-value labels.
2. Visualizer image URLs are resolved from persisted product/variant image identities.
3. Open-publication checks are current-installation/current-status scoped.
4. Successful save no longer retains stale publication eligibility.
5. Publication continuation refreshes publication metadata without replacing dirty geometry/form state, CAS base, or an uncertain save request.
6. Editor monetary defaults are exact lexical zero; all configured fixed/tier/override values are validated against admitted currency exponents without rounding.
7. M5 commands lock the current tenant/install before durable command reservation, closing a reproduced PostgreSQL `40P01` deadlock.
8. Same idempotency key + different valid body is surfaced as sanitized HTTP 409.

No M2 money semantics, v2 wire, Function source or v1.4 architecture decision changed.

## M5-001 accepted

Accepted at this slice's scope:
- authenticated ProductConfig list/detail admin surfaces;
- one config per shop/product;
- versioned merchant draft;
- M2 validation;
- draft CAS and exact-request recovery;
- independent copy-to-product;
- immutable economic revision + geometry/presentation companions;
- current publication pointer/pre-M4 crash recovery;
- generation-scoped publication continuation;
- direct Konva renderer with deterministic normalized geometry;
- one typed editor/application state as canvas/UI authority;
- truthful publication states;
- production M4 prepare/advance with no direct M3 activation;
- fail-closed entitlement/currency behavior.

## Verification

All ten workflows report SUCCESS on exact head `506f2b39...`.

Final-head runs:
`36780150557`, `36780150625`, `36780150525`, `36780150635`,
`36780150524`, `36780150707`, `36780150712`, `36780150810`,
`36780150548`, `36780150646`.

Local corrected evidence records:
- complete root suite exit 0;
- 32 web passes + 6 DB-gated skips;
- PostgreSQL 52/52;
- six current Admin PostgreSQL/HTTP integration tests;
- focused money and publication-preservation regressions;
- clean exact-head worktree.

### Retained intermittent foundation failure

Foundation attempt 1 at the same source failed:
`publication failed preserves dirty local edits and exact save recovery`
with `centerX` `0.5` instead of expected `0.6`.

No code/test change occurred before attempt 2 passed.
Four focused local repeats also passed.

The cause is unestablished. It is retained as an M5 browser-flake/race
qualification item. It is not treated as solved by retry. M5 remaining work
must stress this path further.

## M5 remains incomplete

Still unproved:
- live embedded G7;
- measured third-party-cookie blocking;
- deployed Function artifact identity;
- publication activation;
- all-channel/in-flight admission boundary;
- large-history query-plan performance.

No complete G6/G7 gate is accepted.

M5-002 is separately authorized by the accompanying brief.
