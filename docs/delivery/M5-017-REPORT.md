# M5-017R principal correction — local source and exact-response replay

The principal [requested changes](evidence/m5-017r/authority-PR-048-principal-review.md) at PR48 head `2d0b5177add9b412a8e1f9c43309ae6af04f1e1e`. The [correction brief](prompts/M5-017R-ACK-COMPLETION-TIMING-CORRECTION.md) authorizes only local source correction, offline qualification and exact captured-response replay in the same PR. No second live run, fixture, provider/credential access or merge is authorized.

Application, production adapter and unmerged v3 SQL now classify true legacy ResourcePublication future timing at completed `receivedAt`. Request-start `observedAt` remains unchanged for conservative freshness/provenance. Equality is accepted; even one millisecond after receipt blocks, with no tolerance. Legacy false records remain conservatively unsupported/non-effective blocking evidence; they do not assert ResourcePublicationV2 staged state. The existing `visibleScheduledOrStaged` schema field is retained for compatibility and documents that distinction. Provider documents and request sequence are unchanged; v1/v2 source, predicates, JSONB and recovery meanings are unchanged.

The separate [derived memory replay](evidence/m5-017r/replay.json) returns **RESTORED** through corrected production source using all seven exact preserved restore/prestate/readback responses. Exact original effective membership, direct anchors and online-store semantics match; ACK facts and its request-start/completion timestamps remain exact. Compensation attempts=0 and external requests=0. An immutable ambient-fetch denial is active, and credentials are synthetic in-memory premises. Canonical live bytes, raw adjudication and every historical failed observation remain unchanged. This is deterministic offline adjudication, not a claim that the original live run returned PASS.

Focused application/activation/recovery85 and Shopify v3 58, PostgreSQL18 database171, PostgreSQL-enabled full root and actual 100k query-plan checks passed locally. Canonical interval/equality red failures were reproduced separately at application, production snapshot and old SQL seams before correction; their original output is preserved. A test-fixture setup error was corrected and its failure remains recorded separately. Empty migration down/up passed, and populated v3 downgrade was correctly refused with version retained.

Publication stress completed **400/400**, 100 of each dirty/ambiguous success/failure case. Renderer control returned the expected missing-renderer failure (wrapper exit0); style/secrets passed. Required regression/SQL parity, PostgreSQL18 and local check receipts are collected under [M5-017R evidence](evidence/m5-017r/). Final candidate refs, original fresh reviews and eleven exact-head CI receipts belong in the PR body/external packet, avoiding self-referential head commits.

Residuals remain: hidden non-effective intent is not generically discoverable; scheduled publishing is not live-qualified; multi-resource observations are non-atomic; Shopify supplies no native CAS. Principal approval, merge, production activation and all release/dependent gates remain outstanding. The historical report below retains frozen execution meaning; the original run is still **STOPPED/CONFLICT** and its disposable fixture is permanently ARCHIVED/effectively unpublished.

---

# M5-017 — Availability Hold v3

Status: STOPPED. The one authorized live v3 qualification returned `CONFLICT` at restore because an ACK publication time inside the write interval was compared with the request-start clock. Acquire and fresh-process observe were HELD; exact original effective membership returned. The fixture was safely archived once and verified effectively unpublished. Canonical run is closed/sealed. No production source/build was changed after live access. [PR48](https://github.com/Optidigi/insignia/pull/48) is for principal review; the live qualification is not PASS.

## Authority and entry

[Principal approval](PR-047-principal-review.md) and the [unchanged supplied brief](prompts/M5-017-AVAILABILITY-HOLD-V3.md) authorize this versioned correction and one gated development-store lifecycle. PR47 was normally merged at `4bba14fb4415815557ffa5f1e600427a62128489`, with ordered parents `d0efd626222047a2047573f678b019cd7b1802a9`, `857e0db43918dada608af8aa63654756673c6ba7`, and tree `dcd5aca2e0f4152b9eb07b7b1616f0d309ecf4a7`. The exact refs, ten unique attempt-1 passing workflows and supplied external approval matched. Native reviews were empty; no native approval was fabricated. The connector merge returned 403 without mutation; the previously verified `gh` route completed the authorized normal merge. [Merge receipt](evidence/m5-017/pr47-merge-receipt.json).

M5-016/DIRECT_ONLY, its archived product, and all earlier runs remain permanently closed. Their classifications and raw evidence are unchanged.

## V3 contract

New activation creates `m5-availability-hold-v3` and `m5-activation-evidence-v3`. SAME_MODE remains no-hold. Unresolved v1/v2 state moves to operator handling without adoption, provider dispatch or current-state conversion. Historical v1/v2 snapshot, hold, evidence and recovery meanings remain explicit.

A v3 observation records complete product effective visibility and directly resolves every effective Publication ID to verify exact product inclusion. Static, bounded serial `publication(id:)` documents use complete `includedProducts(first:2, query:id...)`; no shop-wide Publication/Catalog connection supplies authority. Capabilities remain anchor evidence. The maximum of 64 effective anchors is an engineering guard under one operation-wide deadline, not a merchant-capacity promise.

Held safety requires DRAFT, zero effective membership, absent online-store visibility, no visible scheduled/staged record, and unchanged original anchors including their capability metadata. Restore success requires original state, exact original effective ID set and online-store presence semantics, unchanged anchors, and no visible schedule. Exact observed dates/URLs and `updatedAt` are diagnostic; no timestamp CAS or tolerance is introduced.

A settled restore ACK plus exact requested active/visible state and a semantic mismatch permits one production status-only DRAFT compensation. Qualified compensation returns `REHELD_CONFLICT`; activation persists `OPERATOR_HOLD` and immutable restore/mismatch/compensation evidence. Ambiguous restore never compensates. Ambiguous compensation remains pending/operator incident; neither write is retried.

## Durable dispatch and recovery

The coordinator commits ACQUISITION_PENDING before acquisition. For restoration it commits RESTORATION_CLAIMED and a v3 reservation for both the restore and its single conditional compensation before dispatch. Only the originating invocation receives dispatch capability. Reentry, including a fresh adapter, cannot recreate it from matching status. The conditional reservation is consumed even when compensation is unnecessary; it is not evidence that a compensation request occurred.

Adapter attempt sets prevent replay within an instance; durable cross-process ownership belongs to the trusted coordinator or experiment operator. A crash after provider dispatch can leave a claim without a returned audit receipt. It requires operator settlement rather than inferred attribution, replay or automatic compensation.

Trusted v3 recovery is observation-only. It binds the exact original hold and a versioned decision, requires `SETTLED_BY_TRUSTED_OPERATOR`, and compares effective/anchor semantics while rechecking observation freshness. Original v1/v2 recovery paths retain their prior version-specific equality and authority requirements.

The additive migration preserves the exact original v1/v2 constraint predicates and stored JSONB. V3 predicates fence nested schema, tenant/product identity, held safety, version binding and immutable audit phases. Downgrade denies when v3 rows exist. No historical record is rewritten.

## Fresh-run guard and limits

The entry captures native fetch privately for the operator and installs immutable, fail-closed global fetch before experiment logic loads. Production receives only `fetchImpl: op.fetch`. Local tests prove missing/misspelled injection reaches zero external requests, and the correct route reaches only loopback with matching durable reservations/events.

The fresh operator permits one create, two direct setup/cleanup updates, at most three production adapter mutations, two auth exchanges and 128 GraphQL requests. It admits exact fixture ownership and static production documents only. Restore and conditional-compensation reservations precede dispatch; resume verifies immutable held bytes/hash in a genuinely fresh process. Every transport invocation has a durable event. Cleanup requires independently known ownership/current state and settled writes; an unknown transition is never cleaned up automatically.

The experiment uses a 30-second production operation-wide budget with each operator transport bounded to eight seconds. Native transport privacy and fail-closed global fetch are process-level safeguards; they do not claim OS-wide network or credential isolation.

## Platform residual and evidence boundary

V3 protects the exact Publications observed effective before the hold. It does not establish complete configured-intent discovery, absence of hidden non-effective future intent, atomic multi-resource provider observation, or drainage/propagation of external writes. Visible scheduled/staged records remain unsupported. Current exact observations and double product reads detect observed drift; external changes after an observation remain a platform residual.

A synthetic lifecycle is labelled `PASS_V3_SYNTHETIC`. It is not live qualification, production activation, RELEASE_BOUND, G7, M6/M7 or launch evidence. Live authority opens only after completed source/build, clear fresh full-source GPT-6.1-sol/high reviews, green exact-source CI, a frozen gate and locally proven guard. Production source/build become immutable at first provider access; a live defect stops for principal review.

## Precredential review corrections — historical checkpoints

The following entries preserve what was pending at each source checkpoint. The completed frozen gate and actual live outcome follow below.

[Round1 findings and responses](evidence/m5-017/review-findings-responses.md) retain the original independent reports and exact failed CI/TDD evidence. The revised candidate closes v2 web-fixture integration, schedule evidence in settled ACKs, conservative monotonic freshness, and final native-dispatch deadline/freshness gaps. Identity/grant contradictions independently poison the operator before projection/envelope errors. Known unsent reservations are counted as local denials; actual dispatch accounting is `reserved = dispatched + denied` with zero unknown attribution from a denial.

The live scope's `shopId=m5_017_fixture_only` and generation1 label the standalone disposable-fixture qualification; they do not assert a production database tenant or installation generation. Live qualification never runs the production activation coordinator, writes activation records or creates release authority.

The original source candidate passed root checks, PostgreSQL18 164-test database regression, empty down/up rehearsal, actual 100k read-seam query plans, stress400/400 (100 each success/failure with dirty/ambiguous edits) and the renderer negative control. Its runtime CI nevertheless failed because PostgreSQL web integrations were still v2; those tests had been skipped by root without a database URL. Both enabled integrations now pass on the corrected working candidate. Revised-source full checks, clear fresh reviews and all exact-source CI are pending; credentials remain closed.


[Round2](evidence/m5-017/review-findings-responses.md) required an additional fence on scheduled original prestates and the slice-specific eleventh CI workflow. Both are corrected with failing/passing regressions. M5-017 requires all eleven applicable exact-source attempt1 workflows; the approved predecessor merge still has its original ten-workflow requirement. Source/build/review/CI freeze and live execution remain pending on the revised candidate.

The same ownership fence rejects original DRAFT visibility and retained scheduled ACKs before provider transport. SQL rejects successful held authority while preserving unheld incident evidence. A fresh adapter cannot recreate acquisition from a prior ACK without a held snapshot. These related working-stage regressions are preserved with their actual provenance.

Round3 identified the remaining unheld original-DRAFT ACK fallback. Adapter observation/restoration and coordinator admission now reject retained acquisition ACKs without a held receipt before transport; SQL denies successful restoration/rehold receipts on unheld incidents. ACK-free safe original DRAFT still needs no mutation. Original reports, failing synthetic/SQL probes and successful regression evidence remain separate. Round3 full checks and eleven CI workflows passed, but its review verdict was NOT CLEAR. Revised-source round4 qualification is pending.

Round4's security review found a remaining original-DRAFT restoration-ACK boundary bypass despite a clear Spec verdict. The coordinator now classifies a supplied unqualified ACK as CONFLICT before persisting it; SQL requires qualification for every non-null successful restoration ACK. ACK-free original DRAFT remains supported, and raw scheduled conflict evidence is retained. The failing SQL/coordinator probes and original reports remain preserved. Fresh round5 full qualification is pending; credentials remain closed.


## Frozen source and completed offline gate

Live used source `424e4af4133993a6d61579e86f10d9138d3f40c2`, tree `dbd32e6e63ebff9ebd68ecb669f6900e3bb46da5`, base/effective merge base `4bba14fb4415815557ffa5f1e600427a62128489`. [Executable gate](evidence/m5-017/gate.json) binds 3,460 tracked-source/package-build modules with digest `5d7be7dfe7ee8456cda40410dcd629a6252350deef9b5f6fd85384140c24003a`; the supplementary manifest binds 96 other generated artifacts. Both fresh full-source round5 reviews were clear: Spec `01a11637-9b8e-7dd3-8ef5-ce71a3f27ce0`, Standards/security `01a11637-9bd9-7370-8d6c-bcb57f5fc47f`, actual GPT-6.1-sol/high, enforced read-only/never local Codex exec fallback. Original reports and same-launch settings remain exact. T3 delegated-task controls did not provide an enforced read-only schema; the fallback is not OS credential/network isolation or native principal approval.

[Offline report](evidence/m5-017/offline-report.json) records PostgreSQL-enabled root exit0, PostgreSQL18.6 database167, actual 100k read-seam query plans, empty down/up, populated downgrade expected exit2 with v3 migration retained, stress400/400 (100 per four cases), renderer expected negative control, process guard24 and historical source/register SHA checks. All eleven applicable natural exact-source workflows passed at attempt1. Original first CI failure and four NOT_CLEAR review rounds remain preserved, not relabelled. Local mocks and successful CI did not establish live restore qualification.

## Exact live lifecycle and STOPPED classification

Fresh canonical `/home/serveradmin/insignia-m5-017-handoff/run` used product `gid://shopify/Product/10496636387611`, marker `insignia-m5-017-8f834f0f-71b3-426e-a4cf-181048902f36`, operation `d96162c6-a176-42de-b640-057e11625105`. Exact development shop/app/install/grants and ownership passed. Create produced DRAFT; production v3 DRAFT snapshot was held-safe. One direct ACTIVE setup exposed Publication `gid://shopify/Publication/339456917787`; exact direct resolution confirmed inclusion, `autoPublish=true`, `supportsFuturePublishing=false`. No generic Publication/Catalog enumeration or publication mutation occurred.

Fsynced v3 intent preceded one acquisition. HELD DRAFT had zero effective visibility and the original anchor still included the product. Exact returned held bytes: 2,823 bytes, SHA256 `b90a977a2a757d16e9890ee04831ef32f119a11ac7cbbcf46f176a91c0d99495`. Initial PID1322883 terminated; fresh PID1325112 verified those bytes/hash and observed HELD once. Its product updatedAt had advanced from `12:08:46Z` to `12:09:17Z` without semantic drift; the 31,000ms diagnostic change did not block observation.

One production restore was ACKNOWLEDGED to ACTIVE. Complete readback returned the exact original effective Publication-ID set, online-store presence booleans and anchors, with no visible scheduled/staged record. The frozen shared semantic comparator returns true. The ACK and readback updatedAt differ exactly 1,000ms (`12:09:56Z` versus `12:09:57Z`); this was diagnostic and was not the conflict cause.

The production result was nevertheless `CONFLICT`. Its ACK showed `isPublished=true`, publication date `2026-10-07T12:09:56.000Z`, request-start observedAt `12:09:54.968Z` and receivedAt `12:09:57.978Z`. The classifier uses publishDate > observedAt, so it marked the newly effective publication as future: 1,032ms after request start, yet 1,978ms before ACK receipt. [Derived adjudication](evidence/m5-017/live-adjudication.json) is separate from unchanged raw execution. Raw harness outcome remains `STOPPED`, stop `restore_not_exact`; raw adapter result remains `CONFLICT`. This is a confirmed production classification defect, not evidence of an intentionally induced mismatch or unresolved write.

No compensation request occurred because complete effective availability matched the original. The compensation slot was reserved/consumed (`calls.compensation=1`); that is not a provider attempt. Independently exact ownership/current ACTIVE and all settled writes allowed the brief's single ARCHIVED cleanup. Final production v3 readback was ARCHIVED, zero effective Publication IDs, no online-store presence, `onlineStoreUrl=null`. Cleanup ACK/readback updatedAt both `12:10:14Z`. All five writes settled, pending=null. Future-capable anchor coverage was NOT_OBSERVED; no case was manufactured.

## Accounting, closure and remaining correction

Actual counts: auth2/2, GraphQL36/128, create1/1, direct setup/cleanup updates2/2, adapter mutations2/3 (acquire1, restore1, compensation0). All prohibited mutations were zero. Every one of 38 native transport invocations has its durable event; reserved=dispatched=38, denied0, mismatch=false. No retries, extra create or further provider access after closure. Raw register/qualification/intent/held/binding/gate and phase markers are copied byte-for-byte under [live-run](evidence/m5-017/live-run). Original canonical nine files are chmod0400, directory0500, register CLOSED, with an external seal/manifest. The copied raw register is an evidence snapshot, not a runnable canonical destination.

[Immutability check](evidence/m5-017/postlive-immutability.json) verified all 3,460 frozen modules, 96 supplementary artifacts and 51 historical canonical files unchanged immediately after closure, before final docs/evidence. Production source/build remain immutable; final changes are documentation/evidence only. No historical fixture/register was reopened.

The smallest proposed correction is to separate conservative request-start freshness provenance from v3 ACK schedule evaluation time. Principal must adjudicate an exact completed-observation endpoint while retaining raw timestamps, actual future/unpublished/staged failure and no tolerance. Add published-during-write ACK controls plus actual future controls and requalify only in a separately authorized slice. No correction was implemented after live access; no second lifecycle is authorized. This known defect remains unresolved in the submitted source, and merge/activation readiness is not claimed.

Fresh completed-change full-source/evidence reviews and final-head CI receipts are supplied in the external PR/portable principal packet after committing this evidence. Principal approval remains external. No successor merge, production activation, RELEASE_BOUND/G7, M6/M7 or launch.
