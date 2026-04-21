# Admin Orders UI — Pencil Design Spec

**Date:** 2026-04-21
**Scope:** `admin-dashboard-order-pages.pen` — Orders Table screen + Order Detail screen
**Output:** Pencil design file used as implementation blueprint for `app/routes/app.orders._index.tsx` and `app/routes/app.orders.$id.tsx`
**Stack:** React Polaris (React components, NOT `s-*` web components — admin app pages, not extensions)

---

## Problem Statement

The admin order management UI needs a complete, unambiguous Pencil design for two screens:
1. **Orders Table** — `app/routes/app.orders._index.tsx`
2. **Order Detail** — `app/routes/app.orders.$id.tsx`

The design must use Shopify Polaris React components precisely — correct props, correct tones, correct layout patterns — so the implementation agent has zero ambiguity. Every component choice must be validated via Shopify MCP before it appears in the design. Visual inspections are mandatory checkpoints, not courtesy reviews.

---

## Execution Approach

Five phases. Visual inspection is a hard stop after each design phase — no proceeding until the screenshot is reviewed and passes.

```
Phase 1 — Component Research (Haiku subagent, Shopify MCP)
Phase 2 — Pencil Component Reference Frame (Sonnet subagent)
           Visual Inspection #1 (main agent — mandatory)
Phase 3 — Orders Table Screen (Sonnet subagent)
           Visual Inspection #2 (main agent — mandatory)
Phase 4 — Order Detail Screen (Sonnet subagent)
           Visual Inspection #3 (main agent — mandatory)
Phase 5 — Cross-screen consistency + implementation annotations (Sonnet subagent)
           Visual Inspection #4 (main agent — final sign-off)
```

Subagent model policy: Haiku for structured MCP lookups (Phase 1). Sonnet for all design composition and corrections. Main agent (Sonnet 4.6) owns every visual inspection — never delegated.

---

## What Gets Validated in Phase 1

The research agent must confirm via Shopify MCP each of the following, outputting exact prop names, valid enum values, deprecation warnings, and any "gotchas" from the live docs:

| Component | Key questions |
|---|---|
| `IndexTable` | Exact props for selectable, headings, bulk actions, row tone, how `tone="warning"` works on rows |
| `Badge` | All valid `tone` values — is `attention` valid or deprecated? What is the amber/pending tone? |
| `Tabs` | Props for controlled tabs, `fitted` vs default, how `selected` + `onSelect` work |
| `Filters` | Full `Filters` component API: `filters`, `appliedFilters`, `onClearAll`, how chips render |
| `ChoiceList` | Works inside `Filters`? Props pattern |
| `Page` | `primaryAction`, `secondaryActions`, `backAction`, `subtitle`, `fullWidth` |
| `Card` | Current API — is it still `<Card>` wrapping children, or `<Card padding>`? Sectioned prop? |
| `Layout` / `Layout.Section` | Two-column pattern: `Layout.Section oneThird`, `twoThirds` — still valid in current Polaris? |
| `InlineStack` / `BlockStack` | `gap` valid values (enum or string?), `align`, `blockAlign` |
| `Text` | `variant` valid values, `tone` valid values (`subdued`, `critical`, etc.) |
| `Button` | `variant`, `tone`, `size`, `submit`, `plain` — any deprecated props? |
| `EmptyState` | Props for image, heading, description, action |
| `Pagination` | Controlled pagination props |
| `TextField` | Search field pattern: `prefix={<Icon>}`, `clearButton`, `autoComplete` |
| `Select` | Date range select pattern |
| `Divider` | Exists in current Polaris? Alternative if not |

Output must be a structured JSON or markdown reference — not prose.

---

## Phase 2 — Component Reference Frame

A dedicated "Polaris Atoms" frame in the Pencil file. This is not decorative — it is the shared vocabulary that both screen frames draw from. Contains:

### Badge variants (all tones in use)
- `tone="attention"` (or correct amber tone) — ARTWORK_PENDING, pending counts
- `tone="success"` — SHIPPED, all artwork provided
- `tone="info"` — ARTWORK_PROVIDED, IN_PRODUCTION
- `tone="warning"` — QUALITY_CHECK
- Default (no tone) — neutral item counts

### Button variants
- `variant="primary"` — Send artwork reminder, Mark as In Production
- `variant="secondary"` (or default) — Print production sheet, View
- `variant="plain"` — Row-level View action, Show more

### Status progression reference
Visual strip showing the five production statuses left-to-right with their Badge tones:
`ARTWORK_PENDING → ARTWORK_PROVIDED → IN_PRODUCTION → QUALITY_CHECK → SHIPPED`

### Two-column layout shell
`Layout` with `Layout.Section variant="twoThirds"` + `Layout.Section variant="oneThird"` — shows the proportion and gap behavior. (Phase 1 research must confirm whether the current Polaris version uses `variant` prop or legacy boolean props like `oneThird={true}`.)

### Line item card anatomy
The card structure used in Order Detail: card header row (thumbnail + name + variant + method badge + production badge), followed by placement rows.

### Placement row anatomy
`InlineStack` with CSS-overlay preview box (180×180px placeholder), placement name, artwork status badge, Upload/Replace button.

---

## Screen 1 — Orders Table

### URL / Route
`/app/orders` → `app/routes/app.orders._index.tsx`

### Page shell
```
<Page title="Orders" fullWidth>
  <Layout>
    <Layout.Section>
      <Card padding="0">
        <Tabs> ... </Tabs>
        <Filters> ... </Filters>
        <IndexTable> ... </IndexTable>
        <Pagination> ... </Pagination>
      </Card>
    </Layout.Section>
  </Layout>
</Page>
```

### Tabs
Two tabs, `fitted` layout:
- **Awaiting Artwork** (default selected) — `tab="awaiting"`
- **All Orders** — no tab param

### Filters bar
```
<Filters
  queryValue={search}
  queryPlaceholder="Search orders by number or customer"
  filters={[
    { key: "methodId", label: "Decoration method", filter: <ChoiceList> },
    { key: "dateRange", label: "Date range",        filter: <ChoiceList> },
    { key: "artworkStatus", label: "Artwork status", filter: <ChoiceList> },
  ]}
  appliedFilters={[...chips]}
  onClearAll={...}
/>
```
Applied filter chips render automatically below the Filters bar.

### IndexTable columns

| # | Heading | `alignment` | Content |
|---|---|---|---|
| 1 | Order | left | `#1042` in `<Text fontWeight="bold">` + date below in `<Text tone="subdued" variant="bodySm">` |
| 2 | Customer | left | Name + email below in `<Text tone="subdued" variant="bodySm">` |
| 3 | Items | left | `<Badge>3 items</Badge>` (no tone) |
| 4 | Decoration | left | Method name(s), plain text |
| 5 | Artwork | left | `<Badge tone="attention">2 pending</Badge>` OR `<Badge tone="success">All provided</Badge>` |
| 6 | Production | left | Single `<Badge>` with worst-case status tone (see status model) |
| 7 | Fee | right | Right-aligned currency string (e.g. `€28.00`) |
| 8 | — | right | `<Button variant="plain">View</Button>` |

### Row states
- Normal row: default IndexTable.Row
- Row with any ARTWORK_PENDING line: `<IndexTable.Row tone="warning">` — this applies the amber row background

### Bulk actions
```
promotedBulkActions={[
  { content: "Mark as In Production", onAction: handleBulkMarkInProduction }
]}
bulkActions={[
  { content: "Export selected", onAction: handleExport }
]}
```

### Empty states
Two distinct `<EmptyState>` components:
1. **No orders at all** — heading "No customization orders yet", description about placing a test order
2. **No results for filter** — heading "No orders match your filters", action "Clear filters"

### Design states to show in Pencil
- Primary state: table with 3 sample rows (mixed statuses, one warning-tone row)
- Bulk actions bar active (2 rows selected)
- Empty — no orders
- Empty — filtered to zero

---

## Screen 2 — Order Detail

### URL / Route
`/app/orders/:id` → `app/routes/app.orders.$id.tsx`

### Page shell
```
<Page
  backAction={{ content: "Orders", url: "/app/orders" }}
  title="Order #1042"
  subtitle="Sophie Klass · 14 April 2026"
  primaryAction={{ content: "Send artwork reminder", onAction }}
  secondaryActions={[{ content: "Print production sheet", url: "...", external: true }]}
>
  <Layout>
    {/* Full-width banner slot — only rendered when hasPendingArtwork === true */}
    <Layout.Section>
      <Banner tone="warning" title="Awaiting artwork">
        {pendingCount} item{pendingCount > 1 ? "s" : ""} still need artwork from the customer.
      </Banner>
    </Layout.Section>
    <Layout.Section variant="twoThirds">
      {/* Line item cards */}
    </Layout.Section>
    <Layout.Section variant="oneThird">
      {/* Sidebar */}
    </Layout.Section>
  </Layout>
</Page>
```

`primaryAction` is context-sensitive:
- Any PENDING_CUSTOMER artwork → "Send artwork reminder"
- All artwork provided, not all shipped → "Mark all as In Production"
- All shipped → omit `primaryAction` prop entirely (no button rendered, not disabled)

`Page.subtitle` prop must be validated in Phase 1 — if absent from current Polaris, use `titleMetadata` with a `Text` element instead.

### Left column — Line item cards

Each `<Card>` contains one `OrderLineCustomization`:

**Card header row** (`<InlineStack align="space-between" blockAlign="start">`):
- Left: `<InlineStack gap="300">` — 48×48px product thumbnail placeholder + `<BlockStack gap="100">` with product name (`<Text variant="headingSm" fontWeight="semibold">`), variant + method line (`<Text variant="bodySm" tone="subdued">`), qty line
- Right: `<InlineStack gap="200">` — method `<Badge>` + production status `<Badge>` with correct tone

**Placement rows** (flat list, not nested, `<BlockStack gap="300">`):

Each placement row is an `<InlineStack gap="300" blockAlign="center">`:
- 180×180px CSS overlay preview box (position:relative container, product img fills it, logo img absolutely positioned)
- `<BlockStack gap="100">`:
  - Placement name + size label (`<Text variant="bodySm" tone="subdued">`)
  - Artwork status badge: `<Badge tone="success">Provided</Badge>` or `<Badge tone="attention">Awaiting artwork</Badge>`
  - `<Button variant="plain" size="slim">Upload artwork</Button>` (when pending) or `<Button variant="plain" size="slim">Replace</Button>` (when provided)

**Card footer** (only when all placements for this line have artwork):
`<Button tone="success" variant="primary">Mark as In Production</Button>`
Phase 1 must validate that `Button` accepts `tone="success"` alongside `variant="primary"` in the current Polaris version — fallback is `variant="primary"` without tone (standard blue primary).

**Multi-item collapse:** First 3 cards expanded. 4th+ collapsed. A `<Button variant="plain">Show 2 more items</Button>` reveals them.

### Right column — Sidebar

**Order Summary card** (`<Card>`):
```
<BlockStack gap="400">
  <Text variant="headingSm" fontWeight="semibold">Order summary</Text>
  <BlockStack gap="200">
    [Customer name]     [email subdued]
    [Order total]       [€ amount]
    [Customisation fee] [€ amount]
  </BlockStack>
  <Button url="https://admin.shopify.com/..." external>View in Shopify</Button>
</BlockStack>
```

**Production Notes card** (`<Card>`):
```
<BlockStack gap="400">
  <Text variant="headingSm" fontWeight="semibold">Production notes</Text>
  <BlockStack gap="200">
    {notes.map(note => (
      <BlockStack gap="100">
        <Text variant="bodySm" tone="subdued">[Author · timestamp]</Text>
        <Text variant="bodySm">[Note content]</Text>
      </BlockStack>
    ))}
  </BlockStack>
  {/* Form wrapper required — useSubmit posts to the page action */}
  <Form method="post">
    <input type="hidden" name="intent" value="save-note" />
    <BlockStack gap="200">
      <TextField multiline={3} label="Add a note" labelHidden placeholder="Add a note..." name="note" />
      <Button submit>Save note</Button>
    </BlockStack>
  </Form>
</BlockStack>
```
Note: `save-note` is a new intent (not yet implemented). The design shows the UI; backend implementation is separate from this design spec.

### Design states to show in Pencil
- Primary state: 2 line items, mixed placements (one provided, one pending), both expanded, artwork warning banner visible
- All-provided state: all badges green, "Mark all as In Production" primary action active, no warning banner
- Collapsed multi-item: 3 expanded + "Show 2 more" button visible below third card

---

## Visual Inspection Protocol

Each inspection is performed by the main agent using `mcp__pencil__get_screenshot` to capture the Pencil canvas, then comparing against:
1. Shopify Polaris documentation screenshots (fetched via Shopify MCP)
2. The component reference frame

**Pass criteria for each inspection:**
- No fabricated component that doesn't exist in Polaris (e.g. fake `<StatusStepper>`)
- Badge tones match the spec exactly (`attention` for pending, `success` for provided, `info` for in-progress)
- `IndexTable.Row tone="warning"` used for ARTWORK_PENDING rows (not custom CSS)
- Two-column layout uses `Layout.Section variant="twoThirds"/"oneThird"` not custom flex
- `Page` component carries the primary/secondary actions (not a custom header)
- Spacing follows the Polaris spacing scale (gap values from the validated reference)
- Every interactive element is a real Polaris component, not a styled div

**Fail criteria (blocks proceeding):**
- Any component whose props could not be validated via Shopify MCP
- Color values not from the Polaris token set
- Layout patterns that contradict Polaris documentation

---

## Annotation Layer

Each screen frame in Pencil must include an annotation overlay (separate from the design) that the implementation agent reads:
- Component name + key props for every non-obvious element
- State-driving conditions ("shown when `hasPendingArtwork === true`")
- Data binding notes ("Badge content = `order.pendingArtworkCount + ' pending'`")
- Any constraint notes ("CSS overlay: position:relative on Box, logo img absolutely positioned using centerXPercent/centerYPercent geometry")

---

## Out of Scope

- Production notes backend implementation — the `save-note` intent and its Prisma persistence are a new feature; this spec covers the UI design only
- Artwork upload flow (DropZone) — present in detail page as button only; upload modal is existing code
- Print sheet — linked button only, no design for the print page itself
- Mobile responsive design — Polaris handles responsiveness; design targets desktop 1280px+
- Admin block extension — already implemented and shipped

---

## Success Criteria

1. A Pencil file with three frames: Component Reference, Orders Table, Order Detail
2. Every component validated via Shopify MCP before placement
3. Four visual inspections passed (component frame + each screen + final consistency)
4. Annotation overlay on each screen frame complete enough that the implementation agent requires no design clarification
