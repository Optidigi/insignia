# G<n> — <gate name>

Status: NOT_RUN / IN_PROGRESS / PASS / FAIL / BLOCKED
Candidate result date: <UTC timestamp>
Principal acceptance: NOT_REVIEWED / <verdict reference and reviewed SHA>

## Claim and boundary

State exactly what must hold, where the claim comes from in plan section 14, and which architecture assumption reopens on failure. Describe what this test does NOT prove.

## Reproduction context

Code/build SHA; Wasm hashes; SDK/CLI/toolchain and Shopify API/query schema versions; app distribution; store plan/test privileges; relevant currencies/tax/discount settings; test-only resource identifiers; non-secret setup and cleanup steps.

## Acceptance matrix

| Case | Expected | Observed | Result | Evidence pointer |
|---|---|---|---|---|
| <specific case> | <falsifiable result> | <actual output> | <PASS/FAIL/NOT_RUN> | <artifact/hash> |

Include negative controls, failure/resource limits, retry/duplicate behavior and interacting gates where relevant. Unit/mocked and real-platform observations must be labeled separately. A large physical quantity is not the same as a large number of signed cart buckets.

## Artifacts and repeatability

Commands or procedures, exit status, normalized/redacted input/output, screenshots or traces, logs, resource measurements and artifact checksums. Record access/retention and a durable sanitized summary; avoid sole dependence on an expiring CI artifact link. Write the gate's machine-readable result manifest when implementing the real harness.

## Conclusion

Smallest established claim, unresolved cases, recommended supported limits and cleanup state. On failure describe realistic alternatives without implementing a silent architectural substitute. Only principal-accepted PASS evidence permits dependent work. A merged spike PR is not itself gate acceptance.
