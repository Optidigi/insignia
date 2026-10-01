# Independent principal diagnostic — exact source at 7a67028d55c191d9c83816312844f2e9cd62d648

Executed in scratch space, Node **v22.16.0**:

```sh
node --experimental-transform-types evidence/probe.mjs --assert-contract
```

The three full source snapshots match Git blob identities fetched at the reviewed
head. They were reconstructed from the retained prior snapshots plus inspected
current changes, and the complete resulting bytes were checked before execution.
`source-verification.json` and the probe's own startup checks record the identities.
No source was altered to obtain the passing result. These files are review evidence;
never copy them over the repository's current implementation.

The complete availability and publication adapter/HTTP modules execute with synthetic
credentials, time and fetch responses. The exact database admission callback is
extracted from its source and exercised with a synthetic store, along with the
caller's guard/pass-through ordering. There is **no real database transaction or
complete activation coordinator execution in this diagnostic**. Restoration uses
an explicit synthetic predicate, not real or simulated production release provenance.
The production calendar helper is not independently executed by this probe.

56 cases pass: five observation controls, five status controls, 24 publication
phase/age combinations, five caller-guard controls, twelve ACTIVE/UNLISTED restoration
cases and five pre-send/late-credential controls. Expired/reversed cases send zero
mutations. The source limits and CI/local-review evidence for broader behavior are
separately explained in the principal verdict.

The initial harness performed an additional stateful predicate call for logging,
ignored its refusal, then called again. `harness-first.stderr` preserves that harness
failure. The corrected diagnostic stops on the first false result, as production does.
This was not a discovered production regression and involved no repository patch.
`runtime-stderr.txt` contains the final Node experimental-feature warning only.

No authenticated Shopify request, ordinary external network fetch, browser operation,
PostgreSQL run, Rust/Wasm build or pinned Node24 suite was executed by this diagnostic.
