# New-merchant product and workflow audit

27 October 2026. Five Luna Max agents attempted different merchant/customer scenarios. Root evaluated the reports, inspected source and selected screenshots, reproduced the alignment and large-catalogue states, and ran a focused model experiment. A separate Sol agent independently evaluated all five reports and challenged their recommendations. This was a research assignment. No application code or Shopify records were changed.

## Overall judgment

The tested logo-decoration journeys have a workable structure. A fresh local product could be configured with a view, placement, method and price without an assignment loop. A one-placement embroidery product was reflected in the artwork preview. A one-size non-garment fixture reached quantities and review with appropriate labels. The merchant's deferred-artwork path correctly separated payment from artwork availability and removed the artwork hold after attachment.

The strongest recurring efficiency opportunity is assigning different photos across a large colour range. The clearest small UI defect is method-specific size terminology. Broader gift personalization and products with genuinely different production requirements need explicit scope decisions. These findings do not justify another global settings panel or rebuilding Shopify commerce inside an artwork preview.

This is agent-simulated cognitive walkthrough evidence, not human usability research, a conversion study, or a completed connected checkout. It cannot establish what percentage of merchants the product serves. Several representative sample-data limitations remain below.

## Scenarios and actual outcomes

| Persona and task | What was actually exercised | Outcome and qualification |
| --- | --- | --- |
| New workwear seller: one left-chest embroidery logo on a polo | Home → Products → trim an inherited polo to one view/placement and Embroidery → Save → local Publish → customer artwork preview → inspect sample orders | The simplified setup saved and appeared in preview. Upload dialog was opened but no file supplied in this session. Three-colour purchasing was not verified from this one-colour legacy seed. |
| Teamwear seller: 24 colours, eight intended garment sizes, Front/Back logo and a few differently framed photos | Existing product → 24-colour image fixture → search/grouping/assignment → alignment exception/reset/Undo → buyer preview → upload one public sample logo and reuse it on Front and Back | Grouping avoided per-size image rows and file reuse worked. The fixture contains four sizes per colour, 96 variants, not the intended 192. It has three actual colour photo sets and no real crop-outlier set. No completed 48-photo assignment run is claimed. |
| Drinkware seller: two capacities/finishes, logo and optional customer-entered back text | Home first-use states → Shopify product-creation handoff → apparel editor/preview as a named analogy → two-design sample order and worksheet | No mug was invented or substituted as proof. The catalogue lacks drinkware fixtures. Text entry and variant-specific physical production rules are not represented in the current inspected contracts. Two-design order presentation was observed, not a mug checkout. |
| Cafe apron seller: logo not ready, merchant attaches it after purchase | Existing hoodie as an analogy → artwork-later setting → save/publish locally; separate empty-product fixture → add view, placement, existing/new method and price → save/publish; order #1043 → attach public logo; apron buyer quantities/review; sample #1046 | Fresh setup had no chicken-and-egg loop. Attachment changed artwork status and removed the artwork hold. The separate apron fixture showed colours and a single garment-size row. Two placements were correctly distinguished from two independent design groups in #1046. Local demo changes were reset. |
| Phone-case seller: one back logo, one case size, bounded movement near a camera cutout | Existing schematic buyer fixture → arrows/drag/reset → quantity 1 → Review/price breakdown → Edit quantities → product return/reopen | Product labels were appropriate and no garment wording was observed. A conservative rectangular inset kept the logo clear of the supplied camera island. This does not prove arbitrary camera-shaped exclusions or manufacturing calibration. No replacement file upload or live cart was completed. |

Raw notes: [polo](persona-simple-polo-luna-2026-10-27.md), [teamwear](persona-large-teamwear-luna-2026-10-27.md), [drinkware](persona-personalized-drinkware-luna-2026-10-27.md), [aprons/deferred artwork](persona-logo-later-aprons-luna-2026-10-27.md), [phone case](persona-phone-case-luna-2026-10-27.md).

## Improvements worth doing

### 1. Use consistent decoration terminology

The embroidery-only preview still labels its size field `Print size`. The screenshot and sibling prototype's `designer.tsx` hardcoded labels confirm this. The production storefront already uses `Decoration size`. Use the neutral term across the actual prototype and preview so embroidery is described correctly. The selections and pricing mechanism do not need redesigning.

Evidence: `/Users/pc/Development/Insignia/.artifacts/persona-audit-2026-10-27/simple-polo/customer-one-placement-after-publish.png`.

### 2. Clarify which kind of test a preview provides

The editor's Customer preview is a frozen current-draft artwork preview. Its adapter deliberately supplies one image choice, a placeholder size, base price zero and preview-only mode. It cannot establish a catalogue's colour/size runs or checkout. The full buyer UI has quantity, review and retained-design controls; the phone/apron attempts exercised the later stages. Therefore the absence of those stages from the snapshot is not a missing buyer feature.

Make that preview purpose clear through its action/context, and connect the merchant to the existing Storefront setup/theme-editor test when they want to test the actual buying journey. That destination already exists in `StorefrontProductTest.tsx`; another cart or settings page is unnecessary. Keep `Current draft`, because that is the source of the snapshot even immediately after local publication. A local per-item decoration-price cue is a small consistency option; full review already explains the price basis.

### 3. Reduce repeated distinct-photo assignment

The current bulk operation reuses one image across selected groups. It does not match many different photos to many groups. A 24-colour Front/Back range implies 48 distinct view/group assignments, even though sizes are correctly collapsed. That is a structural workload inference from the current controls, not measured setup time.

An optional, reviewable action using existing Shopify variant-image associations would help. Scope it to the selected view, show proposed matches and conflicts, preserve existing exceptions, and leave uncertain mappings unresolved. Prefer real source associations; filenames alone are insufficient evidence. Continue to require appropriate image/alignment review rather than substituting a wrong colour or silently overwriting an exception. [Shopify documents the assigned variant image and product-media distinction](https://help.shopify.com/en/manual/products/product-media/add-images-variants); [Zakeke's guide](https://zakeke.zendesk.com/hc/en-us/articles/360015501299-Variants-Detailed-guide-on-setting-them-up-for-your-customizable-product) demonstrates variant import and targeted area adjustments.

### 4. Make onboarding tests reproducible

A first-use screenshot showed a completed guide above a configure-product prompt. Source explains this as the same shop's persisted guide preferences being merged across developer fixture examples. Treat this as test/demo isolation to fix before assessing clean onboarding. Do not claim a production regression or reset real merchant completion automatically. The short guide and the observed fresh product setup do not need more onboarding fields.

## Alignment decision

Keep shared artwork areas as the default and the existing per-appearance exception/reset controls. The large-range persona understood `Shared artwork area`, `Adjust for Black`, `Alignment for Black`, and `Use shared area`. Root independently observed Black's custom rectangle and White's inherited rectangle. The source and focused experiment confirm the distinction.

A new global "aligned colours" switch would duplicate the current normal behavior and could make a merchant think every colour must become independent to correct three photos. `Confirm alignment` is an acknowledgement of a visual check, not automatic alignment. Keep that distinction.

Existing custom rectangles remain absolute when the shared rectangle changes; resetting restores inheritance. Preserve this deliberate behavior. If further attempts show uncertainty, clarify the local scope or make exceptions easier to find. No observed confusion here justifies extra global controls or new automatic publication warnings.

One possible later QOL action is aligning a differently cropped photo once across multiple placements in that view. That requires a common offset/scale transform, not copying the identical placement rectangle everywhere. The supplied aligned photographs do not establish demand or visual correctness for that feature. Test it with real supplier outliers before building it.

Photo correction and production dimensions must stay separate. [Customily recommends consistent framing when reusing an area](https://help.customily.com/articles/9628015600-setting-up-product-images-in-your-product-base), and [its preview-adjustment guide](https://help.customily.com/articles/2840535877-adjusting-the-personalizable-elements-to-match-the-preview) separates mockup adjustment from the print file. Full source review, policy cases and the experiment are in [the alignment research note](persona-alignment-research-2026-10-27.md).

## Real product-scope decisions

| Requirement | Current assessment | Reasonable V1 position |
| --- | --- | --- |
| Uploaded logo, one or several placements, selected methods/sizes, several item variants | Represented in the inspected UI/models; representative local tasks worked | Retain the current focused workflow. Connected Shopify acceptance remains separate. |
| A customer types a name, number or short message | No direct text-personalization field in the inspected design contract/preview. An uploaded artwork file containing text is a different task. | Decide explicitly whether personalized gifts/team names are in scope. A future text feature needs preview and order/production representation, not only a form field. [Customily's text guide](https://help.customily.com/articles/2111674173) is a primary example of this capability. |
| Different capacity, material or style needs a different printable area, side, method or decoration price | Image grouping does not model variant-specific production eligibility/specifications | A common safe setup may cover variants where appropriate. Otherwise separate products remain an honest bounded workaround. Broader variant rules need an explicit design/contract decision. |
| Camera-shaped exclusions, full wraps, perspective or supplier print templates | Not established by the rectangular logo-placement workflow | The tested inset works for a simple back logo. Do not require a mask for that case; decide separately before promising full-surface personalization. |
| Very large catalogues and size runs | Current geometry/buyer contracts have bounded capacities | Root independently checked 100 explicit image overrides per view, 250 catalogue variants, and 32 distinct selected variants per design. Those are different limits, and 32 is not a physical-item quantity cap. Reconcile the group resolver and capacity profile during integration; do not add technical limit captions to every ordinary screen. |

## Recommendations rejected after evaluation

- A production-ready badge based only on artwork availability or optional physical dimensions. `Artwork complete` is accurately scoped; the worksheet separately says when physical size is unconfigured and directs the merchant to original files. New supplier/approval gates need a definition before a readiness badge can make a truthful promise.
- A customer artwork-follow-up portal. The intended merchant-after-purchase attachment path worked. A separate portal was not required to complete that tested workflow.
- Renaming `Current draft` to a published revision label without changing what the preview opens.
- Calling the missing mug sample a missing product-creation feature. Shopify owns creation; the local handoff explicitly stops before it.
- Treating two artwork positions as two designs, or two decoration sizes as two garment sizes.
- A generic full design studio, auto-colouring, arbitrary rules builder, or more permanent controls without demonstrated task benefit.

## Evidence, review and remaining coverage

[Sol's independent evaluation](persona-independent-sol-evaluation-2026-10-27.md) reached the same main priorities and rejected unsupported escalation. Root made the judgments above from source, direct inspection, the raw attempts and the focused experiment. No vendor-admin app was operated for this audit; competitor facts are from current primary documentation.

The polo/drinkware/apron reports have saved stage screenshots. The teamwear agent emitted captures during its attempt but did not save them. Root separately corroborated the focused group panel in `root/large-catalog-panel-focused.png`; this does not retroactively supply its missing captured stages. The phone-case agent saved only the returned-product screen, with JPEG bytes under a `.png` name. Its movement/review observations have report/source corroboration rather than saved stage pixels. These limits prevent treating the walkthroughs as exhaustive visual acceptance.

Root's nine-check alignment/capacity experiment passed, with its script/results under `/Users/pc/Development/Insignia/.artifacts/persona-audit-2026-10-27/root/`. No application regression suite or build was run because no application source was changed. Temporary audit tabs were closed; the apron agent restored its local demo edits. The original review/editor tabs remain available.

Guidance used: installed Checklist Design Onboarding and Uploading media checks, pinned Shopify App Home setup-guide/content guidance, the saved Insignia UI delivery workflow, and fresh [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). The earlier primary-source Memorisely hierarchy and Zander disclosure lessons remain context in the [colour-variant design research](color-variant-design-direction-2026-10-27.md); no new live observation of those lessons is claimed here.
