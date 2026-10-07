# PR #48 — external principal review

**Verdict: CHANGES_REQUESTED at the exact reviewed head.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #48
- Base / effective merge base: `4bba14fb4415815557ffa5f1e600427a62128489`
- Reviewed head: `2d0b5177add9b412a8e1f9c43309ae6af04f1e1e`
- Reviewed tree: `73e516cec289ebd368d4d1e2607886fc285dd30f`
- State: open, draft, unmerged, mergeable
- Current main at review: exact base
- Final-head workflows: 11/11 SUCCESS, all attempt 1
- Fresh completed-change reviews: NOT_CLEAR on the same known P2; no additional material findings

PR #47 normal merge `4bba14fb4415815557ffa5f1e600427a62128489` has the approved ordered parents/tree.

## Accepted live evidence

The v3 effective-anchor architecture materially worked in the real provider lifecycle:

- fresh DRAFT snapshot was held-safe;
- ACTIVE exposed hidden third-party Publication `gid://shopify/Publication/339456917787`;
- exact direct anchor resolution confirmed inclusion;
- acquire returned HELD;
- exact held bytes were persisted and verified in a genuinely fresh process;
- fresh-process observe returned HELD;
- restore mutation was ACKNOWLEDGED;
- complete post-restore readback returned the exact original effective Publication-ID set, anchor semantics and online-store presence;
- no visible schedule existed in the complete readback;
- compensation was not dispatched;
- cleanup archived the fixture and exact final readback proved zero effective visibility.

Fixture `gid://shopify/Product/10496636387611` is ARCHIVED and effectively unpublished.

All 38 actual native invocations are durably accounted; pending=null; all five writes settled.

This is strong evidence that v3's effective-anchor provider mechanics are sound.

## Confirmed production defect

The frozen implementation classifies legacy ResourcePublication timing against request-start `observedAt`.

Live restore ACK:
- request start / ACK observedAt: `2026-10-07T12:09:54.968Z`
- Publication publishDate: `2026-10-07T12:09:56.000Z`
- ACK receivedAt: `2026-10-07T12:09:57.978Z`

The Publication became effective during the acknowledged write interval. The date is after request start but before completed receipt.

The exact readback then returned the original semantic availability and no visible schedule.

Therefore comparing `publishDate > observedAt` creates a false future-schedule classification.

The brief explicitly permits publish-date changes on restoration.

## Shopify contract clarification

The production query uses legacy `ResourcePublication`, not ResourcePublicationV2.

Current Shopify 2026-07/latest documentation states for legacy ResourcePublication:
- `isPublished=true` means published **or scheduled to be published**;
- `isPublished=false` means neither published nor scheduled;
- `publishDate` is the date it was or is going to be published.

ResourcePublicationV2 has different semantics:
- true = published;
- false = staged.

Do not import V2's `false=staged` meaning into the legacy ResourcePublication field.

The existing helper currently includes `!isPublished` in `visibleSchedulesV3`. This is conservative/fail-closed, but its staged/schedule interpretation is not the legacy field's documented meaning. The correction must cover this explicitly rather than strengthening the wrong semantic claim.

## Required correction

Preserve request-start `observedAt` for conservative freshness/provenance.

For publication timing classification of a **completed** product/ACK observation, use the completed observation endpoint `receivedAt`.

No tolerance or clock window.

For a legacy ResourcePublication:
- `isPublished=true` with `publishDate > receivedAt` remains future/scheduled and blocks qualification;
- `isPublished=true` with `publishDate <= receivedAt` is not future solely because it happened after request start;
- `isPublished=false` must not be described or asserted as V2 staged semantics. It may remain a conservative blocking/non-effective condition if desired, but tests/comments/docs must reflect the legacy contract rather than claim `false=staged`.

Application, adapter and SQL predicates must remain equivalent.

## No new live run required

Do not create another fixture or call Shopify.

The exact sealed live mutation ACK/readback already exercise the defect. The provider request sequence is unaffected by this classification correction.

Use memory-only replay of the exact preserved live responses through the corrected production source.

Required replay outcome:
- corrected restore => RESTORED;
- exact original effective membership/anchors/online-store semantics;
- no compensation attempt;
- zero external requests.

This provides deterministic adjudication of the captured live lifecycle without another provider experiment.

The historical raw live result remains STOPPED/CONFLICT and must not be rewritten.

## Merge boundary

Do not merge current head.

Correct this same PR locally, run full tests/reviews/final CI and return PR #48 for principal rereview.

If corrected exact-response replay, SQL parity, full regression and fresh reviews are clear, no further live availability lifecycle should be required before moving on from the hold mechanics.
