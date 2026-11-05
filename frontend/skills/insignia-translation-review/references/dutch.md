# Dutch draft brief

Locale candidate: **nl-NL**. Audiences: merchant admin and buyer customizer. The Dutch catalog now ships alongside English, German, French, Spanish and Italian. Its terminology is AI-reviewed; no qualified human linguistic approval is claimed. Consult the package README for exact coverage and fallback behavior. This brief informs admin and buyer copy. The merchant wording editor overrides customer/common copy only; adding an authoring target there does not change the staff language or publish a Shopify language.

## Voice and conventions

Use consistent **je** as the drafting default for both audiences, unless an existing scoped brief establishes another choice. Shopify's Dutch merchant help uses je. Microsoft's Dutch guide explains that u versus je depends on product and audience; its corporate voice is not an Insignia mandate. Record an intentional audience exception rather than switching address accidentally.

Write ordinary, direct Dutch. Translate the whole purpose, not the English word order. Prefer familiar words where meaning allows: ook rather than an unnecessarily formal tevens, vanaf rather than met ingang van. Necessary domain terminology still needs precision. These are contextual choices, not banned-word replacements.

Use kiezen for a choice among alternatives and selecteren for a literal selection where natural. Neither verb has to replace the other everywhere. Use device-neutral actions in general UI; mention klikken or tikken only where the actual instruction benefits from it. Follow Dutch spelling and natural compounds rather than English title capitalization. Review spacing, punctuation, decimals and dates with the existing locale formatters; preserve actual source amounts, currencies and units.

## Terminology candidates

| Concept | Proposed form | Evidence and limits |
| --- | --- | --- |
| Product / variant | product / variant | Official localized Shopify concepts. A variant is an option-value combination, not a physical quantity. |
| Option / option value | optie / optiewaarde | Shopify terminology. Use actual supplied option names and values unchanged. Grammar may require inflected/plural forms. |
| Garment size / color | maat / kleur | Shopify option examples. Do not assume every product has either option. |
| Save / publish | Opslaan / Publiceren | Shopify distinguishes the actions. A save-draft label must retain its draft meaning where needed. |
| Preview action | Voorbeeld bekijken | A candidate for an actual preview action; not automatically the noun for a product view. |
| Product view, such as front/back | aanzicht | Insignia candidate. Distinct from screen weergave, a preview and the action bekijken. Check the complete workflow before adopting. |
| Placement | decoratieplek | Insignia candidate. Avoid drukpositie as a generic term when embroidery or other methods are supported. The merchant's named placement remains supplied data. |
| Decoration size | decoratieformaat / formaat van de decoratie | Insignia candidates. Distinct from garment maat; do not imply verified physical dimensions when only a visual scale is known. |
| Decoration method | decoratiemethode | Insignia candidate. Preserve the actual supplied method name; generic drukmethode would narrow the meaning. |
| Uploaded artwork file | ontwerpbestand | Candidate only when the message means the file. A complete saved buyer design includes more than this file; supplied filenames remain unchanged. |
| Restore wording defaults | Resolve in context | No locked Dutch term. The action removes an override and exposes the applicable baseline, staged until Save in the current authoring UI. It does not delete another language or Shopify content. |

A Shopify anchor supports that concept's terminology, not every sentence containing it. Insignia candidates need contextual review; an alternative natural form is not an error solely because it differs from this table. Record any term selected for a batch as accepted for that draft with scope and revision.

## Review focus

Check Save versus Publish, add versus update cart, negation in recovery, free versus unpriced, unit quantities versus decoration counts, and garment size versus decoration size. Check je/u consistency without introducing unnecessary pronouns into short buttons. Review ordinary inflection, compounds and natural collocations in neighbouring messages.

For real UI fit, use target-language screens with representative names and quantities, including long labels and all required plural forms. Source or pseudo-locale screenshots do not establish Dutch fit. Agent review can improve drafts; report qualified-language evidence only when an actual reviewer participated.

## Sources

- [Microsoft Dutch style guide](https://download.microsoft.com/download/e/8/f/e8f04dd4-591e-46e9-a076-e49a8c8c75e4/nld-nld-StyleGuide.pdf), especially natural rewriting and audience-dependent address.
- Shopify Dutch [variants](https://help.shopify.com/nl/manual/products/variants) and [adding/updating products](https://help.shopify.com/nl/manual/products/add-update-products/). Localized help is terminology evidence, not proof of exact current Admin labels or buyer voice.
- Active product callers, the source glossary and `packages/localization/README.md` own meaning and runtime behavior.

Research detail: `docs/delivery/notes/translation-locale-brief-research-2026-11-04.md` in the active Insignia checkout. That dated note records proposals; it does not override this brief or the current runtime.
