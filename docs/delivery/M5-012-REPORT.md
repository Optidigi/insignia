# M5-012 — Copilot intent surfaces disagree; cleanup withheld

**Canonical classification: INCONSISTENT. Outcome: STOPPED intent_inconsistent.** Three documented intent/inclusion surfaces return the exact owned DRAFT fixture, while the publication_ids association search validly excludes it. Under the frozen harness's conservative disagreement rule, archive was withheld. No write occurred.

| Fixed surface | Exact result | Completeness |
|---|---|---|
| publication339456917787 includedProducts, id10490211467547 | One exact owned DRAFT product | first:2; both pageInfo flags false |
| id10490211467547 published_status294412484609-intended | One exact owned DRAFT product | first:2; both flags false |
| id10490211467547 published_status339456917787-intended | One exact owned DRAFT product | first:2; both flags false |
| id10490211467547 publication_ids339456917787 | Empty | first:2; both flags false |
| Exact publishedOnPublication339456917787 | false | Scalar on each owned anchor |

These positive inclusion/intended observations support configured channel intent on this DRAFT fixture. The canonical result remains INCONSISTENT because association differs; no after-the-fact relabeling or weaker cleanup guard was applied. The exact semantics/coverage of publication_ids versus the three agreeing surfaces require principal adjudication. This slice did not capture these surfaces before ACTIVE→DRAFT, so it does not establish their cross-transition invariance.

## Exact state and accounting

Product `gid://shopify/Product/10490211467547`; handle/title/sole tag `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`; created `2026-10-02T21:19:48Z`. Every anchor and every returned node matches ownership and state. Last observed at `2026-10-06T14:47:50.793Z`: DRAFT, updatedAt `2026-10-06T13:09:52Z`; legacy publication nodes empty and complete; publishedAt/onlineStoreUrl null; exact effective-publication boolean false. No observed ownership/state/grant drift or provider error. Search diagnostics had no warning or malformed-metadata failure.

Fresh identity is exact Insignia app429028933633 / client1443cf6d03d39edae7c101a943c5c684, shop105501393179 / insignia-rewrite-dev.myshopify.com, installation1054356963611, development true. Grants include write_products, read_products, read_publications and read_product_listings and remain identical across all reads. Publication metadata remains autoPublish true, supportsFuturePublishing false, active AppCatalog188090286363; its complete first:2 channel view contains Microsoft Copilot Channel339456917787 / App294412484609.

Actual usage: **auth1/read7/update0**, all settled, pending null. Cleanup NOT_ATTEMPTED. ARCHIVED update and final readback NOT_RUN; one unused read is not continuation authority. [Canonical binding/gate/register/qualification and closure](evidence/m5-012/live/) are exact-byte copies; the fresh register is closed and sealed. No provider operation occurred after the stop. M5-004/009/010/011's 27 canonical files remain hash-identical.

M5-011's acknowledged version13:09:51Z versus readback13:09:52Z remains real conflict evidence. This fresh version observation does not waive it. Its four empty V2 partitions and ambiguous sole-cause attribution are unchanged. No production availability source/build change or timestamp tolerance was added.

## Authority and source qualification

[Fixed prompt](prompts/M5-012-PUBLICATION-INTENT-AND-CLEANUP.md) and [owner-forwarded external approval](evidence/m5-012/authorization/PR-041-principal-review.md). PR #41 normally merged as `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e`, with ordered parents `1fffcb3048952ff762f1f9805f86aceed90f228f`, `9353bf9a5c13649daa55cb3693cab16532c6f6f6` and tree `e00f2f8ce5b33321b67c6271cb13a315f34471a1`; [actual merge receipt](evidence/m5-012/pr41-merge-receipt.json). Live refs, ten exact-head attempt-1 passing workflows and external approval matched before merge. No native approval or protection bypass was fabricated.

Executed M5-012 source `0f8b7d7d53732cf7d0038eb4d366fe2e6179b01f`, tree `1f4b2195bdd4325e126f4fc2a5911220399abecf`; bindingDigest `6a3d80fdb571fc9754f11d4e5168a64b111e7296b0eb555a9fc8842cc1fbe115`, 2846 source/build entries. The complete offline gate verified before credential access: full serial root check, focused31/31 including100 serial cases, browser stress100/100, eight2026-07 schema documents plus rejected invalid control, two fresh full-source GPT-6.1-sol/high reviews and ten exact-source attempt-1 passing workflows. Production availability source and all26 Shopify build artifacts match prior binding. Database qualification is CI, not a locally configured database.

Five preserved red/green cycles cover denied targets, exact cleanup settlement, search metadata, malformed GraphQL errors/rejected-data retention, and durable no-retry/final-read capacity. The supplied prompt establishes the request/operator, qualification and binding seams; tests mock external HTTP/credentials and exercise real durable operator behavior. [Round1](evidence/m5-012/precredential-round1/responses.md) and [round2](evidence/m5-012/precredential-round2/responses.md) material findings and responses remain full and unedited. [Fresh round3 reports](evidence/m5-012/precredential-round3/) clear both axes on the executed source. Actual same-launch settings were checked by the orchestrator; reviewer self-attestation limitations remain verbatim.

Reviewers use the operating model's fresh Codex CLI fallback because native collaboration does not expose sandbox controls. Enforced read-only/never settings are verified; this does not claim credential isolation. Reviewer tests redirected filesystem writes to memory and could not run nested Git freeze due EPERM. Host real-filesystem/root checks and exact-source CI passed; physical crash/power-loss durability was not independently simulated. Initial overlapping local launches were stopped and marked NON-ACCEPTANCE; accepted checks ran serially on each corrected candidate. Historical log whitespace stays preserved.

## Principal handback

[Recommendation](M5-012-PRINCIPAL-RECOMMENDATION.md): adjudicate the association predicate and configured-intent/effective-publication distinction before choosing a versioned production snapshot/settlement correction. Cleanup remains a separately owned decision because this register is closed. No new live attempt, production correction or dependent slice is authorized.

Fresh completed-change reviews and final-head CI will be published against the final PR head in its review-packet comment; this avoids a self-referential source commit. Stop for principal review. No availability acquire/restore, ACTIVE→DRAFT repeat, new product, publication/scope/version mutation, inventory/variant/price operation, matrix continuation, M6/M7, activation, RELEASE_BOUND/development-gate pass or launch occurred.
