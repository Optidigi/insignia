# Observed failure examples

These are evidence from Home V1 and Storefront setup on 26 October 2026. Recheck current contracts before applying a historical fix. The useful lesson is the failure mechanism, not a universal component recipe.

| Symptom | What happened | What changes the next decision |
| --- | --- | --- |
| Section actions passed validation but vanished | In the pinned Polaris runtime, link children in a section's secondary-action slot did not render. Supported button children restored the owning-list destinations. | Inspect the actual slot output and accessibility tree. Validate and render against the same selected runtime. |
| A phone thumbnail had a large gap before its title | A native control's `display: contents` behavior defeated the intended grid placement and enlarged an `auto` track. | Inspect real grid participation. A fixed thumbnail track and a real action wrapper restored predictable alignment in that view. |
| An empty-state paragraph stayed left aligned | Outer text alignment did not override the native paragraph's shadow styling. The recovery cluster also used its default start alignment. | Inspect line boxes, not just the outer card. Use supported layout contracts or semantic wrappers with native inline text; avoid private shadow selectors. |
| An icon box looked empty | The declared glyph did not produce a useful visible graphic in the captured state. | Verify rendered glyphs. Omit an optional empty graphic instead of preserving a blank decorative box. |
| A long-content case exposed internal prose | A fixture description explained how the preview tested wrapping. It reached the merchant page unchanged. | Stress length with plausible merchant content. Keep scenario explanations in developer controls or gallery notes. |
| Several setup buttons led to the same place | Home repeated Settings tasks and labeled internal handoffs Add to theme or Enable in Shopify. Completed rows still gave Add instructions. | Summarize at Home, label the actual handoff, and let Settings own the detailed actions. Use status copy after completion. |
| Retry lost keyboard focus | The recovered empty section disappeared, making its old focus target invisible. | Restore focus after the rendered update. Choose a visible recovery region or meaningful sibling when the original region no longer exists. |
| Restoring guidance targeted a hidden phone action | Polaris moved the guide's disclosure into the section action overflow on phones, even after its label was replaced by an icon. | Keep the disclosure in the body when it must stay directly available. Exercise restore at the narrow width and verify focus reaches a visible control. |
| A plan change left the old restriction visible | The initial billing read was never repeated on return. Theme responses could also arrive out of order. | Re-evaluate relevant facts after returning and prevent older asynchronous results from replacing newer ones. |
| A summary looked complete without complete facts | A title-sorted product page could miss configuration elsewhere; recent orders were not a complete attention queue. | Keep bounded absence, totals and actionable work separate. A missing or expired artwork badge alone does not establish a merchant task. |
| Decorative examples weakened the setup page | Invented miniature storefronts repeated text without showing the merchant's theme or teaching an extra step. | Use an example only when it explains a real choice or outcome. Do not present generated interface imagery as observed UI evidence. |

| A clean refinement still missed the requested native design | The first metrics refinement rendered plain values without the reference's chart treatment, and the getting-started guide was a bullet list. Review confirmed completeness without comparing the actual reference composition. | Compare reference and implementation images directly. Check value/chart geometry and task-completion/expanded-step behavior, not just presence of metrics and guidance. |
| Internal data rules became merchant copy | Exclusion and recent-five sentences added visible explanation absent from the native references. | Keep data integrity in the model. Put metric definitions in contextual help, and use familiar Recent/View all presentation for a bounded overview. |

| First use gained filler after feedback that it looked empty | A generic journey repeated the guide. A sample garment then passed an accuracy/pixel review but assumed a product category and added no supported first decision. | Before adding a section or image, name the distinct current merchant task or fact it serves. Compare several native apps and content guidance, not only their geometry. A real screenshot can still be irrelevant. Keep the page compact when there is no justified extra content. |

## Evidence to revisit

- [First-use removal decision and multi-reference research](../../../../docs/delivery/notes/home-first-use-restoration-research-2026-10-26.md)

- [Home implementation and corrective passes](../../../../docs/delivery/notes/home-v1-design-2026-10-26.md)
- [Independent Home source and pixel review](../../../../docs/delivery/notes/home-v1-sol-review-2026-10-26.md)
- [Home preflight criteria](../../../../docs/delivery/notes/home-v1-preflight-2026-10-26.md)
- [Home refinement and bounded summaries](../../../../docs/delivery/notes/home-refinement-2026-10-26.md)
- [Storefront source correction and image removal](../../../../docs/delivery/notes/storefront-setup-source-correction-2026-10-26.md)

The current owner feedback values the clean Home V1 and asks for further refinement, including useful statistics and dismissible guidance. The earlier decision to omit metrics was a V1 fact/scope choice, not a permanent rule against statistics, richer guidance or personality.

The owner rejected the first Home refinement after the earlier independent review reported no material finding. That review did not establish reference fidelity. Its presence/spacing checks remain useful, but future reviewers must also compare the requested native composition directly.
