# M0-010R correction evidence — local only

This is an addendum to the original [M0-010 evidence](../README.md). The principal's attributed [PR #13 review](../../../../docs/delivery/PR-013-principal-review.md) requested R1 and R2 corrections on reviewed base/effective merge base `31484d328ec401a30994d073518b11eb67777433` and head `fc6159664a829962983a33cdfe5c415645aee29e`. No original receipt or architecture decision was rewritten.

## Reproduce the reviewed defects

The attached handoff manifest verified all twelve supplied file hashes. PR #13 was OPEN at the reviewed base/head and the working tree was clean before editing. The host ran Node `v24.21.0` and pnpm `12.6.0`.

The principal-supplied [diagnostic](principal-reproduce.mjs) was run against **complete repository modules** at reviewed head `fc6159664a829962983a33cdfe5c415645aee29e` in a detached baseline worktree:

```sh
node spikes/m0-010/evidence/m0-010r/principal-reproduce.mjs /home/serveradmin/insignia-m0-010r-baseline
```

Exit **0** means the *defects* were present. The saved [Node 24 result](pre-fix-node24.json) records R1 `until: null`, `ALLOW` before/at/one minute after the scheduled cancellation and `PENDING_VERIFY` only after snapshot expiry; all twelve R2 nonzero/malformed/missing tier-flat-amount cases incorrectly returned `ACTIVE`. The `0.005` unit-rate control remained `ACTIVE`. The supplied [source-verification metadata](principal-source-verification.json) is retained as principal attribution; the local run imported the actual complete baseline modules.

New tests were written at the parser → `currentHistory` → `BillingApplication.decideNewAction` seam **before** the production change. With those tests copied into the original detached checkout, `node --test test/application.test.ts` exited **1**: R1 expected the `00:00` ceiling but got `null`; R2 expected `UNSUPPORTED_TARIFF` for first-tier `1.00` but got `ACTIVE`. The complete [red public-seam output](red-public-seam-node24.txt) is retained. The detached checkout's test file was restored byte-for-byte afterward.

## Closure

| Finding | Corrected behavior on current candidate | Local proof |
|---|---|---|
| R1 known cancellation ceiling | `currentHistory` ends old active authority at the provider's exact scheduled cycle end. Before `2026-06-15T00:00:00.000Z`: `ALLOW`; exactly at and one minute after: `PENDING_VERIFY`, while the same snapshot is still younger than five minutes. Pending-plan and trial boundaries likewise end old authority; the unscheduled paid control remains `ALLOW` one minute after cycle end while fresh. | New public-seam test in `test/application.test.ts`, covering parser, normalizer and application. No cancellation outcome or renewal is invented. |
| Review edge: empty pending update | A non-null pending update with no plan item is now `UNKNOWN_CONTRACT`; it cannot authorize a new action after the cycle end. This is a conservative parser response to an accepted-input edge, not a claim about live provider behavior. | Additional public-seam test first failed with `ACTIVE` instead of `UNKNOWN_CONTRACT`, then passed with `PENDING_VERIFY` at the application. |
| R2 tier flat amount | Both `PriceTier.amount` values must be exact decimal zero. `0`, `0.0`, `0.00` and `0.000` pass for each tier. Positive, negative, malformed, null and absent values return `UNSUPPORTED_TARIFF` and leave the application at `PENDING_VERIFY`; `amountPerUnit: "0.005"` remains valid. | New public-seam table test in `test/application.test.ts`. No floating-point comparison or new production tariff is introduced. |

On the corrected code, the old diagnostic deliberately exits **1** at its *old* R1 assertion (`until === null`); [captured output](post-fix-diagnostic-node24.txt) proves it now sees the exact boundary. Its old R2 assertions are after that first assertion, so the committed public-seam test is the post-fix R2 proof. `corepack pnpm install --frozen-lockfile` passed on Node 24.21.0/pnpm 12.6.0, followed by strict TypeScript and **34 tests, 0 failures**, including all 31 pre-existing tests. `python3 -B spikes/m0-007/scripts/check-history.py` passed: plan SHA256 `8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145`, ledger `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a`, 41 old sources and 120 receipts unchanged. The staged diff check passed and a 14-file staged scan found no secret patterns.

The parser-only Partner API contract remains synthetic. No authenticated Shopify/Partner/App Events call, event, plan, meter, contract, order, preview command or staging change occurred. `VerifiedPurchase`, complete historical normalization, durable transaction, real no-charge eligibility and provider billing outcomes remain unverified. The accepted stopped preview and existing grants were untouched.
