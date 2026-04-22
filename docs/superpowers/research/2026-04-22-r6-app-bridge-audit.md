# App Bridge Integration Audit — Insignia Remix App

**Date:** 2026-04-22  
**Scope:** `@shopify/app-bridge-react@4.2.4`, `@shopify/shopify-app-react-router@1.2.0`

---

## 1. Current App Bridge Setup

**Package providing `AppProvider`:** `@shopify/shopify-app-react-router/react` (v1.2.0).  
This is NOT `@shopify/shopify-app-remix`. The app migrated to the React Router adapter.

**Script injection — confirmed from source:**  
`node_modules/@shopify/shopify-app-react-router/src/react/components/AppProvider/AppProvider.tsx` shows the provider injects two `<script>` tags automatically:

1. `https://cdn.shopify.com/shopifycloud/app-bridge.js` (with `data-api-key`) — only when `embedded={true}`
2. `https://cdn.shopify.com/shopifycloud/polaris.js` — **always**, regardless of `embedded` prop

Both are rendered as React `<script>` elements inside the component tree, not in `<head>`. This is relevant to the loading order question in section 5.

**`app/routes/app.tsx` confirms:** `<AppProvider embedded apiKey={apiKey}>` is used. Both scripts are already being injected by the provider. There is no manual script tag in `app/root.tsx` for either.

**`polaris.js` status:** Already loaded via the `AppProvider` component. Any migration that adds `<s-*>` web components is already covered.

**App Bridge React version:** `4.2.4`. This is the v4 generation. All v4 features (`toast`, `saveBar`, `modal`, `resourcePicker`, `loading`, `idToken`, etc.) are available.

---

## 2. `useAppBridge()` Hook Surface

From `@shopify/app-bridge-react/build/types/esm/hooks/useAppBridge.d.ts`, the hook returns `ShopifyGlobal`. The full interface is defined in `@shopify/app-bridge-types/dist/shopify.ts`:

```ts
interface ShopifyGlobal {
  config: AppBridgeConfig;
  origin: string;
  ready: Promise<void>;
  environment: EnvironmentApi;       // .mobile, .embedded, .pos
  loading: LoadingApi;               // (isLoading?: boolean) => void
  idToken: IdTokenApi;               // () => Promise<string>
  user: UserApi;
  toast: ToastApi;                   // .show(message, opts?) / .hide(id)
  resourcePicker: ResourcePickerApi; // (options) => Promise<SelectPayload | undefined>
  scanner: ScannerApi;
  modal: ModalApi;                   // .show(id) / .hide(id) / .toggle(id)
  saveBar: SaveBarApi;               // .show(id) / .hide(id) / .toggle(id) / .leaveConfirmation()
  pos: PosApi;
  intents: IntentsApi;
  webVitals: WebVitalsApi;
  support: SupportApi;
  reviews: ReviewsApi;
  scopes: Scopes;
  picker: PickerApi;
  app: AppApi;
}
```

Confirmed availability for the migration:
- `shopify.toast.show(message, opts?)` — **present**
- `shopify.saveBar.show(id)` / `.hide(id)` / `.toggle(id)` / `.leaveConfirmation()` — **present**
- `shopify.modal.show(id)` / `.hide(id)` / `.toggle(id)` — **present**
- `shopify.loading(bool)` — **present** (`LoadingApi = (isLoading?: boolean) => void`)
- `shopify.resourcePicker(options)` — **present**

**No `shopify.print()` API exists in this version.** There is no print method anywhere in `ShopifyGlobal`. If print-to-PDF is needed for orders, use `window.print()` directly or open a print-specific URL in a new tab via `window.open(url, '_blank')`.

**No `shopify.navigate()` API.** Navigation must go through React Router's `useNavigate()` hook. The `AppProvider` internally listens for a `shopify:navigate` DOM event and delegates to React Router's `navigate`.

---

## 3. Existing `window.shopify` Call Sites

All found in `app/`. These are migration candidates for a `useAppBridge`-based helper:

**Toast calls (33 total):**

| File | Line(s) | Message(s) |
|---|---|---|
| `app/routes/app.products.$id._index.tsx` | 516, 518, 523, 525, 529, 542 | "View deleted", "Cannot delete view", "Print area deleted", "Cannot delete placement", "Changes saved", "Methods updated" |
| `app/routes/app.products.$id.images.tsx` | 433, 438, 503, 522, 526, 545, 555, 573, 585, 590, 800 | Upload errors, "No empty cells to fill", "Applied to N cells", "Failed to apply/copy image", "No Shopify product linked", "No images found", import results |
| `app/routes/app.products.$id.placements.$placementId.tsx` | 164 | "Print area saved" |
| `app/routes/app.orders._index.tsx` | 204 | "N lines marked as In Production" |
| `app/routes/app.methods._index.tsx` | 125 | "Method created" |
| `app/routes/app.products.$id.views.$viewId.tsx` | 867, 876, 890, 892, 894, 896, 898, 912, 915 | Pricing saved, View renamed, Layout cloned, View calibrated, Print area CRUD, Applied to all variants, Clone/error messages |
| `app/routes/app._index.tsx` | 596 | (dynamic message) |
| `app/components/ZonePricingPanel.tsx` | 173, 174, 196, 207 | Size tier CRUD, error, "Order updated" |

Notable pattern issues:
- Several call sites in `app.products.$id.images.tsx` cast as `(window.shopify as any)` — those need typing fixes when migrated.
- `app.orders._index.tsx` line 204 only fires on the `advanced` count; the `standard` path has no toast.

**SaveBar calls:**

| File | Save Bar ID | Show/Hide |
|---|---|---|
| `app/routes/app.products.$id._index.tsx:477` | `"product-detail-save-bar"` | show/hide in `useEffect` on `hasChanges` |
| `app/routes/app.products.$id.views.$viewId.tsx:846` | `"view-editor-save-bar"` | show/hide in `useEffect` on dirty state |
| `app/routes/app.methods.$id.tsx:262` | `"method-save-bar"` | show/hide in `useEffect` on `hasChanges` |
| `app/routes/app.settings.tsx:299` | `"settings-save-bar"` | show/hide in `useEffect` on `translationsDirty` |

**ResourcePicker calls:**
- `app/routes/app.products.$id._index.tsx:565`
- `app/routes/app.products._index.tsx:229`

---

## 4. Remix SSR Considerations

**Hook behavior on server:** The `useAppBridge` hook in v4.2.4 does NOT throw during SSR. It returns a `serverProxy` (a `Proxy` that throws only if a property is actually *accessed*). The pattern `const shopify = useAppBridge()` is safe at the top of a component. Accessing `shopify.toast.show(...)` on the server would throw, but since all call sites are inside event handlers or `useEffect` callbacks, this never fires during SSR.

**Should the helper be `.client.ts`?** Yes, per repo convention (`*.client.ts` = browser-only). Even though the hook itself doesn't throw, a helper module that re-exports or wraps `useAppBridge` for use across routes should be placed at `app/lib/shopify-bridge.client.ts` to make the server-exclusion explicit and prevent accidental server-side imports.

**Hydration:** `useAppBridge` returns `window.shopify` directly after hydration — the same stable reference the browser sets up via the `app-bridge.js` script. No hydration mismatch risk because the hook's return value is never rendered into HTML.

---

## 5. Script-Loading Strategy

`polaris.js` is **already loaded by `AppProvider`** as a React-rendered `<script>` tag inside the component body (not `<head>`). This is currently positioned before the `<Outlet />` children. Shopify's own provider source confirms this is the intended pattern — no changes needed.

For any new `<s-*>` web components introduced during the admin UI migration, they will be rendered by React after hydration, at which point `polaris.js` has already registered the custom elements. No race condition.

Do NOT add a duplicate `polaris.js` tag to `root.tsx`. It is already present via `AppProvider`. Adding it twice causes element registration warnings.

If a page outside the `app.*` layout (i.e., not under `app/routes/app.tsx`) needs Polaris web components, it must either render its own `AppProvider` (with `embedded={false}`) or add the script manually.

---

## 6. Gotchas for I1 and I2

**Toast options** (`ToastOptions` type):
- `duration?: number` — milliseconds, default `5000`
- `isError?: boolean` — default `false`; triggers red styling in the admin
- `action?: string` — label for an action button in the toast
- `onAction?: () => void` — callback when action button is clicked
- `onDismiss?: () => void` — callback when dismiss icon is clicked
- `toast.show()` returns a toast `id` (string); pass to `toast.hide(id)` for programmatic dismissal

**SaveBar id contract:**  
The `<SaveBar id="my-save-bar">` React component (from `@shopify/app-bridge-react`) renders a `<ui-save-bar id="my-save-bar">` custom element. The `shopify.saveBar.show("my-save-bar")` call targets that element by id. The id string must match exactly. There is **no** `data-save-bar` attribute contract on the form itself — the save bar operates independently of form elements. Child `<button variant="primary">` inside `<SaveBar>` acts as the Save button; `<button>` without variant is Discard.

**Modal pattern:**  
Declare `<Modal id="my-modal">` (from `@shopify/app-bridge-react`) in JSX; call `shopify.modal.show("my-modal")` to open it. The `src` prop loads an iframe URL; without `src`, children are rendered inline. `variant` accepts `"small" | "base" | "large" | "max"`. After `show()`, `modal.contentWindow` gives iframe access.

**Print API:**  
`shopify.print()` does not exist in this version. Use `window.print()` to print the current page, or `window.open(url, '_blank')` to open a printable URL. If a dedicated print view is needed, create a route and open it in a new tab — the admin will not interfere.

**`loading` API:** `shopify.loading(true)` shows the admin spinner; `shopify.loading(false)` hides it. It is a function, not an object — do not call `shopify.loading.show()`.

**Known issues / cautions in 4.2.x:**
- `(window.shopify as any)` casts in `app.products.$id.images.tsx` suggest those call sites were written before types were properly installed. When migrating to `useAppBridge()`, remove the cast — the return type is `ShopifyGlobal` which fully covers `toast`.
- `shopify.saveBar.leaveConfirmation()` resolves when it is safe to navigate (i.e., save bar is not showing, or the user confirmed discard). Wire this up in any custom navigation handler to prevent unsaved-data loss.
- The `shopify:navigate` DOM event is handled internally by `AppProvider`; do not dispatch it manually.
