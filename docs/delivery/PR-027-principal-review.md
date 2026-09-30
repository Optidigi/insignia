# PR #27 principal review — CHANGES_REQUESTED (execution-contract hold)

## Binding

- Repository: `Optidigi/insignia`
- PR: `#27`
- Base/effective merge base: `f8fff36fca749c6b2b6666550e48c7e347b6d65f`
- Reviewed head: `ec8e5ea9090579a6f101632552aaa843afb2c688`
- Reviewed tree: `e54fa974f231db2d78bd01cd983870cd14be2d86`
- Synthetic merge: `83cb29aeeab0cabcbea4479f2fed8db5df35640a`
- Synthetic merge parents: exact base + reviewed head
- Synthetic merge tree: exact reviewed tree

PR #26 merge `f8fff36fca749c6b2b6666550e48c7e347b6d65f` has the
previously approved parents and tree.

The native GitHub REQUEST_CHANGES action returned HTTP 403 and was not posted.
This file is the external principal verdict.

## Code review result

No material code-level blocker was found in the reviewed M5-001 implementation.

Reviewed areas include:
- one ProductConfig per product and tenant/product ownership binding;
- M2-valid merchant draft projection;
- optimistic draft CAS and exact-key replay;
- independent copy-to-product;
- immutable M2 revision + geometry + presentation sidecars;
- pre-M4 committed-intent recovery;
- distinct-key publish races;
- installation-generation fencing;
- explicit shop-currency adoption;
- direct-Konva visualizer with typed owner state;
- normalized geometry and UI/canvas roundtrip;
- server-only admin composition;
- bearer/session-token authentication and online staff grants;
- mutation origin and permission controls;
- truthful publication states;
- M4 `prepare`/`advance` use without direct M3 activation;
- fail-closed entitlement/publication behavior.

The M5 current-publication pointer deliberately uses the immutable revision UUID
as the M5 publication operation UUID. The recovery and read paths are therefore
consistent rather than accidentally conflating unrelated identities.

The optional Shopify preview correctly remained NOT_RUN because a web-only
non-extension-mutating envelope could not be proven.

All ten workflows reported success on the exact reviewed head.

## Blocking process finding

After the M5-001 launch, the owner explicitly changed the execution requirement:

> main/local orchestrator, writers/subagents, Spec/correctness reviewers and
> Standards/security reviewers must use `6-1-sol high`.

PR #27 instead records fresh review sessions as `gpt-6-sol/high`.

The packet does not provide evidence that the integrated final source was
reread by a `6-1-sol high` orchestrator, and the required fresh independent
reviewers were not `6-1-sol high`.

This is a direct execution-contract mismatch.

The implementation does **not** need to be rewritten merely because of this.
The exact current source should be reassessed under the required model.

## Required correction

Keep existing PR #27 open.

Use **actual `6-1-sol high` throughout the correction**:

1. one `6-1-sol high` local orchestrator/integrator must reread:
   - root instructions;
   - current v1.4 plan/ledger;
   - M5-001 authority brief;
   - full final PR #27 source, not only the last delta;
   - current review packet and known limitations;

2. run fresh independent read-only:
   - Spec/correctness review using `6-1-sol high`;
   - Standards/security review using `6-1-sol high`;

3. reviewers must inspect the complete final implementation at the exact head,
   not only prior findings/deltas;

4. if either reviewer finds a material issue:
   - fix it on PR #27;
   - obtain fresh `6-1-sol high` rereview of the corrected exact head;
   - rerun complete final-head CI;

5. if no source changes are needed:
   - preserve head/tree;
   - add only a review/evidence correction if repository policy requires it;
   - retain the existing exact-head CI as source-bound evidence;
   - run a focused local verification sufficient to show the worktree still
     matches the reviewed head.

Do not manufacture a native GitHub approval.

## Existing limitations remain

- live embedded G7 remains unproved;
- third-party-cookie blocking was not directly measured;
- publication activation remains pending;
- deployed Function identity remains unverifiable;
- no real admission/all-channel hold exists yet;
- large-history query-plan performance is not measured;
- no complete G6/G7 gate is accepted.

## Verdict

CHANGES_REQUESTED solely for the model/execution-contract mismatch.

No code-level rework is required unless the required `6-1-sol high` rereview
finds one.

No PR #27 merge, activation slice, M6/M7 start, production publication,
Function deployment, production key/FX activation, gate pass or launch is
authorized.
