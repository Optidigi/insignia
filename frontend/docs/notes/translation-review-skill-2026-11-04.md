# Insignia translation-review skill

4 November 2026. This implements the approved glossary/style/review foundation after the [linguistic-quality research](translation-linguistic-quality-research-2026-11-04.md). It does not add or publish language catalogs.

## Delivered

The canonical [skill](../../../.agents/skills/insignia-translation-review/SKILL.md) provides a scoped workflow for drafting and reviewing UI translations after i18next setup. It links a [source-concept glossary](../../../.agents/skills/insignia-translation-review/references/glossary.md), [style and review criteria](../../../.agents/skills/insignia-translation-review/references/style-and-review.md), a [proposed Dutch brief](../../../.agents/skills/insignia-translation-review/references/dutch.md) and [primary sources](../../../.agents/skills/insignia-translation-review/references/sources.md).

The glossary separates artwork from complete buyer designs, garment options from decoration size, and Save from Publish. It preserves supplied names and values. Scope follows the selected customer modal and Shopify-owned cart, current exact-locale sparse wording overlays, staged restore defaults and English fallback. The [independent domain audit](translation-glossary-domain-review-2026-11-04.md) checked these against contracts and callers. [Dutch research](translation-locale-brief-research-2026-11-04.md) informs everyday wording and distinguishes Shopify terminology anchors from proposed Insignia terms.

The skill retains this project's i18next syntax and generated parameter contracts. It does not adopt FormatJS ICU syntax, require a paid translation platform, or introduce a localization dependency. Review-only requests report findings; explicitly authorized drafting can change the stated files. AI review, technical checks and actual target-language UI/qualified-language evidence are separate.

`AGENTS.md` and the localization README point to the skill. The user skill directory links to this canonical folder at `/Users/pc/.codex/skills/insignia-translation-review`; the contents match. Discovery configuration is present; automatic selection in a fresh Codex session was not exercised.

## Independent behavioral checks

Luna xhigh reviewed a 12-entry Dutch packet. Luna Max independently reviewed an eight-entry German packet. Packets mix valid controls with meaning, placeholder and ownership errors. The original inputs and raw reports are preserved under [the evaluation artifacts](../../../.artifacts/translation-review-skill-2026-11-04/).

The Dutch pass found all four concrete defects: draft saving translated as publishing, missing quantity placeholder, reversed restore scope, and a translated merchant-supplied method name. It retained valid Publish, upload, singular quantity, model, generic method, cart and filename messages. The filename contains instruction-like text as a supplied value; it was treated as data.

The first Dutch report also made an unsupported caller inference for an ambiguous View label, using an unrelated matching key suffix. Root rejected that finding and tightened the skill: a search match is not caller identity, fixture revisions do not identify current catalogs, and a commit alone does not identify dirty source content. On recheck, the reviewer withdrew the false finding, recorded missing context and corrected provenance. Both reports are retained rather than overwriting the failure.

The German pass found both major meaning defects: cart update translated as payment, and pending artwork translated as ready/print-only. It retained ordinary German labels and formal address. It correctly separated a de-DE customer wording target from German admin or complete catalog support, and did not treat English/pseudo screenshots as German fit evidence. Its feedback led to explicit guidance on mixed-audience eligibility and when a text-only packet does not warrant unrelated catalog builds. Small reviews can already record provisional decisions inline without creating a full locale brief.

A further Luna Max review used a separate four-entry packet without seeing the other review results. It found the one-file/all-files scope error, retained valid Save wording, and left ambiguous Size/View labels unresolved. This exercises the corrected mapping rule on unseen inputs. All 24 packet entries were reviewed across the three packets; these are behavioral samples, not evidence of whole-product translation coverage.

Skill frontmatter validation passes. Local skill/delivery links resolve, discovery metadata is valid, the local skill link resolves to the canonical files, and scoped whitespace checks pass. [The verification receipt](../../../.artifacts/translation-review-skill-2026-11-04/verification-receipt.json) records the final skill hashes and evidence. The validator used PyYAML in an isolated temporary Python environment; no project dependency was added. Application tests were not rerun because this task changes instructions/research only, with no catalog or runtime delta.

## Scope and remaining work

English remains the only bundled language. Dutch terms and address are drafting proposals, not native-language approval. No application/catalog changes, Shopify language publication, shared persistence, live customer delivery or release acceptance are claimed by this task. A future authorized language batch should use the skill on complete workflows, preserve its source revision, and add the corresponding technical, translated-screen and linguistic evidence.
