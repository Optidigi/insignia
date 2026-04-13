# Engineering Platform — Insignia App

This repository is a **software engineering platform** for Claude Code.
It enables fully autonomous, multi-agent development with deliberate model
routing, deterministic policy enforcement, and first-class plugin support.

This file covers two things:
1. **Platform** — how Claude Code agents are orchestrated in this repo.
2. **Insignia App** — mandatory rules for working on the Shopify app under `Insignia-shopify-app/`.

Read both sections at session start. Detail lives in skills — keep this short.

---

# Part 1 — Engineering Platform

## Getting started

Run once after cloning:

```bash
bash scripts/setup.sh
```

This checks and auto-installs the one required system dependency (`jq`),
using whichever package manager is available (scoop, brew, apt, dnf, choco,
winget). No manual steps needed.

---

## Core philosophy

1. **Plan first, always.** No agent writes code without an approved plan.
2. **Right model, right task.** Haiku explores. Sonnet builds. Opus decides.
3. **Skills over prompts.** Repeatable logic belongs in a skill, not in chat.
4. **Hooks enforce policy.** Trust is not a control; hooks are.
5. **Agents are autonomous.** The architect delegates without asking permission.

---

## When a task arrives — use a command

| Command | Use when |
|---|---|
| `/build <description>` | Any feature, app, or medium+ task |
| `/fix <description>` | Small bug or isolated change |
| `/platform-change <description>` | Infra, Docker, CI, migrations |
| `/escalate <type> <context>` | Architect needs Opus reasoning |
| `/release` | Prepare and publish a release |

The architect agent owns `/build`. It plans, delegates, and drives autonomously.
You do not sequence agents manually.

---

## Model routing

| Task | Model | Why |
|---|---|---|
| Scan files, grep, run tests, summarise output | Haiku | Cheapest for read-only work |
| Write code, review, refactor, document | Sonnet | Best cost/capability ratio |
| Architectural decisions, root-cause debugging, migrations | Opus | Reserved for high-stakes reasoning |

Attempt every task with Haiku or Sonnet first. Opus is invoked only when
the architect determines that cheaper models have insufficient context or
reasoning depth for a decision.

---

## Plugin integration

This repo is designed to complement, not duplicate, installed plugins.

- **Superpowers** — if installed, the architect defers planning and TDD phases
  to Superpowers commands (`/sp:plan`, `/sp:tdd`) instead of its own planning
  skill. Detection is automatic via the `stack` skill.
- **Context7** — loaded automatically by the researcher when fetching library
  docs. Reduces hallucinated API usage.
- **Sequential Thinking** — activated by the architect before any Opus
  escalation to ensure structured reasoning.
- **Language servers** (pyright, vtsls, rust-analyzer) — used by the
  implementer for real-time type checking after every edit.

If a plugin is not installed, the platform's native skills fill the gap
without error. All plugin touchpoints have fallbacks defined in their skills.

---

## Repository layout

```
CLAUDE.md                   — This file (session-start manifest)
.claude/
  agents/                   — Sub-agent definitions (model + tools + persona)
  commands/                 — Slash commands (user-facing entry points)
  skills/                   — Domain skills (loaded on demand)
    architect/              — Planning and delegation logic
    stack/                  — Plugin detection and stack conventions
    implement/              — Coding standards and patterns
    test/                   — Test execution and interpretation
    review/                 — Code review criteria
    debug/                  — Systematic debugging protocol
    infra/                  — Infrastructure change procedures
    release/                — Release and versioning procedure
  hooks/                    — Shell scripts (deterministic enforcement)
  vendor/                   — Plugin integration notes
```

---

## Contribution rules

- Add a skill instead of expanding this file.
- Add a hook instead of writing a prompt about what Claude "should" do.
- If you run a procedure more than twice, it becomes a skill.
- Every new agent must specify model, toolsAllow, and a description.

---

# Part 2 — Insignia Shopify App

All rules in this section apply when working inside `Insignia-shopify-app/`.

## Project Overview

Insignia is an embedded Shopify app for product customization (logo placement on products). Merchants configure decoration methods, product views, and placement zones. Customers upload logos and place them via a storefront modal. Fee products handle pricing via a variant pool system.

**Tech stack**: React 18 + React Router 7 + Polaris v13 | Prisma + PostgreSQL | Shopify Admin GraphQL API (2026-04) | Konva (2D canvas) | AWS S3/R2 | Zod | TypeScript (strict)

## Commands

```bash
npm run dev          # Start Shopify app dev server (includes tunnel + theme extension)
npm run build        # Production build
npm run lint         # ESLint check
npm run typecheck    # react-router typegen && tsc --noEmit
npx prisma validate  # Validate Prisma schema
npx prisma migrate dev  # Run database migrations
```

## Project Structure

```
app/
  routes/              # React Router routes (app.* = admin, apps.insignia.* = storefront proxy, api.* = internal API)
  components/          # React components (storefront/ = modal components)
  lib/services/        # Backend services (*.server.ts)
  lib/storefront/      # Client-side storefront utilities
  shopify.server.ts    # Shopify app initialization
  db.server.ts         # Prisma singleton
extensions/
  insignia-theme/      # Theme app extension (blocks + locales only, NO templates)
docs/
  AGENT_ENTRY.md       # Tier 1 navigation entry point (source of truth)
  core/                # Tier 1: canonical specs and contracts
  admin/               # Tier 2: admin dashboard specs
  storefront/          # Tier 2: storefront modal specs
prisma/
  schema.prisma        # 13 models, PostgreSQL
```

## Documentation Tiers

1. **Tier 1** (`docs/core/`): Canonical source of truth. Always read before modifying related code.
2. **Tier 2** (`docs/admin/`, `docs/storefront/`): Working specs. Consult for feature context.
3. **Tier 3** (`docs/notes/`): Research, audits, design intent. Reference only.

Start at `docs/AGENT_ENTRY.md` for navigation.

---

## Mandatory Rules

### 1. Shopify API: Always Use the MCP

**Every** interaction with Shopify APIs, GraphQL schema, webhooks, Liquid, or theme extensions MUST be validated against the Shopify Dev MCP before writing code.

- Use `mcp__shopify-dev-mcp__introspect_graphql_schema` to check field names, types, and enums before writing GraphQL queries/mutations.
- Use `mcp__shopify-dev-mcp__validate_graphql_codeblocks` to validate every GraphQL operation you write.
- Use `mcp__shopify-dev-mcp__search_docs_chunks` or `mcp__shopify-dev-mcp__fetch_full_docs` for API behavior, webhook topics, Liquid objects, and theme extension rules.
- Use `mcp__shopify-dev-mcp__validate_theme` for theme extension Liquid files.
- Use `mcp__shopify-dev-mcp__validate_component_codeblocks` for Polaris component usage.
- **Never guess or invent** Shopify API fields, enum values, webhook topics, Liquid objects, or Polaris component props. If the MCP is unavailable, check Tier 1 docs and explicitly flag uncertainty.

### 2. UI/UX: Polaris Design System for Admin Dashboard

All **admin dashboard** UI (routes under `app/routes/app.*`) MUST use Shopify Polaris components and follow the Polaris design language. No custom CSS or HTML reimplementations of things Polaris already provides.

- Use Polaris `Page`, `Layout`, `Card`, `BlockStack`, `InlineStack`, `Text`, `Button`, `Banner`, `Badge`, `DataTable`, `Modal`, `Form`, `TextField`, `Select`, etc.
- Follow Polaris layout patterns: `Layout.Section`, `Layout.Section variant="oneThird"` for sidebar content.
- Use Polaris `tone` props for semantic color (`success`, `critical`, `warning`, `info`, `subdued`).
- Use Polaris spacing tokens via `gap`, `padding` props — never hardcode pixel values for spacing.
- Use Polaris icons from `@shopify/polaris-icons` — never inline SVGs for standard actions.
- Validate component usage against the MCP: `mcp__shopify-dev-mcp__validate_component_codeblocks`.

**Note**: The storefront modal (`app/components/storefront/`, `app/routes/apps.insignia.*`) is customer-facing and does NOT use Polaris. It uses custom CSS to blend with the merchant's theme. Polaris rules do not apply there.

### 3. UI/UX: Design Thinking and Best Practices

When creating or modifying any dashboard, page, or UI component:

- **Read `docs/notes/polaris-quirks.md` first.** It documents known Polaris v13 layout bugs (e.g. `Icon` `margin: auto` breaking flex rows) and the required workarounds. Apply them proactively — do not wait for the bug to appear visually.
- **Invoke the frontend-design and UI/UX skills** before starting implementation. These cannot be skipped.
- Apply design thinking: understand the user (merchant or customer), their goals, and the context before designing.
- Follow information hierarchy: most important content first, progressive disclosure for complexity.
- Ensure consistent visual rhythm: align spacing, typography, and component sizes.
- Provide clear feedback: loading states, success confirmations, error messages with actionable guidance.
- Mobile-responsive: admin pages should work in Shopify Mobile admin; storefront components should work on all viewports.
- Accessibility: all interactive elements must be keyboard-navigable and screen-reader compatible. Use Polaris components (which handle this) and don't break their accessibility.

### 4. Visual Inspection After UI Work

After any UI/UX change, you MUST visually verify the result:

- Use Playwright MCP to take screenshots of the changed pages/components.
- Verify layout, spacing, alignment, and visual consistency with the rest of the app.
- Verify responsive behavior if applicable.
- Check that Polaris components render correctly (no broken layouts, missing icons, wrong tones).
- Compare before/after if modifying existing UI.
- If Playwright is unavailable, explicitly note that visual verification is pending and should be done manually.
- When using Playwright always take screenshots in JPG format to avoid the "Request too large (max 20MB). Try a smaller file." issue.

### 5. Test After Every Change

Every code change must be verified before considering it done:

- **TypeScript**: Run `npm run typecheck` — must pass (pre-existing errors in unrelated files are acceptable, new errors are not).
- **Lint**: Run `npm run lint` for style and a11y violations.
- **Shopify theme**: Use `mcp__shopify-dev-mcp__validate_theme` for any Liquid file changes.
- **GraphQL**: Use `mcp__shopify-dev-mcp__validate_graphql_codeblocks` for any query/mutation changes.
- **Functional**: For backend/API changes, test the endpoint (via curl, Playwright, or the running dev server).
- **Visual**: For UI changes, take screenshots and verify (see rule 4).
- **Build**: Run `npm run build` for significant changes to catch bundling issues.

### 6. Theme App Extension Constraints

The theme extension (`extensions/insignia-theme/`) has strict rules:

- Only `assets/`, `blocks/`, `snippets/`, and `locales/` directories are allowed. **No `templates/` directory** — it will crash the dev server.
- Blocks must have a valid `{% schema %}` tag with a JSON configuration.
- App embed blocks use `"target": "head"` or `"target": "body"`.
- Always validate with `mcp__shopify-dev-mcp__validate_theme` after changes.

### 7. Fee Products Must Be UNLISTED

Fee products (variant pool) must always be created with `status: "UNLISTED"`:

- UNLISTED hides products from collections, search, and recommendations on all themes automatically.
- Fee products must still be published to Online Store for `/cart/add.js` to work.
- The app embed block (`fee-product-redirect.liquid`) is a safety net for direct URL access — not the primary hiding mechanism.
- If a fee product is accidentally deleted, the system self-heals: `ensureVariantPoolExists` detects the deletion, cleans up stale DB rows, and re-provisions.

### 8. GraphQL API Version

The app uses API version `2026-04` (set in `shopify.app.toml`). Always use this version when querying the MCP or writing GraphQL operations.

### 9. Database Changes

- Always create Prisma migrations for schema changes: `npx prisma migrate dev --name <description>`.
- Migrations must be safe (no data loss without explicit confirmation).
- Keep `prisma/schema.prisma` as the single source of truth for the data model.
- Run `npx prisma validate` after any schema change.

### 10. Error Handling Philosophy

- Validate at system boundaries (user input, Shopify API responses, external services).
- Trust internal code and framework guarantees — don't add defensive checks for impossible states.
- Shopify API calls: always check `userErrors` in mutation responses.
- Storefront endpoints: return structured JSON errors with `{ error: { message, code } }`.
- Backend services: use `AppError` from `lib/errors.server.ts` with appropriate HTTP status codes.
- Self-heal where possible (e.g., fee product deletion recovery) rather than failing permanently.

---

## Code Conventions

- **File naming**: `*.server.ts` for server-only code, `*.client.ts` for browser-only code. Routes follow React Router conventions.
- **Imports**: Use absolute paths from project root. Server-only imports must not leak to client bundles.
- **GraphQL**: Prefix queries with `#graphql` template tag for syntax highlighting and codegen.
- **Types**: Use Zod for runtime validation at boundaries. Use TypeScript types for internal contracts.
- **Formatting**: Prettier handles formatting (runs on save). Don't manually format.
- **Components**: Polaris for admin, custom components in `app/components/storefront/` for the customer-facing modal.
- **Services**: Backend logic lives in `app/lib/services/*.server.ts`. Routes are thin controllers that call services.
- **Env vars**: Required env vars are in `.env` (not committed). See `docs/backend/README.md` for the full list.

## MCP Servers Available

| Server | Purpose |
|--------|---------|
| `shopify-dev-mcp` | Shopify API schema introspection, docs search, GraphQL validation, theme validation, component validation |
| `playwright` | Browser automation for visual testing and functional verification |
| `context7` | Library/framework documentation lookup (React, Prisma, etc.) |

## Key Architectural Decisions

- **Variant Pool**: Fee products use UNLISTED status + Online Store publication. Variants are reusable slots whose prices are set dynamically during `/prepare`.
- **App Proxy**: Storefront modal loads via Shopify App Proxy at `/apps/insignia/*`. All storefront endpoints verify the proxy signature.
- **Canvas Rendering**: Konva.js for 2D placement editing (admin) and size preview (storefront). R2 presigned URLs for images (no CORS headers, canvas becomes tainted but display works).
- **Session Management**: Database-backed sessions via Prisma. Access tokens refresh automatically through Shopify's OAuth flow when the admin loads the app.
