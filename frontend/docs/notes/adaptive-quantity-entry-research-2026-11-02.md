# Adaptive quantity entry for the customer customizer

2 November 2026. Research and recommendation only. No customer behavior or screen was changed. Main-agent research includes the current gallery screenshot and quantity renderer, all fourteen scenario data sets, Shopify product-form documentation, current Horizon and Dawn source, Vercel interaction guidance, W3C input patterns and the installed Checklist Design files. An [independent research agent](quantity-patterns-independent-research-2026-11-02.md) checked the same problem from Shopify's selection and quick-order patterns.

## Decision

Choose the presentation from actual variant structure and readable control space. Keep one underlying quantity record keyed by exact variants. The UI can simplify a short catalogue without identifying a product category or requiring a merchant setting.

Use these presentations:

| Supplied data | Recommended presentation |
| --- | --- |
| One actual variant | Meaningful attributes as text and one editable quantity control. Remove selectors that offer no choice. |
| A few actual combinations | One compact list. Each row names the combination and has an editable quantity with minus/plus buttons. Allow several positive rows without a separate add-item flow. |
| A repeated axis with readable short values | Grouped direct-entry quantities, suitable for entering many values in sequence. Keep supplied order and label each field; do not require a plus click for every unit. |
| Large, long-labelled or very sparse combinations | A labelled option picker or search, followed by compact selected-combination rows with quantities. Keep all already-entered items visible in a summary. |

For the current sparse case example, that means compact rows for Matte / Model A and Gloss / Model B, each with its own quantity. The actual unavailable Gloss / Model A record can have a plain Unavailable state. Matte / Model B does not exist and must not be created as a product choice. No repeated card headings, generic warning blocks or two-column grids are needed for this example.

For ordinary six-size apparel, retain rapid direct input across the supplied size values. Rows remain useful for additional colours. This recommendation does not depend on recognizing words such as shirt, colour, size, finish or model.

## What the sources establish

Shopify's [product template guidance](https://shopify.dev/docs/storefronts/themes/architecture/templates/product/overview) separates selecting a variant from selecting its quantity. [Horizon source](https://github.com/Shopify/horizon/blob/dfad90d87be2408de52636315069fc998da28c9e/snippets/variant-main-picker.liquid) renders a singleton non-swatch option as text. Its [quantity control](https://github.com/Shopify/horizon/blob/dfad90d87be2408de52636315069fc998da28c9e/snippets/quantity-selector.liquid) combines direct entry with decrement/increment controls.

Shopify also explicitly documents [quick order lists for multiple quantities across variants](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/store-contextualization/create-and-manage-overrides#add-the-quick-order-list-section-to-your-product-page). [Dawn's actual variant rows](https://github.com/Shopify/dawn/blob/05222537f672cc0e8ae8aa3ac07808b9cfc34742/snippets/quick-order-list-row.liquid) support the compact list approach. These first-party implementations use actual variants, not generated Cartesian combinations. Their bulk component is a list, not an official recommendation for Insignia's size matrix.

[NN/G's input-stepper research](https://www.nngroup.com/articles/input-steppers/) supports increment controls for small changes and warns against making users click through large changes. Direct typing must remain available in every presentation. [W3C's spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) describes editable values, bounds, names, invalid state and keyboard behavior. [Vercel's guidelines](https://vercel.com/design/guidelines) add usable phone targets, unobscured focus and preservation of input values.

The installed Checklist Design Input Field, Radio and Multi-step Form checklists support clear labels, related fields, step-level errors, Back without losing progress, and a final editable review. They do not prescribe a variant-count threshold. A radio selects one value within an option group; it cannot stand in for a customer's complete multi-variant order.

No inspected Shopify source prescribes an automatic cutoff between these layouts. The algorithm below is an Insignia design proposal, not a platform rule or a measured conversion improvement.

## A bounded automatic policy

Start by distinguishing a single actual variant from a varying catalogue. A singleton axis inside a multi-variant product becomes an attribute, not another picker. Hide a synthetic Title / Default Title decision only when that exact supplied structure establishes that there is no customer choice. Keep meaningful singleton values.

A reasonable initial compact-list boundary is at most six actual configured tuples with at most three values on the existing column axis. This keeps the sparse case and three one-size apron colours compact, while a five- or six-size row can retain efficient direct entry. The numbers are starting limits to evaluate in rendered tasks, not proven best-practice constants.

For larger sets, choose a grid only where short labels and controls fit, with a bounded number of columns and readable grouping. Long labels and sparse relationships favor rows or an option picker. Use responsive CSS for wrapping and generous control space; do not perform repeated layout reads while the customer types. Keep a customer-accessible route to individual option selection when the default grid does not suit their task.

Use configured tuples to choose the presentation, not the count that happens to be in stock today. Keep the presentation stable while quantities change, inventory refreshes or a filter changes. Screen width can reflow the presentation without deleting values or changing ordering intent. A layout change must not remount focused inputs unnecessarily.

The adapter's last-axis projection currently supplies the quantity columns. A future layout policy should inspect complete structured axes instead of declaring the last axis a semantic size. Do not reorder labels or manufacture option metadata to make a grid convenient.

## Why not always use one variant picker and one quantity?

That is Shopify's familiar single-purchase pattern and the independent agent's preferred default. It is a useful large-list presentation. However, making it mandatory for Insignia's tiny catalogue would add selection-and-add cycles to an existing mixed-quantity task. Two visible available rows can express both one-item and mixed-model orders directly. I recommend that lower-risk simplification first, while retaining picker-based entry when an all-variant list would grow long.

Neither variant count nor an option named Size establishes purchase intent. A small catalogue can need hundreds of units; a large catalogue can be a one-item purchase. Every control must support direct numeric entry, and larger presentations need a way to choose individual combinations. If actual user testing shows frequent single-item selection in the small list, the picker default can be reconsidered without changing the quantity model.

## Checks against the existing scenarios

These are data-shape observations, not completed usability tests of a new design:

- Phone case options: two row values, two column values, three actual variant records and two available combinations. A compact actual-variant list removes the existing empty cross-product cell and repeated warnings.
- Minimal and the single-variant phone case: one row and column. One quantity needs no matrix.
- One-size apron: three choices and one column. Three compact rows avoid repeated One size headings.
- Classic: six colours and six short size values. Retain direct size entry, adding colour groups as needed.
- Front only and many widths: one colour and five size values. Direct entry stays efficient even though the total catalogue is small.
- Colour studio and large palette: 24 and 60 colour rows with six size values. Search/add the relevant colour groups; do not render every row by default.
- Extended sizes: two rows and fourteen values. Wrap or group fields with full labels; no squeezed fourteen-column phone grid.
- Long content: two rows and eight values, one label 21 characters long. Protect readable labels and use rows/list when necessary.
- Staff polo, team hoodie and many placements: multiple rows and seven or eight short size values. Preserve direct-entry bulk behavior.

## State and data requirements

The presentation selector should be a pure function beside the existing option adapter. It returns a layout description; it does not rewrite quantities, prices or variant IDs. All renderers dispatch the existing domain quantity events. UI-only picker selection and search stay separate from committed item quantities.

Required checks for implementation:

1. Zero means not ordered in a multi-variant list. Rendering every row must not preselect one of each. Preserve an explicit host quantity when supplied for an intended selection.
2. Changing a picker does not transfer quantities from one tuple to another. Duplicate selections focus or edit the existing tuple rather than create duplicate order entries.
3. Missing combinations and existing unavailable variants remain distinct. Do not call an unavailable boolean Sold out unless that reason is known.
4. Unknown or incomplete variant metadata cannot establish availability or that the catalogue contains only one variant. Show existing recovery guidance rather than invent options.
5. Minimum, maximum and increment rules apply only when supplied by the authoritative integration. Current local maxQuantity is not proof of stock or B2B rules. Keep invalid text available for correction; do not silently round.
6. Search, layout changes, responsive wrapping, Back and Review preserve every entered quantity. Hidden positive or invalid entries stay discoverable and counted in validation.
7. A three-axis product preserves the full tuple and its ID. Grouping one axis must not erase selected quantities in other groups.
8. Quantity control focus identifies its complete tuple. Label and action targets remain usable at 320px, dark mode and zoom. Keyboard users can type, navigate and reach inline errors without a covered focus target.
9. Selecting a row may select the corresponding configured preview appearance. It cannot infer a compatible photo, artwork area or physical calibration for a different model.
10. Stock updates revalidate selected tuples without silently removing a customer's order. Partial metadata loading must not briefly show a false single-choice layout.

Implementation would need pure policy tests and rendered checks for one variant, compact dense/sparse sets, five/six-size rows, many long model labels, three axes, unavailable updates, existing mixed orders, invalid quantities, filtering and responsive focus. No new backend presentation setting or product classifier is needed. Live Shopify integration remains separate.
