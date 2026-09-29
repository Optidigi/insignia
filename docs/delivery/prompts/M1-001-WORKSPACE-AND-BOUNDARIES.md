# M1-001 — reproducible workspace and enforced boundaries

Principal-issued 29 September 2026. Execute only after the owner sends `LOCAL-AGENT-LAUNCH.txt`. One integrated foundation PR, not another spike report. Dependencies: approved PR #19 at `f267b7b3bfae0090060d4f25aafa23e4c2d3cfb7`, the actual normal merge, and `M1-ENTRY-DECISION.md`.

## Outcome

A clean checkout builds and tests the planned Node/TypeScript and Rust workspace; minimal web, storefront and worker processes run locally; forbidden dependencies fail executable checks; exact candidate Function behavior remains testable from source. Nothing is deployed or usable for real commerce. This package is M1 only, not M2's complete pricing engine or M3's persistence.

## 1. Establish the root workspace from proven material

Read current AGENTS, delivery state/operating model, architecture plan §§1–2, 14.2.1 and M1, the ledger, this entry decision and the PR-019R review. Reuse established tools, credentials-free public research, and the existing writing-for-agents/TDD/review skills where relevant; do not run general preflight or install an unrelated skill suite. Resolve an actual capability failure locally where allowed, and continue independent work.

Start a new branch/worktree from the verified PR #19 merge. Establish root pnpm and Cargo workspaces and exact toolchain/lockfile pins. Prefer the versions already proven by the spikes; consult current primary documentation/changelogs/security information for newly introduced packages and material compatibility issues. Resolve a necessary patch/minor correction with tests; return a material stack/major-version change rather than silently replacing the selected architecture. Do not scaffold Shopify's React Router template.

Use `apps/web`, `apps/worker`, `apps/storefront`; `packages/`; `extensions/insignia-theme`, `extensions/insignia-cart-transform`, `extensions/insignia-cart-validation`; and `crates/cart-authorization`, `crates/cart-transform`, `crates/cart-validation` per the plan. Create implementation-bearing packages as they are used. Record future database/artwork/visualizer responsibilities in the boundary map without inventing generic repositories or dummy service implementations just to fill every directory. Keep `spikes/` outside the new workspace membership and retain each historical lockfile/build.

Minimal shared code may include existing pure money primitives in `domain`, browser-safe Zod DTOs in `contracts`, an application composition seam only where actually called, server observability, the isolated Shopify adapter namespace, and an **experimental-v2** codec export in `cart-authorization`. Public package boundaries do not freeze a final buyer wire contract. A package may expose no production signer/issuer route yet. Keep public test keys conspicuously synthetic and out of runtime defaults.

Done: explicit dependency/entry-point map and a frozen install from a clean checkout, without changing historical source/fixtures to satisfy new tooling.

## 2. Make boundaries executable before adding features

Dependency-cruiser plus compiler/export/bundle checks must cover:
- Domain has no Shopify, framework, renderer, persistence, filesystem/network, implicit clock or randomness dependency, including through re-exports.
- Application depends inward on domain and owns real external ports when needed. Adapters do not call each other; web/worker are composition roots.
- Browser entries cannot reach database, Shopify SDK, artwork server processing, private-key signer, Node built-ins or server observability. Type-only imports remain browser-safe DTOs, not hidden runtime paths.
- Only `packages/shopify` imports `@shopify/shopify-api`. Preact/Polaris belong to UI surfaces; direct Konva belongs only to the visualizer when introduced. No React/react-konva runtime is added.
- New runtime modules do not import `spikes/` or live receipt directories. Tests may use a small explicit provenance-bound fixture set; the old spikes stay runnable independently.

Use deliberate invalid-import fixtures, including transitive re-export and browser/server cases, and require each negative fixture to fail for the intended rule. A passing scan of an empty tree is not evidence. Exercise real bundler reachability as well as path-based linting. Document package exports rather than relying on arbitrary source-folder relative imports.

Done: useful boundary violations are red, legal imports/builds green, and the normal CI command fails on an injected illegal dependency.

## 3. Implement minimal local runtime surfaces

**Web:** Astro standalone Node SSR with the chosen Preact integration. Serve a public liveness endpoint and a minimal non-merchant shell. Use one small Preact/Polaris interaction in a clearly local test page; it can be a browser test fixture rather than a public product route. Preserve the distinction between public bootstrap and protected merchant data. Real merchant APIs/commands are absent or fail closed, never enabled by `shop` query parameters or a fake auth fallback.

**Storefront:** a Vite/Preact bundle registered as a Custom Element with Shadow DOM, mounted by a minimal local harness and referenced by the theme-extension build. Verify mount/unmount and event/DOM isolation. No product configurator, cart mutation, fee/pricing path or complete visualizer yet; the legacy visual reference remains M5/M7 work.

**Worker:** a buildable Node process with graceful start/stop and a local diagnostic mode. Run a deterministic Sharp/libvips decode/derivative smoke on known synthetic bytes in the worker build environment. It proves native packaging, not security of arbitrary uploads. Missing DB must not be reported as durable readiness; do not implement fake pg-boss semantics. M3 owns actual database, queue and outbox setup. A disposable CI build container is permitted; lack of local Docker does not justify changing the host or blocking all other work. VPS topology and production deployment remain deferred.

Done: production-mode local web build runs, Playwright executes the real client interaction/Custom Element, worker smoke passes, and browser outputs contain no server/test credential material. “Production-mode build” is not a production release.

## 4. Put the two Functions in the root build, without adopting their production contract

Extract only the reviewed candidate's necessary verifier/checked arithmetic and target logic into the planned crates/extension build entries. Preserve v2 bytes and `/0` correction, exact pre-discount checks, complete-set verification and independent Validation. This is a reversible, preproduction internal candidate, expressly not final protocol/capacity adoption. No per-line fallback architecture or fixture-role-dependent production issuer.

Keep non-deploying synthetic default configuration. Do not carry live extension UIDs, generations, public-key trust, old cart authorizations, or merchant credentials into new runtime defaults. Existing real-app named configs under historical spikes remain untouched. Credentials-free build scripts must not trigger app installation, config linking, previews or releases.

Use one root Cargo lockfile for new crates and build from current source. Pin and verify any needed public trampoline binary; account explicitly for optimization. Paths/targets must be worktree-safe: do not depend on a writable shared global `/tmp` tree or an old spike's node_modules. Record code/query/schema/raw-and-final-Wasm hashes for each new artifact. A path-driven binary difference is not automatically a failure, but previous measurements cannot be relabelled against the new bytes.

Run synthetic TS/Rust golden vectors and semantic replay comparisons for both targets. At minimum include marked `/0` at both checkout steps, exact remainder allocation, complete/missing/duplicate/altered/underpriced sets, required unsigned rejection, repair, experimental 32+168, 33 rejection and 10,000 physical units. Record relevant new artifact counters, preserving unknown stack telemetry. Do not regenerate expected outputs to conceal a changed security/economic result. New fixtures that reproduce a live shape must be synthetic and labelled as such; keep the original stopped-run replay in its historical location only.

Done: both root source builds and artifact-bound regressions pass without Shopify access, historical artifacts remain separate, and no runtime quote issuance/publication is active.

## 5. Integrate once, review once, hand off one PR

The root check should run format/lint/type checks, Vitest/domain/contract tests, architectural negative fixtures, Rust fmt/clippy/tests, both Wasm builds/replays, runtime build/smokes, Playwright, and targeted secret/dependency checks. Keep test expectations narrow and meaningful. Scan fixture/test artifacts separately so a documented test seed is not broadly allowlisted as a production secret exception. Upload versioned immutable build/verification artifacts with a manifest; required artifacts missing must fail CI.

Retain and run applicable historical integrity/regression checks. Verify a fresh install/build from a clean separate checkout and final-head GitHub Actions. Root workspace globs must not mutate old lockfiles or require archived spikes to conform to new naming/lint rules.

Import this review/entry decision with provenance; update delivery state, current prompt pointer and a concise dependency map. Preserve the v1.3 architecture bytes and the existing history verifier. Add a small unresolved-acceptance register (or update the existing one), recording the exact obligations in the entry decision, particularly add-to-cart settings, live capacity, stack, publication activation, isolated malformed-member live evidence and supported cancellation. The existing cancelled/returned/refunded test order remains untouched. No new readiness-only PR.

Local execution: actual established sol-6-high; at most two restricted non-overlapping writers after the orchestrator fixes their file boundaries. Suggested parallel work is TypeScript/runtime packaging and Rust/Function extraction. The orchestrator alone owns root manifests/locks/CI integration; each writer returns tests and exact changes. Fresh read-only Spec and security reviewers inspect the integrated fixed head, including browser/server boundaries and accidental fixture promotion. Ordinary corrections are completed inside this package. Reviewers cannot approve their own work or grant principal acceptance.

Return one PR with base/head/effective merge base, source/artifact hashes, final-head CI, actual commands/results, dependency negative-test evidence, local browser/worker evidence and review dispositions. Report any remaining blocker honestly. Stop for principal review; do not merge that PR or start M2.

## Permission envelope

Authorized after owner launch: new foundation code, project-local dependencies, public documentation/schema/package/binary downloads, localhost-only runtime/browser tests, disposable CI build resources, Git branch/push/one PR. Existing isolation is retained. No production/VPS changes or organization-wide app tooling changes.

Zero authenticated Shopify/Partner/App Events calls, token acquisitions, secret-file reads, previews, deployments, settings changes, product/cart/order/fulfillment/refund operations, billing operations, credential changes or additional live experiments. The probable add-to-cart setting explanation is recorded, not mutated or marked store-verified. No automation monitor is started. No full gate pass, v2 production adoption, supported-capacity promise, public launch, M2 or next-PR merge.
