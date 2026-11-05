# Public feedback on generated admin UI

Research date: 20 October 2026. This note records public reports about GPT-6 and GPT-6.1 frontend output for the Insignia admin preparation. It does not change approved product scope. Shopify's current App Design Guidelines and Polaris guidance take precedence over the taste of a model, a reviewer, or a third-party skill.

## What people reported

The evidence is mixed and mostly anecdotal. These sources identify the requested model families explicitly. Older GPT-5 complaints were excluded from model-specific findings. Reddit pages exposed relative dates, sometimes inconsistent with search crawl labels, so the dates below preserve the displayed age instead of inventing a publication date.

| Source and date | Firsthand report | What the evidence supports |
| --- | --- | --- |
| [JadeSerpant, "Has GPT regressed even more on web design?"](https://www.reddit.com/r/OpenAI/comments/1x2z7mg/has_gpt_regressed_even_more_on_web_design/), displayed "13h ago" when retrieved | The author reports GPT-6.1 Sol repeatedly producing green-tinted layouts and the same template across different apps. Commenters describe similar results and improvements after supplying screenshots and explicit visual constraints. | A concrete failure pattern to check. The post supplies no reproducible prompt set or blinded comparison, so it does not establish a regression or its frequency. |
| [Momo--Sama in "How good is GPT 6 on frontend/UI/etc?"](https://www.reddit.com/r/codex/comments/1w9h5x2/how_good_is_gpt_6_on_frontenduietc/), displayed "28d ago" | The commenter says GPT-6 Astra's visual output improved but adds too much unrelated text across the screen. In the same discussion, njdrums123 reports that it follows an existing design system well when implementing a multistep invite flow. Other commenters disagree about which output looks best. | Excess copy deserves explicit review. The discussion does not show a shared objective definition of better design. |
| [FitGoose240 in "To those who have already tested the GPT 6 Astar..."](https://www.reddit.com/r/codex/comments/1w82op3/to_those_who_have_already_tested_the_gpt_6_astar/), displayed "1mo ago" | The commenter reports better results with examples and concrete instructions than with a vague request to make something look good. Another commenter reports an obvious Astra style even when a design skill is involved. | References and a specified design system are useful constraints. Installing a skill alone is not evidence that the result meets them. |
| [Petras Baukys, Muzli](https://muz.li/blog/openai-devday-2026-for-designers/), 6 October 2026 | The author ran GPT-6.1 Sol on three shared briefs using a design skill and browser screenshot checks. Sol fixed visible problems but left a scroll trap in an iframe and a tap that unexpectedly dismissed an open player. | Published prompts and live outputs make this more inspectable than an unsupported opinion. Three single runs in the author's own harness cannot establish population-level model quality. Interaction defects can survive screenshot review. |

No source above establishes that every GPT-6 variant shares the same defaults, or that any model is incapable of good frontend work. Specific model names, prompts, harnesses, references, and reviewer preferences matter. These reports justify local acceptance checks, not a ranking.

## Insignia rules derived from Shopify guidance

These are project recommendations grounded in current Shopify sources, checked on the research date.

- Use Polaris components and their visual conventions for Insignia's embedded admin. Keep colors semantic. Shopify explicitly reserves green for positive or completed states and says to avoid green used merely to attract attention. Do not replace a green default with a different decorative default. [Visual design](https://shopify.dev/docs/apps/design/visual-design)
- Give each page a short title describing its purpose. Use concise nouns in navigation and predictable verb-plus-object action labels. For example, use "Templates" and "Create template" where those actions exist. A tagline such as "Unlock your creative potential" supplies no task information and should be removed. The example is proposed copy, not an additional feature requirement. [Navigation](https://shopify.dev/docs/apps/design/navigation)
- Remove repeated headings, duplicate navigation, and sentences that restate a nearby label. Use plain words and short sentences. Keep explanations that help a merchant decide or recover from an error. Concision must preserve necessary instructions. [Content](https://shopify.dev/docs/apps/design/content)
- Show actual status, immediate needs, and useful next actions on App Home. Require a product reason for every metric, banner, illustration, and explanatory paragraph. A large promotional hero is an unsuitable default for this daily workflow. [App Home page](https://shopify.dev/docs/apps/design/user-experience/app-home-page)
- Select sections and tables for the content. Shopify recommends containers for most content, one primary styled action per interactive card, and resource index patterns for many objects. A generic ban on cards would conflict with Shopify guidance. Avoid decorative repetition without removing useful grouping. [Layout](https://shopify.dev/docs/apps/design/layout)

## Review before calling a screen complete

1. Compare the rendered screen with the chosen Shopify pattern at desktop and narrow admin widths. Check typography, spacing, color roles, hierarchy, and overflow.
2. Read every visible sentence. It must name something, explain a decision, report actual state, or help finish a task. Remove invented claims, celebratory filler, and implementation notes from merchant copy.
3. Use the screen with pointer and keyboard. Check opening and closing, focus, scrolling at container boundaries, validation, saving, loading, empty states, errors, and retry paths where present. Screenshots cannot establish that these interactions work.
4. Confirm that the implemented UI follows Polaris even if a general frontend skill recommends a more expressive style. Distinctive marketing art direction is not the acceptance criterion for Insignia's admin.

The interaction checks above are local engineering recommendations informed by the reported defects. They are not claims that the external articles tested Insignia.
