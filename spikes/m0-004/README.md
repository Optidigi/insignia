# M0-004 — local authorization and exact-money proof

This is the isolated M0-004 package. It exercises local portions of G2/G3/G5; it does not deploy either Function or qualify live checkout enforcement. The principal's [slice](../../docs/delivery/prompts/M0-004-authorization-exact-money.md) and the unchanged [implementation plan](../../docs/architecture/implementation-plan.md) control the contract.

## Internal dependency map and ownership

1. **Integration owner (orchestrator):** confirm the high-effort host report, predecessor merge, fixed candidate byte contract and public test fixture format. Own this directory's shared contract/fixtures, root package scripts and lockfiles, CI, gate/state pointers and final evidence.
2. **TypeScript writer (orchestrator):** implement the Node 24 reference codec, signer, fixed-vector setup allocation and exact decimal boundary in `ts/`. Test public behavior with immutable expected bytes and amounts.
3. **Rust writer (separate worktree):** implement independent decoding/encoding, strict verification and complete-set logic in `rust/`; own local Cart Transform and Validation target adapters under `extensions/`. Run native and Wasm tests and report source/schema limits. Do not edit shared fixture/contract/CI/state files.
4. **Integration owner:** reconcile cross-language fixtures, acquire pinned public schemas, run both real target harnesses and benchmark full paths or preserve the narrow failure boundary. Run the package check, independent Spec and Standards reviews, fix ordinary findings and return one PR.

Only the orchestrator owns shared files. The Rust writer does not use merchant credentials or mutate Shopify. This package does not touch orders #1001–#1004, the existing M0-001 Function/schema or historical receipts.

## Status boundary

G1 remains IN_PROGRESS with the principal's limited C/R/B acceptance and immediate-R capture gap. This package may move only local G2/G3/G5 evidence to IN_PROGRESS. No protocol freeze, public-app qualification, live G6 enforcement or M1 readiness follows from local results.

The [local evidence](evidence/README.md) records a real complete-target instruction-budget failure: the optimized candidate reaches only four isolated signed buckets under the 11M reference limit, and three signed buckets with 197 ordinary lines exceed it. That is an architecture/capacity issue for principal review, not a passed product capacity. The pure authorization/exact-money behavior and both schema-valid synthetic Function paths remain useful reusable work. No Shopify resource was changed.
