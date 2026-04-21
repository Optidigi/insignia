# Polaris React Component Reference

**Source authority:** Existing working code in `app/routes/app.orders._index.tsx` + `app/routes/app.orders.$id.tsx` (ground truth — these compile and run), supplemented by Context7 Polaris React docs and the v11→v12 migration guide.

**CRITICAL:** This document covers `@shopify/polaris` React components. Do NOT confuse with `s-*` Polaris web components (those are for Admin Block/App Home extensions). The admin app pages (`app/routes/app.*`) use React Polaris exclusively.

---

## Badge

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `tone` | string | `"info"` `"success"` `"attention"` `"warning"` `"critical"` `"new"` | `"attention"` = amber/yellow — CONFIRMED valid in React Polaris. Do NOT use `"caution"` (that is s-* web component API). |
| `children` | ReactNode | string | Badge label text |

**Use in this project:**
- `tone="attention"` → ARTWORK_PENDING, pending artwork counts (amber)
- `tone="success"` → SHIPPED, all artwork provided (green)
- `tone="info"` → ARTWORK_PROVIDED, IN_PRODUCTION (blue)
- `tone="warning"` → QUALITY_CHECK (orange)
- No tone → neutral item counts

**Gotchas:** React Polaris `tone="attention"` = amber. Web component (`s-badge`) uses `tone="caution"` for amber. They are different APIs — never mix them.

---

## IndexTable

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `resourceName` | object | `{ singular: string, plural: string }` | Required |
| `itemCount` | number | — | Total item count for accessibility |
| `headings` | array | `[{ title: string, alignment?: "start"\|"center"\|"end" }]` | Column headers. Use `alignment: "end"` for right-aligned columns |
| `selectedItemsCount` | number \| "All" | — | Pass `allResourcesSelected ? "All" : selectedResources.length` |
| `onSelectionChange` | function | — | From `useIndexResourceState` |
| `promotedBulkActions` | array | `[{ content: string, onAction: fn }]` | Shown prominently when rows selected |
| `bulkActions` | array | `[{ content: string, onAction: fn }]` | In overflow menu when rows selected |
| `hasZebraStriping` | boolean | — | Alternating row background (currently used in app) |

### IndexTable.Row

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `id` | string | — | Required — unique row identifier |
| `position` | number | — | Required — zero-indexed position for shift-selection |
| `selected` | boolean \| "indeterminate" | — | From `selectedResources.includes(id)` |
| `tone` | string | `"subdued"` `"success"` `"warning"` `"critical"` | Row background color. **`"warning"`** = amber background for ARTWORK_PENDING rows. NOT `"attention"` — that is Badge-only |
| `onNavigation` | function | `(id: string) => void` | Fires when row is clicked on primary link |
| `onClick` | function | `() => void` | Overrides default click |

### IndexTable.Cell

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `alignment` | string | `"start"` `"center"` `"end"` | Use `"end"` for right-aligned cells (Fee column, Date column) |

**Confirmed usage from existing code:**
```tsx
<IndexTable.Row
  id={order.shopifyOrderId}
  position={idx}
  selected={selectedResources.includes(order.shopifyOrderId)}
  onNavigation={() => navigate(`/app/orders/${encodedId}`)}
>
  <IndexTable.Cell>...</IndexTable.Cell>
  <IndexTable.Cell>
    <Text as="span" alignment="end" numeric>...</Text>
  </IndexTable.Cell>
</IndexTable.Row>
```

**Gotchas:** `IndexTable.Row tone="warning"` for amber row background — NOT `tone="attention"`. The tone values for rows are completely separate from Badge tone values.

---

## Page

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `title` | string | — | Page heading |
| `titleMetadata` | ReactNode | — | Rendered inline after title — use for Badge or status indicator. **`subtitle` prop does NOT exist in current Polaris.** |
| `backAction` | object | `{ content: string, url: string }` | Back navigation link |
| `primaryAction` | object | `{ content: string, onAction: fn }` \| ReactNode | Primary CTA in page header |
| `secondaryActions` | array | `[{ content: string, url?: string, external?: boolean, onAction?: fn }]` | Secondary actions |
| `fullWidth` | boolean | — | Removes max-width constraint |

**Confirmed usage from existing code:**
```tsx
<Page
  title={`Order ${orderName}`}
  backAction={{ content: "Orders", url: "/app/orders" }}
  secondaryActions={[{
    content: "Print production sheet",
    url: `/app/orders/.../print`,
    external: true,
  }]}
  titleMetadata={<Badge tone="attention">Artwork pending</Badge>}
>
```

**Gotchas:**
- NO `subtitle` prop. Use `titleMetadata` for a Badge next to the title.
- For a customer name + date line BELOW the title, place it as the first element inside the page body (e.g., a `<Text tone="subdued">` in a Box above the Layout, or use `Page.Header` if needed).

---

## Layout and Layout.Section

| Component | Prop | Type | Valid values | Notes |
|---|---|---|---|---|
| `Layout` | — | — | — | Container — no props needed |
| `Layout.Section` | `variant` | string | `"oneThird"` `"twoThirds"` `"oneHalf"` | Confirmed from Context7 docs. Default (no variant) = full width |

**Confirmed from Context7 (SkeletonPage example — current Polaris v12 API):**
```tsx
<Layout>
  <Layout.Section>
    {/* full width — use for Banner */}
  </Layout.Section>
  <Layout.Section variant="twoThirds">
    {/* ~65% — left main column */}
  </Layout.Section>
  <Layout.Section variant="oneThird">
    {/* ~35% — right sidebar */}
  </Layout.Section>
</Layout>
```

**Gotchas:** Old boolean props (`oneThird={true}`, `twoThirds={true}`) are the v11 API. Current v12 uses `variant="oneThird"`. Do NOT use the boolean form.

---

## Card

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `padding` | string | `"0"` `"200"` `"400"` etc. | `padding="0"` makes table extend edge-to-edge. Confirmed in existing code. |
| `children` | ReactNode | — | Card content — no `sectioned` prop in v12 |

**Confirmed usage:**
```tsx
<Card padding="0">
  <IndexTable ...>
</Card>
<Card>
  <BlockStack gap="200">...</BlockStack>
</Card>
```

---

## Tabs

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `tabs` | array | `[{ id: string, content: string, panelID: string }]` | Tab definitions |
| `selected` | number | — | Index of selected tab |
| `onSelect` | function | `(index: number) => void` | Tab change handler |
| `fitted` | boolean | — | Tabs expand to fill container width |

**Confirmed usage from existing code:**
```tsx
const ORDER_TABS = [
  { id: "all", content: "All orders", panelID: "all-orders" },
  { id: "awaiting", content: "Awaiting Artwork", panelID: "awaiting-artwork" },
];
<Tabs tabs={ORDER_TABS} selected={activeTabIndex} onSelect={handleTabChange} />
```

---

## Filters

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `queryValue` | string | — | Search field value |
| `queryPlaceholder` | string | — | Search placeholder |
| `onQueryChange` | function | — | Search change handler |
| `onQueryClear` | function | — | Clear search handler |
| `hideQueryField` | boolean | — | Hides the built-in query field (use when search is handled separately with a TextField) |
| `filters` | array | `[{ key, label, filter: ReactNode, shortcut?: boolean }]` | Filter definitions |
| `appliedFilters` | array | `[{ key: string, label: string, onRemove: fn }]` | Active filter chips shown below bar |
| `onClearAll` | function | — | Clear all filters |

**Important pattern from existing code:** The app uses `hideQueryField` and places a separate `<TextField>` above the `<Filters>` for the search input. The `<Filters>` component only renders the filter buttons + applied chips.

**Confirmed usage from existing code:**
```tsx
<Filters
  queryValue=""
  queryPlaceholder=""
  onQueryChange={() => {}}
  onQueryClear={() => {}}
  hideQueryField
  filters={[{
    key: "artworkStatus",
    label: "Artwork status",
    filter: <ChoiceList .../>,
    shortcut: true,
  }]}
  appliedFilters={artworkStatus ? [{ key: "artworkStatus", label: "...", onRemove: fn }] : []}
  onClearAll={handleClearAllFilters}
/>
```

---

## ChoiceList

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `title` | string | — | List heading |
| `titleHidden` | boolean | — | Hides the title visually |
| `choices` | array | `[{ label: string, value: string }]` | Options |
| `selected` | array | string[] | Selected values |
| `allowMultiple` | boolean | — | Multi-select |
| `onChange` | function | `(selected: string[]) => void` | Change handler |

---

## InlineStack

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `gap` | string | `"100"` `"200"` `"300"` `"400"` `"500"` etc. | Spacing scale. `"100"`=4px, `"200"`=8px, `"300"`=12px, `"400"`=16px |
| `align` | string | `"start"` `"center"` `"end"` `"space-between"` `"space-around"` `"space-evenly"` | Horizontal alignment |
| `blockAlign` | string | `"start"` `"center"` `"end"` `"baseline"` `"stretch"` | Vertical alignment |
| `wrap` | boolean | — | Allow wrapping to next line |

---

## BlockStack

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `gap` | string | `"100"` `"200"` `"300"` `"400"` `"500"` etc. | Same spacing scale as InlineStack |
| `align` | string | `"start"` `"center"` `"end"` `"space-between"` | Main axis (vertical) alignment |
| `inlineAlign` | string | `"start"` `"center"` `"end"` `"stretch"` | Cross axis (horizontal) alignment |

---

## Text

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `variant` | string | `"bodyMd"` `"bodySm"` `"bodyLg"` `"headingSm"` `"headingMd"` `"headingLg"` `"headingXl"` `"heading2xl"` `"heading3xl"` | Typography scale |
| `tone` | string | `"subdued"` `"success"` `"critical"` `"caution"` `"magic"` `"text-inverse"` | Text color |
| `fontWeight` | string | `"regular"` `"medium"` `"semibold"` `"bold"` | Font weight |
| `as` | string | `"p"` `"span"` `"h1"` `"h2"` `"h3"` `"h4"` `"h5"` `"h6"` | HTML element |
| `alignment` | string | `"start"` `"center"` `"end"` `"justify"` | Text alignment |
| `numeric` | boolean | — | Tabular numbers for alignment |

---

## Button

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `variant` | string | `"primary"` `"secondary"` `"tertiary"` `"plain"` `"monochromePlain"` | Visual style. Default (no variant) renders standard outlined button |
| `tone` | string | `"success"` `"critical"` | Applies color tone. `variant="primary" tone="success"` = green primary button (was `primarySuccess` in v11). `tone="critical"` = destructive red |
| `size` | string | `"slim"` `"medium"` `"large"` | Button size |
| `submit` | boolean | — | Submits parent form |
| `url` | string | — | Renders as anchor tag |
| `external` | boolean | — | Opens in new tab (use with `url`) |
| `disabled` | boolean | — | Disabled state |
| `icon` | IconSource | — | Polaris icon |
| `onClick` | function | — | Click handler |

**Confirmed from v11→v12 migration guide:**
```tsx
// Green primary button (was primarySuccess):
<Button variant="primary" tone="success">Mark as In Production</Button>
// Plain text link button (was plain={true}):
<Button variant="plain">Upload artwork</Button>
// Standard button (no variant = outlined/secondary appearance):
<Button>Print production sheet</Button>
// Destructive (was destructive={true}):
<Button variant="primary" tone="critical">Delete</Button>
```

**Gotchas:** `plain` as a boolean prop is deprecated. Use `variant="plain"`. `primary` as a boolean prop is deprecated. Use `variant="primary"`. `variant="secondary"` may not be valid — use default (no variant) for the secondary style.

---

## EmptyState

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `heading` | string | — | Required — main heading |
| `image` | string | — | Illustration URL. Standard: `"https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"` |
| `action` | object | `{ content: string, onAction: fn }` | Primary CTA button |
| `secondaryAction` | object | `{ content: string, url: string }` | Secondary link |
| `children` | ReactNode | — | Description paragraph content |

**Confirmed usage:**
```tsx
<EmptyState
  heading="No customized orders yet"
  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
>
  <p>Orders with Insignia customizations will appear here.</p>
</EmptyState>
```

---

## Pagination

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `hasPrevious` | boolean | — | Enables Previous button |
| `hasNext` | boolean | — | Enables Next button |
| `onPrevious` | function | — | Previous handler |
| `onNext` | function | — | Next handler |

---

## TextField

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `label` | string | — | Required for accessibility |
| `labelHidden` | boolean | — | Visually hides label (still accessible) |
| `placeholder` | string | — | Placeholder text |
| `value` | string | — | Controlled value |
| `onChange` | function | `(value: string) => void` | Change handler |
| `prefix` | ReactNode | — | Left icon/element. Use `<Icon source={SearchIcon} />` |
| `autoComplete` | string | `"off"` `"on"` etc. | Browser autocomplete |
| `clearButton` | boolean | — | Shows × clear button |
| `onClearButtonClick` | function | — | Handler for clear button click |
| `multiline` | number \| boolean | — | `multiline={3}` = 3-row textarea |
| `name` | string | — | Form field name for form submission |

---

## Banner

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `tone` | string | `"warning"` `"success"` `"critical"` `"info"` | Visual tone |
| `title` | string | — | Banner heading |
| `onDismiss` | function | — | Makes banner dismissible with × button |
| `children` | ReactNode | — | Banner body content |

**Confirmed placement from existing code — Banner always goes in a `<Layout.Section>` (full width) BEFORE the two-column sections:**
```tsx
<Layout>
  <Layout.Section>
    <Banner tone="warning" title="Artwork pending">
      <Text as="p">...</Text>
    </Banner>
  </Layout.Section>
  <Layout.Section variant="twoThirds">...</Layout.Section>
  <Layout.Section variant="oneThird">...</Layout.Section>
</Layout>
```

---

## Divider

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `borderColor` | string | `"border"` `"border-secondary"` `"transparent"` | Line color |
| `borderWidth` | string | `"025"` `"050"` `"100"` | Line weight |

Confirmed: `<Divider />` is imported and used in `app/routes/app.orders.$id.tsx`.

---

## Thumbnail

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `source` | string | — | Image URL |
| `alt` | string | — | Alt text |
| `size` | string | `"extraSmall"` `"small"` `"medium"` `"large"` | Size. `"small"` ≈ 40px, `"medium"` ≈ 60px |

Confirmed: `Thumbnail` is imported in `app/routes/app.orders.$id.tsx`. Use `size="small"` for the 48px product thumbnail in card headers.

---

## Box

| Prop | Type | Valid values | Notes |
|---|---|---|---|
| `position` | string | `"relative"` `"absolute"` `"fixed"` | CSS position |
| `width` | string | CSS width string | e.g. `"100%"`, `"180px"` |
| `minWidth` | string | CSS min-width | |
| `padding` | string | spacing scale | |
| `background` | string | Polaris token | e.g. `"bg-surface-secondary"` |
| `borderRadius` | string | radius scale | |
| `overflow` | string | `"hidden"` `"scroll"` | |

**CSS overlay preview pattern:**
```tsx
<Box position="relative" width="180px" minHeight="180px" overflow="hidden" background="bg-surface-secondary">
  <img src={productImageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
  {logoUrl && (
    <img
      src={logoUrl}
      style={{
        position: "absolute",
        left: `calc(${geometry.centerXPercent * 100}% - ${geometry.maxWidthPercent * 50}%)`,
        top: `calc(${geometry.centerYPercent * 100}% - ${(geometry.maxHeightPercent ?? geometry.maxWidthPercent) * 50}%)`,
        width: `${geometry.maxWidthPercent * 100}%`,
      }}
      alt="Logo preview"
    />
  )}
</Box>
```

---

## Summary of Key Spec Corrections

| Spec as written | Correct Polaris API |
|---|---|
| `Page subtitle="Sophie Klass · 14 April 2026"` | NO subtitle prop. Use `titleMetadata` for a Badge, and a `<Text tone="subdued">` as first body element for the customer/date line |
| `Badge tone="attention"` for PENDING | ✅ Correct — `attention` is valid in React Polaris (amber) |
| `Badge tone="caution"` | WRONG for React Polaris — `caution` is s-* web component API only |
| `IndexTable.Row tone="warning"` | ✅ Correct — `warning` is a valid row tone |
| `IndexTable.Row tone="attention"` | WRONG — `attention` is not a valid row tone |
| `Layout.Section oneThird={true}` (boolean prop) | `Layout.Section variant="oneThird"` |
| `Layout.Section twoThirds={true}` (boolean prop) | `Layout.Section variant="twoThirds"` |
| `Button tone="success" variant="primary"` | ✅ Correct — this is the new v12 API for green primary |
| `Button variant="secondary"` | Use `<Button>` with no variant (default = secondary style) |
| `<Button plain>` | `<Button variant="plain">` |
| `<Button primary>` | `<Button variant="primary">` |
| Filters with integrated search field | App pattern: separate `<TextField>` above `<Filters hideQueryField>` |
