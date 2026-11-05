# Alignment and product versatility: primary-source check

27 October 2026. Research for the new-merchant scenario audit. No application change. These findings distinguish current local design behavior from future integration and from physical production requirements.

## What the references establish

- [Customily product images](https://help.customily.com/articles/9628015600-setting-up-product-images-in-your-product-base) recommends consistent photo size and framing when one print area is shared. [Its preview-adjustment guide](https://help.customily.com/articles/2840535877-adjusting-the-personalizable-elements-to-match-the-preview) separately allows adjusting a mockup without modifying the production file. These are two responsibilities, not interchangeable settings.
- [Zakeke variants](https://zakeke.zendesk.com/hc/en-us/articles/360015501299-Variants-Detailed-guide-on-setting-them-up-for-your-customizable-product) documents individual variant images/print areas and removal of particular variant/side combinations. This supports checking real variant capabilities, rather than treating every difference as a photo problem.
- [Teeinblue mockup assignment](https://support.teeinblue.com/en/article/assign-variants-to-mockup-13wqtx6/) supports grouped and bulk mapping. [Its artwork-location guide](https://support.teeinblue.com/en/article/locate-artwork-in-printarea-1grzjp0/) distinguishes automatic fitting, manual placement, production consequences and supplier reference templates. Assignment convenience is not proof that production size is correct.
- [Shopify variant images](https://help.shopify.com/en/manual/products/product-media/add-images-variants) supplies one assigned image per variant, with additional product gallery media. Front/back and print-area intent still require an app mapping. The Shopify catalogue should remain the source of real offered combinations.

## Existing behavior verified

Actual local editor inspection used the `variant-alignment` example in a separate temporary tab. Black / Left chest showed `Alignment for Black`, Center X 65 and `Use shared area`. White / Left chest showed `Shared artwork area`, Center X 61 and `Adjust for White`. Changing the appearance did not modify the product draft. Evidence:

- `/Users/pc/Development/Insignia/.artifacts/persona-audit-2026-10-27/root/black-custom-area.png`
- `/Users/pc/Development/Insignia/.artifacts/persona-audit-2026-10-27/root/white-shared-area.png`

The present design already shares the normal rectangle and permits a selected appearance/placement exception. It does not need a second global switch to establish that model. This is an inference from the existing control behavior and the cited separation of preview from production, not a claim that a particular competitor mandates this exact UI.

## Recommended policy to evaluate against the persona attempts

| Situation | Appropriate behavior | Current evidence |
| --- | --- | --- |
| Colour photos have matching framing | Set up the area once and reuse it. Keep ordinary controls compact. | Shared rectangles are the local default. |
| A few photos have different crop or scale | Adjust only those appearances; retain a clear return to the shared area. | Per-appearance/per-placement exception and reset exist. Actual misaligned supplier photo accuracy was not measured by these aligned sample assets. |
| One misaligned photo has several placements | Consider one photo alignment transform for that view, if repeat work proves substantial. | Current exceptions are per placement. Applying the identical rectangle to every placement would be wrong; a common offset/scale transform is a different operation. This is a candidate QOL feature, not established need. |
| Merchant later resizes the shared area | Preserve intentional exceptions, while making it clear that they need separate review. | Pure-model experiment confirms inherited rectangles follow the new width, while an existing exception keeps its stored width. `Use shared area` restores inheritance. |
| Size/material changes printable sides, limits, method or price | Treat this as production eligibility/configuration, with deliberate supported combinations. | Current photo grouping does not provide variant-specific production rules. |
| Photograph is angled or curved | Do not promise precise placement from an axis-aligned rectangle alone. | Perspective/curvature tools and supplier templates require separate design and validation. |

The strongest immediate alignment recommendation is to preserve shared-by-default plus explicit exceptions. A new switch that makes all colours independent would create more setup work and duplicate existing scope. A future photo-alignment action should keep prices and physical print dimensions unchanged, and should explain how later shared-area edits interact with it.

## Capacity and inheritance experiment

The standalone script under `.artifacts/persona-audit-2026-10-27/root/alignment-and-capacity-checks.mts` ran nine checks against the current photo model, geometry source and compiled buyer contracts matched to their source. Results are in `alignment-and-capacity-results.json` alongside it.

- Shared width changes propagate to inheriting appearances; an explicit exception remains absolute until reset.
- Geometry accepts 100 explicit variant-image records in a view and rejects 101.
- The buyer catalogue schema accepts 192 variants and rejects 251. A 24-colour by eight-size product has 192 combinations.
- A buyer design accepts 32 distinct selected variant IDs and rejects 33. This is not a limit of 32 physical items.

These are integration guardrails, not observed failures of the new image-grouping UI. A future resolver cannot assume that a compact list of 24 groups permits a naive expansion into 192 image overrides. The limits need deliberate reconciliation before claiming full large-catalogue support; they should not become permanent technical captions in normal merchant UI.

## Review lenses

The installed Checklist Design Web app Onboarding and Uploading media checklists guide first action, minimum setup, completion, constraints and recovery. Fresh [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) supports explicit scope, accessible controls, long-content handling and recoverable actions. The pinned Shopify skill found the [setup-guide composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/setup-guide), which tracks required tasks and completion. None of these sources justifies adding a new permanent settings panel without an actual task benefit.
