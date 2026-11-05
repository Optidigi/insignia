# Home metrics and quality-of-life review

26 October 2026. Independent critique of the existing Home pixels against the native Superfunny Orders metric strip. The main implementation agent owns source changes. This note does not approve the next revision before its pixels exist.

## Evidence and method

Read `AGENTS.md`, the admin UI guidance and saved UI delivery workflow. Read the installed Shopify skill and its App Home reference. Runtime is `polaris-2.0-rc.js`, types `2.0.0-rc.3`. Used Checklist Design critique mode with its bundled web-app Dashboard and Onboarding checklists. Their useful questions here are whether metrics have meaningful period context, current work can be found quickly, the first setup action is clear, and completion is acknowledged. These checklists do not establish Shopify fidelity.

Inspected the actual images at readable scale:

- `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/superfunny-orders-metrics.png`
- Existing desktop and phone `home-operating.png`, `home-guidance-expanded.png`, `home-first-use.png`, `home-guidance-complete.png`, `home-many-artwork-tasks.png`, and `home-statistics-definitions.png` under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/home/`.

Read `HomeActivity.tsx`, `home-activity.css`, `HomeGettingStarted.tsx`, `home-getting-started.css`, `MerchantHome.tsx` and `merchant-home.css`. This is a pixel and source review. I have not independently exercised the live native metric definition interaction or the changed implementation interactions in this pass.

## Native metric comparison

The existing Home gets the basic relationship right: label above a count, with a small chart toward the right, and definitions behind an underlined label. Keeping two additive measures avoids a gratuitous chart on every available fact. The current definition popover also fits a 390 px capture and keeps exclusions out of the resting dashboard.

The remaining mismatch is visible, not a component-type issue. Native Orders has one unboxed horizontal strip. A compact period segment sits inside the strip at the far left. Labels are small and bold, their dotted rules are lighter and more widely spaced, and pale cyan charts stay close to the count baseline. Home has an external bold `Customization activity` heading with the period beside it, followed by a pronounced rounded card. Its label is larger, its dotted underline denser and darker, and its teal chart has a busier, taller silhouette. The combined result reads as a different dashboard pattern.

If the requested target is this exact native Orders strip, copy its framing and internal date segment as well as the label/value/chart relationship. An earlier acceptance of a rounded band as a Forms-inspired compromise does not answer the owner's fresh Orders-specific correction. Do not add native percentage changes without a real comparison source. Do not add a date picker solely to imitate native if the Home data only supports one fixed period.

Changing dot spacing needs a controlled rule or background pattern. Browser `text-decoration: underline dotted` does not expose dot-gap control. Verify the result in a close crop at actual display scale. Keep its position a few pixels below the label rather than letting the rule touch the glyphs.

The native clip is desktop only. Phone parity cannot be claimed from it. Current Home stacks the two metrics into about 154 px, before the guide or orders. A compact two-column phone band is worth testing, provided `Customized orders` and `Customized items` fit at 320 px and the charts do not crowd their values. Preserve legible label targets and definitions.

## Concrete quality-of-life opportunities

The expanded onboarding guide uses a useful native structure: separate completion rings and chevrons, one shaded active step, a clear action, and visible progress. The first-use phone state gives one obvious next action. Preserve those strengths.

The operating phone state spends around 150 px per recent order because identity, product, meta and status each stack. Five rows extend the card to around y=1060 and move the draft below y=1100. Try keeping the status beside the identity or meta while preserving room for long names. Desktop rows already scan cleanly.

The `home-many-artwork-tasks` phone capture has a more consequential priority problem. The expanded guide sits before live missing-artwork work, pushing `Artwork to prepare` to around y=660. For a shop with actual pending work, place those tasks before the guide or start the guide collapsed. An educational card should not make a merchant scroll to discover an order that needs action.

Recent orders are only linked through their short order-number text. Product title, metadata and the rest of the row are inert in source. A supported full-row clickable composition can make the broad row useful while retaining its real keyboard link. This is especially valuable on phones, where the order link occupies only a small fraction of a tall row.

The all-complete capture still shows `Get started with Insignia` and three expanded completed rows. The progress count does acknowledge completion, so this is polish rather than a blocker. A concise collapsed `Getting started complete` treatment would release space. Manual completion must remain separate from verified product publication and theme state.

Keep official illustrations purposeful. The best location is the active desktop onboarding step where the native reference teaches product setup. Use only a clearly relevant Shopify illustration with recorded provenance. A generic package or celebration image in operating metrics would add space without explaining the task. The phone version must keep the first action visible and avoid making the guide substantially taller.

## Pending final review

Await corrected desktop, 390 px and 320 px captures. Recheck metric framing, exact dot pattern, value/chart alignment, long labels and definition disclosure. Recheck phone current-work priority and order density if changed. Valid types and supported tags alone do not resolve these findings.

## Final corrected pixel and source review

Inspected the regenerated desktop and 390 px operating and many-artwork-tasks captures; 320 px long-content; desktop, 390 px and 320 px first-use; desktop guidance-complete; 390 px statistics-definitions; and the desktop published-setup-pending capture with its decoded illustration. These replace the earlier pixels for the findings below.

No material visual blocker remains in these inspected states. The metrics now follow the actual Orders strip: unboxed horizontal framing, an internal period segment, small semibold labels with sparse light-grey dotted rules, compact pale-cyan sparklines with faint prior-cohort lines, and count and percentage on one baseline. The external heading and rounded metric card are gone. The dot spacing and lighter color visibly answer the owner's complaint. Two metrics naturally receive more horizontal space than the native six-metric strip; this is an appropriate consequence of Insignia's chosen data, not missing native framing.

The phone adaptation remains stacked, which preserves room for the longer metric labels, values, trends and 80 px charts at 320 px. No clipping or horizontal crowding appears in the inspected narrow state. This is a sensible responsive implementation, not a claim to have observed Shopify's native phone metrics.

Phone recent-order rows now place status beside the ID. They occupy roughly 100 px rather than 150 px, and the operating draft begins roughly 150 px earlier in the full page. Long product titles remain limited to two lines, with readable item/date metadata. The 320 px long-content title wrapping is orderly and does not collide with actions or badges.

Artwork work now leads before the collapsed guide in the active-work scenario. At 390 px its heading begins around y=275 rather than y=660, and the first task action is visible immediately below it. The completed guide is compact and says `Getting started complete`. First-use retains one active step, a short explanation and one prominent action at all three inspected widths.

The official paint-roller and can image loads at 80 px inside the active desktop theme step. It supports the theme customization context without dominating the action. It is absent on phones, keeping the guide concise. Source marks it decorative with empty alt and an aria-hidden wrapper.

Source review found no nested link in the new full-row recent-order link. A real native link remains the keyboard destination. The aggregate metric button initially retained a label-only accessible name after its value moved into the button. That issue was reported and corrected: the final accessible label includes metric name, formatted count, comparison when present, and `View details`. Completion places pending focus on the guide toggle before collapsing the completed content. These are source observations. The implementation agent owns live pointer, keyboard, focus and range-change test execution; I have not independently repeated those interactions in this review.

This review establishes independently observed local composition for the listed captures and source checks. It does not establish owner acceptance, native embedded behavior or deployment.
