# Independent final frontend review

30 October 2026. Approved for the local frontend handoff scope reviewed below. No blocking finding remains in the changed runtime, variant behavior, named-option presentation or corrected guidance/localization notes. This is not native Shopify observation, owner acceptance, production readiness or release approval.

## Standards

Reviewed the selected sibling customizer against its source snapshot in `/Users/pc/Development/Insignia/.artifacts/frontend-hardening-2026-10-30/frontend-source-before.tar.gz`, the changed merchant preview helpers and the repository guidance. Applied the project Shopify/Polaris guidance, Checklist Design's modal/cart/error checks, compatible Vercel guidance and the recorded Pocock guidance on cohesive workflow commands and public behavior tests.

The customer runtime owns asynchronous effects through required ports. The reducer retains drafts, validation, undo and stale-result guards. The local saved-design collection, FileReader implementation, fixtures and development host remain outside the core Designer import graph. Receipt matching, pending mutation guards, abort handling and retry identities are explicit. A successful attempt is retired so a later identical new design has an independent identity. No additional state library or production authorization mechanism was introduced.

## Spec

- Same-view placement duplication preserves independent copies of existing group rectangles. Cross-view copying remains a separate operation. Group search matches actual member variants, including ungrouped options and IDs, without combining values from different sparse members.
- Optional presentation metadata names row and quantity axes and selects swatches or named choices. Legacy defaults remain intact. The phone-case fixture labels and existing schematic remain presentation examples; they do not establish Shopify variant mapping or production calibration.
- The first-product note now separates the selected contextual canvas from the production four-step editor. The localization plan remains a plan and explicitly covers Astro shell/document language, the selected sibling, host locale ownership, SSR isolation and state/request preservation. Its shared-package distribution is an explicit implementation decision.
- The backend reference worktree was independently verified clean at `54c222ba8e4481b4c50be4522f9ab7686fb49d67`.

## Rendered review and correction

Inspected actual desktop/light and phone/light/dark customer captures, first-product empty/placement states, and merchant variant grouping, bulk image picker, narrow panel, long-label canvas, search and retry/publication-blocking states. The previous fixed-position error toast covered the phone Items summary. It was replaced with an inline footer alert. Fresh 1440px light, 390px dark and 320px short-window captures show the error above the total and retry action without covering the summary. Short-window document scrolling remains available.

Also inspected eight named-option captures across 1440px light, 390px dark and 320px light, covering inline choices, picker, quantities and review. Labels, selected states and actions fit the reviewed widths.

Stable evidence: `/Users/pc/Development/Insignia/.artifacts/frontend-hardening-2026-10-30/demo-adapter-captures/` and `named-option-captures/`; merchant evidence: `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/variant-photos/`.

## Verification and limits

Independently ran customer runtime 12/12, config/model 66/66 and merchant variant-photo 21/21 tests. The merchant suite used pinned Node 24.21.0. The final combined customer browser pass was reported by the implementing agent as 17/17, with build passing; its refreshed failure captures were independently inspected.

The 140-variant sparse model regression does not qualify rendered large-catalog performance. Existing production variant/exception limits, exact-variant mapping, authoritative quotes, accepted assets and verified Shopify cart application remain integration work. The isolated core bundle check proves a removable preview dependency boundary, not an implemented production entry.
