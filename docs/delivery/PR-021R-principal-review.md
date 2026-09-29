# PR #21 principal re-review — APPROVED

## Review binding

- Repository: `Optidigi/insignia`
- PR: `#21`
- Base/effective merge base: `911818301cc96d98f0b612259d1ba98dec8b9df4`
- Approved head: `2765220037d581de2a710b2eab6e2a469352d61b`
- Approved tree: `40dffb60f7577d1f24052cdbd53604f01b4fc2b1`
- Synthetic merge: `89ac3787a27d2ccb83ed275dd02b9d5450b93e74`
- Synthetic merge parents: exact base + approved head
- Synthetic merge tree: exact approved tree

This supersedes the earlier CHANGES_REQUESTED verdict on old head
`668772c2a9f1e05f36e6a2746d878ad2191a19a1`.

The native GitHub APPROVE attempt returned HTTP 403 and was not posted.
This file is the external principal verdict.

## M2-001R correction closure

The previous blocker is closed.

The corrected pricing implementation:
- preserves `base + signed unit adjustment` as bounded signed arithmetic;
- allocates nonnegative setup using the existing deterministic group/variant/ordinal ordering;
- checks every final real-variant bucket price only after that allocation;
- rejects a final negative price or overflow;
- checks each bucket line total and complete conservation.

The three required regressions are present:

1. `1.00 base - 1.50 adjustment + 1.00 setup` accepts at `0.50`.
2. Two zero-base units with `-0.01` adjustment and `0.03` setup allocate final `0.01` and `0.00`, total `0.01`.
3. Two zero-base units with `-0.02` adjustment and `0.03` setup reject because one final bucket remains negative.

No schema, identity, tier, FX, setup-frequency or Function protocol semantic changed.

## M2-001 acceptance

M2-001 is accepted at its intended pure-domain scope.

Accepted production-owned semantics include:
- canonical quantity-independent customization identity;
- explicit deferred/logo-later identity;
- exact merging of recognized identical groups;
- setup once per customization group;
- compatible variant partition invariance;
- order-wide customized physical quantity `Q`;
- all-units customization tiers resolved from `Q`;
- explicit method-unit multiplicity;
- generic/method-specific placement and step pricing;
- exact contextual base plus customization economics;
- exact rational FX input with explicit overrides;
- half-even FX rounding;
- 0/2/3-decimal currency support under the current Money contract;
- deterministic real-variant price-bucket allocation;
- exact minor-unit conservation;
- immutable JSON-safe proposal economics;
- versioned Zod transport schemas and unknown-version rejection;
- platform/network/persistence/clock/randomness-independent domain.

This approval does not:
- prove the supplied revision hash is authentic published content;
- verify Shopify variant ownership or contextual-price applicability;
- select the production FX provider/freshness policy;
- establish artwork readiness;
- authorize or sign a buyer purchase;
- adopt experimental whole-quote v2;
- pass G1-G8;
- start or complete M3 automatically without the attached bounded authorization.

## Final-head verification

All eight final-head workflow runs reported success:
- M1 foundation: `36579073603`
- M0-014 local candidate: `36579073752`
- M0-013 capacity: `36579073775`
- M0-012 local proof: `36579073937`
- M0-011 provider: `36579073772`
- M0-010 billing: `36579073589`
- M0-009 embedded: `36579073563`
- M0-008 publication: `36579073662`

Foundation CI confirms:
- 26 domain tests;
- 6 contract tests;
- the seeded 200-case allocation suite;
- dependency/ambient-effect checks;
- 57 native Rust tests;
- 8 Transform and 18 Validation offline replays;
- browser and historical checks.

GitHub artifact `11038711238`:
- ZIP SHA-256:
  `245ef564654c1322e820b6c2c44938048845b4b0fe670c8579644a63ac153ce4`
- all 14 files physically packaged in the ZIP match their manifest SHA-256 and byte sizes;
- Function Wasm remains unchanged from the reviewed M1 build.

## Verdict

APPROVED for normal merge at the exact head above.

M3-001 is separately authorized by the accompanying execution brief.
