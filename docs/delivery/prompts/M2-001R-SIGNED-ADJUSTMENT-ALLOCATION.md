# M2-001R — final signed-adjustment allocation correction

## Scope

Continue existing PR #21 only.

Do not create a successor PR and do not merge.

The sole required semantic correction is that signed placement/step unit adjustments are validated against each **final allocated unit price**, after setup allocation, rather than against the intermediate `contextual base + unit adjustment`.

## Required implementation behavior

In `priceProposal` or equivalent production-owned pricing code:

- Keep contextual base nonnegative and bounded.
- Keep aggregate signed unit customization exact and bounded.
- Allow an intermediate `base + unit adjustment` to be negative.
- Apply deterministic setup allocation using the already-reviewed ordering.
- Validate each final bucket price only after adding its setup share.
- Final unit price must be `>= 0` and within the Money/u64 bound.
- Final bucket line total must be exact and bounded.
- Complete group and proposal totals must conserve exactly.
- No floating-point arithmetic.

Do not change:
- identity semantics;
- tier semantics;
- setup frequency;
- FX policy/version;
- schema versions unless genuinely required by the fix;
- override semantics;
- experimental Function protocol;
- architecture/ledger v1.3.

## Mandatory red/green tests

Add explicit tests proving:

1. Rescue:
   - base 1.00
   - signed unit adjustment -1.50
   - setup 1.00
   - quantity 1
   - accepted final unit = 0.50

2. Uneven rescue:
   - two units
   - base 0.00
   - signed unit adjustment -0.01
   - setup 0.03
   - deterministic final unit prices 0.01 and 0.00
   - exact total 0.01

3. Insufficient rescue:
   - two units
   - base 0.00
   - signed unit adjustment -0.02
   - setup 0.03
   - rejection because at least one final bucket would be negative

Retain and rerun:
- existing signed-adjustment acceptance;
- overflow rejection;
- 200 seeded allocation cases;
- setup-once partition invariance;
- exact conservation;
- contracts;
- boundary checks;
- Rust/Function regressions;
- browser/historical checks.

## Review method

Use actual `sol-6-high`.

This is small enough for one writer/integrator; no second writer is needed unless the local orchestrator has a concrete non-overlapping reason.

Run fresh read-only Spec/correctness and Standards/security rereviews after the correction.

Ordinary test/review fixes remain in scope.

## External/resource boundary

Pure local/off-store only.

No authenticated Shopify/provider calls, token/secret reads, previews, deployments, DB provisioning, R2, commerce, billing, credential changes, host-security changes or legacy operations.

## Return

Update existing PR #21 and return:
- unchanged base/effective merge base unless main legitimately moved;
- new exact head/tree;
- concise diff summary;
- red/green signed-adjustment results;
- complete frozen `pnpm check`;
- all final-head workflow IDs;
- reviewer dispositions.

Stop for principal review.

No merge or M3 is authorized.
