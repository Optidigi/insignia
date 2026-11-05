# Home chart pattern research

26 October 2026. Read-only research for the Home UI refinement. No app, dependency, browser, store or backend changes. Target remains Astro/Preact, `polaris-2.0-rc.js` and `@shopify/polaris-types` `2.0.0-rc.3`.

## Recommendation

Use the native Polaris metrics composition for the container and text, then render a small local SVG line or bar chart inside each metric cell. This is a custom chart inside supported native framing, not a Shopify chart component. Keep the chart about the size of a compact sparkline rather than adding an analytics dashboard. Use explicit local example series only in the authorized preview/demo state. Do not label those series live, derive them from unrelated counts, invent revenue, or add backend collection.

The exact installed rc.3 custom-elements catalog has no chart element. Shopify's [metrics composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/metrics-card) supports Section, Grid, Heading, Stack, Text, Badge, Divider and Clickable. It demonstrates one section divided into responsive metric cells. A supported composition establishes the framing; it does not satisfy the owner's specific request for charts by itself.

## Native references inspected

- `.artifacts/home-research-2026-10-26/search-discovery-initial.png`, in the parent workspace. Search performance is two compact metric cards, with the title above, the value below and a short blue zero line at lower right. The line has no axes or grid. The next row contains three smaller data cards. A date range sits next to the section heading.
- `.artifacts/home-research-2026-10-26/forms-inactive-overview.png`, in the parent workspace. Three metrics share one white rounded strip with vertical dividers. Each cell has a compact title, value and unavailable comparison dash. Date and comparison controls precede the strip. This zero-data reference has no chart.

These are observed composition facts. Neither screenshot proves nonzero chart behavior, hover behavior or the data source.

## Implementation choices

| Option | Astro/Preact fit | Benefit | Cost and decision |
| --- | --- | --- | --- |
| Small SVG `polyline`/`path` or `rect` series | Renders directly in existing JSX and SSR, no package | Exact compact dimensions, responsive `viewBox`, testable geometry, no chart hydration delay | Must implement scaling, zero/empty states and accessible equivalent. Recommended for a handful of short local series. |
| Shopify Polaris Viz `SparkLineChart` / `SparkBarChart` | React package with React/ReactDOM 16–18 peer contract, not a Preact-native package | Shopify source has spark charts, themes, states and accessibility labels | Officially deprecated and archived. Would add React compatibility, provider, CSS and client-only rendering. Do not add for this refinement. |
| Chart.js directly from a Preact effect | Framework-independent canvas API; no React wrapper needed | Maintained charting foundation with line/bar types and responsive tooling | Requires package, canvas lifecycle, manual native styling and accessible fallback. Reasonable for future substantial analytics, excessive for these sparklines. |

Primary sources for Polaris Viz are its [deprecation notice](https://github.com/Shopify/polaris-viz), [package manifest](https://github.com/Shopify/polaris-viz/blob/main/packages/polaris-viz/package.json), [SparkLineChart source](https://github.com/Shopify/polaris-viz/blob/main/packages/polaris-viz/src/components/SparkLineChart/SparkLineChart.tsx) and [SparkBarChart source](https://github.com/Shopify/polaris-viz/blob/main/packages/polaris-viz/src/components/SparkBarChart/SparkBarChart.tsx). GitHub marks the repository archived on 29 July 2026. The README says Shopify moved to an internal-only visualization library. The source package is 16.16.0 and declares React/ReactDOM peers through 18.

There is a documentation conflict. Shopify's current [sales dashboard tutorial](https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api/build-a-sales-dashboard?extension=react) still suggests Polaris Viz, including a provider, stylesheet and client-mount gate because chart drawing reads `window`. That tutorial establishes integration mechanics, not continued maintenance. Prefer the repository's explicit deprecation notice for dependency decisions.

Chart.js documents its plain JavaScript and tree-shaken integration [here](https://www.chartjs.org/docs/latest/getting-started/integration.html), and states that canvas contents need ARIA or fallback content for accessibility [here](https://www.chartjs.org/docs/latest/general/accessibility.html).

## Colors and appearance

Use supported semantic props for surrounding content. The public [Text contract](https://shopify.dev/docs/api/app-home/v2.0/web-components/typography-and-content/text) has `color="base" | "subdued"` and semantic `tone` values such as `info`, `neutral`, `success` and `critical`. Keep success/error meanings for actual outcomes. A rising count alone does not establish success.

No documented public v2 CSS semantic-color custom-property API was found in the topic search, public component docs or installed rc.3 type contract. Do not treat `--p-*` variables or inspected shadow internals as public v2 design tokens. Shopify's [Polaris 2 migration guide](https://shopify.dev/docs/apps/build/app-home/polaris2) explicitly warns that reading old Polaris custom properties or copying `@shopify/polaris-tokens` values pins custom CSS to the old palette. It advises app-owned tokens for custom CSS, or native components.

For a custom SVG, define any chart colors as app-owned chart tokens, or use `currentColor` where the actual inherited color is verified. A semantic prop on a shadow component is not proof that an arbitrary child SVG inherits its computed semantic color. Keep native text, dividers, backgrounds, radii and padding under Polaris control. The native screenshot's blue line is a visual reference, not a public palette value. Inspect the chosen accent and baseline in both host appearances before acceptance. Do not force host appearance or add a font stack; the migration guide says App Bridge selects appearance and Polaris loads the correct font.

## Concrete chart contract

- Separate data kind explicitly: available real series, explicit local example series, true zero series, unavailable series. Only an actual zero series gets a flat zero chart. Missing data gets a dash or clear unavailable state, not an invented zero line.
- Use fixed `viewBox` geometry, responsive inline size and a small fixed block size. Avoid a point marker for every datum, legends, gridlines or axes when the metric and date range already identify the series. A small start/end date treatment can clarify the period when needed.
- For nonnegative counts and bars, keep zero as the baseline and use a nonzero scale denominator. A constant nonzero line must not look like zero. One point and an empty series need deliberate handling. Do not smooth between values in a way that invents peaks.
- Keep the metric value and series coherent. A period total must equal the sum of its count series. A current snapshot metric must not be presented as a period total. Show comparison percentages only when both periods and denominator are meaningful.
- Provide an accessible name and concise trend summary. Make a compact data table or a clearly discoverable data-details disclosure available when per-date values matter. Do not require mouse hover to read the values. If the SVG only duplicates complete adjacent text, hide it from assistive technology to avoid duplicate announcements.
- Shopify's [data visualization guidance](https://polaris-site-prod-kit.shopify.prod.shopifyapps.com/design/data-visualizations) asks for multiple formats and warns against encoding meaning through color alone. The public Polaris Viz spark components likewise expose an accessibility label; an unlabeled decorative path is not a complete chart contract.
- Render no animation for these small previews unless it answers a concrete user need. Preserve reduced-motion behavior if animation is added later.
- Keep a metric clickable only when an actual supported detail destination exists. Do not nest a data disclosure inside a whole-cell link.

## Proportionate checks

Validate generated Polaris markup with the toolkit at `--version 2.0-rc`, then typecheck the existing app. Inspect populated example, zero, unavailable, one-point and constant-series states at desktop and narrow widths. Check that the chart stays inside each cell and text does not overlap. Exercise disclosure by keyboard if used. Verify period labels, metric/series arithmetic, contrast and accessible names. These checks establish implemented and observed behavior; owner acceptance and release approval remain separate.

## Follow-up after native Orders reference

The parent agent reports a newly inspected native Shopify Orders strip with a date cell, six compact metrics, dotted labels, small right-aligned line charts and subtle vertical separation. This is parent-reported live observation, not an image independently inspected in this research pass. Alongside the inspected Forms screenshot, it strengthens the case for one compact metric band. Separate Search & Discovery tiles are also native, but are less economical for this Home's short activity summary.

Recommended next composition is one native section containing two metric cells, Customized orders and Customized items, divided on desktop. Keep the heading and period outside. Both values and daily lines have direct matching measures. At phone width, keep two compact stacked rows inside the shared section with one horizontal divider. Keep chart, total and label in each row. This preserves the requested line for every displayed metric and removes repeated card outlines and gaps.

Remove Products ordered from the Home summary unless the owner specifically values assortment breadth. Its period-wide distinct count and the daily distinct counts are valid statistics, but the daily points do not add to the period number. Explaining that difference adds work to this tiny summary. This is an editorial recommendation, not a technical prohibition on distinct-count sparklines. If three metrics remain an owner requirement, include a real daily distinct-product line and disclose its exact definition. Do not present it without a chart when the owner asks for a chart on each metric.

For known initial states, omit the activity band and let the existing product/setup or no-customized-orders action lead. Do not build an empty analytics dashboard around onboarding. A zero total for the last 30 days alone does not prove first use or no orders ever. An established merchant with older orders and a true complete zero series can still see a small flat zero activity band. Missing data remains unavailable, not zero.

The bundled [Dashboard checklist](https://www.checklist.design/web-app/dashboard) says to choose the metrics most relevant to user goals and provide their time scope. It does not require three numbers or equal emphasis for every available aggregate. Its empty-state item and the [Empty State checklist](https://www.checklist.design/web-app/empty-state) favor a clear next action and distinguish real absence from an error. This was a source applicability review, not a fresh pixel critique.

Shopify's [visualization guidance](https://polaris-site-prod-kit.shopify.prod.shopifyapps.com/design/data-visualizations) supports a focused chart answering one question, tests with sparse/spiky data, and explicit period context. Its older chart-type heuristics do not override the owner's observed native sparkline request. The recommendation here is to answer how much customization activity occurred and how it varied across days, with Orders as the count of purchases and Items as their volume. Avoid unsupported trend percentages or comparison arrows.
