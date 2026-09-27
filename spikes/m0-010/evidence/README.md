# M0-010 local evidence — 27 September 2026 UTC

## Fixed starting point and boundaries

Owner-authorized normal merge of PR #12 was verified on remote `main` as `31484d328ec401a30994d073518b11eb67777433`, with exact parents `85282155631d6ab8048d65a3d2ca8ab050c76c06` and `5596c34a31ea603cd897ceea280192d09bc24c99`. The latter is the externally approved, green-CI PR #12 head. This worktree's branch `spike/m0-010-hybrid-billing` started at that merge. The supplied package manifest's five SHA256/length checks passed before work.

The host reported `gpt-6-sol` with high reasoning effort for this launch. One orchestrator wrote the implementation; a separate read-only research scout examined primary provider documentation. Fresh Spec and Standards/security review dispositions are in the review packet. Neither local review constitutes principal approval. No authenticated Shopify API, app preview/cleanup command or billing submission ran in this slice. The stopped M0-009 preview and staging installation grants were deliberately left untouched.

## Reproduction and actual observations

Run from `spikes/m0-010`:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

The local check ran on Node 24.21.0, pnpm 12.6.0 and TypeScript 5.9.3: strict `tsc --noEmit` passed; Node's test runner reported **31 passed, 0 failed**. Tests drive `BillingApplication` through a fake subscription port, one atomic in-memory fact/outbox, fake App Events and aggregate comparison. They cover one 500-garment paid order as one unit, another order as a second unit, trial/included-band rules, stale and ambiguous history, frozen/cancelled/downgraded status, concurrent/duplicate paid facts, post-payment lifecycle immutability, restart and key-generation failure, provider timestamp/fractional-tier forms, future event deferral, timeout-after-receipt, stable idempotency/time, retry/terminal errors and asynchronous billing failure after 202.

From repository root:

```sh
python3 -B spikes/m0-007/scripts/check-history.py
```

This passed with architecture v1.2 hashes `8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145` (plan) and `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a` (ledger), 41 earlier sources and 120 receipts unchanged. The scoped CI workflow repeats frozen install, history and TypeScript tests without secrets. Final-head CI run IDs belong in the PR body after publication.

## Source-bound contract and limits

`provider-contract.md` records the read date, versioned Partner API/App Events fields, primary documentation URLs, synthetic response fixtures and unverified capabilities. The 2026-07 parser reads a current active subscription and individual historical event pages only. It cannot prove full historical coverage, precise trial/effective boundaries, or existing-app Partner API eligibility. Current `activeSubscription: null` is not treated as proof about an old order. A production normalizer must establish exact, paginated history before supplying `VerifiedHistory`.

`VerifiedPurchase` is a trusted upstream interface for an independently verified Shopify order, first full payment and customization; that verifier is **not** built here. A source tag and GID checks in this local proof do not authenticate real input. The current `FakeSubscriptionPort`, `FakeAppEvents` and restartable in-memory snapshots make deterministic failure tests possible; they are not PostgreSQL durability, worker leasing, provider acceptance or invoicing. Local `TRANSPORT_ACCEPTED` means HTTP 202 only. `AGGREGATE_MATCH_ONLY` means quantity and artificial cost match in a single-plan fake cycle, never that an individual event was billed. Mixed-plan and real fractional-price arithmetic remain unresolved. Real asynchronous failures require authorized Dashboard inspection and operator reconciliation. No-charge eligibility, plan/meter setup, Partner API/App Events credentials and live delivery remain NOT_RUN.

No offer, historical buyer access, policy, Function, schema, product, inventory, payment or order was changed. No plan/ledger amendment, new fixture order or staging cleanup occurred. Version 2 remains provisional; Option A publication/fencing and full G7/G8 acceptance remain open.
