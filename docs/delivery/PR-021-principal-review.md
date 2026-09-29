# PR #21 principal review — CHANGES_REQUESTED

## Review binding

- Repository: `Optidigi/insignia`
- PR: `#21`
- Base/effective merge base: `911818301cc96d98f0b612259d1ba98dec8b9df4`
- Reviewed head: `668772c2a9f1e05f36e6a2746d878ad2191a19a1`
- Reviewed tree: `e07bae089155181b0f6c4840ea200d389156061c`
- Synthetic merge: `515132ec23d794afecd71a2baaee482ab3b1deae`
- Synthetic merge parents: exact base + reviewed head
- Synthetic merge tree: same reviewed tree

The native GitHub REQUEST_CHANGES call returned HTTP 403 and was not posted.
This file is the external principal verdict.

## Finding — final-price validation occurs too early

`packages/domain/src/pricing/evaluate.ts` permits signed placement/step unit adjustments.

The review packet states the intended invariant correctly:

> A negative placement/step adjustment is allowed only if every final real-variant unit price remains nonnegative.

However, `priceProposal` currently computes:

```ts
const beforeSetup = checkedMinor(baseMinor + unit.minor);
```

before setup allocation is applied.

That means a proposal is rejected whenever contextual base + signed unit adjustment is negative, even when the positive setup allocation makes every final materialized bucket price nonnegative.

Example:

- contextual base: 1.00
- signed unit adjustment: -1.50
- setup: 1.00
- quantity: 1

Final materialized unit price = 0.50, which satisfies the documented final-price invariant, but the current implementation rejects at the intermediate -0.50 value.

The same issue matters for remainder allocation across multiple units: validity must be checked on every final bucket after its deterministic setup share is applied.

## Required correction

Preserve signed intermediate arithmetic until setup allocation is known.

Do not require `base + unit adjustment` to be nonnegative merely because it is an intermediate value.

Require instead:

1. signed intermediate arithmetic remains bounded and exact;
2. every final bucket `base + unit adjustment + allocated setup` is nonnegative and within the Money range;
3. every bucket line total is exact and in range;
4. complete group/proposal conservation still holds.

Add focused regressions:

### Rescue case — must accept

One unit:
- base 1.00
- placement/step adjustment -1.50
- setup 1.00
- final unit 0.50

### Uneven rescue — must accept

Two units:
- base 0.00
- unit adjustment -0.01
- setup 0.03

Deterministic setup allocation yields 0.02 + 0.01 setup shares, producing final unit prices 0.01 and 0.00. Both are nonnegative; total is exact.

### Insufficient rescue — must reject

Two units:
- base 0.00
- unit adjustment -0.02
- setup 0.03

At least one final bucket remains negative after setup allocation, so the proposal must reject.

Also retain existing negative-adjustment, overflow, exact-conservation and split/reorder tests.

Do not solve this by banning signed placement/step adjustments; they are part of the current reviewed M2 model.

## Other reviewed areas

No other material M2-001 issue was identified in this review.

The following remain coherent at the reviewed head:
- canonical quantity-independent design identity;
- deliberate deferred/logo-later identity;
- setup once per normalized customization group;
- order-wide customized quantity Q;
- all-units tier selection;
- method multiplicity;
- generic vs method-specific placement/step override semantics;
- exact FX rational conversion and half-even rounding;
- deterministic group/variant/remainder ordering;
- versioned Zod transport contracts;
- domain import/ambient-effect boundaries.

Existing qualified later boundaries remain later work:
- published content hash authenticity;
- real Shopify variant ownership/context applicability;
- full currency-source/FX freshness policy;
- artwork readiness;
- quote acceptance/signing;
- production v2 decision.

## CI and artifact verification

Final-head workflows reported successful, including foundation run `36568707934`.

The foundation CI log confirms:
- 23 domain tests;
- 6 contracts tests;
- 12 dependency negative fixtures;
- 18 ambient-effect tests;
- 57 native Rust tests;
- 8 Transform and 18 Validation offline replays;
- browser tests and historical integrity.

Downloaded artifact `11032673795`:
- ZIP SHA-256: `273fbbe7d615e5ec50107addb402975bfeb83aaa22a576f7e7c9be937c39d348`
- 14 files physically present in the ZIP matched their manifest SHA-256 and byte sizes.
- The manifest records the remaining source/query/schema/lock entries separately.

Passing CI does not close the semantic edge above because no current test exercises setup rescuing a signed unit adjustment.

## Verdict

CHANGES_REQUESTED.

Keep PR #21 open. Correct this within the same PR and return the updated exact head for principal re-review.

No merge, M3, gate pass, v2 adoption or external resource operation is authorized.
