# Merchant review: Methods as real configuration

22 October 2026. Scenario-based desk review of the proposed Methods resource, informed by the three research notes linked below. These are hypothetical walkthroughs, not interviews, observed merchant behavior, or usability-test findings. The cited Shopify and vendor material documents available patterns; it does not validate Insignia's fit or prove a merchant preference.

## Recommendation

Make **Methods** a top-level resource with an index and a full detail editor. Keep assignment and pricing in the resource, not behind a name-only modal in Settings. Use the index to find methods and inspect scope/readiness; use the detail page to configure reusable defaults and product scope. A table alone cannot explain conditional pricing and dynamic matching. A wizard makes returning to edit one rule or amount slower and hides relationships between sections. A full page with short grouped sections, conditional fields, and an inline impact summary is the better recurring workflow. On phones, stack sections and the summary; edit prices by product/location without a compressed matrix or ordinary horizontal scrolling.

Treat a method as reusable defaults plus an explicit product target. Keep product-specific locations, geometry, sizes, and final price cells on the product. Offer the requested two pricing modes, with their units visible:

- **Per decoration, per garment** — one default charge for each selected location. If Front and Back both use a $5 method, the decoration surcharge is $10 per garment. Applying the default seeds the applicable product price cells; it is not a hidden live link.
- **Set prices by product, location, and decoration size** — enter each final per-garment surcharge on the product, where those choices exist. Do not add the method's base price again. A product can override copied defaults.

Do not label either option simply “per item.” Blank means that choice is unavailable; explicit $0.00 means free. Partial prices should remain visibly incomplete and block those choices from publication. Show currency and “per garment” next to amounts.

Include both exact product selection and a restrained tag-rule mode because the requested dynamic scope matters. Keep tag rules to selected tags with clear all/any semantics; do not build a generic nested condition language. Show a live match preview and counts for matched, already configured, and needing setup. Critically, define two operations separately: **rule match** discovers the target set; **apply defaults** writes product drafts. Saving an edited rule must not silently rewrite hundreds of product drafts or published products. A new match should appear as `Matched · needs product setup`, with a direct setup action; it must not imply usable geometry, a purchasable choice, or publication. If auto-copy on future matches is later chosen, make it an explicit rule behavior and explain that removing a tag will not delete a product's existing draft copy or unpublish it.

Use the index columns **Method**, **Pricing**, **Product scope**, and **Setup**. Prefer exact counts from a reliable query; otherwise show `Manual selection` / `Tag rule` and avoid invented usage totals. Do not imply that a method itself is published or buyer-active. The detail sections should be **Method**, **Pricing**, and **Product scope**, with a summary of current matching and setup state beside them on wide screens. Keep Save/Discard at page level. Name is required; explanation is optional. Default a new method to per-decoration pricing only if the store can make the unit explicit, and start scope as manual selection. Do not silently assign all products, choose tags, or infer locations/sizes.

## Scenario walkthroughs

| Merchant situation | Useful behavior and potential surprise |
| --- | --- |
| Tiny shop, one method | Create directly from the Methods index or from product setup without losing context. Show all core choices on one detail page, with a clear `Not assigned` state. No forced wizard and no empty product matrix before products have locations/sizes. |
| 500 products already tagged | Rule editor previews the exact 500 and which need setup. Let the merchant filter/review and explicitly apply defaults in a batch. Show a before/after count and preserve existing product-specific prices. A tag rule save alone must not trigger 500 draft rewrites. |
| Two locations, two methods | Explain charge multiplication and show each product location's selected method and resulting price. Front and Back at $5 each total $10 per garment; two different methods remain independent. No cross-method size choice should appear unless that product actually offers it. |
| New product matches a tag but has no geometry | Surface it as matched but needing product setup. No inferred placement, fit, price, customer option, or publish readiness. The merchant can open product setup and provide its own geometry and price rows. |
| Some custom prices override defaults | Mark each product price as `Using method default` or `Custom`; show the final amount. Applying a changed default needs an explicit scope and diff preview. Keep blank distinct from $0.00. |
| Global method edit with published products | Save the reusable default and state that existing drafts/publications are unchanged. Published revisions and orders retain resolved values. Provide a separate, previewed product-draft update if needed; never mutate publications in place. |
| Narrow phone | One-column sections, wrapped labels, location-focused price editing, and summary inline. Do not squeeze desktop columns or require sideways scrolling to discover which prices are missing. |

The riskiest wording is **assignment**: a merchant can read it as live inheritance, while the current proposal describes copied, product-local values. The UI should distinguish `Matched by rule`, `Applied to draft`, `Needs setup`, `Ready to publish`, and `Published`. Keep a product copy independent after application; tag-rule membership can change the target preview, but must not silently remove an existing copy or alter a published snapshot. Explain this before a bulk apply as well as after saving the reusable method.

## Basis and limits

The Shopify pattern report supports an index plus full Details layout and warns that collection rules and app assignments have different semantics. The pricing report establishes why per-location scope must be named and why product/location/size cells are product-local. The assignment report favors exact selection initially, while documenting that tags and collection membership can change; this review keeps tag rules in the proposed UI but requires a live match preview and separates matching from draft writes. Those are source-informed design judgments, not findings from merchant research.

Related notes: [Shopify pattern review](method-shape-shopify-review-2026-10-22.md), [pricing review](method-shape-pricing-review-2026-10-22.md), and [assignment review](method-shape-assignment-review-2026-10-22.md).
