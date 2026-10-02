# M5-004 — availability adapter qualification

## Authority and merge

The owner authorized only PR29's exact normal merge and this bounded qualification. Actual merge a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30 has ordered parents 8a84ddeaf277368852d224915abe6d4a93a3d8a4 and 7a67028d55c191d9c83816312844f2e9cd62d648, tree5f3f29d44da7d5f0423fd6902c19dc501f7c79ff. The new branch begins at that verified remote main. External approval is attributed, not a native review.

## Current outcome

**STOPPED_ACCESS_PREREQUISITE — no fixture created, no Shopify mutation.** One authentication exchange and one fixed Admin identity read completed on 2 October 2026 UTC. App, client, shop, installation and development-store identity matched. That response returned `currentAppInstallation.accessScopes: []`, failing the required exact nine-grant guard before creation. This is the current bearer’s returned scope view; it does not establish why it differs from historical preview evidence or prove an organization-wide permission change.

The affected live experiment ended. No scope repair, reauthorization, alternate credential search or retry occurred. All five status/catalog cases are NOT_RUN. No cleanup mutation is needed because no fixture exists. The register is settled, its lock released, and unused allowances confer no further authority. The precise next prerequisite is principal/owner disposition of this current empty-scope response versus the retained nine-grant requirement; a targeted access investigation or repair requires new authority.

The live source is **e3d15d451f60fd3dc894679534f0f0132186857d**, tree **b81608fc911e7bdbaadcf5daa20e8b6e5694bbb9**, with a173-path source/build binding digest **dd134b3d6673965078cf7c4cb5638d3d735f54b117b7a3fcc7685981cefebedb**. Both fresh full-source safety reviewers cleared that candidate before credential access; all ten source workflows succeeded on attempt1. The later evidence head adds the captured-response regression and reporting, and is not represented as the live-run source.

The experiment reused unchanged production availability/catalog builds; the guard stopped before either reached a product. No production application/database/protocol behavior changed. Root/integrator runtime is actual T3 Code Codex gpt-6.1-sol/high. Independent reviewers used explicit same-launch model/effort/read-only settings, retained in full source-bound reports and selected settings receipts.

## Actual access, budgets and final state

| Check | Observed result |
|---|---|
| Credential route | Existing approved server.env, uid1000, mode600; parent ownership/private permissions passed. Contents, secret, bearer and auth response omitted. No Partner credential read. |
| Authentication | Existing Admin client_credentials HTTP200; usable short-lived bearer accepted in memory, no cache/export. |
| Shop | gid://shopify/Shop/105501393179; insignia-rewrite-dev.myshopify.com; partnerDevelopment=true; Basic App Development. |
| App/client | gid://shopify/App/429028933633;1443cf6d03d39edae7c101a943c5c684. |
| Installation | gid://shopify/AppInstallation/1054356963611. |
| Access | HTTP200 scope array empty; expected read_products, write_products, read_cart_transforms, write_cart_transforms, read_validations, write_validations, read_inventory, write_inventory, read_locations. Guard returned retained_grants. |
| Actual attempts | auth1/3; reads1/96; create0/1; status updates0/16. Final reserves12 reads/3 updates unused. |
| Fixture/cleanup | NO_FIXTURE_CREATED. No creation, status/publication/policy/key/Function/billing/commerce mutation; no compensating action or delete. |
| DRAFT/ACTIVE/UNLISTED/ARCHIVED/drift | All NOT_RUN; no product snapshot, hold, restore or catalog result invented. |

[Immutable operator register](evidence/m5-004/live/register.json), [qualification](evidence/m5-004/live/qualification.json), [sanitized identity response](evidence/m5-004/live/identity-response.json) and [budget/cleanup receipt](evidence/m5-004/live/cleanup-budget.json) preserve the stopped outcome. The fetch-observed identity body SHA-256 is90c969d016495de29cf427fc797c9c2c6bd6742f8b6aa10785661ed5a600e6a3. Saved selected fields are sanitized evidence, not the original full body; local replay reconstructs those selected JSON semantics, not byte identity. Auth event bodyDigest hashes only a fixed public intent and literal secret placeholder, never credential bytes.

The captured-input regression runs the actual public qualification workflow and identity guard with only external fetch/credentials synthetic. It reproduces retained_grants, exactly one auth/read, zero fixture writes and released lock. It establishes stop behavior, not live availability-adapter qualification.

## Request plan

One existing Admin client_credentials exchange and one productCreate. Initial identity + owned read:2 reads. DRAFT cycle:2 identity +4 adapter reads +1 owned=7 reads,0 updates. ACTIVE/UNLISTED/ARCHIVED: setup3 reads + cycle9 reads each,3 updates each including setup; UNLISTED adds2 catalog reads. Drift:two setup groups6 reads + snapshot/acquire/observe/restore5 adapter reads + final owned1=12 reads,3 updates. Thus normal plan59 reads/12 updates, with conservative allowance up to70 reads, remaining normal84-read/13-update caps. Finalization normally3 reads/0 updates; on stopped known writes up to6 reads/1 status update. Whole-slice maximum96 reads/16 updates reserves12/3 for finalization; auth3/create1. Every attempted request, including failed HTTP, consumes a reservation. No parallel provider calls or intentional live faults.

## Offline checks and local review

The pre-access source passed32 public operator/workflow tests on pinned Node24.21.0. Final evidence source adds one captured-response case (33 tests), without production/operator behavior changes. Complete root check reached its artifact manifest; exact-source foundation CI independently succeeded for the full root command and100/100 no-retry geometry stress. Eight DB-free web skips remain explicit; they are not PostgreSQL integration evidence. Exact-source PostgreSQL18/HTTP/worker workflows succeeded, including159 database tests, one built HTTP/queue-handoff test,15 PostgreSQL-backed Admin/editor tests and15 worker/runtime tests. Final-head CI is linked in the PR packet after committing.

All six retained100001-row benchmark source/build/query/migration inputs still match their original hashes; the benchmark was not unnecessarily repeated. Architecture v1.4 plan/ledger hashes and historical receipts/source remain unchanged.

The first three safety pairs’ findings, actual red/green evidence and original reports remain preserved below and under offline-safety. Fourth Spec and Standards/security full-source reviews both report **no unresolved material finding** at the live source. Their actual distinct sessions are01a0f9e9-e373-7752-9ee0-7aa47ec05588 and01a0f9e9-e8be-7b02-81a1-58f1405332c6, each observed modelgpt-6.1-sol, efforthigh, sandboxread-only, approvalnever. These local findings do not confer principal approval. The completed evidence change requires two further fresh full-source reviews, whose exact-head reports/settings and dispositions will be returned in the PR packet.

No raw agent sessions/reasoning, owner credential files, auth payloads/bearers or private request traces are imported. Earlier retained logs contain formatting whitespace; that diagnostic is not rewritten as a code/security pass. Current source formatting checks remain separate.

## Limits

An unpublished fixture cannot establish withdrawal of previously published availability, nonempty publication histories, all-channel propagation, in-flight checkout drainage, native product-version CAS, deployed Function identity or production RELEASE_BOUND recovery. No production activation or gate completion is claimed. Nine grants, billing resources, stopped previews, old fixtures and order history remain preserved. Final refs, source/build hashes, observed matrix, budgets, cleanup and local-review results will be returned in this report and its PR packet.

## Initial local-review corrections

Both first independent GPT-6.1-sol/high reviews refused safety clearance at candidate09de2ef844113570d5d67dd7b959401445e79687. Their full reports/settings and red/green logs are preserved in evidence/m5-004/offline-safety. These are harness findings, not production adapter changes. No credential access occurred.

| Finding | Correction and public regression |
|---|---|
| Per-directory budget/lock and missing history | One canonical live register outside worktrees; one initialization sentinel prevents recreating missing history; alternate live paths reject; directory ownership/private permissions checked. |
| Incomplete CI/unbound review receipts | All ten applicable workflows required exactly once; identified exact-head runs; offline and independent review source/base/build bindings; retained report/settings hashes; same-launch actual model/effort/read-only settings checked. |
| Gate certified another checkout / stale register binding | Live entry anchored to executing module checkout; full register binding must match before credential loading. Separate explicit synthetic credential/HTTP seam makes no live attestation claim. |
| Late HTTP continuation could outlive lock | Pending/queued dispatches prevent lock release/reopen until work settles. Already-aborted queued requests refuse before fetch. |
| Malformed/unsuccessful mutation treated as settled | Only supported HTTP200 with valid explicit-null-product user-error envelope is REJECTED; malformed/5xx/non-JSON outcomes remain UNKNOWN and prohibit cleanup writes. |
| Wrapper altered error classifications / unreplayable sanitized errors | Preserve actual HTTP classification without requiring JSON on non200; preserve malformed200 behavior and error-field presence/nesting/types. Replace message text with typed placeholders, retaining classifier codes. Real-adapter snapshot/acquire replay tests verify identical normalized outcomes. |
| Unrelated metadata drift | Bind acknowledged handle/title/exact tags/creation timestamp; later owned reads reject drift; reopened history validates baseline against creation receipt. |

The root suite and100/100 no-retry stress passed for the first source, with eight explicit DB-free web skips. All ten initial-source CI workflows succeeded on attempt1. Corrected source is awaiting new root/CI and both fresh full-source safety reviews; these prior successes do not open its live gate. Historical PG/HTTP/worker and100k evidence is reused only where exact unchanged source/build bindings match.

## Second safety review and response-byte closure

Fresh reviews of e4fce4b6f7ab950e94a639b63785232b9d206032 closed the initial structural findings but withheld clearance for four additional edge cases. Full reports and corrections remain in offline-safety. Malformed success userErrors must be an actual empty array to acknowledge a write; a full synthetic workflow now confirms malformed success keeps UNKNOWN and sends no cleanup.

The transport delivers original bounded fetch-observed bytes to the unchanged adapter and hashes those bytes. Availability keeps its128KiB bound; catalog keeps its1,000,000-byte bound and fatal UTF-8 behavior. Missing/oversized bodies retain provider_shape; synthetic replay preserves those outcomes. Oversized responses record only a bounded-prefix digest and explicitly do not claim a complete response hash. Sanitized invalid-UTF8 replay is diagnostic, not original provider bytes. Direct/wrapped/replayed controls cover these cases and user-error/HTTP classifications.

Every drift/catalog case is persisted before assertions; normalized results and failure class are retained. Catalog failure leaves UNLISTED STOPPED. Drift observation failure stops before restoration; a known observed drift grants zero restoration writes. No source patch or retry would be permitted after a real contract failure. Corrected30-test suite is green; new complete-root, source CI and fresh full-source safety reviews are required before credentials.

## Restart-preservation and catalog success-status closure

Third full-source security review found no material issue; Spec review withheld clearance at5420a886ca6a9a143f8ade0f204d804e4baed685 for report overwrite on restart and body loss on successful catalog201. Both are corrected with public direct/wrapped/replayed and restart regressions. Ordinary re-entry now refuses before credential loading when history or a qualification report exists, preserving previous normalized evidence byte-for-byte. Counters and successful cases are never reset/repeated. This conservative experiment is not an automatic live-resume service: interruption requires retained evidence and a safe disposition, not a replay. Catalog uses its response.ok success predicate; availability retains exact200 classification. The32-test suite passes; this changed source still requires fresh complete-root/CI and both full-source safety reviews.
