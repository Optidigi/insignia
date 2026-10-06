# M5-011 — fixed published-state adjudication

Status: OFFLINE_QUALIFICATION_IN_PROGRESS. No credentials, authenticated browser or store operation has occurred in this slice.

## Authorized baseline

PR #40 merged normally as `1fffcb3048952ff762f1f9805f86aceed90f228f`; ordered parents `25e6c487741e1685637d351137d9671033f3c53d`, `ca250edb776e6c5b4567334c1fb4f2c750ddcc5a`; tree `8b9d8389f48c0a8c12a6c56880abe994573af5c6`. Live main/head, effective merge base, ten reviewed-head workflows (attempt 1, success), and external principal approval matched before merge. Native reviews were empty; none were fabricated. [Merge receipt](evidence/m5-011/pr40-merge-commit.json).

## Fixed experiment

The only product is `gid://shopify/Product/10490211467547`, marker `insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb`, created `2026-10-02T21:19:48Z`. Exact historical handle/title/single tag/creation identity are mandatory. The only publication metadata target is `gid://shopify/Publication/339456917787`.

The transport admits ten exact GraphQL documents plus the exact client-credentials route. It reserves every attempt durably before invocation, limits reads to16 and status updates to2, rejects alternate targets/statuses/extra mutation fields and reentry, and serializes provider calls. Auth bodies/headers/tokens are never retained; successful GraphQL evidence is limited to selected fields. Fresh identity/ownership and source/build gate checks fence each status dispatch. A changed tracked file, build, source commit or review/CI binding closes authority.

The production port supplies its own snapshot and acquire behavior; no restore is called. A full fixed projection captures all four V2 partitions before and after exact DRAFT settlement in five serial reads per projection. Every partition repeats ownership, full installation identity and scalar state; differing anchor versions stop before cleanup. The run plan is exactly16 reads, including one final legacy/ownership read. Cleanup is a separate single status-only ARCHIVED update authorized only for this disposable fixture. An ambiguous archive receives one bounded observation, preserving UNKNOWN settlement and never resending.

## Qualification and limitations

TDD seam: fixed operator transport/register and actual production port through synthetic external HTTP. Ownership and archive recovery red/green receipts are retained locally. The focused harness/gate checks now pass32/32, including100 serial synthetic adjudications and regressions for all material round3 findings. [Findings and responses](evidence/m5-011/precredential-round3/responses.md). Fresh root validation is running on the corrected harness. Browser stress passed100/100 with unchanged production app bytes. All ten fixed documents passed schema validation with the inherited displayName deprecation warning. Fresh full-source reviews and exact-source CI remain required before credentials.

Shopify has no atomic status/version CAS. The harness checks observed identity/state and freshness around dispatch but cannot eliminate an external merchant race after the final read. Complete Admin observations establish only those views; they do not prove customer propagation or checkout drainage. Local database-gated tests and CI results are reported separately.

## Live result

NOT_RUN. Classification, pre/post projections, metadata, adapter result and cleanup will be added only from the frozen run. No production correction, matrix continuation, new product, publication mutation, scope/version change, M6/M7, activation, RELEASE_BOUND or gate/launch acceptance is authorized.
