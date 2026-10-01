# Fixed-source transport-dispatch reproduction

Source: Optidigi/insignia at `91f46ba0006d9c5d50613dc39e234f33c797f625`.

The complete unchanged `availability-hold.ts`, `production-activation.ts` and `publication-admin.ts` snapshots were read through the GitHub connector, reconstructed in a separate review directory and verified against Git's blob hashes. The probe verifies all three before any cases execute. No repository implementation was modified.

## Run

```sh
node --experimental-transform-types evidence/probe.mjs
node --experimental-transform-types evidence/probe.mjs --assert-contract
```

Run from the extracted package root. Tested here with Node22.16.0, not the project's pinned Node24.21.0. Type-only imports are erased by Node's transform; no external dependencies or real network access are used. A global fetch guard rejects unintended network calls; each actual adapter receives a synthetic `fetchImpl`.

Characterization exits0 after asserting source integrity and positive controls. `--assert-contract` exits1 at this reviewed source because expired/reversed admission still sends a mutation. These different exits are deliberate, not retries masking a failure. Retained stdout/stderr and `results.json` record actual execution.

## Coverage and limits

- Five current-source observation-origin boundary cases.
- Five legal/unknown product-status cases.
- Five caller-guard timing controls.
- Twenty-four real publication adapter/HTTP transport cases: four mutation shapes × six clock schedules. Twelve initiate a synthetic HTTP mutation despite expired/reversed admission; the remaining twelve are valid within-budget controls.

The exact corrected `established` callback is extracted from the verified source and executed with a synthetic store/clock. Its digest dependency uses the exact canonical behavior for the all-string plain scope fixture. The final caller check/order is replicated from the inspected production coordinator. The **complete coordinator/SQL transaction is not executed** here. Both complete Shopify modules and the callback are actual source, not excerpts rewritten to imitate the suspected defect.

This proves the transport pre-send gap under controlled inputs, not live exploitation, actual provider state, full database integration, source correctness outside these cases or production readiness. The local agent must retain a red/green regression through the real public-PG facade and real adapter/transport under the pinned runtime. Do not edit these historical snapshots or expected blob hashes as the purported fix.
