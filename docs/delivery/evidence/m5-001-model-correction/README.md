# PR #27 execution-model correction

This is the owner-authorized correction on existing [PR #27](https://github.com/Optidigi/insignia/pull/27). The [external principal verdict](../../PR-027-principal-review.md) is CHANGES_REQUESTED at base/effective merge base `f8fff36fca749c6b2b6666550e48c7e347b6d65f`, head `ec8e5ea9090579a6f101632552aaa843afb2c688`, tree `e54fa974f231db2d78bd01cd983870cd14be2d86`. Its unsuccessful native review attempt is not a GitHub review. This document does not supply principal approval of the corrected source.

## Actual execution and full-source reads

The correction's sole orchestrator/integrator is GPT-6.1-sol/high in the T3 Code Codex harness, model slug `gpt-6.1-sol`, as exposed by trusted same-session runtime metadata. The orchestrator read the complete M5 authority bundle, root instructions, v1.4 plan/ledger, delivery operating model/roles, review packet/state, every changed implementation/test/config/migration file, interacting M2/M3/M4 seams, and both synthetic PNGs. Generated pnpm YAML was fully parsed, its complete diff inspected, and manifest/integrity correspondence checked. A neutral read manifest records 65 hashed entries and 31 completed reading batches; the corrected code and regressions were also read before integration. Raw session records are not exported.

Fresh full-source Spec/correctness and Standards/security sessions at the original reviewed head used Codex CLI 0.159.2:

```text
codex exec --model gpt-6.1-sol
  -c model_reasoning_effort="high" -c approval_policy="never"
  --sandbox read-only --cd <integrated worktree> --json
```

The Spec session is `01a0f3dd-b67b-74b1-a426-29ea59c6c353`; Standards/security is `01a0f3dd-bb3e-78f1-887e-aed6eea6bf14`. The integrator inspected the same launches' saved `turn_context` fields: `model:gpt-6.1-sol`, `effort:high`, `approval_policy:never`, `sandbox_policy.type:read-only`. These are observable client settings, not provider-private attestation. Earlier gpt-6-sol reviews in the original packet remain historical and do not satisfy this correction.

One non-overlapping restricted UI writer used the same model/effort, `workspace-write`, approval `never`, network access false, in a separate worktree. Its session is `01a0f3f4-6da5-7dd3-aaa7-b34b490bfcea`; same-launch metadata was inspected. It changed only the editor island and browser test. The integrator owned HTTP/database changes, shared integration, tests and refs, so there were at most two implementation writers. The writer's server/Chromium launch failed inside the restricted sandbox; that is not passing browser evidence. The integrator ran the normal existing localhost test runner without relaxing worker policy or changing host settings.

The project TDD, diagnosing-bugs, code-review, handoff and writing-for-agents skills were read. New user authority supersedes historical model text and does not require another confirmation for ordinary corrections.

## Material findings and corrections

| Fresh finding | Narrow correction and actual regression |
|---|---|
| Deleted named method/option/price retained dangling presentation labels | Removal updates the choice and only its label entries atomically; deleting an option also deletes its nested value labels. Normal typed browser controls name/remove/save; the old build fails the retained-label assertion and the corrected build preserves remaining labels and M2 validity. Server reference validation is retained. |
| Selected unconfigured variant URL was mapped onto a saved default image reference/dimensions | URLs resolve from persisted product/variant image identities. Selecting the landscape variant without adoption keeps the saved portrait; explicit adoption changes the variant reference/dimensions and real Konva aspect ratio. The old build fails the background comparison; the corrected build passes. A preceding overly strict locator timeout remains inconclusive evidence and was corrected in the test. No URL enters persisted geometry. |
| Prior installation's prepared publication blocked new-generation preparation | Open-operation lookup now requires the locked current installation generation and applicable journal status. PostgreSQL reproduces the old rejection, permits a new generation, still rejects a second same-generation pending intent, retains the old journal under existing supersession semantics, and performs zero fake remote writes without admission. No historical row is deleted. |
| Confirmed save retained stale publication eligibility | Read back eligibility for the exact saved config/generation/version/content. Until verified, publication is disabled. Failed or stale subsequent reads preserve the confirmed save and editable draft, without creating an ambiguous save or retry. The old currency-adoption build fails; the corrected browser test passes successful, failed and stale read controls. |

Standards/security found no material blocker at the original head and reported one definite P3: command-key/different-body conflict surfaced as 503. The integrator closed it: the real durable command path through authenticated HTTP returns 409, identical replay remains 200, persisted version/content remain unchanged, and unknown dependency errors remain sanitized 503. The regression failed with 503 before the fix and passed afterward.

Focused corrected browser verification: all three removal/image/eligibility cases passed using the rebuilt Astro/Preact editor, pinned real Polaris fixture and direct Konva, with synthetic App Bridge/HTTP data. Full PostgreSQL verification: 52 database tests passed on isolated PostgreSQL 18.6. The complete `corepack pnpm check` passed on the integrated correction source with Node 24.21.0, pnpm 12.6.0 and Rust 1.98.1: production build, units, source/security boundaries, TS/Rust/Wasm vectors, history/setup/hash checks and browser tests (27 web passes, 4 DB-gated skips, 1 storefront pass). The four skipped tests were separately run with the isolated PostgreSQL database and all passed: real editor commands, production publication, production auth composition, and built HTTP ingress/queue handoff. Fresh corrected exact-head full-source rereviews and all ten final-head workflows are recorded with actual results and refs in the PR correction handoff comment; no prior CI is substituted for changed source.

## Preserved limits and principal boundary

No authenticated Shopify/provider operation, credential-file read, preview or resource mutation was performed for this correction. Architecture plan/ledger hashes, historical receipts/PNG evidence, Function implementation/wire and production pricing semantics remain unchanged. No migration, dependency, scope or admission-policy change is introduced.

Still unproved: live embedded G7; actual third-party-cookie blocking; publication activation; deployed Function identity; an all-channel admission boundary; and large-history query-plan performance. Synthetic local browser/PG tests do not establish these. Whole-quote v2's implementation adoption does not establish deployment or universal capacity. PR #27 remains open, with principal rereview required. No merge, activation slice, M6/M7, production publication/key/FX/Function activation, complete gate pass or launch is authorized.
