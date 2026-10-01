# M5-004 — bounded real-Shopify availability-adapter qualification

## Outcome and authority

Establish whether the **accepted availability adapter's status, observation, ownership and restoration contract** matches actual Shopify responses on one new, unpublished disposable product. Return one integrated qualification PR with an honest observed result or a bounded reproducer. This is the next M5 slice, not M6 and not a production activation/release.

Execution requires the owner-forwarded launch accompanying this package and the verified normal merge of PR #29 at head `7a67028d55c191d9c83816312844f2e9cd62d648` / tree `5f3f29d44da7d5f0423fd6902c19dc501f7c79ff`, from base `8a84ddeaf277368852d224915abe6d4a93a3d8a4`. The principal review is `PR-029R2-principal-review.md`. Never use GitHub's synthetic test-merge SHA as the actual merge receipt.

One orchestrator/writer and fresh independent Spec/correctness and Standards/security reviewers, all actual **GPT-6.1-sol/high**. Only the designated root operator may access authorized existing Shopify credentials or send the bounded requests below. Reviewers stay read-only and off-store. Preserve shared infrastructure and unrelated processes.

## 1. Resume and freeze the experiment

Verify the actual #29 merge and begin a new branch from that exact remote main. If main/head/merge method or tree differ, stop for principal direction; preserve all newer work. Import the attributed approval, this brief and a short state/AGENTS pointer on the new branch. Do not rewrite historical failures or approvals.

Read current AGENTS, ledger, operating model, M5-003/R/R2 reports, M1 unresolved-acceptance register and plan publication/activation sections. Use the pinned `.agents/skills`: writing-for-agents for brief/report, tdd plus tests/mocking for the harness, diagnosing-bugs for an observed defect, code-review for the two axes, handoff for the return. Existing rules override skill defaults. No new skill/framework installation or repeated baseline interview.

Build a **small experiment-only operator** reusing the current production availability/catalog adapters, existing fixed-target accounting patterns and current toolchain. Expected new paths: `scripts/m5-004/`, focused operator tests, `docs/delivery/evidence/m5-004/`, report/review packet and the necessary root command/CI wiring. Production application/DB/protocol behavior is not changed by this qualification slice. Public docs/schema reads are allowed; runtime API stays **2026-07**. Validate actual queries against that contract; do not silently switch to latest or unstable.

Freeze source commit and built-module hashes, compile and run the offline safety tests, complete both fresh local safety reviews and obtain applicable exact-source CI **before using credentials or making an authenticated request**. Local reviewers check permission-enforcement code, not grant principal approval. All subsequent live observations must bind those exact bytes. A changed source requires new checks; an actual provider-contract failure ends the affected live test rather than authorizing an unreviewed live patch/retry loop.

Completion: one reviewed, hash-bound operator with explicit request/fixture allowlists and no path to publication, activation or billing.

## 2. Named resources and request envelope

Use only the retained new public-app development environment; these historical identifiers must be reverified live, not assumed current:

| Identity | Expected historical value |
|---|---|
| App | `gid://shopify/App/429028933633` |
| Client ID | `1443cf6d03d39edae7c101a943c5c684` |
| Shop | `insignia-rewrite-dev.myshopify.com` |
| Shopify Shop ID | `gid://shopify/Shop/105501393179` |
| Existing installation | `gid://shopify/AppInstallation/1054356963611` |

Use the documented existing credential route from the tooling register. Credential lookup is limited to that route/app/shop; no broad secret search, new credential, scope expansion, reinstall or grant repair. Check exact identity and the existing `read_products`/`write_products` capability before creation. A missing usable route, changed installation or insufficient permission stops authenticated work and returns the precise prerequisite; local work may still finish.

Owner-forwarded maximums are **whole-slice, not per process/restart/worktree**:

| Operation | Ceiling |
|---|---:|
| Existing-scope token issue/refresh exchanges | 3 |
| Admin GraphQL read requests | 96, of which 12 reserved for final/stop-state observation |
| `productCreate` attempts | 1 |
| `productUpdate` status-only attempts on the returned fixture ID | 16, of which 3 reserved for safe finalization |
| Publication-membership, metafield/policy/key, Function, inventory/variant/price or billing mutations | 0 |
| Cart, checkout, payment, order, fulfillment, refund or cancellation operations | 0 |
| CLI app dev/deploy/release/clean, app-version or app-configuration changes | 0 |
| Product deletion | 0 |

Every possible outbound attempt, including an automatic SDK retry, consumes the appropriate budget. Disable blind mutation retries. Reserve intent durably before dispatch; bind run identity, operation, source, body digest and exact returned fixture ID. Reuse the project's simple single-operator durable register/lock pattern; do not build a second production workflow/lease service. A missing/corrupt/unknown register is a stop, not permission to reset counters. Ordinary dependency retrieval, public documentation and GitHub reads are outside the Shopify request budget.

## 3. Fixture ownership and exposure

Create **one new product**, with explicit DRAFT status, a unique run-bound `insignia-m5-004-...` handle/title/tag and no media, collection assignments, inventory seeding or extra variants. Retain the provider-returned Product ID; never select an older fixture by a familiar title. Verify no publication or scheduled-publication membership before any status cycle and after each completed cycle. The product must remain unpublished throughout.

Shopify documents productCreate as unpublished by default and ACTIVE as not automatically published, but those documents do not substitute for the actual fixture read. Unexpected publication or unrelated changes stop the experiment. No channel-membership repair is authorized. Historical products, orders, billing fixtures, retained nine grants and stopped previews remain untouched.

A lost creation response permits only a bounded read for the exact unique run marker/handle, with identity/creation-window checks. Never resend create. Unattributable or ambiguous ownership ends mutation work.

Capture provider state separately from normalized adapter snapshots: status, updatedAt, selected publication/visibility fields and their bounded connection completeness, observed origin/receipt, and immutable fixture identity. Use real time for live observations. Preserve values needed to explain a derived-metadata mismatch; do not export credentials, authorization headers, session traces or unrelated merchant data.

Completion: a uniquely owned unpublished fixture and a saved prestate; otherwise return a concrete blocked result.

## 4. Execute the bounded matrix

Run serially through the **unchanged current adapter**, not an equivalent hand-written mutation client. Bootstrap/status setup and finalization are separately identified fixed `productUpdate` operations restricted to this same fixture; hold/acquire/observe/restore are the production adapter paths being measured.

1. **Original DRAFT:** snapshot, acquire, persisted-hold reload in a fresh process, observe and restore. Expect no adapter status mutation.
2. **Original ACTIVE:** explicitly stage ACTIVE while still unpublished, then snapshot → acquire DRAFT → save/reload exact hold → observe → restore ACTIVE → exact readback.
3. **Original UNLISTED:** same cycle, restoring UNLISTED rather than ACTIVE; inspect catalog detail and a narrowly filtered list containing the fixture.
4. **Original ARCHIVED:** same cycle, restoring ARCHIVED.
5. **Known observed drift control:** stage this fixture ACTIVE, acquire DRAFT, then make one separately acknowledged status-only change to ARCHIVED on the same fixture. Observe/restore must report conflict without overwriting that known change. This is an observed-drift control, **not a concurrent CAS/race proof**.

Before executing, enumerate the concrete request plan and verify it fits the ceiling while preserving finalization reserve. Do not repeat a successful case merely for more screenshots. Execute only feasible cases; unavailable states or legitimate provider rejection are recorded rather than worked around.

The experiment calls the adapter directly under this explicit fixture-operation authority; it does **not** call the production activation coordinator with invented RELEASE_BOUND evidence. A restoration before-send predicate must bind the owned fixture, current step, real finite experiment deadline and unconsumed allowed attempt. It is experiment permission only, never persisted or presented as production release/recovery authority. Do not add an Admin/browser activation button or weaken production readiness.

Persist hold snapshots and reload them byte-for-byte for observation before restoration. Record exact acknowledged mutations and all actual readbacks. Distinguish provider observations, normalized decisions and operator setup actions. No intentionally lost live response, network fault, race, token revocation or timeout experiment is authorized; those remain synthetic regressions. If ambiguity happens naturally, stop further mutation rather than assuming a status read establishes settlement.

## 5. Failure, finalization and evidence limits

On schema/permission/identity/membership/normalization/restore mismatch, stop the affected cycle, preserve expected/actual fields and form a local replay against the captured sanitized response. Production source changes, widened matching, freshness relaxation or removal of visibility fields require principal adjudication; do not change an expected value merely to produce a pass.

If every earlier possible write is accounted for and acknowledged, finalize only this fixture as **ARCHIVED and still unpublished**, using a reserved status-only attempt if necessary. Verify and retain its ID/marker; no deletion. If settlement, ownership or state is unknown, leave the last observed unpublished fixture alone and return the unresolved operation/readback. Cleanup is not authority to replay over ambiguity or repair unrelated resources. Do not terminate shared infrastructure.

An unpublished fixture can establish this adapter's real status/schema/ownership/readback behavior. It **cannot prove** availability withdrawal for a previously published product, preservation of all nonempty publication histories, all-channel propagation, in-flight checkout completion, atomic product-version CAS or a production rollout contract. Report those limits explicitly even if every case passes. No real ProductConfig/effective revision, production key or Function is activated.

## 6. Return one qualification PR

Return actual merge/branch/base/head/tree, source/build bindings, offline safety and applicable CI results, per-operation budget totals, the observed case matrix, request/response provenance, normalized snapshots, restored/status-conflict outcomes and final fixture/cleanup state. Include a concise finding on whether the exact adapter matches the tested real contract and which remaining production prerequisites it does not establish.

Preserve all earlier M5 failures and the new raw-versus-normalized discrepancies. Large private traces are unnecessary; retain minimal sanitized factual responses and checksums. A readback is evidence of that read, not platform-wide consensus. A failed contract test or access blocker is a valid returned outcome with a precise reproducer, not a reason to invent a passing result or broaden permission.

Require fresh full-source Spec/correctness and Standards/security review of the completed operator/evidence change and all applicable final-head workflows. Reuse existing scripts; no required test may be weakened. Do not rerun the unchanged 100k benchmark solely for this operator: verify relevant source bindings, rerunning only if its inputs/seams change. Existing root/regression coverage remains, with real PostgreSQL/HTTP/worker runs where source or composition is affected; report DB-free skips separately.

**Stop for principal review.** Neither this PR's merge nor M6/M7, complete M5/G6/G7 acceptance, production RELEASE_BOUND/recovery, live product-config activation or launch is authorized. New live supported-channel/in-flight and release-source work will need its own scoped decision after this evidence.

## Contract references

Repository authority remains primary for project decisions. Current external material supports the experimental candidate, not proof of its actual result:
- https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate
- https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ProductUpdateInput
- https://shopify.dev/docs/apps/build/product-merchandising/unlisted-products

Version selectors can move; validate the operator against 2026-07 before execution. No automatic API upgrade is authorized.
