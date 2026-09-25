# M0-004 — local authorization and exact-money proof

Principal-issued: 25 September 2026. Version 1.0. One delegated execution package inside M0.

## Outcome and authorization boundary

Given fixed accepted quote vectors, TypeScript produces canonical signed cart authorizations; Rust independently verifies them and their set integrity; exact unit amounts survive both relevant local Wasm target boundaries; measured resource results establish an honest candidate capacity or a reproducible failure.

This advances the **local portions of G2, G3 and G5**. It is neither the full application nor a declaration that any entire gate passed. Keep G1 open, with the specific M0-003R observed native procedure accepted by the companion review. No more staging work is needed to start this local proof.

PR #6 is principal-approved at base/merge base `a9398ebf8d069f3556c0b359be1372d94d45f82e`, head `16444b19823d044b1e5f4cf3a547ae465a3be3d0`. The owner must authorize its merge separately; the companion launch message supplies that permission when sent by the owner. Verify exact refs, approval and applicable CI before merging. Use a normal permitted merge, never bypass protections or fabricate a native approval. Keep the reviewed head fixed; branch from the verified remote merge. If it is already merged, verify its content and continue without merging again.

The principal owns project direction, architectural adjudication, final PR review and gate acceptance. The local orchestrator owns implementation tactics within this package. The user retains product decisions and undelegated resource/merge authority. Local success never authorizes the next milestone or the next PR's merge.

## Context, working area and team

Read AGENTS, the decision ledger, delivery state/operating model, companion PR #6 review, implementation-plan sections 4.5–4.6, 5, 6.2, 13, 14.2 and M0 in section 15. Those sections define the candidate protocol and pricing invariants; do not reconstruct or redesign them from chat. Read relevant captured G1 input/output and order shape as evidence, not as proof of the Validation Function's input shape.

Put the isolated package under `spikes/m0-004/`, with its own scoped pnpm/Cargo manifests, source, fixtures, tests and benchmark commands. A small internal shared Rust crate is justified by the two actual targets. Use existing compatible pins and the verified host linker. Do not initialize the full apps/packages monorepo. Reuse tested techniques from `spikes/m0-001/` without modifying its Function/schema or historical receipts. Add a dedicated off-store CI check and minimal current-slice/review/gate pointers. Keep the architecture plan and ledger byte-identical. Do not rewrite historical claims or regenerate earlier manifests.

Use at most two implementation writers in separate worktrees: TypeScript codec/signing/money reference, and Rust codec/verification/target adapters. The orchestrator exclusively integrates shared byte contracts, golden fixtures, lockfiles, CI and state. If it writes concurrently, it counts against that two-writer limit. A read-only schema/crypto scout and fresh Spec plus Standards/correctness reviewers can help in separate contexts. Depth one; no worker-owned scope changes. Reviewers report concrete defects and examined evidence, not agreement with the author's conclusions.

Use the project's pinned `writing-for-agents`, `tdd`, `diagnosing-bugs`, `code-review` and `handoff`. `research`, `to-tickets` and `implement` may be used or minimally added at the previously inspected upstream commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`, preserving support files/license. Ticket decomposition here is an internal dependency list, not permission for a new tracker system. Use the existing Shopify docs/schema tools, shell, Git/GitHub and local runners; no broad plugin install or new credentials. Finish internal research, red/green cycles, integration and local-review corrections before one principal handoff.

## 1. Use the actual high-effort execution route

PR #6 disclosed active T3 `gpt-6-sol`/medium. Do not repeat that mismatch for this package. Use a supported per-session high setting, or run the substantive orchestrator through the already verified Codex CLI with explicit `-m gpt-6-sol -c 'model_reasoning_effort="high"'` and the existing bounded workspace permissions. A host used only to relay files/tool outputs is distinct from the decision-making orchestrator; report roles honestly.

Before substantive implementation, obtain one same-launch client configuration record and successful repository read. Reuse PF-002's working method; do not demand hidden provider telemetry or use model self-description. Do not change global trust, sandbox policy or install host upgrades. If the chosen host cannot run the requested profile, use the verified CLI route, not a claimed equivalent medium setting. A genuine inability to establish any supported high route is a narrow owner action, not permission to substitute silently.

Native child spawning previously failed. Separate restricted sessions/worktrees are allowed; do not repeatedly debug optional native delegation. Record actual role settings and permissions before relying on them. No reviewer needs merchant mutation credentials.

**Done:** actual substantive orchestrator route is high, boundaries remain enforced, and a short internal dependency map assigns the two source areas and integration owner. Continue directly into implementation, not another preflight PR.

## 2. Contract and reference vectors first

Implement plan section 5.2 as the explicit **candidate**: 114-byte payload plus 64-byte Ed25519 signature, 178 total, 238 characters in unpadded base64url. All integers are fixed-width unsigned big-endian; UUIDs are raw bytes. Prefix the signed payload with exactly `Insignia\0CartAuthorization\0v1\0`. Use ordinary Ed25519 over those bytes, not Ed25519ph/ctx or an additional message hash. Check lengths and exact bytes against the plan before dispatching independent language work.

Create a compact threat/contract note and a field-to-input table: signed field, TypeScript source, Rust representation, independent expected context, target-schema availability. Expected variant/quantity/currency/country/date/policy cannot come from decoding the same token being checked. App-owned public configuration is not a source for current buyer context. No fabricated GraphQL fields or token-derived expected context.

Use public test keys/seeds, clearly marked never for real shops, with provenance such as standard vectors. Node's native crypto is the default reference signer/verifier. Select a maintained Rust Ed25519 implementation with strict verification and minimal features; document the actual pinned choice. Implement no curve arithmetic yourself. Production key storage, encryption rollout and installation reconciliation are out of scope.

Golden fixtures contain source claims (wide integers encoded losslessly), payload bytes, signature, final token and expected accept/reject result. JSON is allowed as a fixture container, not as the authorization protocol. Keep expected bytes/signatures committed and reviewed; tests must not silently rewrite expected fixtures from the implementation under test. Have Rust native test utilities independently serialize/decode candidate payloads to cross-check TypeScript rather than merely comparing two copies of generated expectations.

Cover valid examples and mutations: lengths/truncation/trailing bytes; padding/invalid alphabet/noncanonical base64url including unused tail bits; wrong magic/version/reserved flags; unknown key; malformed signatures/keys and strict verification edge cases; tampered price, IDs, quantity, currency/exponent, country/market, epoch and generation; integer overflow; unknown supported-currency mappings. Test signed wide values beyond JavaScript's safe-integer range without claiming Shopify accepts those money amounts.

Use a deterministic expected shop-local date. Issuance day D is valid through D+2 inclusive; D+3 expires. Test calendar/DST boundaries in the date-resolution helper where applicable. A new set ID under the same accepted quote models renewal; mixed renewal sets reject. Reuse of an unchanged complete valid set is allowed by the bounded-offer decision—do not add a single-use mechanism.

**Done:** an immutable vector corpus produces agreed canonical bytes and strict outcomes in both languages. Any material protocol flaw is reported with a minimal reproducer and proposed correction; no silent protocol redesign.

## 3. Exact money, allocation and complete-set verification

Use BigInt/checked integer arithmetic; preserve lexical decimals through the SDK adapter. Neither Number/f64 arithmetic nor floating tolerances may decide economic equality. Test the actual supported serialization/access path of the pinned SDK. A correct decimal string produced only after an f64 parse is not sufficient. No SDK/runtime fork merely to bypass a failed test.

Implement only the fixed-vector allocation needed for this proof, using plan section 4.5: aggregate applicable setup once per group, equal-per-unit quotient/remainder, stable variant ordering, range-based allocation and coalescing. No object or signature per physical garment. Tests include the plan's EUR 91 case (2 × 30.33 + 1 × 30.34), variant reordering, two groups, heterogeneous unit prices, zero setup, one minor-unit setup, and logical totals of 500 and 10,000 units. Exponents 0/2/3 are mathematical adapter tests, not declarations of market support. Do not implement the full merchant rule editor, contextual lookup, FX provider or tier engine; use explicit fixed accepted prices/tier-result fixtures.

Each signed bucket has a unique quote-global index and count. Check one quote/set and common generation/epoch/context/expiry/totals; every index exactly once; observed variant and quantity; checked sums of quantities and quantity × unit minor units; permitted capacity; required-versus-optional plain controls. Reject missing/duplicate/extra/mixed members, wrong quantities, changed common totals, overflow, selling-plan customization and invalid marked lines. Reordering a complete set must not change economics. In a 500-unit vector, removing a group cannot preserve the signed 500-unit acceptance.

Keep a pure verifier contract separate from target-specific normalization. A supplied test context is visibly labelled harness input; do not claim its values are exposed by Shopify until the source mapping proves that. Parent/group presentation must not double-count physical items. Missing or ambiguous price/context information is a rejection/unsupported dimension, not a guessed match.

**Done:** deterministic pricing buckets, canonical authorizations and complete-set decisions agree across language tests, including adversarial cases and exact total conservation.

## 4. Both local Wasm targets and honest resource measurements

Build separate Cart Transform and Cart & Checkout Validation test targets using the pinned current generated schemas and real exported entry points. Shared Rust verification code is permitted, but each target independently verifies the signatures. For the candidate transform emit the intended one-child same-variant expansion with the exact allocated unit amount. The validator must compare the independent observed pre-discount amount against the authorization in supported fixture shapes—not merely accept a signature or trust a transform-written success marker. These are necessary G2 resource/adapter harnesses, not live G6 acceptance.

Validate queries/fixtures/outputs with the existing schema tools/test runner. Preserve an explicit input-shape provenance label: captured platform input, schema-valid synthetic projection, or harness-only normalized test. G1's order receipts do not establish Validation Function cart input semantics. Pin an exact API schema; a `/latest` documentation redirect is not a schema pin.

If a required field or exact scalar path is not actually available, preserve that narrow failing contract and complete independent codec/allocation work. Never invent support, fake accepted target inputs or benchmark an always-reject/no-op path and call it viable. A reduced verifier benchmark can remain exploratory; it cannot pass the complete-Function budget gate.

Measure final built artifacts for each target: binary bytes, executed instruction/fuel units, input/output bytes, available runtime memory/stack reporting and query cost/size. Report unknown metrics as unknown. Run successful complete-set workloads at 1, 10, 32 and 64 signed buckets, then probe the failing boundary where practical; include ordinary-cart coexistence, key rotation overlap, invalid signature near the end, missing/duplicate members and large numeric quantities. Use schema-legal individual quantities when representing 10,000 logical physical units. The byte/token size bound and total cart-line count are separate dimensions.

Compare to the current documented and runner-enforced limits; as reference, current docs list 256,000-byte binary, 11 million instructions and 128,000/20,000-byte input/output for carts up to 200 lines. Capture source/version and actual units; do not rely only on remembered limits. Include all relevant verification/input/output work. Propose a capacity with explicit measured headroom; the principal accepts product-facing capacity, not the agent. A capacity failure is a valid useful outcome. Bounded optimization of library features/size is allowed; weakening verification, price equality, signatures or materially changing token layout is not.

**Done:** actual target artifacts and benchmark rows reproduce, or the exact supported failure boundary is captured. No signature-only microbenchmark is presented as full target proof.

## 5. Integrated review, CI and return

Provide a single check command for this package: strict TypeScript checks, Rust formatting/clippy/native tests, cross-language vectors, exact-money/property/mutation tests, both Wasm builds and schema-valid executions, and benchmark smoke. Pin dependencies/actions and commit lockfiles. Full offline here means no merchant services during tests; trusted dependency/schema acquisition may use the network. CI has no Shopify credentials or mutations. Keep existing lifecycle tests/evidence intact and keep their checks green when shared CI changes.

Add deterministic assertions for trust and economic failures, not assertions that merely echo an output's declared PASS field. Use reproducible seeds and record coverage limits; a finite fuzz run is not proof of exhaustive security. Record fixture/source/build hashes, commands, results and the local review findings/dispositions. Store only necessary compact evidence, not duplicated full logs or a new framework.

Fresh Spec and Standards/correctness reviews examine the integrated final diff and relevant crypto/economic behavior. Resolve routine findings locally and rerun affected tests. A reviewer must not substitute local test acceptance for principal gate adjudication. Do not change package scope to obtain a clean report.

Update delivery state with the PR #6 review/merge, accepted narrow G1 result, its retained limitations, corrected actual orchestrator route and this package's tasks. Initialize/update G2/G3/G5 evidence as **IN_PROGRESS**, separating local passed subtests from unrun Shopify transport, real allocated-bucket lifecycle, contextual economics, Function deployment/failure and public-app qualification. Do not rewrite the closed product audit or declare protocol v1 frozen. Preserve G4/G6/G7/G8 as unrun except existing acknowledged evidence; no live G6 testing occurs here.

Return **one outcome PR**: exact base/head/merge base and CI, completed contract/codec/amount path, measured target capacity or material failure, local reviewer findings and what remains untested. Partial work may be returned at a genuine architecture/platform blocker after independent tasks are completed. Do not stop at ordinary compiler/test failures that can be resolved inside the package.

## Permissions and hard stops

Allowed: scoped local files/worktrees/dependencies and fixtures, synthetic test keys, public primary-source research/schema retrieval, off-store tests/benchmarks, minimal project-local launch/role configuration, and the authorized repository branch/PR workflow. Use current installed capabilities; don't duplicate functioning tools.

Not authorized: any Shopify app/store/cart/order/billing/stock/payment/preview/Function/metafield mutation or new merchant credentials; real signing keys; external resource provisioning; global privileged setup; production application scaffolding/M1; plan/ledger changes; altering old receipts; non-Plus alternative pricing implementation; deploying either target; moving on to another package or merging its PR. Test orders #1001–#1004 and all staging resources remain untouched.

No Shopify distribution proof is waived. It does not block these local reusable experiments, but it still blocks reliance on the full non-Plus/public-app mechanism where the plan requires that evidence. If a signed-claim source, cryptographic cost or exact-money boundary materially fails, report the narrow violated invariant and realistic next options for principal adjudication.

## References

- Repository implementation plan §§4.5–4.6, 5, 6.2, 14.2 and M0 remain primary project authority.
- Node 24 crypto: https://nodejs.org/docs/latest-v24.x/api/crypto.html
- Shopify Function resource limits: https://shopify.dev/docs/api/functions/latest
- Rust SDK/build guidance: https://shopify.dev/docs/apps/build/functions/programming-languages/rust-for-functions
- Codex effective configuration: https://developers.openai.com/codex/config-basic
- Skill provenance: https://github.com/mattpocock/skills/tree/c55ee46073ed923f86ce59a5eb3b6d895095d1b7

These are technical sources, not passed gate evidence. Read the pinned SDK source and generated API contracts when general documentation is insufficient.
