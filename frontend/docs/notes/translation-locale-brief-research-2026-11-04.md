# Candidate Dutch translation brief

4 November 2026. Research for a future translation-review skill; not a Dutch rollout decision, catalog translation, native-language review, or approval. Dutch is a previously recommended first locale, but the package still advertises English only. The local `en-XA` catalog is an expanded-English test input, not a supported locale ([localization package README](../../../packages/localization/README.md)).

## Locale and audience decision

Use `nl-NL` as a **research candidate only** if Dutch is selected later. The inspected Microsoft guide is specifically for Dutch (Netherlands); it describes language conventions, not Insignia's target market or voice. Do not advertise or author a shipped Dutch catalog until the product owner chooses a locale and a qualified Dutch reviewer accepts the wording.

Candidate address form: use **je** consistently in both the merchant admin and buyer customizer, subject to owner decision and Dutch-language review. Shopify's localized Dutch Help Center consistently addresses merchants as `je`; Microsoft's Dutch guide says `u` was historically used in Microsoft products, notes the growing use of `je` in the Netherlands, and says the choice depends on product and audience. The guide therefore does not settle Insignia's form of address. Treat admin and buyer as distinct audiences for vocabulary and context, but do not switch `je`/`u` between them without an explicit product decision. Prefer `je` over emphatic `jij` unless emphasis is intended. Sources: [Microsoft Dutch style guide, §2.2.1](https://download.microsoft.com/download/e/8/f/e8f04dd4-591e-46e9-a076-e49a8c8c75e4/nld-nld-StyleGuide.pdf) and Shopify's [Dutch product guidance](https://help.shopify.com/nl/manual/products/add-update-products/).

This is a style proposal, **not owner-approved voice** and not evidence that Dutch is selected for release. If the product owner prefers `u`, decide that before translation and apply it consistently to both surfaces or document an intentional audience exception.

## Candidate style brief

- Write clear, friendly, concise Dutch. Prefer words people commonly use for the task; rewrite from the full meaning and screen context instead of translating English word by word. The Microsoft guide explicitly calls for natural rewriting and everyday words; its examples prefer `ook` to `tevens` and `vanaf` to `met ingang van` where the meaning fits.
- Keep specialized words when they name a real Shopify or Insignia concept. Explain or qualify them at first use if a user needs to distinguish them. Do not replace an accurate term with a more familiar but broader word that changes what is selected, saved, published, removed, or priced.
- Use direct instructions. Name the control and the action; keep steps short and in the order the user performs them. For a visible choice between alternatives, `kiezen` is a good candidate. Use `selecteren`/`deselecteren` when the action is literally selecting a control or list item; Shopify's Dutch guidance uses these verbs in that context, so do not apply Microsoft's `kiezen` example mechanically.
- Match the actual interaction: `Klik op ...` for a mouse action and `Tik op ...` for a touch action when device-specific help is needed. Shopify's Dutch help uses both. Do not include UI navigation steps that the current Insignia screen does not require.
- Preserve the distinction between an action and its result. Shopify's Dutch Help Center uses `Opslaan` and `Publiceren` for different actions. In Insignia, saving a draft and publishing a product configuration have different effects. Restoring a wording default removes the merchant override and reveals the applicable baseline; it does not delete the baseline or product content. Use the screen context to make that consequence clear.
- Keep merchant-authored names, product option values, artwork names and file names as data. Translate the surrounding interface, not supplied content. This follows the localization package's current boundary.

Instruction examples are patterns, not translated Insignia catalog strings:

| Use | Avoid | Why |
| --- | --- | --- |
| `Klik op Opslaan.` / `Tik op Opslaan.` | A passive construction that hides who acts or which control to use | Direct action and control, following Shopify's localized procedural wording. |
| `Kies een maat.` when the user is deciding between product sizes | `Selecteer een maat.` as a fixed rendering of every English “choose” | Microsoft recommends `kiezen` for a choice among options; retain `selecteren` when the action is a specific UI selection. |
| `Kies de maat en kleur.` when those are the actual Shopify options | A word-for-word English sentence that calls garment size a decoration size | Names the choice and keeps the two product attributes distinct. |

## Terminology candidates and status

Status key: **Shopify anchor** means an official localized Dutch Shopify Help Center source uses the term for the Shopify-owned concept; it is not acceptance of an Insignia string. **Insignia candidate** means the English product concept is grounded in the local spec, but no Dutch term is established by that spec or by Shopify's help. None of these rows is human-approved terminology.

| Concept | Candidate Dutch term | Evidence and decision status | Guardrail |
| --- | --- | --- | --- |
| Shopify product variant | `variant` / `varianten` | **Shopify anchor.** Shopify's Dutch help uses `varianten` for combinations of product option values. | Use for the actual Shopify product variant. In buyer-facing choice text, name the options (such as size and color) where that is clearer than saying “variant.” |
| Shopify option / option value | `optie` / `optiewaarde` | **Shopify anchor.** Shopify's Dutch variant help uses these terms. | Preserve the difference between the option name (for example, size) and its value (for example, M). Merchant-supplied values remain unchanged. |
| Garment size / color | `maat` / `kleur` | **Shopify anchor.** Shopify uses `maat` and `kleur` as product options and gives clothing examples. | Reserve `maat` alone for the garment-size concept. Do not use it for an Insignia decoration-size step. |
| Save / publish / preview actions | `Opslaan` / `Publiceren` / `Voorbeeld` (verb: `een voorbeeld bekijken`) | **Shopify anchor.** The official Dutch help uses these labels/verbs for its own product and theme workflows. | Reuse only where the Insignia action has the same effect. In particular, save draft is not publication; publication changes product availability/configuration state. |
| Choose among alternatives / select a control | `kiezen` / `selecteren` (and `deselecteren` for reversing a control selection) | **Style and usage anchors.** Microsoft's guide recommends `kiezen` rather than `selecteren` for choosing among options. Shopify uses `selecteren`/`deselecteren` for channel and control selection. | Choose by action meaning. Do not force one English verb to one Dutch verb in every context. |
| Garment `View` in the product model: a side/orientation, such as front or back | `aanzicht` (candidate) | **Insignia candidate.** The implementation spec defines a product view that owns placements. No source consulted establishes Insignia's Dutch label. | Do not conflate a garment side with a screen `weergave` or a product `voorbeeld`. Validate the noun and its plural in context. |
| `Placement`: merchant-configured decoration location on one garment view, with its own method, step and artwork choices | `decoratieplek` (candidate) | **Insignia candidate.** The spec defines Placement/View/Step and links each placement to view geometry. Shopify has no equivalent. | Avoid generic `drukpositie`/`drukplek` unless the specific method is print-only. The product concept must remain broad enough for each supported decoration method. Keep a named placement distinct from the geometric area/bounds it contains. |
| `Step`: a merchant-defined decoration-size choice with scale/dimensions and pricing | `decoratieformaat` or `formaat van de decoratie` (candidate) | **Insignia candidate.** The implementation spec explicitly separates decoration-size steps from garment S/M/L variants. | Do not label this `maat` alone. Explain a physical measurement only when the UI has calibrated dimensions; a visual preview is not a manufacturing measurement. |
| `DecorationMethod`: a merchant-defined customization method | `decoratiemethode` (candidate) | **Insignia candidate.** The spec defines a stable merchant-defined method label; no official Dutch domain source was found. | Preserve the merchant's actual method name. Avoid `drukmethode` as a generic term unless the specific method is printing-only. |
| Uploaded artwork asset / file | `ontwerpbestand` (candidate when the UI means the uploaded source file) | **Insignia candidate.** The spec distinguishes original private artwork bytes, safe derivatives, and a buyer's complete customization. | Use `bestand`/`ontwerpbestand` only for the file. Do not use it for the complete customer design, and never translate the supplied filename. |
| Restore default wording | No locked candidate yet; describe the actual effect in context | **Insignia product semantics are grounded** in the wording workflow; the best short Dutch action label is not established by the consulted sources. | Must mean “remove this override so the applicable baseline appears.” Do not suggest deleting the baseline or copying it into the saved override. |

Insignia term definitions come from [the current product specification](../../architecture/implementation-plan.md), especially its ProductConfigDraft/ProductConfigRevision, DecorationMethod, Placement/View/Step, and geometry definitions. Shopify term anchors: [Variants](https://help.shopify.com/nl/manual/products/variants), [Add variants](https://help.shopify.com/nl/manual/products/variants/add-variants), [Add and update products](https://help.shopify.com/nl/manual/products/add-update-products/), and [Manage products on Shop](https://help.shopify.com/nl/manual/online-sales-channels/shop/manage-shop-store/products-and-collections).

## Review criteria for the translation-review skill

For each changed phrase, review complete source, message key, speaker/audience, UI location, state/action consequence, neighboring strings, visible control name and representative variable values. The package README requires complete messages and keeps merchant/product content as values; do not review detached fragments as if they were full sentences.

Record findings under separate categories:

1. **Meaning and action safety:** omissions/additions, negation, quantities, entity or state confusion, and changed consequences. Treat save/publish/discard/restore/delete, artwork readiness, prices and garment-versus-decoration size as high-impact.
2. **Terminology and product semantics:** wrong Shopify term, inconsistent approved candidate, or a Dutch word that collapses two different Insignia concepts. Consult the table above, but mark unresolved Insignia words as questions rather than asserting a glossary decision.
3. **Dutch naturalness and conventions:** grammar, spelling, idiomatic collocation, literal structure, rare/formal word choice, awkward compounds and register. A grammatical phrase can still be a valid naturalness issue; reviewers should give a contextual reason and a correction, not just a preference.
4. **Audience and address:** fit for merchant staff or a shopper, consistent `je`/`u` choice, and vocabulary appropriate to the screen. Track the address choice separately from term correctness.
5. **UI fit and accessibility:** length, wrapping, truncation, control names, accessible names, variables/plurals and whether a step remains actionable on desktop and phone.

For each finding keep the source phrase, proposed target correction, reason, context, severity, evidence/source and disposition. Distinguish confirmed defects from uncertain domain terms and acceptable stylistic alternatives. A model suggestion is not approval. Without a qualified Dutch-language reviewer, label the result **AI-reviewed; language acceptance pending**; never mark it native-approved or fluent-certified.

## Sources and limits

- [Microsoft Localization Style Guides index](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides) links the official [Dutch (Netherlands) PDF](https://download.microsoft.com/download/e/8/f/e8f04dd4-591e-46e9-a076-e49a8c8c75e4/nld-nld-StyleGuide.pdf). Sections 2.1.1–2.1.4 support natural rewriting, common wording, avoiding literal translation, and the examples noted above. Section 2.2.1 explicitly leaves `u` versus `je` dependent on product and audience. This is Microsoft's guide, not an Insignia style approval.
- Shopify Help Center pages cited above are first-party Dutch localized sources for Shopify products, variants, options, product actions and examples of direct procedural wording. Help Center wording is an evidence source, not proof of exact current Shopify Admin UI labels or buyer-facing voice.
- The Insignia implementation spec and [localization package README](../../../packages/localization/README.md) own Insignia meanings and localization boundaries. They establish product semantics, not Dutch wording quality.
- This brief did not translate or evaluate any application catalog strings and did not obtain native-language acceptance. The exact locale, address form, domain terms and rollout remain decisions for later review.
