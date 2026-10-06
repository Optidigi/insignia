# M5-011 — published-state adjudication evidence

Result: **INCONCLUSIVE; stopped on provider-version drift.** The canonical register is closed. Fixture10490211467547 was last observed owned and DRAFT at2026-10-06T13:10:00.463Z; archive was not attempted. No second live run is authorized. [Raw qualification](evidence/m5-011/live/qualification.json), [register](evidence/m5-011/live/register.json), [closed receipt](evidence/m5-011/live/closed-receipt.json).

## Authorized merge

PR #40 merged normally as `1fffcb3048952ff762f1f9805f86aceed90f228f`. Ordered parents are `25e6c487741e1685637d351137d9671033f3c53d`, `ca250edb776e6c5b4567334c1fb4f2c750ddcc5a`; tree `8b9d8389f48c0a8c12a6c56880abe994573af5c6`. Live refs, effective merge base, external approval and all ten exact-head attempt1 passing workflows matched before merge. Native reviews were empty; none were fabricated. [Receipt](evidence/m5-011/pr40-merge-commit.json).

## Observed publication views

The exact app/client/shop/domain/installation/development identity and all four required grants matched. Exact marker/title/single tag/createdAt ownership remained intact. Publication339456917787 metadata identified Microsoft Copilot: autoPublish=true, supportsFuturePublishing=false; ACTIVE AppCatalog188090286363; Channel339456917787, App294412484609. The exact minimal metadata is retained in the raw qualification.

| Field | ACTIVE before | DRAFT after |
|---|---|---|
| Legacy resourcePublications |339456917787, isPublished=true, publishDate2026-10-02T21:19:52Z|Empty|
| unpublishedPublications |339456885019,339456950555,339456983323|Same three IDs; target absent|
| V2 APP |Empty|Empty|
| V2 MARKET |Empty|Empty|
| V2 COMPANY_LOCATION |Empty|Empty|
| V2 NONE |Empty|Empty|
| publishedAt / onlineStoreUrl |null / null|null / null|
| updatedAt |2026-10-02T21:19:57Z|2026-10-06T13:09:52Z|

All captured connections had hasNextPage=false and hasPreviousPage=false, with no provider errors. Every partition repeated exact ownership/identity and matched its scalar anchor. **The target publication was not observed retained/staged in V2:** it was absent from all four captured V2 partitions both before and after. This returned-view comparison is DIFFERENT_PLATFORM_BEHAVIOR relative to the retention hypothesis. It does not establish global absence of configured publication intent or explain the empty V2 projection. The canonical overall classification remains INCONCLUSIVE because settlement was not exact. [Derived comparisons](evidence/m5-011/live/adjudication.json).

## Adapter result and exact stop

The unchanged production port performed snapshot once and acquire once; it returned CONFLICT with current state unavailable/DRAFT. The acknowledged DRAFT mutation had updatedAt `2026-10-06T13:09:51Z`; the production readback and all five post views had `2026-10-06T13:09:52Z`. Acknowledgement/readback visibility digests match; provider versions differ by one second. Ownership and grants remained exact. The source of that subsequent version change is unknown.

The adapter's first OR condition, acknowledgement/readback sameState inequality, is true and sufficient for CONFLICT. Acknowledged legacy membership also differs from ACTIVE membership and would independently satisfy its second condition. The legacy digest was therefore not isolated as the sole cause. The third condition (version failed to advance beyond ACTIVE) is false. No production correction is implemented.

The exact settlement check refused this mismatch with write_settlement. The single write remains ACKNOWLEDGED, not EXACT. There was no outstanding transport at close. **Archive and final ARCHIVED verification were NOT_RUN.** Accounting: auth1/3, reads15/16, status-only updates1/2; creates, deletes, publication mutations, restore, scope/version operations and all other provider operations0. No retry occurred. Prior M5-004/M5-009/M5-010 register hashes remain unchanged. [Hash check](evidence/m5-011/live/closed-register-final.json).

## Gate, timing limitation and offline correction

Frozen live source `1d62d7249ee22e6275eb9ed3299fb6f56991d0f3`, tree `97f5426a771752907b12e6d4f0b555b570ea0b35`, binding digest `3f349e8199d24793404a5739029cd3c0d25ac2bfda3e891b99ae3cc57232df3d`. Source/build hashes, full root success,45/45 focused checks,100 serial synthetic cases,100/100 browser stress, ten Admin2026-07 schema documents/control, two fresh full-source actual GPT-6.1-sol/high read-only reviews and ten exact-source attempt1 passing workflows were verified **before credentials**. [Binding](evidence/m5-011/live/binding.json), [gate](evidence/m5-011/live/gate.json), [verification](evidence/m5-011/live/gate-verification.json), [round7 reports/settings](evidence/m5-011/precredential-round7), [offline receipt](evidence/m5-011/live/offline-gate-report.json).

The frozen harness deferred its full settlement check until after the five post-DRAFT reads. Thus those reads were collected before the version mismatch was rejected. This is a timing limitation of the executed harness, preserved without editing its raw evidence. The offline successor now checks acknowledgement/current-port readback version and visibility equality **before** requesting post views. Its regression reproduces the late15-read stop on the executed source and now passes with10 reads, no post projection and no cleanup. Current focused46/46 including100 serial cases and the full root check pass; the secret/provenance check and selected-live-JSON sensitive-key audit also pass. [Red/green evidence](evidence/m5-011/completed-offline). This corrected harness was **not run live**. Tracked changes close the old binding, and the exclusive canonical nonce/register prohibit replay.

Production availability source stays byte-identical to baseline (SHA256 `aeb68cf151fc5b3fba0974e7fb659a8bcc422c0b2e517f478e0f2b185e7ab421`); interacting production packages and prior harness sources are unchanged. Local database-gated suites were skipped; exact-source PostgreSQL18.6 CI passed. [CI excerpts](evidence/m5-011/live/source-database-ci-excerpts.json). Final candidate refs, fresh completed-change reviews and final CI are recorded in the PR packet after committing, to avoid changing their bound head.

## Principal review boundary

[Conditional smallest correction proposal](M5-011-PROPOSED-CORRECTION.md) preserves publication fields/guards and requires proof of V2 coverage before any implementation. The empty V2 views do not justify a V2-only substitution. Principal review must adjudicate the provider-version drift, publication projection coverage and remaining DRAFT fixture disposition. No successor merge, second live run, production correction, new product, matrix continuation, restore ACTIVE, publication mutation, scope/version change, M6/M7, activation, RELEASE_BOUND, gate pass or launch is authorized.
