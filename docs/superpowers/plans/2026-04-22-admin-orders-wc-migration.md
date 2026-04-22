# Admin Orders Polaris Web Components Migration (v2)

**Date:** 2026-04-22
**Branch:** `feat/orders-polaris-wc`
**Status:** v2 — incorporates critic findings + product decisions

---

## Goal

Replace `app/routes/app.orders._index.tsx` and `app/routes/app.orders.$id.tsx` render layers with production-quality Polaris Web Component implementations matching [in-scope.html](../../../in-scope.html), preserve all existing server behavior (loaders, actions, webhooks, schema), correctly render every edge-case UI state the current routes handle plus states they currently miss, and build a new `OrderNote` backend so the "Save note" form actually persists. App is pre-launch; no backward compatibility.

## Architecture — build new, don't rewrite in place

- **Loaders and actions stay untouched** in existing route files until the cutover commit.
- **Render components go in new files** under `app/components/admin/orders/` — built from a clean slate against the loaders' actual return shape.
- **Old render code is deleted at cutover** in one focused commit per route that swaps default export + prunes imports + (minimal) extends loader.

```
app/components/admin/orders/
  OrdersIndex.tsx · OrdersEmptyState.tsx
  OrderDetail.tsx · LineItemCard.tsx · PlacementCanvas.tsx · PlacementsTable.tsx
  OrderSummaryCard.tsx · PlanningCard.tsx · ProductionNotesCard.tsx · StatusHistoryCard.tsx
  index.ts
```

## Non-negotiables (v2 — corrected from v1)

- Full replacement — old render layers deleted at cutover.
- **Attributes are camelCase** per `@shopify/polaris-types` (`alignItems`, `gridTemplateColumns`, `listSlot`, `onPreviousPage`, `accessibilityLabel`). Not kebab-case. The HTML-context kebab-case rule from the skill does not apply to React JSX.
- **`@shopify/polaris-types` already installed at `1.0.5`** — use its exported types; do NOT hand-write a `.d.ts`.
- **`polaris.js` loaded from CDN at `latest`** — no versioned URL exists. Type alignment happens via `@shopify/polaris-types` in devDependencies.
- **Script load location: `app/root.tsx` `<head>`** — not `app/routes/app.tsx`. Verify `app-bridge.js` is not already injected by the Remix adapter before adding it.
- Terminology lock enforced via `app/lib/admin/terminology.ts`.
- Canvas uses storefront's [NativeCanvas.tsx](../../../app/components/storefront/NativeCanvas.tsx); Konva dropped from admin.
- Every UI state from Phase-0 R1/R2 has a real handler.
- App Bridge accessed via `useAppBridge()` from `@shopify/app-bridge-react@^4.2.4` through a single client-only helper module (`app/lib/admin/app-bridge.client.ts`).
- No feature-flag build-out. Branch → review → merge.
- Pagination events: `onPreviousPage` / `onNextPage` (React props), not custom DOM event names.

## Product decisions (confirmed)

- **Production Notes: build real backend** — new `OrderNote` Prisma model, migration, `/api/admin/order-notes` endpoint, wire into detail page. Dedicated subagent in Phase 1.5.
- **Send artwork reminder: disabled "Coming soon"** — consistent with placeholder pattern.
- **Un-advance production status: not in scope** — flagged for v3 backlog.
- **Bulk print production sheets: disabled "Coming soon"** — awaits backend bulk-PDF endpoint.
- **Message customer, Planning (due date / assigned-to), Status history full tracking: disabled "Coming soon"** — per v3 feature list.

## Prototype design issues NOT to carry forward (from critic R2)

- `Customer` column on index — loader does not return customer name; render `—` or omit column until §10 gap resolved.
- `Items` column content like "3× Polo · 2 placements" — not in loader; render existing `lineCount` text.
- Row #1038 `<s-badge>Draft</s-badge>` — no `Draft` value in `ProductionStatus` enum; discard.
- `ORDER.uploadLink` in pending banner — map to `line.orderStatusUrl` (Prisma field, already on model, surfaced via one-line loader patch); if null, omit the copy-link field.
- Badge tone for "Awaiting artwork" amber — R3 confirms whether `warning` or `attention` renders amber in `<s-badge>`.

---

## Phase 0 — Parallel research (6 subagents)

Dispatched in one message. All produce reports under `docs/superpowers/research/2026-04-22-*.md`.

| ID | Agent | Model | Deliverable |
|----|-------|-------|-------------|
| R1 | Explore | Haiku | `r1-orders-index-audit.md` — (A) every loader field + source, every action intent + outcome, every UI state the current code handles; (B) states it doesn't handle that production should. **Does NOT audit dead imports — R5 owns that.** |
| R2 | Explore | Haiku | `r2-order-detail-audit.md` — same shape, plus `ArtworkUploader` state machine, nested-route invocations, `orderStatusUrl` field audit (confirm it's on the model; confirm it's NOT in loader return — the one-line loader patch target), geometry merging, QC conditional. **Does NOT audit dead imports.** |
| R3 | general-purpose | Sonnet | `r3-shopify-wc-reference.md` — **tiered format**: quick-ref table (one row per WC tag, key props only) at top; verbose appendices per component. Invokes `node scripts/search_docs.mjs` via bash at absolute path `/Users/pc/.claude/plugins/cache/claude-plugins-official/shopify-ai-toolkit/1.1.0/skills/shopify-polaris-app-home/scripts/`. **Must resolve specifically**: correct tone value for amber `<s-badge>` (`warning` vs `attention`); SSR/FOUC mitigation strategy for Remix; whether `app-bridge.js` is auto-injected by `@shopify/shopify-app-react-router` or must be added manually; `<s-drop-zone>` progress support. |
| R4 | general-purpose | Sonnet | `r4-canvas-consolidation.md` — delta between NativeCanvas and admin detail needs (per-placement logos, view switching, download-all, logo fetch failure, presigned URL 403 refetch). Concrete extension plan. Konva code that becomes deletable; what may still need to live. |
| R5 | Explore | Haiku | `r5-dead-code-scan.md` — **sole source of dead-code inventory**. Imports, helpers, `useIndexResourceState` sites, `IndexFilters` usage, saved-view infra, stale "Logo" strings (UI contexts only — `rg` patterns must exclude Prisma field names like `logoAssetIdsByPlacementId`), test files exercising React render, Konva imports that go unreferenced. Candidates only; no deletion. |
| R6 | general-purpose | Sonnet | `r6-app-bridge-audit.md` — `@shopify/app-bridge-react@4.2.4` hook surface, verify `useAppBridge()` works in Remix embedded setup, map from plan's needs (toast, save bar, print, modal) to hook return surface. Remix SSR / hydration gotchas for the hook. **This report flows to BOTH I1 and I2.** |

**Crucial rule for Phase 0 agents:** produce findings only. Research, no code.

## Phase 1 — Foundation (main agent, sequential, starts after all Phase-0 reports land)

1. **Types:** Confirm `@shopify/polaris-types@^1.0.5` resolves in typecheck. Skip any `.d.ts` creation. If compile errors for `<s-*>` elements surface, verify `tsconfig.json` includes the package types.
2. **CDN scripts:** Edit `app/root.tsx` — add `<script src="https://cdn.shopify.com/shopifycloud/polaris.js" />` to the `<head>` block in the root `Layout`. Verify `app-bridge.js` status from R6; add only if not already injected. Confirm `app/routes/app.tsx` needs no changes (its `<Outlet />` continues serving).
3. **Terminology module** `app/lib/admin/terminology.ts`:
   - `productionStatusLabel(status: ProductionStatus): string`
   - `productionStatusTone(status): 'info' | 'success' | 'warning' | 'critical'`
   - `lineItemArtworkStatusLabel(state: ArtworkStatus): string` (per-card label — e.g. "Artwork provided" when all placements have artwork)
   - `artworkStatusLabel(hasPending: boolean, count?: number): string`
   - `artworkStatusTone(hasPending: boolean): 'success' | 'warning' | 'attention'` — uses amber value confirmed by R3
   - Unit tested against every enum value.
4. **App Bridge helper** `app/lib/admin/app-bridge.client.ts` (note `.client.ts` suffix — client-bundle-only enforcement):
   - `useToast()`, `useSaveBar()`, `usePrint()`, `useModal()` — thin wrappers over `useAppBridge()`. Single source of truth; no other `window.shopify` calls after this.
5. **Canvas:** Per R4's recommendation, either extend `NativeCanvas.tsx` (if backward-compatible with storefront caller) OR create a new `app/components/admin/orders/PlacementCanvas.tsx` wrapper. Phase-1 summary records which file I2 imports.
6. **Layout conflict check:** `app/routes/app.tsx` wraps `<Outlet>` in `<Box paddingBlockEnd="1600">`. Per R3, verify whether this conflicts with `<s-page>` layout; if it does, conditionally skip the `<Box>` for orders routes OR remove the outer padding for those routes specifically.
7. `npm run typecheck` + `npm run lint` pass.

## Phase 1.5 — OrderNote backend (subagent, runs in parallel with Phase 2)

**Subagent:** `general-purpose`, Sonnet. Self-contained best-practice build.

**Brief outcomes:**
1. Prisma model `OrderNote` (fields: `id`, `shopId`, `shopifyOrderId`, `body`, `authorUserId`, `authorName`, `createdAt`, `updatedAt`) — decide on FK direction: probably a soft reference to `OrderGroup` via `shopId + shopifyOrderId` since `OrderGroup` itself is a view, not a table. Research what `OrderGroup` actually is (may be a derived shape in the loader, not a persisted row) and choose FK accordingly.
2. Migration via `npx prisma migrate dev --name add_order_notes`.
3. Action handler added to `app.orders.$id.tsx` under a new `intent=save-note`. Server-side validation via zod. Authorization: shop scoping (same pattern as existing intents).
4. Loader extension in `app.orders.$id.tsx`: return `notes: OrderNote[]` for the order, newest first.
5. No UI work (I2 consumes the loader shape directly).
6. Tests — at minimum, a webhook-idempotency-style test confirming cross-shop isolation for note writes.

**Verification:** `npx prisma migrate reset` + re-apply works; `npm run typecheck` passes; existing test suite still green; one new test for the action handler.

## Phase 2 — Orders Index (subagent, runs in parallel with Phase 1.5)

**Subagent:** `general-purpose`, Sonnet.
**Inputs:** R1, R3, R5, R6, Phase-1 modules, full text of existing `app.orders._index.tsx` (contract source), `in-scope.html` orders route (visual spec).
**Deliverables:** new `OrdersIndex.tsx` + `OrdersEmptyState.tsx` + `index.ts` under `app/components/admin/orders/`. No edits to existing files.

**Hard rules:**
- camelCase attributes (not kebab-case).
- Read loader return values from the file — do not invent field names.
- Terminology module for every status label + badge tone.
- App Bridge helper for toast.
- Every state from R1 (A) handled; R1 (B) items with clear best-practice answers handled.
- `Customer` column renders `—` (gap per §10); `Items` column renders `lineCount` (not "3× Polo · 2 placements" from prototype); discard "Draft" badge.
- `Print production sheets` button rendered disabled with "Coming soon" tooltip.
- Selection via `useState<Set<string>>` + `<s-checkbox>` onChange events; no `useIndexResourceState`.
- Pagination via `onPreviousPage` / `onNextPage` props.
- Accessibility: visible labels or `labelAccessibilityVisibility="exclusive"` on every input.
- **Self-review before returning**: run through the 12-point rubric from Phase 5, list findings at end of response.

## Phase 3 — Order Detail (subagent, sequential — after 1.5 + 2 complete)

**Subagent:** `general-purpose`, Sonnet.
**Inputs:** R2, R3, R4, R5, R6, Phase-1 modules, Phase-1.5 OrderNote loader shape, extended NativeCanvas or PlacementCanvas (per Phase-1 decision), full text of existing `app.orders.$id.tsx`, `in-scope.html` detail route (both A/B states).
**Deliverables:** new detail components (7 files listed under Architecture) + barrel updated.

**Hard rules (same as Phase 2) plus:**
- `ArtworkUploader` stays as Polaris React island (R3 will have confirmed `<s-drop-zone>` doesn't support XHR progress).
- All 15+ states from R2 (A) handled: `orderDataError` banner, currency fallback, missing-customer coalesce, upload in-flight/done/error, production cascade rules, missing-logo placeholder, cross-tenant 404, QC conditional.
- R2 (B) states with clear answers: presigned-URL-expiry → re-fetch on 4xx OR explicit error. Other (B) items addressed or flagged for critic escalation.
- `Send reminder` button disabled + "Coming soon" badge.
- `Message customer` disabled + "Coming soon" badge.
- Planning card disabled (Coming soon) per prototype.
- Status history: real timeline from available data + "Coming soon" for full tracking.
- **Production Notes card**: wires to real `OrderNote` loader + `intent=save-note` action from Phase 1.5. Live form.
- Loader one-line patches applied in this phase: `orderStatusUrl: l.orderStatusUrl` added to `lines.map(...)`.
- Canvas per-placement logos from `logoAssetMap`, view switching for multi-view products, download-all wired.
- **Self-review before returning**.

## Phase 4 — Cleanup & cutover (main agent, single commit per route)

1. Edit `app/routes/app.orders._index.tsx` — replace old render with `import OrdersIndex from "~/components/admin/orders/OrdersIndex"; export default OrdersIndex;` + delete dead imports + delete dead helpers.
2. Edit `app/routes/app.orders.$id.tsx` same pattern + apply loader one-liners.
3. Drop Konva imports from files that no longer need them.
4. Remove `useIndexResourceState`, `IndexFilters`, saved-view infra, tab infra.
5. Final greps (scoped to JSX text / children / label props, not field names): any remaining "Logo" UI strings; raw `ARTWORK_*` / `PRODUCTION_*` enums in JSX.
6. Update [CLAUDE.md](../../../CLAUDE.md): "Admin uses Polaris React for existing pages, Polaris Web Components for Orders pages. Prefer WC for new admin pages. CDN: `cdn.shopify.com/shopifycloud/polaris.js` (latest); type alignment via `@shopify/polaris-types` dev dep."
7. Update [docs/frontend/backend-api-reference.md](../../../docs/frontend/backend-api-reference.md) Integration Gaps — `OrderNote` no longer a gap; other placeholders still `Coming soon`.
8. Delete `OrderLinePreview*.tsx` files under `app/components/` that are only referenced by the old admin render (verify with `rg`); keep anything still used by storefront.

## Phase 5 — Critic reviews (two-pass)

**V1a (after Phase 2 + Phase 1.5, before Phase 3):** `general-purpose`, Sonnet. Rubric points 1–7 applied to `OrdersIndex.tsx` + `OrderNote` backend. Surfaces index-page issues before they compound in detail work.

**V1b (after Phase 4 cutover):** `general-purpose`, Sonnet, full 12-point rubric on full diff. Inputs: branch diff + all Phase-0 reports + `in-scope.html`.

**Rubric:**
1. Visual parity to in-scope.html (structure, spacing, component choice, copy, tones)
2. Every state from R1+R2 (A) has real handling; (B) items explicitly handled or flagged
3. Terminology lock — zero "Logo" / "Shipped" / raw-enum strings in rendered output
4. camelCase attributes throughout; zero kebab-case violations
5. Accessibility — labels, aria, keyboard, focus management
6. Error boundaries — every async/fetcher call has an error path
7. Dead code — zero commented blocks, zero unused imports
8. Canvas correctness — per-placement logos, view switching, polo 4-view, cap 1-view, logo fetch failure
9. Form submission — every button has a clear path to its handler
10. Toast emissions fire at right moments, terminology-locked text
11. Edge cases from R2 (B) addressed or flagged
12. Performance — no unnecessary re-renders, CDN loads once, lazy loading preserved

Main agent acts on every finding or explicitly justifies skipping.

## Phase 6 — Verify & merge

1. **Seed check (pre-step):** confirm local DB has ≥1 order with 2+ line customizations (one `ARTWORK_PENDING`, one `ARTWORK_PROVIDED`), variant view configs, and at least one uploaded logo. Seed if missing.
2. `npm run typecheck` → 0 errors
3. `npm run lint` → 0 errors
4. `npm test` → existing suite + new OrderNote test pass
5. **Playwright smoke test** at `tests/orders-wc.spec.ts`: navigate to orders index (embedded admin), assert `<s-table>` renders, click first row, assert detail page `<s-page heading>` matches, navigate to `/app/orders/$id/print` directly (confirm print sheet renders, not WC).
6. Dev server walk-through:
   - **Index:** empty-never · populated · filtered-empty · bulk-select 3 · paginate · export CSV · click-through
   - **Detail A (pending):** copy upload link · send reminder (verify disabled with Coming soon) · upload one placement (in-flight → done → banner changes)
   - **Detail B (provided):** Mark in production → badge updates · Save production note → survives refresh · timeline updates
   - **Error injection:** temporarily break GraphQL query → orderDataError banner; revert
7. **Console check:** devtools console open throughout walkthrough; zero errors, zero custom-element re-registration warnings, zero hydration-mismatch warnings.
8. **Bundle size (optional):** `npm run build` before/after — note size delta of the orders chunks.
9. Commit with Co-Authored-By footer, push branch, open PR, self-review, merge to main.

## Rollback procedure (explicit)

Cutover is two commits (one per route). Rollback requires both plus the root.tsx CDN injection:

1. `git revert <cutover-commit-sha-detail>` — restores old `app.orders.$id.tsx` render
2. `git revert <cutover-commit-sha-index>` — restores old `app.orders._index.tsx` render
3. `git revert <root-tsx-cdn-commit-sha>` — removes `polaris.js` injection if necessary (may be safe to leave; test in staging before deciding)

New component files under `app/components/admin/orders/` remain orphaned in the tree after revert — harmless, safe to leave or delete. `OrderNote` schema migration is NOT reverted (data safety); the Prisma model stays. Only the action handler wiring in the route gets reverted.

## Escalation triggers

- R2 (B) states that require product decisions surface during I2 self-review → pause, list, ask user per item.
- Extending NativeCanvas breaks storefront caller → create wrapper, notify user.
- V1a or V1b critic finds structural issue requiring full card re-think → ask before tearing up.
- `app-bridge.js` must be added manually AND interferes with existing App Bridge init → ask before editing `app.tsx`.

## Subagent roster (v2)

| Phase | ID | Agent type | Model | Parallel? |
|-------|----|-----------|-------|-----------|
| 0 | R1 | Explore | Haiku | ✓ with other R's |
| 0 | R2 | Explore | Haiku | ✓ |
| 0 | R3 | general-purpose | Sonnet | ✓ |
| 0 | R4 | general-purpose | Sonnet | ✓ |
| 0 | R5 | Explore | Haiku | ✓ |
| 0 | R6 | general-purpose | Sonnet | ✓ |
| 1.5 | N1 | general-purpose | Sonnet | ✓ with Phase 2 |
| 2 | I1 | general-purpose | Sonnet | ✓ with 1.5 |
| 3 | I2 | general-purpose | Sonnet | — |
| 5 | V1a | general-purpose | Sonnet | — |
| 5 | V1b | general-purpose | Sonnet | — |

Eleven agents total.

## Artifacts

- This plan (v2)
- 6 research reports under `docs/superpowers/research/2026-04-22-*.md`
- `docs/superpowers/plans/2026-04-22-admin-orders-wc-migration-critic-v1a.md` + `-v1b.md`
- `app/lib/admin/terminology.ts`
- `app/lib/admin/app-bridge.client.ts`
- `app/components/admin/orders/*.tsx` (9 files)
- `prisma/schema.prisma` extension + migration for `OrderNote`
- Edited `app/root.tsx` (CDN script), `app/routes/app.orders._index.tsx` + `$id.tsx` (cutover), `app/routes/app.tsx` (possible Box-padding adjustment), [CLAUDE.md](../../../CLAUDE.md), [docs/frontend/backend-api-reference.md](../../../docs/frontend/backend-api-reference.md)
