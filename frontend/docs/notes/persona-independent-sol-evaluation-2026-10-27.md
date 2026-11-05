# Independent persona evaluation, 27 October 2026

Independent review of all five Luna walkthroughs against source, saved screenshots and primary vendor documentation. This is a product judgment from simulated scenarios, not measured merchant research. No application code or Shopify data was changed.

## Verdict

The evidence supports a few specific improvements, not a larger configuration system. The simple polo can be configured. Large-catalogue grouping reduces repeated work. The phone-case flow uses product-appropriate language and a safe rectangular inset. Buyer quantities, separate designs, review and cart handling exist outside the frozen admin preview. Do not turn the preview's intentional limits into missing-product findings.

### Improve now

1. Use **Decoration size** consistently when embroidery is available. The polo screenshot plainly shows **Print size** beside **Embroidery**. The actual preview comes from sibling `designer-prototype/src/designer.tsx:1273`, `1279`, and `1307`, which hardcode that label. Production `apps/storefront/src/customizer.tsx` already uses Decoration size. This is a small, real terminology inconsistency, not a reason to redesign size selection.
2. Keep the preview's purpose clear. It tests a frozen draft's artwork setup. Preserve **Current draft**, which accurately names that source even after local publication. If merchants expect commerce testing from **Customer preview**, one short purpose cue or a separate full-flow test destination would resolve the expectation. Adding fake variant prices or a second cart to the snapshot would not. The missing per-item cue is a minor preview-copy opportunity; `designer-prototype/src/review-panel.tsx:139` and the full storefront already identify item/garment price at review.
3. Fix scenario isolation before using onboarding screenshots as acceptance evidence. Drinkware's capture really shows 3/3 complete above a first-product prompt. `home-preview.tsx:18,29-36` merges the same shop's persisted completion preferences into different fixture scenarios. This is a reproducibility defect in the local demo. It does not establish that clean production onboarding completes itself. Keep the short three-task guide; do not add onboarding fields to compensate.

### Useful next improvement if catalogue setup is a priority

Offer a reviewable way to use existing Shopify variant photos for the matching appearance groups. The current group list/search handles selection, but a merchant with distinct photos must repeat assignments per colour and view. Prefer explicit variant associations over guessing from filenames. Show unresolved or conflicting matches and leave existing overrides intact. This saves recurring work; bulk assigning one image to every colour does not solve it. The 48-assignment example is a workload inference, not a completed timed run or evidence of abandonment.

## Shared alignment and exceptions

Keep shared artwork areas as the default with **Adjust for Black** and **Use shared area** for exceptions. Do not add a product-level shared/custom alignment switch. It asks merchants to decide a policy before seeing the three photos that need correction, and can wrongly imply that all 24 colours must become independent.

Source confirms the useful inheritance. `resolveVariantPhotoView` in `placement-variant-photos.mts:264` returns the shared placement unless that appearance group has a placement rectangle. `setVariantPhotoPlacementRect:382` adds the exception; `resetVariantPhotoPlacementRect:402` removes it. The visible labels explain which state is being edited. A group is a colour when grouped by Colour, or a combination when more appearance options are used. Exceptions belong to that group, view and placement, not every garment size.

If testing uncovers uncertainty about shared edits, improve the local scope sentence and make exceptions easy to find. Do not add a setting without evidence that the existing local action fails. **Confirm alignment** acknowledges review; it is not the action that creates a custom area.

These rectangles adjust a mockup. They do not define a different manufacturing width for an 11 oz mug, make embroidery unavailable on one finish, or create camera-cutout masks. `GeometryV1` stores variant image-space rectangles and physical dimensions per decoration step. Published placement eligibility is product-wide, not per capacity or finish. Those are different decisions and data.

## Product-scope choices

- Optional back text is a legitimate missing capability for the stated drinkware offer. `ArtworkChoiceSchema` accepts uploaded revisions or deferred artwork, not text. Add a bounded text field, font/output rules and production record only if text personalization is an intended supported product. A full freeform editor is unnecessary for this requirement.
- Capacity-specific physical print limits and variant-specific method/placement eligibility are legitimate scope questions. Photo alignment cannot supply them. Use verified supplier specifications and preserve an explicit unknown state. A conservative shared limit or separate product configurations can support a smaller initial offering, with that limitation stated honestly.
- Arbitrary safe-shape masks are a legitimate advanced requirement for full-area phone-case decoration. They are not needed for the tested logo inside a conservative rectangle. The scenario and `position-geometry.ts:152-183` corroborate rectangular full-footprint clamping. Do not report a camera-collision bug that was not seen.
- A production approval workflow is a separate scope choice. Apron artwork attachment correctly removes the artwork hold; **Artwork complete** does not claim production approval. The worksheet still discloses **Physical size not configured** and says to use original artwork. I reject adding an overall readiness badge solely because that optional calibration is absent. A badge becomes useful only after the product defines which specifications and checks actually gate production. Preserve the existing scoped artwork status and hold behavior.
- Large-range limits need a supported-capacity decision before integration claims. `BuyerConfigSchema` allows 250 catalogue variants, while `BuyerDesiredGroupSchema` allows 32 selected variants per design and geometry validation allows 100 explicit variant images per view. A 24 by 8 catalogue does not necessarily mean 192 selected quantities or 192 unique photos. Conversely, a large size run can exceed 32 selected variants. This is a source-confirmed capacity risk, not an observed shopper failure or a reason to raise every bound silently.

## Findings rejected as noise or misclassification

| Claim | Judgment |
| --- | --- |
| Missing mug/apron products means product setup is broken | Absent sample content, not a capability failure. Apparel analogs cannot prove non-apparel production readiness either. |
| No variants, quantities or checkout in Current draft preview means buyers cannot order a size run | Intentional snapshot limitation. Full `customizer.tsx:793` supports retained designs and `1222` renders per-variant quantities. Source presence does not prove connected checkout. |
| Current draft should say published after Publish preview | Rejected. The action still opens the current draft; changing the label alone would misstate its source. |
| Multiple decoration sizes conflict with a one-size phone case | Rejected. Case size and decoration size are separate. Restrict decoration sizes only when the merchant intends a fixed logo size. |
| Enabling both print and embroidery is a new-product default bug | Unsupported. The polo walkthrough explicitly started from an inherited sample draft. Deliberately selecting methods per placement is legitimate configuration. |
| Artwork-later needs a customer post-purchase upload portal | Unsupported by these scenarios. The stated workflow deliberately lets the merchant attach artwork after purchase, and the apron walkthrough exercised that path successfully. |
| Missing real checkout/backend wiring is a UI regression | Rejected within the deliberately postponed integration scope. Keep integration acceptance separate. |

## Evidence and outside references

Read the raw polo, teamwear, drinkware, apron and phone-case notes. Viewed saved polo buyer, drinkware onboarding/alignment, apron setup/production-hold/after-attachment worksheet and phone-case returned-product screenshots. Independently checked actual source, including `artwork-status.ts:15` and worksheet warning/rendering logic. No live browser session was needed and no existing tab was touched. The apron buyer's two placements do not prove two designs; its report correctly distinguishes them from the two-design order fixture.

Teamwear has no saved screenshot artifacts in its stated folder, so its appearance/interaction claims are not independently auditable from that report alone. I also inspected root's separate `root/large-catalog-panel-focused.png`, which corroborates the group rows, search and missing-image state. It does not restore Luna's missing captures. Phone-case has one returned-product screenshot, not saved drag/quantity/review states; those claims have walkthrough/source support with narrower pixel evidence.

- [Customily preview setup](https://help.customily.com/articles/2701184772-preview-setup) explicitly separates preview adjustments and visual variants from the print file. This supports separating photo exceptions from physical production specifications.
- [Customily variant functions](https://help.customily.com/articles/6457305403) distinguishes changing a garment image for colour from changing a template for sizes that need another print file. This supports separate appearance and production decisions, not copying its entire settings system.
- [Zakeke variant guide](https://zakeke.zendesk.com/hc/en-us/articles/360015501299-Variants-Detailed-guide-on-setting-them-up-for-your-customizable-product) describes importing variant images and adjusting individual variant print areas. This supports reducing manual photo assignment and retaining targeted exceptions.
- [Shopify content guidance](https://shopify.dev/docs/apps/design/content) calls for consistent terminology, plain language and task-focused steps. It supports the narrow wording changes above.
- Bundled Checklist Design [onboarding](https://www.checklist.design/web-app/onboarding) and [uploading media](https://www.checklist.design/flows/uploading-media) checks favour minimum setup, clear progress, restrictions and recovery. Upload type/size restrictions are visible. The walkthroughs did not exercise enough rejected-file/retry states to justify inventing upload defects.

The relevant saved UI workflow and admin guidance were read. Runtime/type pins are Polaris `2.0-rc` and `2.0.0-rc.3`; no UI code was generated, so no component validation or test suite was required for this note.
