# Insignia language style and review

## Product voice

Use calm, clear, direct wording for both merchants and buyers. Prefer words that ordinary users of the locale use for this task. Friendly does not mean slang, jokes or promotional claims. Explain a failure with its useful recovery, without implementation jargon or promises the product cannot keep.

Translate the purpose of the whole message, with natural target-language order. Keep Save, Publish, add/update, pending/completed, default/custom and current/historical facts distinct. Use terminology as a meaning guide, not a word-for-word substitution table. Preserve meaningful differences between garments, decoration and artwork. Choose another sentence structure when a variable's gender or case cannot be known safely.

Apply capitalization, punctuation, spacing and form of address appropriate to the locale. English sentence case does not remove German noun capitalization. Match existing localized Shopify controls for Shopify concepts where their meaning is the same. Supplied product names, option labels/values, placement names and filenames remain data, not translation units.

Literal translation, rare synonyms and inflated wording need correction when they make the action less familiar or harder to understand. Necessary domain terms can remain technical. Explain that distinction in a finding; don't replace a precise printing/embroidery term just to shorten it.

## Locale brief

Before a complete locale batch, record:

| Field | Required decision or evidence |
| --- | --- |
| Locale and audience | Exact target locale/region and merchant, buyer or embedded upload audience. A Shopify Market or currency is not a language. |
| Address and tone | Selected form of address and imperative style; label a proposed choice as proposed. Keep it consistent within the same audience/workflow. |
| Terminology | Concept IDs and preferred/allowed forms with status and sources. Keep unreviewed language candidates distinct from decisions accepted for this draft. |
| Protected data | Names, supplied values, tokens, identifiers, file extensions and brand policy. An app-generated generic fallback label is still translatable. |
| Scope and evidence | Catalog revision, included workflows/states, reviewer, reference screenshots or routes, technical and language checks actually performed. |

A small message review can state these in its report rather than generating a separate brief file. Preserve existing decisions unless new evidence or an explicit task justifies changing them. An absent brief is a reason to identify uncertainty, not to invent the owner's approval.

## Translator context packet

Provide the complete message key and source, target draft, locale, audience, UI role and triggering condition. Add the source caller or workflow state and screenshot when needed. For a variable, describe its meaning, ownership and a realistic value, including long names. For plurals, supply representative values that actually select each required category.

For isolated packets, distinguish supplied context from facts verified in the application. A same-word or key-suffix match does not establish a caller. Record an exact mapping or leave the source role unresolved. Do not label the current working tree with a commit revision alone when it contains edits.

For a merchant wording overlay, identify each entry's eligible audience/namespace using the current package README and manifest. Mixed admin/customer packets can be reviewed as text, but cannot all be delivered through a customer-only overlay.

Clarify short ambiguous labels such as View, Size, Method and Restore. Explain the action's consequence, especially deletion, discard, publication, cart updates and expired/unavailable work. Show related visible labels, tooltip/accessibility text and confirmation copy together. Resolve ambiguous source copy before marking a translation wrong.

Keep review packets local unless external sharing is already authorized. A proposed tool integration is not authority to upload source catalogs or connect a translation service.

## Finding record

Use a table or structured records, sized to the request:

`key | locale | audience/state | source | target | classification | category | severity | evidence/reason | suggested revision | disposition`

- **Error:** concrete mismatch with source intent, a recorded decision, required syntax or observed UI. Fix before accepting the affected workflow.
- **Decision:** several valid choices depend on audience, source meaning or product policy. Explain the choice and propose a consistent default without labelling another valid choice a mistranslation.
- **Missing evidence:** a needed target, screen, context or reviewer is unavailable. State what it prevents checking; don't infer a pass or a failure.
- **Preference:** an optional improvement with no demonstrated defect. Keep it separate and avoid churn.

Use practical categories inspired by MQM: accuracy, terminology, linguistic conventions, style, locale conventions, audience appropriateness, and design/markup. A missing variable or translated supplied value is a contract/ownership error. An accurate but unnatural phrase is a style finding; ordinary synonym variation is not automatically an error. Use major for changed action/consequence or unusable content, and minor for local wording/presentation problems that preserve the intended task. State user impact rather than assigning a numerical quality score.

## Independent review

For a substantial batch, a meaning reviewer compares source, target and product context. A naturalness reviewer reads the target flow and then checks the source for fidelity. They may be independent agents during drafting; identify them as automated reviewers. Provide raw inputs rather than another reviewer's expected errors. Record disagreements and their resolution using context, language evidence and the brief, rather than majority vote.

A qualified target-language reviewer can provide linguistic acceptance for their explicitly reviewed scope. Being a native speaker alone does not establish knowledge of the product or industry. Give them workflows and terminology context. Keep qualifications and scope factual; no model persona or grammar checker can stand in for their participation.

## Completion record

Record these independently:

- **Language evidence:** draft, AI-reviewed, or reviewed by a named qualified target-language reviewer, with exact scope and unresolved decisions.
- **Technical evidence:** checks actually run and their result, including coverage/tokens/plurals/formatting. Describe skips. Use the current package scripts instead of inventing commands or assuming a passing extraction means good translation.
- **Rendered evidence:** exact locales, workflows, states and sizes actually seen; distinguish translated screens from source/pseudo fixtures. Review critical text without truncating its meaning to make it fit.

A useful outcome can be "AI-reviewed draft, no remaining identified errors, pending target-language review". Neither this result nor technical checks publish a locale or certify the whole product. An isolated text packet without a keyed catalog delta can receive a text/contract review without building unrelated catalogs; report that limit. During review-only work, run checks that do not rewrite maintained files; if generated artifacts are missing, report that limit rather than silently rebuilding source.

## Defaults and ongoing changes

A shipped catalog is the language baseline. Merchant wording is a sparse override, with its own validation and exact-locale boundary. Removing an override exposes the applicable baseline; restoring it must not copy today's default text into the custom record or remove another language. Read the current runtime policy before describing fallback, because an authoring target may use a fallback language rather than a bundled translation.

Review new/changed source messages and their affected neighbours when catalogs evolve. Preserve accepted translations where meaning remains unchanged. Track the reviewed source/catalog revision and mark impacted entries for review when meaning changes. Re-run relevant rendered/technical checks for those changes; don't regenerate every locale just to introduce variety.
