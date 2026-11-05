# Community design review

Reviewed 19 October 2026. Community sources below were opened and read. This is a source/copy critique of `src/main.tsx` and `src/style.css`, not a fresh visual or usability test. No implementation changed.

## What the sources actually support

- [r/UI_Design: websites looking like AI slop](https://www.reddit.com/r/UI_Design/comments/1w70kqb/question_about_websites_looking_like_ai_slop/). Several comments identify repeated eyebrows, unnecessarily explanatory copy and systematic sameness. Others reject treating ordinary borders/shadows as proof of poor design. One useful distinction is whether the content solves a specific problem rather than repeating a template. These are practitioner opinions, not controlled evidence or verified model attribution.
- [r/webdesign: preventing the AI slop look](https://www.reddit.com/r/webdesign/comments/1uhuovu/preventing_the_ai_slop_look/). Comments explicitly flag eyebrows, ubiquitous boxed layouts and language that feels excessively helpful/friendly. Counterarguments say familiar visual devices remain valid when they serve the brand and task. I do not endorse the thread's unsupported neuroscience explanations or claims that paid fonts inherently make better design.
- [r/UI_Design: hero eyebrow labels](https://www.reddit.com/r/UI_Design/comments/1vcixtb/do_hero_eyebrow_labels_improve_clarity_or_just/). Discussion is mixed. Some call them unnecessary visual stops; others describe legitimate context or breadcrumb functions and note the pattern predates generative AI. Useful criterion: does the smaller label add information the headline needs? It is not an automatic ban.
- [LeoStehlik/no-slop-ui](https://github.com/LeoStehlik/no-slop-ui). This independent ruleset explicitly targets Codex as well as Claude Code and other agents. It warns against product screens that imitate marketing heroes, vague copy, nested cards and eyebrow labels. It is a small opinionated repository, not OpenAI guidance or research proving that a particular model causes these failures. Its dashboard references should not become a new rigid style template for a clothing-store buyer.

None of these sources establishes a GPT-6.1-Sol-specific tendency, ranking or failure rate. Some commenters blame Claude; that is anecdotal attribution. The supported conclusion is about recurring AI-generated UI patterns across tools and, more decisively, concrete patterns in our own prototype.

## Where the prototype matches

| Current copy/location | Problem | Better direction |
| --- | --- | --- |
| `main.tsx:94`: “A garment, made yours” above “Let’s make it personal.” plus a sentence below | Three introductory layers before the task. The eyebrow and headline both sell personalization without helping choose a print. | Use “Customise your T-shirt” or “Your prints”. Keep one short instruction only if needed. |
| `main.tsx:95,107`: “Different artwork? Absolutely.” and the chest/back reassurance paragraph | Repeats the design brief to the buyer instead of making the controls self-evident. The rhetorical question sounds generated. | Keep “Add another print” and the per-placement artwork controls. Explain reuse in the artwork picker when relevant. |
| `main.tsx:110`: “One design. Your whole crew.” / “Find everyone’s fit.” | Generic campaign voice, assumes a group order and hides the actual sizes/quantity task. | “Sizes and quantities”. The sentence explaining that every garment gets the same design does useful work. |
| `main.tsx:116`: “A final look” / “Made just how you want it?” | Repeated decorative eyebrow plus a vague question for an exact review task. | “Review your order”. Surface missing artwork and total prominently. |
| `main.tsx:129,132`: “Make it yours”, “A little design guidance”, “A little space for something personal.” | Small help and empty states receive promotional personality that adds reading rather than meaning. | “Help with artwork” and “Your bag is empty”. |
| `main.tsx:107,114,125`: repeated notes/footer captions | Interface overexplains stable rules in several places, competing with file, print-size and price decisions. | Preserve only the local explanation that prevents a real mistake; move secondary guidance into help. |

The placement cards themselves have a real reason to exist: they group an artwork, location, size and price as one editable item. Do not remove all cards, borders, blue accents or Inter merely because a community list mentions them. The stronger criticism is generic introductory copy and redundant framing occupying prime space while meaningful controls and supporting text are very small. `style.css` sets many labels/help messages to 9–12px. That deserves a rendered readability review rather than a claim that changing the font will fix the experience.

## Candid assessment

The prototype is a useful interaction sketch with product-specific behavior. Its writing is noticeably generic and too eager to charm. It repeatedly announces that customization is personal instead of letting the customer's design provide that personality. The next pass should remove ornamental headings, strengthen the hierarchy around artwork, print size, garment quantity and price, and test those decisions at actual desktop/mobile sizes. Keep short explanations where they prevent a costly misunderstanding, especially left/right as worn, print size versus garment size, artwork-later responsibility and the illustrative nature of the preview.

## Model-specific anecdotes inspected by the lead

The lead also opened [a firsthand GPT-6.1-Sol complaint on r/vibecoding](https://www.reddit.com/r/vibecoding/comments/1x2pwa5/gpt_61_sol/) describing excessive UI copy. Replies disagree. [A first-person LinkedIn frontend report](https://www.linkedin.com/posts/akshit2434_gpt-61-sol-is-interesting-for-a-reason-that-activity-7511257064560844800-8f1d) similarly describes unnecessary lines resembling internal notes; a reply reports the issue with Opus too. These provide model-specific anecdotes, which the four broad sources above do not. They establish that other users report similar behavior, not a measured GPT-6.1-Sol failure rate or a comparison proving it worse than another model.
