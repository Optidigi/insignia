# Storefront setup failure-prevention audit

## Scope

This audit compares the current [StorefrontSetup island](../../../apps/web/src/islands/StorefrontSetup.tsx) with the admin review records and the 26 October setup research. It is a source and evidence audit. I did not inspect a fresh rendered capture, so the layout constraints below are review gates, not claims about current pixels.

## Priority constraints

### P0: Keep the setup sequence and completion claims true

- Replace the numbered “1. Configure a product / 2. Add the customization button / 3. Enable cart review” sequence with two independent theme tasks and a customer test. The research says product setup and theme installation can happen in either order. A published product configuration is a prerequisite for the final test only. Do not make the block or embed look gated on product setup.
- Remove the sentence that says the button appears only when a product has an available published customization. The implementation and research do not establish that rule. Do not replace it with another promise about when the buyer button appears.
- A Shopify editor deep link opens a proposed change for merchant review. A click, return, or saved draft is not proof that the change is active. If theme status is added, label its scope “Published theme,” use only source-backed states such as active, not active, unavailable, or could not check, and refresh the observation automatically after returning from Shopify. “Unavailable” does not mean “incompatible.”
- Keep the final product-to-cart test visible. A published-theme activation check cannot prove block position, coverage of every product template, product readiness, or a working customer journey. Tell merchants to preview a configured product, open customization, add it to cart, and check cart review.

### P1: Make the page a short task guide, not a fake wizard

- Keep one page title, a compact setup task for the customization block, a compact task for the cart review embed, and the final test. Put each action next to the instruction it serves. The current numbered headings, subheadings, paragraphs, and extra “Already added the block?” paragraph repeat context. Cut repeated explanation before reducing type size or hiding useful steps.
- Use task labels that match the handoff: “Add to theme,” “Enable in theme,” and “Preview a configured product.” Put a “Set up a product” link with the final test when needed, not first in a required sequence. Keep “Open theme editor” as a useful route for editing an existing block. Retain the manual Shopify route when App Bridge context or the API key is unavailable.
- Use Shopify’s normal section padding. Keep the task title and supporting copy aligned, and place the action consistently within that task row. A prior live defect came from a horizontal scrollport cutting off Polaris focus rings; a different review found that helper copy already aligned with the field border and only looked offset because input text has its own inset. Do not add margin by eye. At 320px, let actions wrap or stack and verify focus rings remain visible.
- Keep the task information easy to scan without a promotional hero, oversized heading, invented progress, decorative card grid, or fake “Setup complete” state. Admin guidance calls for short resource titles and supporting text only when it explains a consequence, choice, or recovery.

### P1: Keep copy merchant-facing and recovery specific

- Keep internal review language, implementation details, and Shopify query or API terminology out of merchant copy. The named records do not document a literal chat leak, but they repeatedly call out implementation notes, duplicate technical explanations, and unsupported product claims as copy to remove.
- Do not add a routine “Refresh” button. If a real status check fails, offer one contextual retry. Say “could not check” when the check itself fails. Only when a specific unsupported template or section is known should the page explain that limitation and offer a manual route to a compatible location. Do not infer incompatibility from an unavailable status or label an empty or failed check as a successful setup.
- Do not add a “Back” stepper unless a real subtask needs it. The two theme editor handoffs are independent, and the existing Settings breadcrumb already returns to Settings. Historical reviews removed duplicate retry actions and kept recovery beside the failed task.

### P2: Review reading order and captures, not only overflow

- The long-copy review found that an earlier “no overflow” result missed a poor reading hierarchy. Inspect the full setup page at 320px and desktop widths with realistic wrapped copy and status text. Confirm the two theme tasks stay distinct and the customer test is still findable. Do not merely shrink text or force the test above the fold.
- Use fresh captures of the intended route after the visible page title and host title have settled. Past galleries captured a request title before it updated, caught a popover opening animation, and once led with the older screen instead of the current workflow. Re-capture after relevant source changes, verify image dimensions and selected state, and do not reuse stale gallery assets as current evidence.
- Measure visible text against the actual content container. Polaris custom elements and hidden slots can report zero layout boxes; those measurements did not establish padding or clipping in prior reviews. A screenshot can support a composition claim, but not keyboard recovery or owner acceptance.

## Likely owner objections

- “Why can’t I configure a product first?” You can. Product setup is one route; adding either theme feature does not depend on it. The product is required only for the customer test.
- “Why not show green checks when I return from Shopify?” The editor handoff is not completion evidence. Any automatic check is scoped to the published theme and cannot validate every template or the buyer flow.
- “Why keep the customer test if the embed and block look active?” Activation does not prove the block is positioned well or that customization and cart review work together.
- “Why no Refresh button?” Recheck on return, then offer a retry only when a check failed. A permanent refresh control repeats a known admin UI mistake.
- “Why not call an unavailable status an incompatible theme?” The status does not prove incompatibility. Explain the limitation only when a specific unsupported template or section is known, and give a manual editor path.
- “Why remove some of the helper copy?” Prior reviews found duplicate headings, repeated technical explanations, unrelated actions, and claims that source could not support. Keep the instruction that helps the merchant make the next decision.

## Follow-up source review, 26 October

The new page source now follows the main flow constraints: two independent theme tasks sit under “Published theme,” the product test is separate, the unsupported button-visibility claim is gone, the page has a manual fallback, and a failed status check has one contextual retry. Its task-row CSS places the action in a trailing desktop column and stacks it at narrow widths. That is compatible with the inset/focus constraint above; final alignment and hierarchy still need the pending screenshots.

The cart embed is a body target. It checks the cart for either Insignia marker property and adds “Review customized cart” whenever a marked item exists, without checking whether it is stale. The buyer customizer restores the Insignia groups, lets a customer choose a retained design to edit, then requires a current customized-cart price review and acceptance to apply the updated items. It can also remove all customized items. It does not promise to repair every incompatible or unrestorable cart, and it is not an inline editor. The server returns `repairRequired`, but the current client does not read that flag.

Suggested merchant copy: “Enable the Insignia cart review embed. When the cart contains an Insignia customization, it adds a ‘Review customized cart’ button to storefront pages. Customers can review saved designs, update one, then review and accept the current customized-cart price.” This avoids implying that the button exists only on the cart page, that it edits arbitrary cart items, or that edits skip price approval.

One source-level action mismatch remains for visual review: every cart-task state except “available” uses the generic `?template=product` URL for “Edit in Shopify” or “Open theme editor.” That opens the product template rather than App embeds. The available cart state uses the `activateAppId` deep link correctly. Other cart states should open the cart embed in App embeds or use a clearly scoped editor route. The no-link banner should also say to open the merchant’s theme from Online Store → Themes → Edit theme, rather than suggesting Insignia itself is found there.

## Evidence used

- [Admin UI guidance](admin-ui-guidance-2026-10-20.md): short task titles, truthful states, normal Polaris composition, no oversized hero or implementation notes.
- [Admin gallery comments](admin-gallery-comments-2026-10-24.md): clipped focus ring, false visual offset from native text inset, incomplete prior feedback, stale workflow selection, narrow-screen context loss, duplicate retry and capture-animation corrections.
- [Settings product-truth review](settings-product-truth-review-2026-10-25.md): remove routine refresh and duplicate explanation; keep empty, error, and recovery states distinct; supported component names alone did not establish useful copy or spacing; wait for visible host content before capturing.
- [Checklist Design fixes](checklist-design-fixes-2026-10-25.md): empty catalog does not prove there are no products; avoid speculative “Create product” or “Refresh” actions; check narrow-screen focus and recovery.
- [Storefront setup research](storefront-setup-research-2026-10-26.md): independent setup order, accurate limits of Shopify’s published-theme status, and the recommended compact V1 task flow.
- [Long-copy design review](../../../../designer-prototype/artifacts/post-cart-review/long-copy-design-review.md): overflow alone did not establish good hierarchy; preserve readable content and verify the complete mobile flow.
