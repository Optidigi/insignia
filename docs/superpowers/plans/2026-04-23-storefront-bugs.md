# Storefront Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three storefront bugs — (#2) modal close returns to home instead of product page, (#3) upload requires two attempts, (#1) HTTP 500 on concurrent /prepare.

**Architecture:** PR 1 ships storefront UX fixes (P0); PR 2 ships backend concurrency safety (P1). No database migrations required — the partial unique index from migration `20260420000000` already exists.

**Tech Stack:** React 18 + React Router 7 | Shopify App Proxy | Prisma 6.x + PostgreSQL | Shopify Theme Extension | Vitest | TypeScript strict

---

## PR 1 — Storefront UX Fixes (Bugs #2 + #3, P0)

**Branch:** `fix/storefront-ux-p0`
**Files touched:**
- `extensions/insignia-theme/blocks/customize-button.liquid`
- `app/components/storefront/CustomizationModal.tsx`
- `app/components/storefront/UploadStep.tsx`
- `app/components/storefront/storefront-modal.css`
- `app/routes/apps.insignia.modal.tsx`

---

### Task 1 — Pre-flight verification (read live code, confirm line numbers)

- [ ] Read `extensions/insignia-theme/blocks/customize-button.liquid` lines 1–25.
  - Confirm line 20: `{% assign product_numeric_id = product.id | split: '/' | last %}`
  - Confirm line 21: `{% assign variant_numeric_id = product.selected_or_first_available_variant.id | split: '/' | last %}`
  - Confirm line 22: `{% assign modal_url = '/apps/insignia/modal?p=' | append: product_numeric_id | append: '&v=' | append: variant_numeric_id %}`
  - Confirm `returnUrl` is **absent** from line 22 (that is the bug).

- [ ] Read `app/components/storefront/CustomizationModal.tsx` lines 275–295.
  - Confirm `isDesktop` useState at line 280: `const [isDesktop, setIsDesktop] = useState(() =>`
  - Confirm SSR unsafe initializer at line 281: `typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false`
  - Confirm useEffect at lines 283–289 that calls `mq.addEventListener("change", onChange)`.

- [ ] Read `app/components/storefront/CustomizationModal.tsx` lines 668–681.
  - Confirm `closeNow()` at line 668–681 with `window.location.href = returnUrl ? \`${origin}${returnUrl}\` : \`${origin}/\`` (no path-traversal guard).

- [ ] Read `app/components/storefront/CustomizationModal.tsx` lines 1013–1046.
  - Confirm `{isDesktop ? (` conditional branch at line 1016.
  - Confirm desktop tree has `.insignia-modal-body-wrap` → `.insignia-desktop-preview` → `{desktopShowPreview && <PreviewCanvas …/>}` → `.insignia-desktop-content`.
  - Confirm mobile fallback at line 1040–1044 has `.insignia-modal-body` + `.insignia-mobile-footer-wrap`.

- [ ] Read `app/components/storefront/UploadStep.tsx` lines 200–214.
  - Confirm AbortError catch at lines 202–205: `if ((err as DOMException)?.name === "AbortError") { return; }`.
  - Confirm **no** `setState("idle"); setErrorBody(null);` before the `return` (that is the gap).

- [ ] Read `app/routes/apps.insignia.modal.tsx` lines 92–109.
  - Confirm `clientLoader` reads `returnUrl` from `url.searchParams.get("returnUrl")` (line 98).
  - Confirm **no** validation/sanitization of `returnUrl` before it is returned (that is the gap).

- [ ] Read `app/components/storefront/storefront-modal.css` lines 1719–1779.
  - Confirm `.insignia-modal-body-wrap`, `.insignia-desktop-preview`, `.insignia-desktop-content` are scoped inside `@media (min-width: 1024px)` breakpoint (confirmed: lines 1721, 1727, 1750 are all inside the `@media` block that starts at line 1694).
  - Confirm `.insignia-mobile-footer-wrap { display: contents; }` at line 1634, and `@media (min-width: 1024px) { .insignia-mobile-footer-wrap { display: none; } }` at lines 1636–1638.

**Expected outcome:** All confirmed facts match. Proceed only if confirmed. If any line number is off by more than 5 lines, adjust the edits in subsequent tasks accordingly (the logic is the same; adapt to actual line numbers).

---

### Task 2 — Fix Bug #2 (Liquid side): add `returnUrl` to `modal_url`

**File:** `extensions/insignia-theme/blocks/customize-button.liquid`

- [ ] Edit line 22. Replace:
  ```liquid
  {% assign modal_url = '/apps/insignia/modal?p=' | append: product_numeric_id | append: '&v=' | append: variant_numeric_id %}
  ```
  With:
  ```liquid
  {% assign encoded_return = product.url | url_encode %}
  {% assign modal_url = '/apps/insignia/modal?p=' | append: product_numeric_id | append: '&v=' | append: variant_numeric_id | append: '&returnUrl=' | append: encoded_return %}
  ```

  **Why:** `product.url` must be encoded into its own variable FIRST via `url_encode`, then appended. If `url_encode` is chained at the end of the full `modal_url` string it would encode the entire accumulated string — including `&returnUrl=` — turning `&returnUrl=%2Fproducts%2Ffoo` into `%26returnUrl%3D%2Fproducts%2Ffoo` and breaking the query string entirely. Encoding only `product.url` before appending keeps all other query-string characters literal.

  **Deploy note:** Theme extension changes take effect only after `shopify app deploy`. During development, edits are visible in the dev store's theme editor after the dev tunnel picks them up. Production merchants won't see the fix until the next app deploy.

- [ ] Validate the Liquid change with the Shopify Dev MCP:
  ```
  mcp__shopify-dev-mcp__validate_theme
  File: extensions/insignia-theme/blocks/customize-button.liquid
  ```

- [ ] Verify in the theme editor (design mode) that clicking the block still renders without JS errors (line 41 uses `{% if request.design_mode %}#{% else %}{{ modal_url }}{% endif %}` so the `#` fallback is unaffected).

---

### Task 3 — Fix Bug #2 (React side): harden `closeNow()` in `CustomizationModal.tsx`

**File:** `app/components/storefront/CustomizationModal.tsx`

- [ ] Locate the `closeNow` useCallback at approximately line 668. The current code is:
  ```typescript
  const closeNow = useCallback(() => {
    if (typeof window === "undefined") return;
    closingRef.current = true;
    const origin = window.location.origin;
    window.location.href = returnUrl ? `${origin}${returnUrl}` : `${origin}/`;
  }, [returnUrl]);
  ```

- [ ] Replace with the hardened version:
  ```typescript
  const closeNow = useCallback(() => {
    if (typeof window === "undefined") return;
    closingRef.current = true;
    const origin = window.location.origin;
    // Guard: returnUrl must be a clean store-relative path (starts with /,
    // no double-slash, no backslash). Rejects open-redirect attempts and
    // any value that slipped through without url_encode.
    const safeReturnUrl =
      returnUrl && /^\/(?!\/|\\)/.test(returnUrl) ? returnUrl : null;
    window.location.href = safeReturnUrl ? `${origin}${safeReturnUrl}` : `${origin}/`;
  }, [returnUrl]);
  ```

  **Why:** The regex `/^\/(?!\/|\\)/` requires the path to start with exactly one `/` and rejects `//evil.com` (double-slash redirect) and `\` (backslash bypass). This is defense-in-depth; the route-level guard in Task 4 is the primary defense.

---

### Task 4 — Fix Bug #2 (route side): reject self-referential `returnUrl` in `apps.insignia.modal.tsx`

**File:** `app/routes/apps.insignia.modal.tsx`

- [ ] Locate the `clientLoader` function at approximately line 92. The current code reads:
  ```typescript
  export async function clientLoader() {
    const url = new URL(window.location.href);
    const rawProductId = url.searchParams.get("productId") ?? url.searchParams.get("p") ?? "";
    const rawVariantId = url.searchParams.get("variantId") ?? url.searchParams.get("v") ?? "";
    const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
    const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;
    const returnUrl = url.searchParams.get("returnUrl");
    // Read appUrl from the <base> tag …
    const baseHref = document.querySelector("base")?.getAttribute("href");
    const appUrl = baseHref
      ? baseHref.replace(/^http:\/\//, "https://").replace(/\/$/, "")
      : window.location.origin;
    return { productId, variantId, appUrl, returnUrl };
  }
  ```

- [ ] Replace the `const returnUrl = url.searchParams.get("returnUrl");` line with:
  ```typescript
  const rawReturnUrl = url.searchParams.get("returnUrl");
  // Reject self-referential returnUrl values — if the customer lands back on
  // /apps/insignia/* the modal would re-open in a loop. Also strip any value
  // that is not a clean store-relative path (open-redirect guard).
  const returnUrl =
    rawReturnUrl &&
    /^\/(?!\/|\\)/.test(rawReturnUrl) &&
    !rawReturnUrl.startsWith("/apps/insignia/")
      ? rawReturnUrl
      : null;
  ```

  The full updated function must be:
  ```typescript
  export async function clientLoader() {
    const url = new URL(window.location.href);
    const rawProductId = url.searchParams.get("productId") ?? url.searchParams.get("p") ?? "";
    const rawVariantId = url.searchParams.get("variantId") ?? url.searchParams.get("v") ?? "";
    const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
    const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;
    const rawReturnUrl = url.searchParams.get("returnUrl");
    // Reject self-referential returnUrl values — if the customer lands back on
    // /apps/insignia/* the modal would re-open in a loop. Also strip any value
    // that is not a clean store-relative path (open-redirect guard).
    const returnUrl =
      rawReturnUrl &&
      /^\/(?!\/|\\)/.test(rawReturnUrl) &&
      !rawReturnUrl.startsWith("/apps/insignia/")
        ? rawReturnUrl
        : null;
    // Read appUrl from the <base> tag that AppProxyProvider injected on the server
    // render. Force https:// — if a stale http:// slips through from an old SSR,
    // mixed-content would block every bundle load. Trim trailing slash too.
    const baseHref = document.querySelector("base")?.getAttribute("href");
    const appUrl = baseHref
      ? baseHref.replace(/^http:\/\//, "https://").replace(/\/$/, "")
      : window.location.origin;
    return { productId, variantId, appUrl, returnUrl };
  }
  ```

---

### Task 5 — Verify Bug #2 fixes (typecheck + lint + theme validate + commit)

- [ ] Run TypeScript typecheck:
  ```bash
  npm run typecheck
  ```
  Must exit 0. New type errors are not acceptable. Pre-existing errors in unrelated files are acceptable.

- [ ] Run ESLint:
  ```bash
  npm run lint
  ```
  Must exit 0. Fix any new lint errors introduced by the edits above.

- [ ] Validate the theme extension Liquid file:
  ```
  mcp__shopify-dev-mcp__validate_theme
  File: extensions/insignia-theme/blocks/customize-button.liquid
  ```
  Must report no errors.

  > **Reminder:** Theme extension changes take effect only after `shopify app deploy`. During development, edits are visible in the dev store's theme editor after the dev tunnel picks them up. Production merchants won't see the fix until the next app deploy.

- [ ] Commit:
  ```bash
  git add extensions/insignia-theme/blocks/customize-button.liquid \
          app/components/storefront/CustomizationModal.tsx \
          app/routes/apps.insignia.modal.tsx
  git commit -m "$(cat <<'EOF'
  fix(storefront): Bug #2 — modal close now returns to product page

  - Liquid: append &returnUrl=<url_encoded product.url> to modal_url so
    the Customize button carries the product page path into the modal.
  - React: harden closeNow() with /^\/(?!\/|\\)/ guard to reject
    open-redirect and double-slash bypass attempts.
  - Route clientLoader: reject returnUrl starting with /apps/insignia/
    (prevents modal re-entry loop) and non-relative paths.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6 — Fix Bug #3: remove `isDesktop` state and unify JSX tree in `CustomizationModal.tsx`

**File:** `app/components/storefront/CustomizationModal.tsx`

The root cause: `isDesktop` useState initializer uses `window.matchMedia` on the client but returns `false` on the server. On a desktop viewport the server renders the mobile tree; after hydration React detects `isDesktop=true` and switches to the desktop tree — this remounts the entire subtree, killing `UploadStep`'s in-flight fetch via the cleanup `useEffect`.

Fix: remove `isDesktop` entirely. Use a single HTML structure that is always the desktop layout, and use CSS `@media` queries (Task 7) to toggle mobile vs. desktop appearance.

**PreviewCanvas Konva viewport gate (critical):** With the unified tree, `<PreviewCanvas>` (inside `.insignia-desktop-preview`) mounts on mobile with `display: none`. Konva computes 0-width geometry in this state, causing warnings, broken pointer math, and a potential crash when the viewport crosses 1024px. To prevent this, add a `useIsDesktopViewport` hook using `useSyncExternalStore` that gates ONLY the `<PreviewCanvas>` mount. This hook must NOT be used to branch the JSX tree — the unified structure stays intact.

```tsx
// At top of CustomizationModal (after other hooks)
function useIsDesktopViewport(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches, // client snapshot
    () => false, // server snapshot — mobile-first (SSR returns false)
  );
}
```

SSR snapshot is `false` (mobile-first). Client snapshot reads matchMedia live. This hook is subscribed to matchMedia changes so it updates reactively. Remounting `PreviewCanvas` on viewport change is acceptable (it does not kill uploads); remounting `UploadStep` is not (the original bug — which the unified tree solves).

- [ ] Remove the `isDesktop` useState and its useEffect. Locate approximately lines 275–289:
  ```typescript
  // Track which layout is active so we mount only ONE step instance.
  // Mounting both (mobile + desktop simultaneously) creates duplicate component
  // instances that each hold their own activeIndex — and the React ref ends up
  // pointing at whichever rendered last, so SizeStep's tryAdvance() acts on the
  // wrong instance and Next-step jumps over placements on desktop.
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  ```
  Delete these 10 lines entirely.

- [ ] Locate the body JSX conditional at approximately lines 1013–1045:
  ```tsx
  {/* Body — desktop wraps in a 60/40 split. Only ONE layout mounts at
      a time so step-component refs (SizeStep.tryAdvance) target the
      live instance rather than a hidden duplicate. */}
  {isDesktop ? (
    <div className="insignia-modal-body-wrap">
      <aside className="insignia-desktop-preview">
        <div className="insignia-desktop-preview-canvas">
          {desktopShowPreview && (
            <PreviewCanvas
              config={config}
              placementSelections={placementSelections}
              logo={logo}
              viewId={desktopActiveViewId}
              onViewChange={setDesktopActiveViewId}
              context="panel"
              onImageMeta={onImageMeta}
              onLogoMeta={onLogoMeta}
              t={t}
            />
          )}
        </div>
      </aside>
      <section className="insignia-desktop-content">
        <div className="insignia-desktop-content-body">{renderStep()}</div>
        {renderFooter()}
      </section>
    </div>
  ) : (
    <>
      <div className="insignia-modal-body">{renderStep()}</div>
      <div className="insignia-mobile-footer-wrap">{renderFooter()}</div>
    </>
  )}
  ```

  Before the component return, add a call to the new hook (declared above the component or as a module-level function):
  ```tsx
  const isDesktopViewport = useIsDesktopViewport();
  ```

  Replace the entire conditional with a single unified tree:
  ```tsx
  {/* Body — single tree, always rendered. CSS media queries in
      storefront-modal.css handle the mobile/desktop layout split.
      This avoids the SSR/hydration mismatch that previously remounted
      the entire subtree on desktop (isDesktop: false→true), which was
      aborting in-flight uploads via UploadStep's cleanup effect.
      PreviewCanvas is additionally gated by isDesktopViewport to prevent
      Konva 0-width geometry errors when the aside is display:none on mobile. */}
  <div className="insignia-modal-body-wrap">
    <aside className="insignia-desktop-preview">
      <div className="insignia-desktop-preview-canvas">
        {desktopShowPreview && isDesktopViewport && (
          <PreviewCanvas
            config={config}
            placementSelections={placementSelections}
            logo={logo}
            viewId={desktopActiveViewId}
            onViewChange={setDesktopActiveViewId}
            context="panel"
            onImageMeta={onImageMeta}
            onLogoMeta={onLogoMeta}
            t={t}
          />
        )}
      </div>
    </aside>
    <section className="insignia-desktop-content">
      <div className="insignia-desktop-content-body">{renderStep()}</div>
      {renderFooter()}
    </section>
  </div>
  ```

  **Critical:** `isDesktopViewport` gates ONLY `<PreviewCanvas>`. It does NOT gate the outer `<aside>` or any other part of the tree. The unified JSX structure is always rendered — only the expensive Konva canvas is conditionally mounted. This keeps all other components (including `UploadStep`) stable across viewport changes.

  **Important:** The `.insignia-mobile-footer-wrap` wrapper that existed in the mobile branch is dropped. On mobile the footer is now rendered directly inside `.insignia-desktop-content`, which CSS will style correctly (Task 7 ensures the footer appears at the bottom on mobile via flex layout). The `.insignia-modal-body` wrapper is also dropped — `.insignia-desktop-content-body` replaces it.

---

### Task 7 — Fix Bug #3 (CSS): add mobile media queries to `storefront-modal.css`

**File:** `app/components/storefront/storefront-modal.css`

The unified JSX tree from Task 6 always renders `.insignia-modal-body-wrap` with `.insignia-desktop-preview` and `.insignia-desktop-content`. On mobile these need to be stacked vertically with the preview hidden. The existing `@media (min-width: 1024px)` block already styles them correctly for desktop. We need to add the mobile-default (no-media-query) styles and update the desktop block to reflect the single-tree structure.

- [ ] Locate the section starting at approximately line 1630:
  ```css
  /* ===== Mobile-only / desktop-only utilities ===== */
  .insignia-only-desktop { display: none; }
  .insignia-only-mobile { display: block; }

  .insignia-mobile-footer-wrap { display: contents; }

  @media (min-width: 1024px) {
    .insignia-mobile-footer-wrap { display: none; }
  }
  ```

  Replace this entire section (6 lines) with:
  ```css
  /* ===== Mobile-only / desktop-only utilities ===== */
  .insignia-only-desktop { display: none; }
  .insignia-only-mobile { display: block; }

  /* ===== Unified body-wrap: mobile-default layout ===== */
  /* On mobile the body-wrap is a flex column; preview pane is hidden;
     content pane fills the viewport. This mirrors the old mobile branch
     without requiring a separate HTML tree (avoids SSR/hydration mismatch). */
  .insignia-modal-body-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
  .insignia-desktop-preview {
    display: none;
  }
  .insignia-desktop-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
  .insignia-desktop-content-body {
    flex: 1;
    min-height: 0; /* critical for flex children to shrink below content */
    overflow-y: auto;
    padding: 16px;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    min-width: 0;
    overflow-x: hidden;
  }
  .insignia-modal-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--insignia-border);
    background: var(--insignia-bg);
  }
  ```

  **Why these scroll properties matter:** The original `.insignia-modal-body` (mobile branch) had `flex: 1`, `min-height: 0`, `overflow-y: auto`, `padding: 16px`, `overscroll-behavior: contain`, `-webkit-overflow-scrolling: touch`, and `touch-action: pan-y`. All of these must carry over to `.insignia-desktop-content-body` since it now applies at all viewports. Dropping them would regress iOS scroll momentum and overscroll containment on mobile.

  **Regarding `.insignia-modal-body`:** Before deleting or keeping the old `.insignia-modal-body` selector, read `storefront-modal.css` around line 248 to check whether any rules there are NOT already covered by `.insignia-desktop-content-body`. If `.insignia-modal-body` only contains the properties listed above, it can be safely deleted. If it contains other layout rules not migrated here, migrate them first. Note this check in a comment when you perform the edit.

- [ ] Locate the existing `@media (min-width: 1024px)` block that contains `.insignia-modal-body-wrap` (approximately lines 1694–1779). Inside that block, verify the desktop overrides for these same classes already exist (they do per pre-flight). Confirm they look like:
  ```css
  @media (min-width: 1024px) {
    /* ... other desktop rules ... */

    .insignia-modal-body-wrap {
      display: grid;
      grid-template-columns: 60% 40%;
      flex: 1;
      overflow: hidden;
    }
    .insignia-desktop-preview {
      background: var(--insignia-bg-subtle);
      padding: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      overflow-y: auto;
    }
    /* ... desktop-content, desktop-content-body, modal-footer etc. ... */
  }
  ```
  These desktop overrides must be present. If `.insignia-desktop-preview` inside the media block still has `display: flex` (or any display value), that is correct — it will override the mobile `display: none`. If the override is missing, add `display: flex;` to the `.insignia-desktop-preview` block inside `@media (min-width: 1024px)`.

  **Checklist:**
  - [ ] `.insignia-desktop-preview` inside `@media` has `display: flex` (or equivalent). If not, add it.
  - [ ] `.insignia-modal-body-wrap` inside `@media` has `display: grid`. Already present.
  - [ ] `.insignia-desktop-content` inside `@media` has `display: flex`. Already present.

---

### Task 8 — Fix Bug #3 (defense-in-depth): harden `UploadStep.tsx` AbortError catch

**File:** `app/components/storefront/UploadStep.tsx`

Even after Task 6 eliminates the hydration remount, it is good practice for `UploadStep` to reset to idle if an abort happens unexpectedly (e.g. React Strict Mode double-invoke in dev, or future refactors that re-introduce remounting). Currently, aborting due to anything other than user cancellation leaves the component in `"uploading"` state with a stall timer counting down.

- [ ] Locate the catch block at approximately lines 202–205:
  ```typescript
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") {
      return; // user cancelled
    }
  ```

  Replace with:
  ```typescript
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") {
      // Aborted — could be explicit user cancel (cancelUpload()) or component
      // unmount cleanup. Reset to idle so re-mounting the component starts fresh.
      setState("idle");
      setErrorBody(null);
      return;
    }
  ```

  **Why:** `cancelUpload()` already calls `setState("idle"); setErrorBody(null)` before calling `.abort()`, so adding it here is a no-op for user cancellations. For abort-on-unmount the component is being torn down anyway, but if React ever re-mounts it (e.g. dev Strict Mode or future structural changes), this ensures the re-mount starts in the `"idle"` state.

---

### Task 9 — Verify Bug #3 fixes (typecheck + lint + visual verification + commit)

- [ ] Run TypeScript typecheck:
  ```bash
  npm run typecheck
  ```
  Must exit 0.

- [ ] Run ESLint:
  ```bash
  npm run lint
  ```
  Must exit 0.

- [ ] Take Playwright screenshots to verify mobile layout (375px), tablet (768px), and desktop (1280px). All screenshots must be JPG format:
  ```
  mcp__playwright (or equivalent Playwright MCP tool)
  Navigate to the modal URL at each viewport width.
  Take JPG screenshots at:
    - 375px wide  (iPhone SE — mobile layout: no preview pane, content fills full width)
    - 768px wide  (tablet  — mobile layout still applies below 1024px)
    - 1280px wide (desktop — 60/40 split: preview left, content right)
  Verify:
    - At 375px: no preview pane visible, upload step fills full width, footer at bottom
    - At 768px: same as 375px (breakpoint is 1024px)
    - At 1280px: preview pane visible on left, content on right, footer inside right pane
  ```

- [ ] Commit:
  ```bash
  git add app/components/storefront/CustomizationModal.tsx \
          app/components/storefront/UploadStep.tsx \
          app/components/storefront/storefront-modal.css
  git commit -m "$(cat <<'EOF'
  fix(storefront): Bug #3 — remove isDesktop state, unify JSX tree

  Replace the isDesktop useState + matchMedia useEffect with a single
  always-rendered HTML tree. CSS @media queries handle the mobile/desktop
  layout split. This eliminates the SSR→client hydration mismatch
  (isDesktop: false→true on desktop) that was remounting the entire
  subtree and aborting in-flight uploads via UploadStep's cleanup effect.

  Defense-in-depth: reset UploadStep to idle on AbortError so a future
  remount starts in a clean state.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10 — Integration check: manual reproduction steps for Bugs #2 and #3

These steps confirm the bugs are fixed end-to-end. Run on the dev server (`npm run dev`).

**Bug #2 — Close returns to product page:**
- [ ] Navigate to a product page that has the Insignia block (e.g. `/products/test-product`).
- [ ] Click "Customize". Confirm the modal URL is `/apps/insignia/modal?p=…&v=…&returnUrl=%2Fproducts%2Ftest-product`.
- [ ] Click the × close button.
- [ ] Confirm you land on `/products/test-product`, NOT on `/` (home page).
- [ ] Repeat with a close via "Close Anyway" in the confirmation dialog.

**Bug #3 — Upload succeeds on first attempt:**
- [ ] Open the modal (from the product page, so returnUrl is set).
- [ ] On the Upload step, pick a valid PNG file and confirm it uploads successfully on the **first click**.
- [ ] Open browser DevTools → Network tab. Confirm the POST to `/apps/insignia/uploads` is NOT cancelled (status 200 or similar, no "cancelled" row).
- [ ] Check for React hydration warnings in the console — there must be none related to `insignia-modal-body-wrap` or `insignia-desktop-preview`.

---

## PR 2 — Concurrency Safety (Bug #1, P1)

**Branch:** `fix/storefront-concurrency-p1`
**Files touched:**
- `app/lib/services/storefront-prepare.server.ts`
- `app/lib/services/__tests__/storefront-prepare.server.test.ts`

---

### Task 11 — Pre-flight: verify transaction body line numbers in `storefront-prepare.server.ts`

- [ ] Read `app/lib/services/storefront-prepare.server.ts` lines 160–215.
  - Confirm the retry loop at line 163: `for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS && !acquired; attempt++)`
  - Confirm the `db.$transaction` call at line 168.
  - Confirm `tx.customizationConfig.create` at lines 183–194 has **no surrounding try/catch** (that is the bug).
  - Confirm `tx.variantSlot.update` at lines 196–204.
  - Confirm NO `pg_advisory_xact_lock` call at the top of the transaction body (only in `variant-pool.server.ts`).

- [ ] Read `app/lib/services/variant-pool.server.ts` lines 425–437.
  - Confirm `pg_advisory_xact_lock(hashtext(${shopId}), hashtext(${methodId}))` pattern using `tx.$executeRaw`.
  - Note the two-argument form: `hashtext(shopId)` and `hashtext(methodId)`. The prepare fix will use a one-argument form: `hashtext(${customizationId})` (per-customization granularity).

- [ ] Read `app/lib/services/storefront-prepare.server.ts` lines 1–15.
  - Confirm current imports: `db`, `AppError`, `ErrorCodes`, `computeCustomizationPrice`, `ensureVariantPoolExists`.
  - Confirm `Prisma` (from `@prisma/client`) is **not** currently imported.

- [ ] Conditional step — check production logs for P2002 errors:
  If your environment has access to production logs (e.g. Docker logs, Heroku logs), run:
  ```bash
  # Replace with your actual log command
  docker logs insignia-app 2>&1 | grep "P2002" | tail -20
  ```
  If P2002 entries are found, note the frequency and timestamps. If logs are unavailable, proceed — the code-level evidence (partial unique index + no P2002 catch) confirms the bug path. Note in the commit message: "P2002 not confirmed from logs — proceeding on code analysis."

---

### Task 12 — Add `Prisma` import to `storefront-prepare.server.ts`

**File:** `app/lib/services/storefront-prepare.server.ts`

- [ ] Locate the imports block at lines 1–10:
  ```typescript
  import db from "../../db.server";
  const PRICING_VERSION = "v1";
  import { AppError, ErrorCodes } from "../errors.server";
  import { computeCustomizationPrice } from "./storefront-customizations.server";
  import { ensureVariantPoolExists } from "./variant-pool.server";
  ```

  Replace with:
  ```typescript
  import { Prisma } from "@prisma/client";
  import db from "../../db.server";
  const PRICING_VERSION = "v1";
  import { AppError, ErrorCodes } from "../errors.server";
  import { computeCustomizationPrice } from "./storefront-customizations.server";
  import { ensureVariantPoolExists } from "./variant-pool.server";
  ```

  **Why:** `Prisma.PrismaClientKnownRequestError` is the typed error class thrown on known database constraint violations (P2002 = unique constraint). Importing from `@prisma/client` (not from `@prisma/client/runtime/library`) is the correct Prisma 5+/6+ pattern.

---

### Task 13 — Wrap `tx.customizationConfig.create` in P2002 try/catch with idempotent read fallback

**File:** `app/lib/services/storefront-prepare.server.ts`

- [ ] Before the retry loop, declare the `AcquireResult` discriminated union type. This replaces the old sentinel approach (`alreadyReserved: true` flag + `as` casts):
  ```typescript
  type AcquireResult =
    | {
        kind: "acquired";
        config: { id: string };
        slot: { id: string; shopifyProductId: string; shopifyVariantId: string };
      }
    | {
        kind: "already-reserved";
        config: {
          id: string;
          configHash: string;
          pricingVersion: string;
          unitPriceCents: number;
          feeCents: number;
        };
        slot: { id: string; shopifyProductId: string; shopifyVariantId: string };
      };
  ```

  Update the `acquired` variable declaration at approximately line 162 to use this type:
  ```typescript
  let acquired: AcquireResult | null = null;
  ```

- [ ] Locate the `db.$transaction` body at approximately lines 168–207. The current code inside the transaction callback is:
  ```typescript
  acquired = await db.$transaction(async (tx) => {
    const freeSlots: Array<{ id: string; shopifyProductId: string; shopifyVariantId: string }> =
      await tx.$queryRaw`
        SELECT id, "shopifyProductId", "shopifyVariantId"
        FROM "VariantSlot"
        WHERE "shopId" = ${shopId}
          AND "methodId" = ${methodId}
          AND state = 'FREE'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
    const freeSlot = freeSlots[0];
    if (!freeSlot) return null;

    const config = await tx.customizationConfig.create({
      data: {
        shopId,
        methodId,
        configHash: configHash!,
        pricingVersion: pricingVersion!,
        unitPriceCents: unitPriceCents!,
        feeCents: feeCents ?? 0,
        state: "RESERVED",
        customizationDraftId: customizationId,
      },
    });

    await tx.variantSlot.update({
      where: { id: freeSlot.id },
      data: {
        state: "RESERVED",
        reservedAt: now,
        reservedUntil,
        currentConfigId: config.id,
      },
    });

    return { config, slot: freeSlot };
  });
  ```

  Replace the entire `db.$transaction` call with:
  ```typescript
  acquired = await db.$transaction(async (tx) => {
    // Advisory lock scoped to this customization — serializes concurrent
    // /prepare calls for the same draft. Same pattern as variant-pool.server.ts:435.
    // One-arg hashtext() maps the 36-char UUID to an int8 lock key.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${customizationId}))
    `;

    const freeSlots: Array<{ id: string; shopifyProductId: string; shopifyVariantId: string }> =
      await tx.$queryRaw`
        SELECT id, "shopifyProductId", "shopifyVariantId"
        FROM "VariantSlot"
        WHERE "shopId" = ${shopId}
          AND "methodId" = ${methodId}
          AND state = 'FREE'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
    const freeSlot = freeSlots[0];
    if (!freeSlot) return null;

    let config: { id: string };
    try {
      config = await tx.customizationConfig.create({
        data: {
          shopId,
          methodId,
          configHash: configHash!,
          pricingVersion: pricingVersion!,
          unitPriceCents: unitPriceCents!,
          feeCents: feeCents ?? 0,
          state: "RESERVED",
          customizationDraftId: customizationId,
        },
      });
    } catch (err) {
      // P2002: the partial unique index on (customizationDraftId) WHERE state='RESERVED'
      // was violated — a concurrent /prepare call won the race and already
      // created a RESERVED config for this draft. Read the winner's config and
      // slot, then return them so the caller can skip the Shopify price update.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winnerConfig = await tx.customizationConfig.findFirst({
          where: { customizationDraftId: customizationId, state: "RESERVED" },
          select: { id: true, configHash: true, pricingVersion: true, unitPriceCents: true, feeCents: true },
        });
        const winnerSlot = winnerConfig
          ? await tx.variantSlot.findUnique({
              where: { currentConfigId: winnerConfig.id },
              select: { id: true, shopifyProductId: true, shopifyVariantId: true },
            })
          : null;
        if (winnerConfig && winnerSlot) {
          // Concurrent winner already reserved — return via discriminated union.
          // Caller checks result.kind === "already-reserved" and skips Shopify price update.
          return {
            kind: "already-reserved" as const,
            config: {
              ...winnerConfig,
              feeCents: winnerConfig.feeCents ?? 0,
            },
            slot: winnerSlot,
          };
        }
        // Partial index race with no readable winner — treat as if no slot was acquired.
        return null;
      }
      throw err;
    }

    await tx.variantSlot.update({
      where: { id: freeSlot.id },
      data: {
        state: "RESERVED",
        reservedAt: now,
        reservedUntil,
        currentConfigId: config.id,
      },
    });

    return { kind: "acquired" as const, config, slot: freeSlot };
  });
  ```

---

### Task 14 — Handle `AcquireResult` discriminated union in the caller (skip `productVariantsBulkUpdate`)

**File:** `app/lib/services/storefront-prepare.server.ts`

The `kind: "already-reserved"` branch from Task 13 must be checked before the `productVariantsBulkUpdate` Shopify call. A concurrent winner already set the price; the loser must return the same result without re-calling Shopify. No `as` casts — the discriminated union narrows types automatically.

- [ ] Locate the code after the retry loop (approximately line 216 after Task 13's changes). It currently reads:
  ```typescript
  if (!acquired) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "All customization slots are in use. Please try again shortly.",
      503
    );
  }
  const result = acquired;

  const priceStr = ((feeCents ?? 0) / 100).toFixed(2);
  const variantId = result.slot.shopifyVariantId;
  ```

  The full block after the loop (from `if (!acquired)` through the Shopify price check) must now read:
  ```typescript
  if (!acquired) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "All customization slots are in use. Please try again shortly.",
      503
    );
  }
  const result = acquired;

  // Discriminated union — switch on kind, no type casts needed.
  if (result.kind === "already-reserved") {
    // A concurrent /prepare call won the race and already set the Shopify
    // variant price. Return the winner's data directly — no Shopify call needed.
    return {
      slotVariantId: result.slot.shopifyVariantId,
      configHash: result.config.configHash,
      pricingVersion: result.config.pricingVersion,
      unitPriceCents: result.config.unitPriceCents,
      feeCents: result.config.feeCents,
    };
  }

  const priceStr = ((feeCents ?? 0) / 100).toFixed(2);
  const variantId = result.slot.shopifyVariantId;
  // … rest of function unchanged …
  ```

  TypeScript will narrow `result` to `{ kind: "acquired"; config: { id: string }; slot: ... }` after the `"already-reserved"` branch exits, so the subsequent code can safely access `result.config.id` without errors.

---

### Task 15 — Write Vitest concurrency test

**File:** `app/lib/services/__tests__/storefront-prepare.server.test.ts`

This test verifies that a concurrent P2002 does NOT propagate as HTTP 500. It uses the existing test file's mock structure — study the file before editing. The new test goes inside the existing `describe("prepareCustomization", ...)` block.

- [ ] Read the full test file at `app/lib/services/__tests__/storefront-prepare.server.test.ts` (already done in pre-flight). Note:
  - Mock hoisting pattern using `vi.hoisted`
  - `prismaMock` shape (must add `$executeRaw` mock for the advisory lock)
  - `makeAdminGraphql()` helper
  - `makeSuccessfulTransaction()` helper

- [ ] Confirm `prismaMock` in `vi.hoisted` at line 7 already has `$executeRaw: makeFn()`. If it does not, add `$executeRaw: makeFn()` to the hoisted mock object.

- [ ] Add the following test case inside the `describe("prepareCustomization", ...)` block, after the existing "throws SERVICE_UNAVAILABLE" test:

  ```typescript
  it("is idempotent on P2002 — concurrent /prepare returns the winner's slot without 500", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT);
    // No existing RESERVED config at the idempotency short-circuit
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);
    // Expired-slot cleanup: nothing to expire
    prismaMock.variantSlot.findMany.mockResolvedValue([]);
    prismaMock.variantSlot.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.customizationConfig.updateMany.mockResolvedValue({ count: 0 });

    // The winner's config that was created by the concurrent call
    const WINNER_CONFIG = {
      id: "cfg-winner",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
    };
    const WINNER_SLOT = {
      id: "slot-winner",
      shopifyProductId: "gid://shopify/Product/99",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
    };

    // Transaction mock: advisory lock ok, free slot found, create throws P2002,
    // findFirst returns the winner's config, findUnique returns the winner's slot.
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          $executeRaw: vi.fn().mockResolvedValue(undefined), // advisory lock
          $queryRaw: vi.fn().mockResolvedValue([MOCK_SLOT]), // free slot found
          customizationConfig: {
            create: vi.fn().mockRejectedValue(
              Object.assign(new Error("Unique constraint failed on the constraint: `CustomizationConfig_customizationDraftId_state_key`"), {
                code: "P2002",
                name: "PrismaClientKnownRequestError",
              })
            ),
            findFirst: vi.fn().mockResolvedValue(WINNER_CONFIG),
          },
          variantSlot: {
            findUnique: vi.fn().mockResolvedValue(WINNER_SLOT),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(fakeTx);
      }
    );

    const adminGraphql = makeAdminGraphql();

    // Must NOT throw — must return the winner's slot data
    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result).toEqual({
      slotVariantId: "gid://shopify/ProductVariant/1",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
    });

    // The Shopify variant price update must NOT be called — the winner already set it
    expect(adminGraphql).not.toHaveBeenCalledWith(
      expect.stringContaining("productVariantsBulkUpdate"),
      expect.anything()
    );

    // Advisory lock must have been called — it is part of the concurrency contract.
    // If a future refactor drops the lock, this assertion will catch it.
    // The fakeTx.$executeRaw is captured in the closure; retrieve it via the mock impl.
    // Simpler: assert on the transaction mock that the inner fn received a tx with $executeRaw called.
    // Because fakeTx is local to the mock, assert indirectly: the transaction was entered once
    // and $executeRaw was invoked (via the mock impl capturing fakeTx).
    // To assert directly, hoist fakeTx out of the mock closure:
    let capturedTx: { $executeRaw: ReturnType<typeof vi.fn> } | undefined;
    prismaMock.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTxWithCapture = {
          $executeRaw: vi.fn().mockResolvedValue(undefined),
          $queryRaw: vi.fn().mockResolvedValue([MOCK_SLOT]),
          customizationConfig: {
            create: vi.fn().mockRejectedValue(
              new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed on the constraint: `CustomizationConfig_customizationDraftId_state_key`",
                { code: "P2002", clientVersion: "6.0.0", meta: {} }
              )
            ),
            findFirst: vi.fn().mockResolvedValue(WINNER_CONFIG),
          },
          variantSlot: {
            findUnique: vi.fn().mockResolvedValue(WINNER_SLOT),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        capturedTx = fakeTxWithCapture;
        return fn(fakeTxWithCapture);
      }
    );
    // Re-run after capturing tx (the first run above used the non-capturing mock):
    await prepareCustomization("shop-1", "draft-1", makeAdminGraphql());
    expect(capturedTx!.$executeRaw).toHaveBeenCalledWith(
      expect.anything(), // template strings array for pg_advisory_xact_lock
      expect.any(String), // customizationId hashtext arg
    );
  });
  ```

  **Implementation note:** The test body above contains two runs — the first validates the result shape and the no-Shopify-call assertions, the second (with `mockImplementationOnce`) re-runs to capture `fakeTx` and assert `$executeRaw`. Refactor into a single run with the capturing mock if the test structure allows — the key requirement is that `$executeRaw` is asserted `toHaveBeenCalled` on the captured transaction object. This assertion is non-optional: the advisory lock is a core correctness guarantee for the concurrency fix.

  **Note on the P2002 mock:** In a real Vitest environment, `Prisma.PrismaClientKnownRequestError` is a class from `@prisma/client`. The mock above throws a plain Error with `code: "P2002"` and `name: "PrismaClientKnownRequestError"` set manually. The fix code uses `err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"`. For the instanceof check to work correctly in the test, the mock must either:
  - (A) Actually use `new Prisma.PrismaClientKnownRequestError(...)`, or
  - (B) The test mock of `@prisma/client` in `vi.hoisted` needs to export a matching `Prisma` namespace.

  Because the existing test file mocks `../../../db.server` but does NOT mock `@prisma/client`, the real `Prisma.PrismaClientKnownRequestError` class is available. Use option A — throw an actual `Prisma.PrismaClientKnownRequestError`:

  ```typescript
  // At the top of the test file, after existing imports, add:
  import { Prisma } from "@prisma/client";
  ```

  Then replace the mock error with:
  ```typescript
  create: vi.fn().mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `CustomizationConfig_customizationDraftId_state_key`",
      { code: "P2002", clientVersion: "6.0.0", meta: {} }
    )
  ),
  ```

---

### Task 16 — Run tests, confirm TDD cycle passes

- [ ] Run the full test suite to confirm no regressions:
  ```bash
  npm test
  ```
  All tests must pass.

- [ ] Run only the prepare test file to see the new test result:
  ```bash
  npx vitest run app/lib/services/__tests__/storefront-prepare.server.test.ts
  ```
  Expected: 5 passing tests (4 original + 1 new concurrency test).

- [ ] **TDD verification step (REQUIRED):** To confirm the test actually catches the bug, temporarily revert Task 13's try/catch (comment out the P2002 catch block so P2002 propagates) and run the test again. The new test MUST **fail**. Then restore the fix and confirm it passes again. This red→green cycle is non-negotiable: the P2002 race condition is the entire reason this task exists, and a test that passes whether or not the fix is present provides zero coverage guarantee.

---

### Task 17 — Typecheck + lint + commit for PR 2

- [ ] Run TypeScript typecheck:
  ```bash
  npm run typecheck
  ```
  Must exit 0. Pay special attention to the `AcquireResult` discriminated union — the `acquired` variable is typed as `AcquireResult | null` (declared in Task 13). TypeScript narrows `result.kind === "already-reserved"` without any `as` casts. If the compiler complains about missing fields on `result.config` in the happy path, verify the `kind: "acquired"` branch is reached (i.e., the early return in the `"already-reserved"` branch ensures the rest of the function only sees `kind: "acquired"`). The `AcquireResult` type declaration and the `let acquired: AcquireResult | null = null;` annotation (from Task 13) are the sole source of truth — do not revert to the old optional-field approach.

- [ ] Run ESLint:
  ```bash
  npm run lint
  ```
  Must exit 0.

- [ ] Commit:
  ```bash
  git add app/lib/services/storefront-prepare.server.ts \
          app/lib/services/__tests__/storefront-prepare.server.test.ts
  git commit -m "$(cat <<'EOF'
  fix(storefront): Bug #1 — prevent P2002 HTTP 500 on concurrent /prepare

  - Add pg_advisory_xact_lock(hashtext(customizationId)) at start of
    transaction body to serialize concurrent /prepare calls per draft.
    Same pattern as variant-pool.server.ts advisory lock.
  - Wrap tx.customizationConfig.create in P2002 try/catch. On conflict
    (partial unique index: customizationDraftId WHERE state='RESERVED'),
    read the winning config + slot and return kind:"already-reserved" via
    AcquireResult discriminated union (no "as" casts, no "in" sentinel checks),
    skipping the redundant productVariantsBulkUpdate Shopify call.
  - Add Vitest concurrency test: P2002 path returns winner's slot data
    without calling adminGraphql productVariantsBulkUpdate.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Final checklist before opening PRs

### PR 1 (Bugs #2 + #3):
- [ ] All tasks 1–10 completed and checked off.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] Theme validated: `mcp__shopify-dev-mcp__validate_theme` passes for `customize-button.liquid`.
- [ ] Playwright screenshots taken at 375px, 768px, 1280px and verified visually.
- [ ] Manual integration check (Task 10) passed.

### PR 2 (Bug #1):
- [ ] All tasks 11–17 completed and checked off.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes (5 tests in prepare test file).

### Both PRs:
- [ ] No `.env`, credentials, or secret files staged.
- [ ] Commit messages follow Conventional Commits format matching repo style.
- [ ] Branch names: `fix/storefront-ux-p0` and `fix/storefront-concurrency-p1`.
- [ ] PRs target `main` branch.
