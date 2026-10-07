# M5-016 — publication coverage and cleanup

## Outcome

**Phase A CLOSED / SEALED — DIRECT_ONLY. Cleanup FINAL_ARCHIVED_UNPUBLISHED.** On 7 October 2026 UTC, exact target Publication `gid://shopify/Publication/339456917787` confirmed inclusion of exact owned fixture `gid://shopify/Product/10495813091611`. Both complete generic APP discovery connections omitted that Publication and its historical AppCatalog. One status-only archival update settled; one final read confirmed ARCHIVED and effective-unpublished.

**No production correction is authorized or implemented.** Exact-ID lookup proves the known Publication's inclusion, not generic complete configured-intent discovery for arbitrary hidden intent. The effective-ID subset invariant remains intact. Live v2 hold qualification remains unqualified. No hold/acquire/restore or further live lifecycle was attempted. Provider authority ended at Phase A closure; this fixture and canonical run must remain closed.

[Integrated PR #47](https://github.com/Optidigi/insignia/pull/47) returns the bounded experiment operator, regressions and evidence for principal review. No successor merge or next slice is authorized.

## Entry and frozen gate

[The supplied brief](prompts/M5-016-PUBLICATION-COVERAGE-AND-CLEANUP.md) and [external PR46 principal approval](PR-046-principal-review.md) are preserved unchanged. Supplied archive SHA256: `286198898fb4c30a6b894c4c79a784de83adf46ce0e67f12b8f2769db1b5c666`; all six manifest entries verified after neutral extraction.

PR46 live refs, all ten unique exact-head attempt-1 successful workflows and the supplied external approval matched. No native approval was fabricated; native review list was empty. Normal merge `d0efd626222047a2047573f678b019cd7b1802a9` has ordered parents `6a186bea8e5d1c01a66f7ab683c06393fe81e991`, `38bac0cfabf96632e533e11df2ccfda9c513dea3` and tree `b54b0f83beee01a06a5218af0a18f604f6e3482b`; remote main matched. [Exact merge receipt](evidence/m5-016/pr46-merge-receipt.json). PR46 is accepted only as truthful STOPPED M5-015R evidence; its run/report were never reopened or relabelled.

The full offline gate completed before canonical initialization or credentials. Frozen precredential and live source: `59593cae97fef72f1aa1260eee773fbc251a6f0e`; tree: `b8eb2de66a085544df485030d162d710f4aac3b9`; base/effective merge base: `d0efd626222047a2047573f678b019cd7b1802a9`. All 3,288 source/build hashes were bound; 96 compiled files in contracts/domain/application/shopify matched the unchanged prior production build. All 46 historical canonical files remained exact. [Preinitial receipt](evidence/m5-016/preinitial-receipt.json), [frozen gate](evidence/m5-016/gate.json), [offline checks](evidence/m5-016/offline-report.json), [ten exact-source CI runs](evidence/m5-016/source-r6-ci-raw.json). These records describe their historical precredential state and are not rewritten to describe completion.

## Actual Phase A observations

The guarded entry was executed once: `node scripts/m5-016/entry.mjs start`. Exit0; stdout records PHASE_A_SETTLED/DIRECT_ONLY and exact accounting; stderr empty. [Raw selected run](evidence/m5-016/run/qualification.json), [durable reservations/events](evidence/m5-016/run/register.json), [external closure verification](evidence/m5-016/phase-a-closure-receipt.json).

Identity matched shop `gid://shopify/Shop/105501393179`, domain `insignia-rewrite-dev.myshopify.com`, partnerDevelopment=true, app `gid://shopify/App/429028933633`, client `1443cf6d03d39edae7c101a943c5c684` and installation `gid://shopify/AppInstallation/1054356963611`. Current grants contained read_products, write_products, read_publications and read_product_listings. The existing own-organization Admin client_credentials route was used; no app scope/version or installation operation occurred. Requests used Admin GraphQL 2026-07.

Ownership matched fixture ID, handle/title/tag marker `insignia-m5-015r-746f0a94-9ce4-4679-a324-6647f59c6c0f` and createdAt `2026-10-06T21:27:53Z`. ACTIVE prestate updatedAt was `2026-10-06T21:28:06Z`, target publishedOnPublication=true, and complete resourcePublications contained exactly one effective target node with publishDate `2026-10-06T21:27:58Z`. Prestate onlineStoreUrl and publishedAt were null; absence of an online-store URL did not negate the target's effective membership.

| Fixed surface | Actual complete observation | Classification contribution |
|---|---|---|
| Exact Publication / includedProducts filtered to this product | Target exists; autoPublish=true; supportsFuturePublishing=false; ACTIVE AppCatalog188090286363; includedProducts contains exactly Product10495813091611; both page flags false | Direct inclusion confirmed |
| Exact channels projection | Channel339456917787; app294412484609 | Minimal channel identity evidence |
| publications(catalogType:APP) | One complete page, three nodes; target absent; no provider/shape error or denial | Complete generic negative |
| catalogs(type:APP) | One complete page, three AppCatalog nodes; target Publication and historical AppCatalog absent; no provider/shape error or denial | Complete generic negative |
| Combined result | direct=true; both generic target predicates=false; historical catalog=false; ambiguity=false; provenSurface=null | DIRECT_ONLY |

Both generic connections returned these associations, with ACTIVE catalog status:

| Publication numeric ID | AppCatalog numeric ID | autoPublish | supportsFuturePublishing |
|---|---|---|---|
| 339456885019 | 188090253595 | false | true |
| 339456950555 | 188090319131 | false | false |
| 339456983323 | 188090351899 | false | false |

Both pageInfo objects had hasNextPage=false and hasPreviousPage=false; raw end cursors remain preserved. This matches the three-ID historical unfiltered omission recorded by M5-015R, whose raw failure/result remain unchanged. Typed discovery did not cure that omission. Publication/catalog/channel queries retained only the authorized IDs/capabilities/status, without names, titles or account data.

## Cleanup and closure

At the archival boundary, ownership/identity were exact and fresh, ACTIVE prestate was known, all prior writes were settled, and pending/unknown were zero. Exactly one `productUpdate` input `{id:"gid://shopify/Product/10495813091611",status:"ARCHIVED"}` was dispatched. No publication field was mutated. The ACK and one exact final read settled without retry.

Final ownership remained exact. Final product was ARCHIVED, target publishedOnPublication=false, complete resourcePublications.nodes empty, onlineStoreUrl=null and publishedAt=null. Complete unpublishedPublications returned the same three generic Publication IDs above. ACK/readback updatedAt both `2026-10-07T01:00:37Z`, exact delta0ms. Timestamps are diagnostic; this slice changes no production equality/CAS semantics and does not waive M5-011's one-second conflict. Final configured intent was **not** re-read; no claim of unchanged final configured intent is made.

Actual requests: auth1/ceiling1, Admin GraphQL6/ceiling16, status-only archive1/ceiling1; every other mutation category0. Seven serial durable events: auth, prestate, direct, publications, catalogs, archive, final. Native transport reservations7/dispatched7/denied0/matches=true; pending=null and unknownMutations0. The register is closed and all five canonical files are owner-read-only0400. Raw repository copies are byte-identical; [closure receipt](evidence/m5-016/phase-a-closure-receipt.json) supplies each SHA256 and the last event completion time. Its external verifiedAt is a verification time, not an invented canonical close timestamp. No further provider operation followed closure.

## Operator qualification and review

The fixed process guard privately captures native fetch and native monotonic time. Immutable global fetch fails with network_escape_denied; only the durable operator receives native transport. Missing/misspelled adapter fetchImpl is proved locally with zero external requests. Synthetic fixtures use bounded local/fake transports and temporary runs; the sole live entry uses the fixed canonical path. Every native request requires a durable reservation; guards poison further access on identity/accounting drift. Queries, serial request/time/body/pagination bounds and the single archive mutation are fixed. Ambiguous writes cannot retry. The operator does not replace or patch production availability logic.

Pinned TDD/tests/mocking, diagnosing-bugs, code-review, writing-for-agents and handoff skills were used under the project operating model. Actual orchestrator and reviewers used GPT-6.1-sol/high. Original full-source review rounds1–5 found defects; each report is retained unchanged with focused red/green reproductions and [responses](evidence/m5-016/review-findings-responses.md). Round6 accepted the frozen source with no unresolved material finding: Spec/correctness `01a113cc-a6e5-7440-b6be-a28491996b50`, Standards/security `01a113cc-a6e5-7213-a4dd-472596483f01`. [Spec original](evidence/m5-016/review-spec-r6.md), [security original](evidence/m5-016/review-security-r6.md), corresponding same-launch settings JSON alongside them.

Reviews used two parallel installed Codex exec sessions with actual model/effort and enforced read-only filesystem/approval never. Native delegation did not expose an enforced read-only filesystem profile here; the recorded CLI fallback created no top-level T3 conversations. This claims neither OS credential/network isolation nor principal/native approval. Fresh completed-change full-source reviews at the integrated evidence candidate and final natural CI are supplied verbatim in the external principal packet, with actual launch settings and exact refs. They cannot be substituted by precredential round6.

| Check actually executed | Result / limit | Durable evidence |
|---|---|---|
| Frozen offline install/build | exit0 | install/build logs |
| Focused operator/binding/process guard | 73/73 | focused-r6-current.log |
| Production v1/v2 adapter regression | 170/170 | adapters.log |
| v1/v2 recovery | 20/20 | recovery.log |
| Full root corepack pnpm check | R1–R7 exit0; exact-source CI covers final diagnostic code adjustment | root-check-r1…r7.log; frozen CI |
| Publication stress / renderer control | 100/100; expected inner renderer failure with successful control exit0 | stress.log; renderer-control.log |
| Style / secret checks | exit0; existing style warnings/info retained | style-r6-final.log; secrets-r6.log |
| Local PostgreSQL integration | UNAVAILABLE: DATABASE_URL absent | offline-report.json |
| Actual exact-source PostgreSQL18 CI | PostgreSQL18.6, success, attempt1 | source-r6-postgresql18.log and source-r6-runtime.log |
| All ten natural frozen-source workflows | exact head59593…, attempt1, completed/success | source-r6-ci-raw.json |
| Raw/historical/production invariants | five sealed raw copies exact; historical46 exact; packages/sql unchanged | closure/binding evidence |

Original failed attempts remain available: incorrect initial Vitest runner, intentional red counterexamples, outdated audit expected shape, missing synthetic clock forwarding, and style overlapping a temporary boundary probe. They are not called passes; subsequent corrected commands passed. Log normalization removes only ANSI/trailing blanks and records original/copy SHAs in [provenance](evidence/m5-016/offline-log-provenance.json). Canonical JSON is never normalized. Public schema retrieval limitations remain documented in [schema notes](evidence/m5-016/schema-notes.md); docs lookup alone was not claimed as live coverage proof.

## Principal boundary

Changed source is confined to the experiment scripts, their root test/style registration, instruction routing and evidence/docs. Production packages, SQL, v1 semantics, mixed-version fences, recovery, prior harnesses/reports and historical JSONB retain their prior meaning. No new fixture, publication mutation, app scope/version change, deletion, inventory/variant/price/media work, production activation, RELEASE_BOUND, G7, M6/M7 or launch occurred.

Principal must adjudicate DIRECT_ONLY coverage and the remaining generic discovery limitation. Recommend preserving fail-closed production behavior until a separately authorized slice establishes a generic complete authority; hardcoding this exact Publication would not satisfy that requirement. No production patch is proposed for this slice. PR47 remains unmerged, and principal approval/next-slice authorization remain external and pending. Exact final base/head/tree/effective merge base, review settings/reports and final CI belong in its PR body and portable principal packet, avoiding a self-referential commit.
