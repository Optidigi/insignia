# M5-017 — Availability Hold v3

Status: LOCAL_OFFLINE. Production implementation and the fresh-run harness are under qualification. Source reviews, exact-source CI and the live lifecycle remain pending. No M5-017 canonical run or credential access has occurred.

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

## Precredential review corrections

[Round1 findings and responses](evidence/m5-017/review-findings-responses.md) retain the original independent reports and exact failed CI/TDD evidence. The revised candidate closes v2 web-fixture integration, schedule evidence in settled ACKs, conservative monotonic freshness, and final native-dispatch deadline/freshness gaps. Identity/grant contradictions independently poison the operator before projection/envelope errors. Known unsent reservations are counted as local denials; actual dispatch accounting is `reserved = dispatched + denied` with zero unknown attribution from a denial.

The live scope's `shopId=m5_017_fixture_only` and generation1 label the standalone disposable-fixture qualification; they do not assert a production database tenant or installation generation. Live qualification never runs the production activation coordinator, writes activation records or creates release authority.

The original source candidate passed root checks, PostgreSQL18 164-test database regression, empty down/up rehearsal, actual 100k read-seam query plans, stress400/400 (100 each success/failure with dirty/ambiguous edits) and the renderer negative control. Its runtime CI nevertheless failed because PostgreSQL web integrations were still v2; those tests had been skipped by root without a database URL. Both enabled integrations now pass on the corrected working candidate. Revised-source full checks, clear fresh reviews and all exact-source CI are pending; credentials remain closed.


[Round2](evidence/m5-017/review-findings-responses.md) required an additional fence on scheduled original prestates and the slice-specific eleventh CI workflow. Both are corrected with failing/passing regressions. M5-017 requires all eleven applicable exact-source attempt1 workflows; the approved predecessor merge still has its original ten-workflow requirement. Source/build/review/CI freeze and live execution remain pending on the revised candidate.

The same ownership fence rejects original DRAFT visibility and retained scheduled ACKs before provider transport. SQL rejects successful held authority while preserving unheld incident evidence. A fresh adapter cannot recreate acquisition from a prior ACK without a held snapshot. These related working-stage regressions are preserved with their actual provenance.

Round3 identified the remaining unheld original-DRAFT ACK fallback. Adapter observation/restoration and coordinator admission now reject retained acquisition ACKs without a held receipt before transport; SQL denies successful restoration/rehold receipts on unheld incidents. ACK-free safe original DRAFT still needs no mutation. Original reports, failing synthetic/SQL probes and successful regression evidence remain separate. Round3 full checks and eleven CI workflows passed, but its review verdict was NOT CLEAR. Revised-source round4 qualification is pending.

Round4's security review found a remaining original-DRAFT restoration-ACK boundary bypass despite a clear Spec verdict. The coordinator now classifies a supplied unqualified ACK as CONFLICT before persisting it; SQL requires qualification for every non-null successful restoration ACK. ACK-free original DRAFT remains supported, and raw scheduled conflict evidence is retained. The failing SQL/coordinator probes and original reports remain preserved. Fresh round5 full qualification is pending; credentials remain closed.
