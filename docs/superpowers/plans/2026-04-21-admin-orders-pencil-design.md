# Admin Orders UI — Pencil Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, validated Pencil design for the Insignia admin orders UI (Orders Table + Order Detail) in `admin-dashboard-order-pages.pen`, with all Shopify Polaris components verified via MCP and four mandatory dual visual inspections (main agent + Sonnet critic subagent) before sign-off.

**Architecture:** Five design phases separated by hard-stop visual inspections. A Haiku research agent validates every Polaris component before anything is drawn. A Sonnet design agent composes each screen from validated atoms. Every inspection is performed independently by both the main agent and a Sonnet critic subagent — neither is a courtesy pass.

**Tech Stack:** Pencil MCP (`mcp__pencil__*`), Shopify Dev MCP (`mcp__shopify-dev-mcp__*`), Shopify Polaris React (NOT `s-*` web components — these are admin app pages, not extensions), skill `shopify-plugin:shopify-polaris-app-home`

---

## Key Files

| File | Role |
|---|---|
| `admin-dashboard-order-pages.pen` | Target Pencil file — receives all design frames |
| `docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md` | Design spec — authoritative source for all decisions |
| `DESIGN_HANDOFF.md` | UX spec, data shapes, status model, component decisions |
| `app/routes/app.orders._index.tsx` | Orders table route — what this design implements |
| `app/routes/app.orders.$id.tsx` | Order detail route — what this design implements |

**Frames to create in Pencil (in this order):**
1. `Polaris Atoms` — component reference library
2. `Orders Table — Primary` — table with 3 rows, mixed statuses
3. `Orders Table — Bulk Active` — 2 rows selected, bulk bar visible
4. `Orders Table — Empty (No orders)` — EmptyState variant 1
5. `Orders Table — Empty (No results)` — EmptyState variant 2
6. `Order Detail — Primary` — 2 items, mixed artwork, warning banner
7. `Order Detail — All Provided` — all green, Mark all CTA
8. `Order Detail — Collapsed` — 3 expanded + Show more button

---

## Inspection Protocol (applies to ALL inspection tasks)

Every inspection task runs TWO checks in parallel:

**Check A — Main agent (inline):**
1. `mcp__pencil__get_screenshot` to capture the frame(s)
2. `mcp__shopify-dev-mcp__search_docs_chunks` to fetch Polaris reference for each component shown
3. Compare each component in the screenshot against Polaris docs — check props, tones, layout, spacing
4. Record pass/fail per criterion (list from spec `## Visual Inspection Protocol` section)

**Check B — Sonnet critic subagent (parallel):**
- Dispatch a Sonnet agent with the prompt from the task's "Critic subagent prompt" block
- The critic has NO access to this conversation context — it works from the prompt alone
- The critic uses `shopify-plugin:shopify-polaris-app-home` skill + Pencil screenshot tool

**Merge:** Collect both reports. Any FAIL from either check blocks the next phase. Issues go to a Sonnet correction subagent, then the inspection re-runs. Do not proceed until both checks pass.

---

## Task 1: Component Research

**Executor:** Haiku subagent
**Files:** Writes output to `docs/superpowers/specs/2026-04-21-polaris-component-reference.md`

**Haiku subagent prompt:**
```
You are a Polaris component research agent. Use the Shopify Dev MCP tool (mcp__shopify-dev-mcp__search_docs_chunks and mcp__shopify-dev-mcp__learn_shopify_api) to look up the CURRENT documented API for each component below. For each, output a markdown table with columns: Prop | Type | Valid values | Notes/deprecations. Flag any prop that appears in our spec but is not in the current docs. Do NOT use training data — only use what the MCP returns.

Components to research (Polaris React — @shopify/polaris, NOT s-* web components):
1. IndexTable — props: headings, itemCount, selectedItemsCount, onSelectionChange, promotedBulkActions, bulkActions. Sub-component: IndexTable.Row — tone prop, id, selected, position. Sub-component: IndexTable.Cell — alignment prop.
2. Badge — all valid tone values. Is `tone="attention"` valid? Is there a separate amber/warning tone?
3. Tabs — props: tabs, selected, onSelect, fitted
4. Filters — props: queryValue, queryPlaceholder, filters (shape), appliedFilters (shape), onClearAll, onQueryChange, onQueryClear
5. ChoiceList — props: title, choices, selected, allowMultiple, onChange
6. Page — props: title, subtitle (does this exist?), backAction (shape), primaryAction (shape), secondaryActions (shape), fullWidth. If subtitle doesn't exist, what is the correct way to show a subtitle/metadata line?
7. Card — props: padding (valid values?). Is Card still a simple wrapper or does it have sectioned behavior?
8. Layout and Layout.Section — does Layout.Section accept a `variant` prop with values "twoThirds"/"oneThird"? Or is it boolean props (oneThird, twoThirds, oneHalf)? Show the correct current API.
9. InlineStack — props: gap (valid string values from spacing scale), align, blockAlign, wrap
10. BlockStack — props: gap (valid string values), align, inlineAlign
11. Text — props: variant (all valid values), tone (all valid values including subdued, critical, etc.), fontWeight, as
12. Button — props: variant (all valid values), tone (does tone work with variant="primary"?), size, submit, url, external, disabled, plain (deprecated?)
13. EmptyState — props: heading, description, action (shape), image
14. Pagination — props: hasPrevious, hasNext, onPrevious, onNext
15. TextField — props: label, labelHidden, placeholder, prefix, clearButton, multiline, name, autoComplete
16. Banner — props: tone (valid values), title, onDismiss. How is it placed inside Layout?
17. Divider — does it exist? What are its props?

Output format — one section per component:
## ComponentName
| Prop | Type | Valid values | Notes |
| ... |
**Gotchas:** [list anything the spec might get wrong]

Save your output to: docs/superpowers/specs/2026-04-21-polaris-component-reference.md
```

- [ ] **Step 1: Dispatch Haiku research agent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="haiku"`. Provide the full subagent prompt above. The agent must write its output to `docs/superpowers/specs/2026-04-21-polaris-component-reference.md`.

- [ ] **Step 2: Read and validate the reference doc**

Read `docs/superpowers/specs/2026-04-21-polaris-component-reference.md`. Check that all 17 components have been researched and the output covers all the key questions. If any component section is missing or too thin, dispatch a second Haiku agent targeted at that specific gap.

- [ ] **Step 3: Update the design spec with confirmed prop names**

Read `docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md`. Update any component prop that the research found to be wrong or deprecated. Specifically resolve:
- Correct `Badge tone` values (is `attention` valid for amber/pending state?)
- Correct `Layout.Section` API (variant prop or boolean props?)
- Whether `Page` has a `subtitle` prop or requires `titleMetadata`
- Whether `Button tone="success" variant="primary"` is valid

- [ ] **Step 4: Commit the reference doc and any spec updates**

```bash
git add docs/superpowers/specs/2026-04-21-polaris-component-reference.md docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md
git commit -m "docs: add Polaris component reference from MCP research, update design spec with confirmed props"
```

---

## Task 2: Component Reference Frame

**Executor:** Sonnet subagent
**Target:** Frame `Polaris Atoms` in `admin-dashboard-order-pages.pen`

**Sonnet subagent prompt:**
```
You are a Pencil design agent building a Polaris component reference frame. Your task is to create a frame called "Polaris Atoms" in admin-dashboard-order-pages.pen.

BEFORE drawing anything, read these files:
1. docs/superpowers/specs/2026-04-21-polaris-component-reference.md — confirmed Polaris prop values
2. docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md — section "Phase 2 — Component Reference Frame"
3. DESIGN_HANDOFF.md — section "Status Model" and "Polaris Component Decisions"

This frame is not decorative. It is the shared vocabulary both screen frames draw from. Every component shown here must use confirmed props from the reference doc — never invent prop values.

What to include in the Polaris Atoms frame (left to right, organized in rows):

ROW 1 — Badge tones (label each with the tone value and use case):
- Default (no tone): "3 items" — neutral counts
- tone="attention": "2 pending" — ARTWORK_PENDING, pending artwork counts  
- tone="success": "Provided" / "Shipped" — artwork provided, order complete
- tone="info": "In production" — ARTWORK_PROVIDED, IN_PRODUCTION states
- tone="warning": "Quality check" — QUALITY_CHECK state
- Also show the IndexTable.Row tone="warning" as a highlighted row strip with annotation

ROW 2 — Button variants (label each):
- variant="primary": "Send artwork reminder"
- variant="primary" (with success tone if confirmed valid, else standard primary): "Mark as In Production"  
- Default (no variant or "secondary" — use whichever research confirmed): "Print production sheet"
- variant="plain": "View" / "Upload artwork" / "Replace" / "Show 2 more items"

ROW 3 — Status progression strip:
Five boxes left to right showing each production status with its badge:
ARTWORK_PENDING [attention badge] → ARTWORK_PROVIDED [info badge] → IN_PRODUCTION [info badge] → QUALITY_CHECK [warning badge] → SHIPPED [success badge]
Add annotation: "forward-only, no regression"

ROW 4 — Two-column layout shell:
Show the Layout proportions: left column (~65%) labeled "twoThirds — line item cards", right column (~35%) labeled "oneThird — sidebar". Use the confirmed API (variant prop or boolean props).

ROW 5 — Line item card anatomy:
A single card showing:
- Card header: [48px thumb placeholder] | [product name bold] [variant subdued] [qty] | [method badge] [production badge]
- Divider
- Placement row: [180×180 preview box — grey placeholder] | [placement name] [artwork badge] [Upload/Replace button plain]
- Card footer (conditional): [Mark as In Production button — full width]
Label each element with its Polaris component and key props.

ROW 6 — Spacing scale reference:
Show the gap values used in this design: 100, 200, 300, 400 — as visual swatches with pixel equivalents (gap="100" = 4px, "200" = 8px, "300" = 12px, "400" = 16px). These are the ONLY gap values used in the screens.

ROW 7 — Polaris color tokens used:
- Text/icon/background tokens for subdued, critical, success, warning, attention states
- Show as colored swatches with token names

Use mcp__pencil__get_guidelines to understand how to create frames and components. Use mcp__pencil__batch_design for all drawing operations. Keep the frame on a white/light background. Add a title "Polaris Atoms — Component Reference" at the top.

Do NOT proceed to drawing until you have read all three reference files. Do NOT invent prop values — only use what is in the reference doc.
```

- [ ] **Step 1: Verify Pencil file is open**

Use `mcp__pencil__get_editor_state` to confirm `admin-dashboard-order-pages.pen` is the active document. If no document is active or a different file is open, call `mcp__pencil__open_document` with the absolute path to `admin-dashboard-order-pages.pen` before proceeding.

- [ ] **Step 2: Dispatch Sonnet design subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Provide the full subagent prompt above. The subagent prompt already includes the instruction to call `mcp__pencil__get_editor_state` first — if the file is not active it should call `mcp__pencil__open_document` with the path `/Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen`. Add this instruction to the prompt before dispatching: "If admin-dashboard-order-pages.pen is not the active document in mcp__pencil__get_editor_state, call mcp__pencil__open_document with path /Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen before doing any design work."

- [ ] **Step 3: Verify frame was created**

Use `mcp__pencil__get_editor_state` or `mcp__pencil__batch_get` to confirm the "Polaris Atoms" frame exists and has content.

---

## Task 3: Visual Inspection #1 — Component Reference Frame

**Executor:** Main agent (inline) + parallel Sonnet critic subagent
**Blocks:** Task 4 cannot start until this passes

- [ ] **Step 1: Main agent captures screenshot**

Use `mcp__pencil__get_screenshot` to capture the "Polaris Atoms" frame. If the frame is large, capture it in sections.

- [ ] **Step 2: Main agent — fetch Polaris reference screenshots**

Use `mcp__shopify-dev-mcp__search_docs_chunks` to fetch Badge, Button, and IndexTable documentation. Compare:
- Are all 5 badge tones rendered? Do the colors match Polaris badge tones?
- Are button variants visually distinct (primary = filled/blue, plain = no border, default = outlined)?
- Is the status progression strip clearly labeled with correct badge tones per status?
- Is the two-column proportion visually obvious (65/35)?
- Is the line item card anatomy complete (thumb, header, placement row, conditional footer)?
- Do spacing scale swatches show a clear visual difference between gap values?

Record: PASS or FAIL per item. Any FAIL = issue list.

- [ ] **Step 3: Dispatch Sonnet critic subagent in parallel**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Run this in parallel with (or immediately after) the main agent inspection in Step 2:

**Critic subagent prompt:**
```
You are a critical Polaris design reviewer. Your job is to inspect a Pencil design frame and find every deviation from Shopify Polaris standards. Be harsh — "good enough" is not acceptable. Your audience is a developer who will implement exactly what you approve.

STEP 1: Invoke the skill shopify-plugin:shopify-polaris-app-home to load Polaris App Home component documentation. Read it fully before proceeding.

STEP 2: Use mcp__shopify-dev-mcp__search_docs_chunks to look up:
- Badge component: all valid tone values and their visual appearance
- Button component: all valid variant values
- IndexTable: row tone values

STEP 3: Use mcp__pencil__get_screenshot to capture the "Polaris Atoms" frame from admin-dashboard-order-pages.pen. (Use mcp__pencil__get_editor_state first to find the frame.)

STEP 4: Review the screenshot against Polaris documentation. Check each of these — do NOT skip any:

A. Badge tones: Are all tones shown using the correct Polaris tone name? Is the visual color consistent with what Polaris docs show? Flag any tone that appears to use a custom color instead of a Polaris token.

B. Button variants: Does "primary" look filled/solid? Does "plain" look like a text link (no border, no background)? Is there a visually distinct "secondary/default" variant shown? Are there any buttons that look like they were drawn as shapes instead of using Polaris styling?

C. Status progression: Are the 5 production statuses shown? Are the badge tones in this exact order: attention → info → info → warning → success? Is the forward-only constraint annotated?

D. Two-column layout shell: Is the proportion obviously 65/35? Are the columns labeled correctly?

E. Line item card anatomy: Is the thumbnail placeholder 48×48px? Is there a clear separation between card header, placement row, and card footer? Is the 180×180 preview placeholder present in the placement row? Are all component labels (Polaris component name + props) visible?

F. Spacing swatches: Are gap values 100/200/300/400 shown with pixel values? Are they visually distinct?

G. General: Is anything missing from the spec (docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md section "Phase 2")? Is anything present that ISN'T in the spec?

STEP 5: Output a structured report:

## Component Reference Frame — Critic Report

### PASS items (confirmed correct):
- [list each item that passes]

### FAIL items (must be fixed before proceeding):
- [Component/element]: [exact issue] — [what the correct Polaris value should be]

### Missing items:
- [list anything from the spec not present in the frame]

### Verdict: PASS / FAIL
(FAIL if any single FAIL item or missing item exists)
```

- [ ] **Step 4: Merge inspection reports**

Collect main agent report (Step 2) and critic subagent report (Step 3). If either reports FAIL, compile all issues into a single correction list.

- [ ] **Step 5: If FAIL — dispatch correction subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Prepend the Pencil file open instruction. Prompt:
```
You are a Pencil correction agent. Read the following issue list and fix each item in the "Polaris Atoms" frame in admin-dashboard-order-pages.pen. Use mcp__pencil__batch_design to apply corrections. Fix ONLY the listed issues — do not change anything else.

Reference files you must read first:
- docs/superpowers/specs/2026-04-21-polaris-component-reference.md (confirmed prop values)
- docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md (spec)

Issues to fix:
[PASTE MERGED ISSUE LIST]
```

After correction, re-run Steps 1–4. Loop until both checks PASS.

- [ ] **Step 6: Log inspection result**

Append to the plan or a scratch note: `Inspection #1 — PASSED [date] — [N issues found and fixed]`

---

## Task 4: Orders Table Screen

**Executor:** Sonnet subagent
**Target frames:** `Orders Table — Primary`, `Orders Table — Bulk Active`, `Orders Table — Empty (No orders)`, `Orders Table — Empty (No results)`

**Sonnet subagent prompt:**
```
You are a Pencil design agent building the Orders Table admin screen for the Insignia Shopify app. You will create 4 frames in admin-dashboard-order-pages.pen.

REQUIRED READING — read ALL of these before drawing anything:
1. docs/superpowers/specs/2026-04-21-polaris-component-reference.md — confirmed Polaris prop values (use these, not your training data)
2. docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md — section "Screen 1 — Orders Table" (full spec)
3. DESIGN_HANDOFF.md — sections "UX Spec Surface 2 — Order Table" and "Polaris Component Decisions Order Table"
4. app/routes/app.orders._index.tsx — the actual existing route code (read to understand current column names, filter names, data shapes)

FRAME 1: "Orders Table — Primary"
Desktop canvas 1440×900px. Show the full orders table page:

Page header:
- Title "Orders" using Page component (fullWidth)
- No primaryAction on the page header (actions are in the table bulk bar and row-level)

Below the Page title, inside a Card with padding="0":
- Tabs row (fitted): [Awaiting Artwork | All Orders] — Awaiting Artwork selected
- Filters bar: search field left (placeholder "Search orders by number or customer"), filter buttons right (Decoration method, Date range, Artwork status). Applied filter chips shown below if active (show one chip "Embroidery" as example).
- IndexTable with these exact columns and headings:
  Column 1: "Order" — checkbox (select) + order link "#1042" bold + "Apr 14, 2026" subdued below
  Column 2: "Customer" — "Sophie Klass" + "sophie@example.com" subdued below
  Column 3: "Items" — Badge (no tone) "3 items"
  Column 4: "Decoration" — plain text "Embroidery"
  Column 5: "Artwork" — Badge tone="attention" "2 pending"
  Column 6: "Production" — Badge tone="attention" "Awaiting artwork"
  Column 7: "Fee" — "€28.00" right-aligned
  Column 8: (no heading) — Button variant="plain" "View"

Show 3 rows:
  Row 1: #1042 / Sophie Klass / 3 items / Embroidery / 2 pending [attention] / Awaiting artwork [attention] / €28.00 / View — tone="warning" (amber row background)
  Row 2: #1038 / Marcus Dahl / 1 item / DTG / All provided [success] / In production [info] / €12.50 / View — normal row
  Row 3: #1031 / Yuki Tanaka / 2 items / Screen print / All provided [success] / Shipped [success] / €35.00 / View — normal row

Pagination below the table: Previous disabled, showing "1–3 of 3 orders", Next disabled.

FRAME 2: "Orders Table — Bulk Active"
Same as Frame 1 but:
- Rows 1 and 2 are selected (checkboxes checked, row highlighted)
- Bulk actions bar visible between Filters and table: "[2 orders selected] [Mark as In Production] [Export selected] [×]"
- The IndexTable header row shows "2 selected" state

FRAME 3: "Orders Table — Empty (No orders)"
Same Page + Card shell but the IndexTable area is replaced by EmptyState:
- heading="No customization orders yet"
- description="When customers complete a customization in your store, orders will appear here."
- No action button (can't clear orders that don't exist)

FRAME 4: "Orders Table — Empty (No results)"
Same Page + Card shell, Filters bar shows "Embroidery" chip applied. IndexTable area replaced by EmptyState:
- heading="No orders match your filters"
- description="Try adjusting or removing your filters."
- action={{ content: "Clear filters" }} — shows as a button

ANNOTATION REQUIREMENTS (must be included in every frame as a separate annotation layer):
- Label every Polaris component with its component name and key props
- Label state-driving conditions (e.g., "tone='warning' on row when order has ARTWORK_PENDING lines")
- Label data bindings (e.g., "Badge content = order.pendingArtworkCount + ' pending'", "shown when pendingArtworkCount > 0, else Badge tone='success' 'All provided'")
- For the Filters bar: annotate each filter's URL param name (search, methodId, dateRange, artworkStatus)

Use mcp__pencil__get_guidelines and mcp__pencil__batch_design for all operations. Target desktop viewport 1440px wide. Place frames horizontally with 80px gap between them.
```

- [ ] **Step 1: Verify Pencil file is open**

Use `mcp__pencil__get_editor_state` to confirm `admin-dashboard-order-pages.pen` is active. If not, call `mcp__pencil__open_document` with `/Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen`.

- [ ] **Step 2: Dispatch Sonnet design subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Prepend this to the subagent prompt: "If admin-dashboard-order-pages.pen is not the active document in mcp__pencil__get_editor_state, call mcp__pencil__open_document with path /Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen before doing any design work." Then provide the full subagent prompt above.

- [ ] **Step 3: Verify frames were created**

Use `mcp__pencil__get_editor_state` to confirm all 4 frames exist.

---

## Task 5: Visual Inspection #2 — Orders Table

**Executor:** Main agent (inline) + parallel Sonnet critic subagent
**Blocks:** Task 6 cannot start until this passes

- [ ] **Step 1: Main agent captures screenshots**

Use `mcp__pencil__get_screenshot` to capture all 4 Orders Table frames.

- [ ] **Step 2: Main agent — systematic component-by-component check**

For each frame, check:

**Page level:**
- [ ] Page title "Orders" uses Page component (fullWidth)
- [ ] Card has padding="0" — table extends edge-to-edge inside card
- [ ] Tabs are present, "Awaiting Artwork" selected by default, `fitted` layout

**Filters bar:**
- [ ] Search field uses TextField with search icon prefix
- [ ] Three filter buttons present (Decoration method, Date range, Artwork status)
- [ ] Applied chip "Embroidery" visible in Frame 1
- [ ] Filter bar is inside Filters component, not custom layout

**IndexTable:**
- [ ] All 8 columns present with correct headings
- [ ] Column 7 (Fee) is right-aligned
- [ ] Column 8 (View button) is right-aligned, uses Button variant="plain"
- [ ] Row 1 has IndexTable.Row tone="warning" amber background
- [ ] Rows 2–3 have normal (white) background
- [ ] Badge tones: attention for pending, success for provided/shipped, info for in-progress
- [ ] Checkboxes visible in first column (select column)
- [ ] Pagination below table

**Frame 2 (Bulk Active):**
- [ ] Bulk actions bar visible between filters and table
- [ ] Shows correct count "2 orders selected"
- [ ] "Mark as In Production" and "Export selected" bulk action buttons visible
- [ ] Rows 1 and 2 have selected state

**Frame 3 & 4 (Empty states):**
- [ ] EmptyState component used (not a custom layout)
- [ ] Different headings and descriptions for each empty state
- [ ] Frame 4 has a "Clear filters" action button in EmptyState
- [ ] Frame 3 has no action button

**Annotations:**
- [ ] Each major component labeled with Polaris component name + key props
- [ ] State-driving conditions annotated
- [ ] Data bindings annotated

Fetch reference from `mcp__shopify-dev-mcp__search_docs_chunks` for IndexTable, Tabs, Filters to compare.

- [ ] **Step 3: Dispatch Sonnet critic subagent in parallel**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Run in parallel with main agent Step 2 (both take their own screenshots independently). Prompt:

```
You are a critical Polaris design reviewer inspecting the Insignia admin Orders Table screens. Be rigorous — this design becomes the implementation blueprint.

STEP 1: Invoke the skill shopify-plugin:shopify-polaris-app-home. Read the IndexTable, Filters, Tabs, Badge, EmptyState, Page, and Pagination documentation carefully.

STEP 2: Use mcp__shopify-dev-mcp__search_docs_chunks to fetch: "IndexTable row tone warning", "Filters appliedFilters chips", "Tabs fitted", "Page primaryAction secondaryActions". Read the actual returned content.

STEP 3: Use mcp__pencil__get_editor_state to find the Orders Table frames, then use mcp__pencil__get_screenshot to capture all 4 frames ("Orders Table — Primary", "Orders Table — Bulk Active", "Orders Table — Empty (No orders)", "Orders Table — Empty (No results)").

STEP 4: For EACH frame, review against Polaris documentation:

FRAME 1 (Primary) — check ALL of these:
1. Page component: Does the page header look like a real Polaris Page? Is it fullWidth? Is the title "Orders" in the correct Polaris heading style?
2. Card padding="0": Is the table flush with the card edges, or is there padding around it?
3. Tabs: Are tabs rendered as Polaris Tabs (not custom dividers/buttons)? Is fitted layout visible?
4. Filters: Does the filter bar look like the Polaris Filters component? Is there a search field on the left with filter buttons? Do applied chips appear below (one chip "Embroidery")?
5. IndexTable columns: Are there exactly 8 columns? Is the 7th (Fee) right-aligned? Is the 8th column a plain-variant Button?
6. Row 1 warning tone: Does Row 1 have a visible amber/yellow background consistent with IndexTable.Row tone="warning"? This is CRITICAL — the row background must be amber, not just text color change.
7. Badge tones: Is Row 1 Artwork badge tone="attention" (amber)? Is Row 2 Production badge tone="info" (blue)? Is Row 3 Production badge tone="success" (green)?
8. Checkboxes: Is there a select checkbox in every row's first column?
9. Pagination: Is it present below the table?

FRAME 2 (Bulk Active):
1. Is the bulk actions bar visible? Does it show between the filters and table?
2. Does the bulk bar show "2 orders selected"?
3. Are "Mark as In Production" and "Export selected" buttons visible?
4. Are rows 1 and 2 in a selected/highlighted state?

FRAMES 3 & 4 (Empty states):
1. Are EmptyState components used (centered illustration + heading + description)?
2. Frame 3: heading "No customization orders yet", NO action button
3. Frame 4: heading "No orders match your filters", has "Clear filters" action button
4. Are these two empty states visually distinct from each other?

ANNOTATION CHECK (apply to all frames):
1. Is every major component labeled with its Polaris component name?
2. Are state conditions annotated (e.g., when tone="warning" fires)?
3. Are data bindings annotated?

STEP 5: Output report:
## Orders Table — Critic Report

### Frame 1 (Primary) — PASS/FAIL items:
[list each check]

### Frame 2 (Bulk Active) — PASS/FAIL items:
[list each check]

### Frames 3 & 4 (Empty states) — PASS/FAIL items:
[list each check]

### Missing or incorrect items requiring correction:
[specific fix requests with exact Polaris values]

### Overall Verdict: PASS / FAIL
```

- [ ] **Step 4: Merge reports and apply corrections if needed**

Same protocol as Task 3 Step 4–5. Dispatch correction subagent if any FAILs. Re-inspect until both checks PASS.

- [ ] **Step 5: Log inspection result**

`Inspection #2 — PASSED [date] — [N issues found and fixed]`

---

## Task 6: Order Detail Screen

**Executor:** Sonnet subagent
**Target frames:** `Order Detail — Primary`, `Order Detail — All Provided`, `Order Detail — Collapsed`

**Sonnet subagent prompt:**
```
You are a Pencil design agent building the Order Detail admin screen for the Insignia Shopify app. You will create 3 frames in admin-dashboard-order-pages.pen.

REQUIRED READING — read ALL of these before drawing anything:
1. docs/superpowers/specs/2026-04-21-polaris-component-reference.md — confirmed Polaris prop values
2. docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md — section "Screen 2 — Order Detail" (full spec)
3. DESIGN_HANDOFF.md — sections "UX Spec Surface 3 — Order Detail Page" and "Polaris Component Decisions Order Detail Page"
4. app/routes/app.orders.$id.tsx — read the existing route to understand loader data shapes, what's already implemented

FRAME 1: "Order Detail — Primary"
Desktop canvas 1440×1100px (taller than table, more content).

Page header:
- backAction: "← Orders" link
- title: "Order #1042"
- subtitle or metadata line: "Sophie Klass · 14 April 2026" (use confirmed Polaris API from reference doc — if Page.subtitle doesn't exist, use titleMetadata with a Text element)
- primaryAction: Button "Send artwork reminder" (shown because order has pending artwork)
- secondaryActions: ["Print production sheet"] — opens in new tab

Full-width Banner (shown because hasPendingArtwork === true):
Banner tone="warning" title="Awaiting artwork"
"2 items still need artwork from the customer."
(This is the first Layout.Section, full width, above the two-column split)

Two-column Layout below the banner:
LEFT COLUMN (twoThirds — ~65%):

LINE ITEM CARD 1 — "Premium Polo Shirt":
Card containing:
  Header row (InlineStack align="space-between" blockAlign="start"):
    Left: InlineStack gap="300":
      - 48×48px grey thumbnail placeholder (Box with grey background)
      - BlockStack gap="100":
          Text variant="headingSm" fontWeight="semibold": "Premium Polo Shirt"
          Text variant="bodySm" tone="subdued": "Black / M · Embroidery"
          Text variant="bodySm" tone="subdued": "Qty: 2"
    Right: InlineStack gap="200":
      - Badge: "Embroidery" (no tone — method label)
      - Badge tone="attention": "Awaiting artwork"
  
  Divider below header row.
  
  Placement rows (BlockStack gap="300"):
    Placement 1 — Left Chest (pending):
      InlineStack gap="300" blockAlign="center":
        Box 180×180px (position:relative — grey background, annotation: "CSS overlay — product img + logo img absolutely positioned using centerXPercent/centerYPercent"):
          Inside: small annotation text "Product preview"
        BlockStack gap="100":
          Text variant="bodySm" tone="subdued": "Left Chest (Small)"
          Badge tone="attention": "Awaiting artwork"
          Button variant="plain" size="slim": "Upload artwork"
    
    Placement 2 — Back (provided):
      InlineStack gap="300" blockAlign="center":
        Box 180×180px (show a logo overlay — use a colored rectangle inside to simulate logo):
        BlockStack gap="100":
          Text variant="bodySm" tone="subdued": "Full Back (Large)"
          Badge tone="success": "Provided"
          Button variant="plain" size="slim": "Replace"
  
  No card footer on this card (not all placements provided).

LINE ITEM CARD 2 — "Classic Cap":
Card containing:
  Header row same structure:
    Product name: "Classic Cap"
    Variant/method: "One size · DTG"
    Qty: 1
    Right badges: Badge "DTG" (no tone) + Badge tone="success" "In production" 
  
  Divider.
  
  Placement row:
    Placement 1 — Front Panel (provided):
      Box 180×180px with simulated logo
      BlockStack gap="100":
        Text: "Front Panel (Medium)"
        Badge tone="success": "Provided"
        Button variant="plain" size="slim": "Replace"
  
  Card footer (all placements provided for this item):
    Button (primary, success tone if valid, else standard primary): "Mark as In Production"
    Full-width inside the card.

RIGHT COLUMN (oneThird — ~35%):

Order Summary Card:
  Card containing BlockStack gap="400":
    Text variant="headingSm" fontWeight="semibold": "Order summary"
    BlockStack gap="200":
      InlineStack align="space-between":
        Text: "Sophie Klass"
        Text tone="subdued": "sophie@example.com"
      InlineStack align="space-between":
        Text tone="subdued": "Order total"
        Text fontWeight="semibold": "€74.50"
      InlineStack align="space-between":
        Text tone="subdued": "Customisation fee"
        Text fontWeight="semibold": "€40.50"
      Divider
      InlineStack align="space-between":
        Text tone="subdued": "Total paid"
        Text fontWeight="bold": "€115.00"
    Button url="https://admin.shopify.com/..." external: "View in Shopify ↗"

Production Notes Card:
  Card containing BlockStack gap="400":
    Text variant="headingSm" fontWeight="semibold": "Production notes"
    BlockStack gap="200" (existing note):
      BlockStack gap="100":
        Text variant="bodySm" tone="subdued": "Admin · Apr 14, 12:30"
        Text variant="bodySm": "Customer prefers matte finish on embroidery thread."
    Form method="post" (annotation: intent="save-note"):
      input hidden name="intent" value="save-note" (annotation only)
      BlockStack gap="200":
        TextField multiline=3 label="Add a note" labelHidden placeholder="Add a note..."
        Button submit: "Save note"

FRAME 2: "Order Detail — All Provided"
Same layout as Frame 1 but:
- No warning Banner (all artwork provided)
- primaryAction changes to "Mark all as In Production"
- Both line item cards show all badges as tone="success"
- Both cards show the card footer "Mark as In Production" button
- All placement rows show Badge tone="success" "Provided" + "Replace" button

FRAME 3: "Order Detail — Collapsed"
Same as Frame 1 layout but with 5 line items:
- Show 3 line item cards expanded (same as Frame 1's two cards + one more)
- Below the 3rd card, show: Button variant="plain": "Show 2 more items" (centered or left-aligned)
- The 4th and 5th cards are NOT rendered (collapsed)
- Annotation: "items 4+ collapsed — expanded state managed by useState<Record<string, boolean>>"

ANNOTATION REQUIREMENTS (all frames):
Every frame must have an annotation layer:
- Component name + key props for every non-obvious element
- State-driving conditions (Banner: "shown when hasPendingArtwork === true", Card footer: "shown when all placements for this line have artwork", primaryAction: context-sensitive logic)
- Data bindings (Badge content, placeholder sizes, Form intent values)
- CSS overlay note on every 180×180 preview box
- Layout.Section variant values labeled on the columns

Use mcp__pencil__get_guidelines and mcp__pencil__batch_design. Target 1440px wide desktop. Place frames horizontally with 80px gap.
```

- [ ] **Step 1: Verify Pencil file is open**

Use `mcp__pencil__get_editor_state` to confirm `admin-dashboard-order-pages.pen` is active. If not, call `mcp__pencil__open_document` with `/Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen`.

- [ ] **Step 2: Dispatch Sonnet design subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Prepend to the subagent prompt: "If admin-dashboard-order-pages.pen is not the active document in mcp__pencil__get_editor_state, call mcp__pencil__open_document with path /Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen before doing any design work." Then provide the full subagent prompt above.

- [ ] **Step 3: Verify frames were created**

Use `mcp__pencil__get_editor_state` to confirm all 3 frames exist.

---

## Task 7: Visual Inspection #3 — Order Detail

**Executor:** Main agent (inline) + parallel Sonnet critic subagent
**Blocks:** Task 8 cannot start until this passes

- [ ] **Step 1: Main agent captures screenshots**

Use `mcp__pencil__get_screenshot` to capture all 3 Order Detail frames.

- [ ] **Step 2: Main agent — systematic check**

**Page level:**
- [ ] Page has backAction "← Orders", title "Order #1042", subtitle/metadata, primaryAction "Send artwork reminder"
- [ ] secondaryActions contains "Print production sheet"
- [ ] Full-width warning Banner is the FIRST Layout.Section (above two columns) in Frame 1
- [ ] No Banner in Frame 2 (All Provided)
- [ ] Frame 2 primaryAction = "Mark all as In Production"

**Two-column layout:**
- [ ] Left column is clearly wider (~65%) than right (~35%)
- [ ] Two line item cards in Frame 1 left column
- [ ] Both sidebar cards (Order Summary + Production Notes) in right column

**Line item cards:**
- [ ] 48×48px thumbnail placeholder present in each card header
- [ ] Card header right side has TWO badges (method + production status)
- [ ] Divider between header and placement rows
- [ ] Placement rows have 180×180 preview boxes — correct size, annotation present
- [ ] Card 1 (Polo Shirt): Left Chest = attention badge + "Upload artwork" button; Back = success badge + "Replace" button
- [ ] Card 1: NO card footer (not all placements provided)
- [ ] Card 2 (Cap): all placements success; card footer "Mark as In Production" button visible
- [ ] Badge tones exactly match spec (attention for pending, success for provided)

**Sidebar:**
- [ ] Order summary shows customer name, email, order total, customisation fee, total paid with divider
- [ ] "View in Shopify" button present (external link)
- [ ] Production notes card shows existing note (author + timestamp + content)
- [ ] TextField multiline + "Save note" button present
- [ ] Form wrapper annotated with intent="save-note"

**Frame 3 (Collapsed):**
- [ ] Exactly 3 cards expanded
- [ ] "Show 2 more items" plain button visible below 3rd card
- [ ] No 4th/5th cards rendered

**Annotations:**
- [ ] CSS overlay annotation on 180×180 boxes
- [ ] primaryAction context logic annotated
- [ ] Banner conditional render annotated
- [ ] Card footer condition annotated

- [ ] **Step 3: Dispatch Sonnet critic subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Run in parallel with main agent Step 2. Prompt:

```
You are a critical Polaris design reviewer inspecting the Insignia admin Order Detail screens. Be rigorous and thorough.

STEP 1: Invoke the skill shopify-plugin:shopify-polaris-app-home. Read the Page, Layout, Card, Banner, InlineStack, BlockStack, Badge, Button, TextField documentation.

STEP 2: Use mcp__shopify-dev-mcp__search_docs_chunks to look up:
- "Page backAction primaryAction secondaryActions"
- "Layout Section twoThirds oneThird"
- "Banner tone placement inside Layout"
- "Card padding"
- "InlineStack align space-between blockAlign"

Read the actual returned content from these queries.

STEP 3: Use mcp__pencil__get_editor_state to find Order Detail frames, then mcp__pencil__get_screenshot for all 3 frames ("Order Detail — Primary", "Order Detail — All Provided", "Order Detail — Collapsed").

STEP 4: Review EACH frame against Polaris documentation AND the spec at docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md (section "Screen 2 — Order Detail"):

FRAME 1 (Primary) — check ALL:
1. Page header: Does it look like a real Polaris Page component? Is the back link present? Is the title large and prominent? Is primaryAction a prominent button in the header? Is secondaryActions rendered as a secondary button/dropdown?
2. Warning Banner: Is it FULL WIDTH (spanning both columns)? Is it the FIRST element below the Page header, before the two columns start? Is the tone="warning" orange/amber color correct?
3. Two-column split: Is the left column obviously wider than the right? Does this look like the standard Polaris two-column layout? Is there appropriate gutter space between columns?
4. Line item cards: Are they Card components (with the characteristic Polaris card shadow/border)? Is there a clear visual hierarchy: header → divider → placement rows → footer?
5. Card headers: Is the 48×48 thumbnail placeholder clearly a square? Is the product name in a larger/bolder weight than the variant/method line? Are the two right-side badges (method + production status) visually distinct from each other?
6. 180×180 preview boxes: Are they square? Is there a visible annotation explaining the CSS overlay technique? Are they clearly different from the 48×48 thumbnail in the header?
7. Placement rows: Is "Upload artwork" shown for the pending placement and "Replace" for the provided one? Do the plain buttons look like Polaris plain variant (text only, no border)?
8. Card 1 footer: Is the "Mark as In Production" footer ABSENT from Card 1 (not all placements have artwork)?
9. Card 2 footer: Is the "Mark as In Production" button present in Card 2 (all placements provided)? Does it span the full card width?
10. Order Summary sidebar card: Are the rows InlineStack with space-between alignment (label left, value right)? Is there a Divider before "Total paid"? Is the "View in Shopify" button present?
11. Production Notes sidebar card: Is there a rendered note showing author + timestamp + content? Is there a TextField with multiline appearance? Is "Save note" a submit button?

FRAME 2 (All Provided):
1. Is the Banner ABSENT?
2. Is the primaryAction "Mark all as In Production" (not "Send artwork reminder")?
3. Are ALL badge tones success (green)?
4. Are BOTH cards showing the "Mark as In Production" footer button?

FRAME 3 (Collapsed):
1. Are exactly 3 cards visible and expanded?
2. Is there a "Show 2 more items" plain button visible below card 3?
3. Are cards 4 and 5 NOT rendered?
4. Is the collapse state annotated?

ANNOTATION CHECK (all frames):
1. CSS overlay annotation on 180×180 boxes?
2. primaryAction context logic annotated?
3. Banner conditional render annotated?
4. Card footer condition annotated?
5. Layout column variant values labeled?

STEP 5: Output structured report:
## Order Detail — Critic Report

### Frame 1 (Primary):
[check-by-check PASS/FAIL]

### Frame 2 (All Provided):
[check-by-check PASS/FAIL]

### Frame 3 (Collapsed):
[check-by-check PASS/FAIL]

### Issues requiring correction:
[specific fixes with Polaris values]

### Overall Verdict: PASS / FAIL
```

- [ ] **Step 4: Merge and correct**

Same correction protocol as Tasks 3 and 5. Loop until both checks PASS.

- [ ] **Step 5: Log inspection result**

`Inspection #3 — PASSED [date] — [N issues found and fixed]`

---

## Task 8: Cross-Screen Consistency and Annotation Polish

**Executor:** Sonnet subagent

**Sonnet subagent prompt:**
```
You are a Pencil polish agent. Your job is to review ALL frames in admin-dashboard-order-pages.pen for cross-screen consistency, then add any missing annotations.

Read first:
- docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md — full spec
- docs/superpowers/specs/2026-04-21-polaris-component-reference.md — confirmed props

Use mcp__pencil__get_editor_state to list all frames. Use mcp__pencil__get_screenshot to capture all frames. Review for:

1. SPACING CONSISTENCY: Do all frames use the same gap values (100/200/300/400)? Flag any frame that uses a gap not on the approved scale.

2. BADGE TONE CONSISTENCY: Is tone="attention" (amber) used for ARTWORK_PENDING across ALL frames? Is tone="success" (green) used for PROVIDED/SHIPPED across ALL frames? Is tone="info" (blue) used for ARTWORK_PROVIDED/IN_PRODUCTION across ALL frames?

3. TYPOGRAPHY CONSISTENCY: Is the same Text variant used for the same element type across frames? (e.g., all card headings use variant="headingSm" fontWeight="semibold")

4. COMPONENT CONSISTENCY: Is the same Polaris component used for visually equivalent elements across frames? (e.g., both empty states use EmptyState, not one using EmptyState and one using custom layout)

5. ANNOTATION COMPLETENESS: Check each frame's annotation layer. Every frame must have:
   a. Component name + key props for every non-obvious element
   b. State conditions for every conditionally-rendered element
   c. Data binding notes for every dynamic value
   d. At minimum one annotation per major section

Fix any inconsistencies using mcp__pencil__batch_design. Add missing annotations.

Finally, add a "Design System Notes" text block visible on the Polaris Atoms frame:
- Confirmed Polaris version/constraints used in this design
- List of any props that required Phase 1 research to clarify (with the confirmed value)
- Any warnings for the implementation agent (e.g., "Production Notes save-note intent is new — requires backend implementation")
```

- [ ] **Step 1: Dispatch Sonnet polish subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Prepend: "If admin-dashboard-order-pages.pen is not the active document in mcp__pencil__get_editor_state, call mcp__pencil__open_document with path /Users/pc/Development/GitHub/insignia/admin-dashboard-order-pages.pen." Then provide the full prompt above.

- [ ] **Step 2: Verify polish applied**

Use `mcp__pencil__get_editor_state` to check the file was modified.

---

## Task 9: Visual Inspection #4 — Final Sign-Off

**Executor:** Main agent (inline) + parallel Sonnet critic subagent
**This is the final gate before the design is approved for implementation.**

- [ ] **Step 1: Main agent captures all frames**

Use `mcp__pencil__get_screenshot` to capture every frame. Review all 8 frames in sequence.

- [ ] **Step 2: Main agent — cross-screen consistency pass**

Side-by-side comparison of all frames:
- [ ] Badge tones are consistent for the same status across all frames (not different shades of amber on different frames)
- [ ] Typography hierarchy consistent: page titles, card headings, body text, subdued text all look the same weight/size across frames
- [ ] Spacing feels consistent — no frame looks obviously more cramped or airy than others
- [ ] Polaris Atoms frame has a "Design System Notes" block
- [ ] All frames have visible annotation layers
- [ ] The Pencil file tells a coherent, complete story for an implementation agent

- [ ] **Step 3: Dispatch Sonnet final critic subagent**

Dispatch via Agent tool: `subagent_type="general-purpose"`, `model="sonnet"`. Run in parallel with main agent Steps 1–2. Prompt:

```
You are a senior Polaris design reviewer doing the final sign-off inspection for the Insignia admin orders UI. This is the last check before a developer implements this design. Be extremely critical — any ambiguity or error you miss becomes a bug in production.

STEP 1: Invoke the skill shopify-plugin:shopify-polaris-app-home. Load and read the full Polaris component documentation.

STEP 2: Use mcp__shopify-dev-mcp__search_docs_chunks to look up any component you are uncertain about during your review.

STEP 3: Use mcp__pencil__get_editor_state to list ALL frames in admin-dashboard-order-pages.pen. Use mcp__pencil__get_screenshot to capture all of them.

STEP 4: Perform a two-pass review:

PASS A — Spec completeness (does the design cover everything in the spec?):
Read docs/superpowers/specs/2026-04-21-admin-ui-pencil-design.md. For each requirement in the spec, confirm a corresponding design element exists. List any spec requirement that has no corresponding design element.

Required frames per spec:
- Polaris Atoms ✓/✗
- Orders Table — Primary ✓/✗
- Orders Table — Bulk Active ✓/✗
- Orders Table — Empty (No orders) ✓/✗
- Orders Table — Empty (No results) ✓/✗
- Order Detail — Primary ✓/✗
- Order Detail — All Provided ✓/✗
- Order Detail — Collapsed ✓/✗

For each screen, check the states listed in the spec's "Design states to show in Pencil" section.

PASS B — Implementation readiness (can a developer implement this without asking questions?):
For each frame, ask: "If I received only this screenshot and the annotation layer, could I implement it correctly?" Flag any element where the answer is no. Specifically:
- Any component where the Polaris component name is not annotated
- Any dynamic/conditional element without a state condition annotation
- Any data binding that is unclear or missing
- Any layout relationship that can't be determined from the design alone (e.g., responsive breakpoints, overflow behavior)
- Any Badge, Button, or Text where the exact props can't be determined from annotations

STEP 5: Cross-screen consistency check:
- Do Badge tones match across all frames for the same status? List any discrepancies.
- Is typography weight/size consistent for equivalent elements across frames?
- Is spacing visually consistent?

STEP 6: Output final report:

## FINAL DESIGN REVIEW — Verdict

### Spec Coverage (Pass A):
Frame checklist: [8 frames ✓/✗]
Missing requirements: [list or "none"]

### Implementation Readiness (Pass B):
[frame-by-frame: implementation-ready ✓ or issues found ✗]
[for each ✗: specific annotation or clarity issue]

### Cross-screen consistency:
[list any inconsistencies or "none found"]

### FINAL VERDICT: APPROVED / REQUIRES CHANGES
(APPROVED only if: all 8 frames present, all spec requirements covered, all frames implementation-ready, no cross-screen inconsistencies)

If REQUIRES CHANGES: list every change needed with enough specificity that a correction agent can apply them without asking clarifying questions.
```

- [ ] **Step 4: Merge final reports**

If either main agent or critic reports REQUIRES CHANGES: dispatch a Sonnet correction subagent with the merged issue list, then re-run Steps 1–3.

- [ ] **Step 5: Log final result and commit**

Once both checks return APPROVED:

```bash
git add admin-dashboard-order-pages.pen docs/superpowers/specs/2026-04-21-polaris-component-reference.md
git commit -m "design: complete Polaris-validated admin orders UI in Pencil — 8 frames, 4 visual inspections passed"
```

- [ ] **Step 6: Log final sign-off**

`Inspection #4 (Final) — APPROVED [date] — Design ready for implementation`

---

## Failure Recovery Protocol

If at any inspection a correction loop exceeds 3 iterations without achieving PASS/APPROVED:
1. Stop. Read both inspection reports carefully.
2. Check if the issue is a fundamental spec ambiguity (not covered in the component reference). If so, update the spec and reference doc first, then dispatch a fresh design subagent for that frame only.
3. Do not apply more corrections on top of corrections — rebuild the failing frame from scratch using the updated reference.

---

## Final Verification Checklist

- [ ] All 8 frames present in `admin-dashboard-order-pages.pen`
- [ ] `docs/superpowers/specs/2026-04-21-polaris-component-reference.md` exists with all 17 components researched
- [ ] 4 visual inspections logged as PASSED/APPROVED
- [ ] Dual inspection (main agent + Sonnet critic) confirmed for all 4 inspections
- [ ] All frames have annotation layers
- [ ] Polaris Atoms frame has Design System Notes block
- [ ] All changes committed
