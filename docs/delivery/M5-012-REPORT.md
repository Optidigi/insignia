# M5-012 — publication intent and exact fixture cleanup

Status: offline qualification IN_PROGRESS; credentials and live operations NOT_RUN.

Authority: [fixed prompt](prompts/M5-012-PUBLICATION-INTENT-AND-CLEANUP.md), owner-forwarded [external PR #41 approval](evidence/m5-012/authorization/PR-041-principal-review.md), and [actual normal merge receipt](evidence/m5-012/pr41-merge-receipt.json). Base is `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e`. Source keeps production availability source/build and closed prior registers unchanged.

The fixed harness reads exact identity/grants, the owned fixture, publication metadata, includedProducts, two intended searches and publication_ids. Every intent response repeats the exact product anchor and full identity/grants; all connections are first:2 and complete. Read order consumes at most eight Admin reads, including final readback. Only status-only ARCHIVED is allowed, once; no acquire/restore or other mutation.

The pre-agreed seams are the fixed request allowlist/serial durable operator, the qualification entry point and source/review/CI binding. Five preserved red/green cycles cover denied broad/alternate requests, exact cleanup settlement and malformed search metadata, plus malformed GraphQL errors and rejected-data retention. Additional public-seam tests cover ownership/grants, state/version drift, connection completeness, disagreement, ambiguity, quarantine/reentry and 100 serial scenarios. The boundary is mocked external HTTP and synthetic credentials, never production internal adapters.

GraphQL schema validation passes for eight documents against 2026-07; invalid control fails. Search meaning and timestamp limitations are recorded in [research](M5-012-RESEARCH.md). The strict DRAFT baseline/version and all-surface agreement guards may stop conservatively; they never convert ambiguous evidence into cleanup authority. M5-011 V2 emptiness and one-second provider conflict stay unchanged.

Precredential full-source Spec and Standards/security reviews, full root checks, applicable browser stress and exact-source CI are required before source freeze. Reviewers use fresh actual GPT-6.1-sol/high Codex CLI sessions with enforced read-only/never settings, the repository operating-model fallback because native collaboration does not expose sandbox controls. No fabricated principal/native approval.

The initial overlapping local check launches were stopped and marked NON-ACCEPTANCE. Acceptance checks run serially on this candidate; no credentials were accessed during those launches. Live intent classification, cleanup state, final completed-change reviews and final CI remain pending.

Completed precredential round 1 found two material defects; full reports and responses are preserved in [round 1](evidence/m5-012/precredential-round1/responses.md). Both corrections remain offline, and require fresh source reviews and CI before the gate can open.

Completed precredential round 2 found a public-operator failed-read retry path; durable per-operation reservation and final-read capacity now fence it. [Reports/responses](evidence/m5-012/precredential-round2/responses.md) remain preserved. Optional absent search-debug warnings are qualified offline; actual intent surfaces remain NOT_RUN.
