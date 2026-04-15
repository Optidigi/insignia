# Storefront UI Implementation — Agent Handoff Prompt

> Copy everything below the line into a new Claude Code session.

---

You are implementing storefront modal UI changes for the Insignia Shopify app based on Pencil design files (.pen).

## Setup (do these first, in order)

1. **Read CLAUDE.md** — mandatory project rules. Follow them exactly.
2. **Read docs/AGENT_ENTRY.md** — documentation navigation. Tier 1 docs are source of truth.
3. **Read CHANGELOG.md** — understand recent changes (v0.5.0 just landed: per-view placements, UI polish).
4. **Read docs/notes/open-work.md** — known open questions.

## Project context

Insignia is an embedded Shopify app for product customization. The **storefront modal** is the customer-facing UI where shoppers:
1. Upload their logo (or skip for later)
2. Select placement(s) — where on the product to print
3. Choose logo size per placement
4. Review and add to cart

The storefront modal is NOT the admin dashboard. It does NOT use Shopify Polaris. It uses **custom CSS** (`app/components/storefront/storefront-modal.css`) with CSS custom properties to blend with the merchant's theme. It loads via Shopify App Proxy.

## Key files you'll be working with

**Components** (all in `app/components/storefront/`):
- `CustomizationModal.tsx` — main modal shell, step navigation, state management
- `UploadStep.tsx` — step 1: logo upload or "provide later"
- `PlacementStep.tsx` — step 2: select print placement(s)
- `SizeStep.tsx` — step 3: choose logo size per placement (card selector)
- `ReviewStep.tsx` — step 4: review and add to cart
- `SizePreview.tsx` — product preview with logo overlay (carousel or tabbed)
- `NativeCanvas.tsx` — canvas renderer for logo-on-product preview
- `PreviewSheet.tsx` — full-screen preview overlay
- `types.ts` — shared types (StorefrontConfig, PlacementSelections, etc.)
- `i18n.ts` — translations (8 locales)
- `currency.ts` — price formatting
- `icons.tsx` — SVG icon components

**CSS**: `app/components/storefront/storefront-modal.css` — ALL storefront styles. Uses CSS custom properties (e.g., `--insignia-primary`, `--insignia-border`, `--insignia-text`). No Tailwind — apply Tailwind design principles through these custom properties.

**Config endpoint**: `app/routes/apps.insignia.config.tsx` → `app/lib/services/storefront-config.server.ts` — returns the product configuration to the modal.

## Design files

The .pen files are in `docs/designs/` (or wherever the user tells you they are). Use the **Pencil MCP** to read and understand them.

### How to read .pen files

The Pencil MCP server must be running. If it's not available:
1. Ask the user to open Pencil (desktop app or VS Code extension)
2. The MCP server starts automatically when Pencil is open
3. Use the Pencil MCP tools to inspect frames, layers, and styles

If the Pencil MCP is not available, ask the user to export the designs as PNG screenshots and describe the layout.

## Your workflow (MANDATORY)

### Phase 1: Understand the designs

1. Use Pencil MCP to read every frame/page in the .pen file(s)
2. For each screen/state, document:
   - What step of the modal it represents
   - What elements are shown (buttons, cards, inputs, preview, etc.)
   - Layout structure (flex/grid, spacing, alignment)
   - Colors, typography, spacing values
   - Interactive states (hover, selected, disabled, loading)
   - Mobile vs desktop differences
3. Cross-reference with the existing code to understand what changes vs what stays

### Phase 2: Ask questions (CRITICAL)

**DO NOT ASSUME ANYTHING.** If the design is ambiguous about ANY of the following, ask:

- **Dynamic content**: The designs show specific examples, but the real app has variable data. Ask: "This shows 3 placements — what happens with 1? With 5? With 0?"
- **Responsive behavior**: Ask: "How should this layout adapt below 375px? Does the card grid become a single column?"
- **Interaction states**: Ask: "What happens when this button is clicked? Is there a loading state? An error state?"
- **Edge cases**: Ask: "What shows when there's no product image? When the logo upload fails?"
- **Animations/transitions**: Ask: "Should this transition be instant or animated? What duration?"
- **Text content**: Ask: "Is this exact text or a placeholder? Does it need translation?"
- **Existing behavior**: Ask: "The current code does X here — should I keep that or replace it with what the design shows?"

Present ALL your questions at once (grouped by screen/step) before starting implementation.

### Phase 3: Create implementation plan

Use `superpowers:writing-plans` to create a detailed plan:
- Map each design change to specific files and line ranges
- Identify what CSS classes need to change/add/remove
- Identify what component JSX needs restructuring
- Plan the order of changes (CSS first, then component structure, then interactions)
- Note which changes are purely visual vs behavioral

**Present the plan to the user for approval before writing any code.**

### Phase 4: Implement

- Use `superpowers:test-driven-development` for any logic changes
- CSS changes: modify `storefront-modal.css` — follow existing patterns, use custom properties
- Component changes: modify the specific step component
- After each step's changes, run `npm run typecheck && npm run lint && npx vitest run`
- Commit after each logical unit of work

### Phase 5: Visual verification

- Use Claude in Chrome browser tools to verify the modal renders correctly
- Test at: `https://insignia-app.myshopify.com/apps/insignia/modal?p=8513346601060&v=48255817973860`
- Store password: `insignia`
- Check desktop AND mobile viewport
- Verify all interactive states work

## Rules

- **No assumptions.** Ask questions first, implement after.
- **No Tailwind classes in storefront components.** Use custom CSS with `--insignia-*` custom properties.
- **No Polaris in storefront.** Polaris is admin-only.
- **Translations.** Any new user-visible text must be added to `i18n.ts` in all 8 locales. Ask the user for translations or use English + mark for translation.
- **Responsive.** Test at 375px, 390px, and desktop (1280px+). The modal must work on all viewports.
- **Accessibility.** All interactive elements need keyboard navigation, focus states, and ARIA attributes.
- **Dynamic values.** Designs show specific examples. Your code must handle: 0, 1, many items. Long text truncation. Missing data.
- Work on a feature branch, not main.
- Run typecheck + lint + tests after every change.
- Use Shopify Dev MCP for any Shopify API questions.
- Use Context7 MCP for React documentation.

## Commands

```bash
npm run dev          # Start dev server (or: npx shopify app dev --config insignia-demo)
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npx vitest run       # Tests
npm run build        # Production build
```

## Database

PostgreSQL must be running:
```bash
pg_ctl -D "$(scoop prefix postgresql)/data" start
```

Connection: `postgresql://insignia:insignia_dev@localhost:5432/insignia`
