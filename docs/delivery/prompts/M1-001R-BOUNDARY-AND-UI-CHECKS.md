# M1-001R — close the domain and component-test gaps

Principal-issued 29 September 2026. Execute after owner forwarding/authorization. Continue EXISTING Optidigi/insignia PR #20, reviewed head `87a6f7557774a31ca6813ad865f028bb79b3af2e`, base `a467afcce5f0324a13fd3bfe647d3543eae159a4`. Outcome: the two missing acceptance checks are executable, with ordinary positive behavior unchanged. This is completion of M1-001, not a new architecture phase.

## 1. Establish the fixed correction scope

Read AGENTS, the current operating model, original M1-001 prompt, `PR-020-principal-review.md` and relevant existing boundary/runtime tests. Verify current refs and worktree; preserve legitimate newer work. Keep the PR open and use ordinary commits. No merge, force-push or successor PR.

Use the established sol-6-high route. One writer is sufficient; two restricted writers may divide the boundary and UI-test paths if the orchestrator fixes non-overlapping ownership. The integrator owns root scripts, dependencies, lockfiles and CI. Reuse relevant TDD/review/writing-for-agents skills; no general preflight or unrelated skill/tool suite.

Done: exact worktree/ref and file ownership identified, with R1/R2 as the correction scope.

## 2. R1 — enforce domain purity beyond imports

First reproduce using never-invoked exports inside an actually compiled/scanned domain module. Examples:

```ts
export function clockProbe() { return Date.now(); }
export function dateProbe() { return new Date(); }
export function randomProbe() { return Math.random(); }
export function qualifiedClockProbe() { return globalThis.Date.now(); }
export function networkProbe(input: string) { return fetch(input); }
export function cryptoProbe() { return globalThis.crypto.randomUUID(); }
```

Use pinned tools and the normal root check path to establish the prior gap. Functions remain uncalled; no network request is needed. The principal's isolated compiler result is not a full pinned-checkout result.

Implement a proportionate syntax-aware lint/AST rule using existing tooling where practical, paired with domain compiler type/lib isolation. Domain must not acquire implicit time/randomness, environment or network capabilities via common globals. Scope it to production domain code, not legitimate test/UI/worker uses. Cover representative direct/globalThis syntax and a helper within the domain graph. A pure-data parameter supplied by an outer layer remains allowed. Keep deterministic Math/BigInt and explicit-value transformations legal.

Avoid keyword-only string scanning, a new general analysis framework, speculative ports or a claim to defeat arbitrary malicious aliasing. State the supported static forms honestly. Do not change money behavior just to demonstrate the guard.

Done: each prohibited probe makes the normal check fail for its intended semantic rule; a deterministic positive control and original money tests remain green; injected code is removed. A passing import-edge test alone does not close R1.

## 3. R2 — prove the actual Polaris component

Use the current built Astro page and existing pinned public Polaris library. Its URL is documented; no version change is requested.

Add a regression that prevents the library from loading and demonstrates why a clickable unupgraded tag was insufficient. Then require registration/upgrade and readiness of the real `s-button`, with a finite timeout and useful script/page-error diagnostics, before counting a successful interaction. Test a meaningful normal component click through Preact; add keyboard behavior if part of the selected assertion. Do not rely on private shadow-root internals where a public property/role or constructor/registration check is sufficient.

The normal genuine-library case must pass. A missing/blocked/broken library must fail the real-component readiness assertion. A negative-control test may deliberately catch that expected failure, but the main positive test cannot silently skip or substitute CSS fallback. A separate Preact-only fallback/shell test may remain clearly labelled.

Prefer the supported public-library localhost route already authorized. A checked/identified public asset may be cached locally for deterministic tests if needed; no hand-written stand-in may be represented as Polaris. No secret, authenticated Shopify request, new installation or repeated Admin-login experiment. If an actual library requirement prevents local use, preserve the exact error and finish independent R1 work rather than inventing an Admin-host explanation or weakening the assertion.

Done: upgraded-component positive interaction passes and blocked-library control cannot satisfy that same acceptance criterion; report accurately separates this from live embedded authentication.

## 4. Integrate, review and return the same PR

Run frozen install and `corepack pnpm check` on pinned tooling, with all new regressions in the normal path. Preserve current Function behavior/build provenance, archived workspaces, v1.3 bytes, historical evidence and required artifact handling. Keep new review observations separate from previous results.

Fresh restricted Spec and security reviewers inspect the fixed integrated correction and counterexamples. Resolve ordinary in-scope findings locally. Update the existing review packet with R1/R2 closure and actual verification limits; do not create an extra decision ledger or a documentation-only PR. Return actual base/head/effective merge base, final-head CI and artifact bindings, red/green evidence and reviewer dispositions. Stop for principal re-review.

## Permission envelope

Authorized: local source/tests/config changes for R1/R2; necessary pinned project-local dependencies; public documentation/library downloads; localhost browser and synthetic offline tests; CI; pushes to existing PR #20. Existing sandbox/security policy remains intact.

No authenticated Shopify/Partner/App Events call, user-server secret-file read, live cart/checkout, billing mutation, preview, deployment, credential change, host-security change or legacy operation. No M2, complete gate acceptance, production protocol/capacity adoption or merge. The earlier M1 entry decision remains valid.
