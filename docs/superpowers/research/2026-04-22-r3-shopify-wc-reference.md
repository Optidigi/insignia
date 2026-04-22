# Shopify Polaris Web Components Reference
## Scoped to `in-scope.html` — 2026-04-22

Sources: `shopify-polaris-app-home` skill search results + `@shopify/polaris-types/dist/polaris.d.ts`

---

## Part 1 · Quick-Reference Table

| Tag | Key props | Key events | Note |
|-----|-----------|------------|------|
| `<s-page>` | `heading`, `inlineSize` (`small`/`base`/`large`) | — | Slots: `primary-action`, `secondary-actions`, `breadcrumb-actions`, `aside`. `aside` only shows when `inlineSize="large"` |
| `<s-section>` | `heading`, `padding` (`base`/`none`), `accessibilityLabel` | — | Requires `accessibilityLabel` if no `heading` child |
| `<s-banner>` | `heading`, `tone`, `dismissible`, `hidden`, `collapsible` | `onDismiss`, `onAfterHide` | Slots: `secondary-actions` (via `ActionSlots`) |
| `<s-table>` | `paginate`, `hasPreviousPage`, `hasNextPage`, `loading`, `variant` | `onPreviousPage`, `onNextPage`, `onComputedVariantChange` | Slot `filters` for search row |
| `<s-table-header-row>` | — | — | Direct child of `<s-table>` |
| `<s-table-header>` | `listSlot` (`primary`/`secondary`/`kicker`/`inline`/`labeled`), `format` (`base`/`currency`/`numeric`) | — | Default `listSlot="labeled"` |
| `<s-table-body>` | — | — | Wraps `<s-table-row>` |
| `<s-table-row>` | `clickDelegate` (id of interactive child) | — | Click-only affordance; no keyboard/a11y added automatically |
| `<s-table-cell>` | — | — | Raw content cell |
| `<s-text-field>` | `label`, `labelAccessibilityVisibility`, `icon`, `readOnly`, `placeholder`, `value`, `disabled`, `name` | `onChange`, `onInput` | `icon="search"` renders inline icon |
| `<s-text-area>` | `label`, `labelAccessibilityVisibility`, `rows`, `name`, `placeholder`, `disabled` | `onChange`, `onInput` | `rows` default: 2 |
| `<s-select>` | `label`, `labelAccessibilityVisibility`, `icon`, `disabled`, `value`, `name` | `onChange` | Children: `<s-option>` / `<s-option-group>` |
| `<s-option>` | `value`, `selected`, `disabled` | — | Direct child of `<s-select>` |
| `<s-checkbox>` | `id`, `accessibilityLabel`, `label`, `checked`, `disabled`, `name` | `onChange`, `onInput` | `id` needed for `clickDelegate` targeting |
| `<s-button>` | `variant` (`auto`/`primary`/`secondary`/`tertiary`), `tone`, `icon`, `disabled`, `loading`, `accessibilityLabel`, `href`, `target` | `onClick` | `slot` attr for placement inside page/banner |
| `<s-button-group>` | `gap` (`base`/`none`), `accessibilityLabel` | — | Slots: `primary-action`, `secondary-actions` |
| `<s-badge>` | `tone`, `color` (`subdued`/`base`/`strong`), `icon`, `size` | — | **Amber = `tone="warning"`** (confirmed) |
| `<s-box>` | `padding`, `paddingBlock`, `paddingInline`, `background`, `border`, `borderRadius`, `inlineSize`, `blockSize`, `overflow` | — | Generic layout container |
| `<s-stack>` | `direction` (`block`/`inline`), `gap`, `alignItems`, `justifyContent`, `paddingBlock`, `paddingBlockStart`, `padding` | — | Inline stacks wrap; block stacks do not |
| `<s-grid>` | `gridTemplateColumns`, `gridTemplateRows`, `gap`, `alignItems`, `justifyContent` | — | CSS Grid wrapper |
| `<s-divider>` | `direction` (`inline`/`block`), `color` | — | Default `direction="inline"` |
| `<s-paragraph>` | `color`, `tone`, `type` (`paragraph`/`small`), `lineClamp` | — | Renders `<p>` |
| `<s-heading>` | `accessibilityRole`, `lineClamp`, `accessibilityVisibility` | — | Level assigned automatically by nesting |
| `<s-link>` | `href`, `target`, `tone`, `accessibilityLabel` | `onClick` | `slot` attr for breadcrumb placement |
| `<s-text>` | `color` (`subdued`/`base`/`strong`), `tone`, `type` (`strong`/`emphasis`/`small`/`generic`/etc.), `accessibilityVisibility` | — | Inline; `type="strong"` renders bold `<strong>` |
| `<s-spinner>` | `size`, `accessibilityLabel` | — | Sizes: `large`/`large-100`/`base` |
| `<s-drop-zone>` | `accept`, `multiple`, `required`, `label`, `labelAccessibilityVisibility`, `error`, `disabled`, `accessibilityLabel` | `onChange`, `onInput`, `onDropRejected` | File select only; **no XHR progress** |
| `shopify.toast.show()` | `(msg, {duration, action, onAction, onDismiss})` | — | App Bridge API, requires `app-bridge.js` |
| `shopify.saveBar.*` | `show(id)`, `hide(id)`, `toggle(id)`, `leaveConfirmation()` | — | Or use `data-save-bar` on `<form>` |
| `shopify.modal.*` | `show(id)`, `hide(id)`, `toggle(id)` | — | Works alongside `<s-modal>` |
| `shopify.print` / `print()` | — | — | Desktop: browser dialog. Mobile: App Bridge intercepts |
| `useAppBridge()` | — | — | From `@shopify/app-bridge-react@^4`; returns `shopify` global |

---

## Part 2 · Component Appendices

### `<s-page>`

**Props** (`PageProps$1` + `ActionSlots`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `heading` | `string` | — | Page title in Shopify admin chrome |
| `inlineSize` | `SizeKeyword` | `'base'` | Only `small`, `base`, `large` are functional; `aside` slot requires `large` |
| `subheading` | `string` | — | Subtitle below heading |

**Slots**: `primary-action`, `secondary-actions`, `breadcrumb-actions` (link/button), `aside` (only when `inlineSize="large"`).

**Footguns**:
- `aside` slot is invisible unless `inlineSize="large"` is set on `<s-page>`.
- Max 1 primary action, max 3 secondary actions per Shopify guidelines.
- `breadcrumb-actions` accepts only `<s-link>` or `<s-button>`.

```jsx
<s-page heading="Orders" inlineSize="large">
  <s-button slot="primary-action" variant="primary" icon="print">
    Print production sheets
  </s-button>
  <s-button slot="secondary-actions" variant="secondary">Export</s-button>
  <s-link slot="breadcrumb-actions" href="/app/orders">Orders</s-link>
  <s-box slot="aside"><OrderSummaryCard /></s-box>
  <s-section>...</s-section>
</s-page>
```

---

### `<s-section>`

**Props** (`SectionProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `heading` | `string` | — | Section title |
| `padding` | `'base' \| 'none'` | `'base'` | Use `none` for full-bleed tables |
| `accessibilityLabel` | `string` | — | Required when no heading present |

**Footguns**: Must have either `heading` or `accessibilityLabel`; omitting both is an a11y violation.

```jsx
<s-section heading="Placements" padding="none" accessibilityLabel="Placements table">
  <s-table>...</s-table>
</s-section>
```

---

### `<s-banner>`

**Props** (`BannerProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `heading` | `string` | `''` | Banner title |
| `tone` | `ToneKeyword` | `'auto'` | `warning` = amber; `critical` = assertive ARIA alert |
| `dismissible` | `boolean` | `false` | Shows close button |
| `hidden` | `boolean` | `false` | Hides the banner; update on `onDismiss` |
| `collapsible` | `boolean` | `false` | Collapses children by default |

**Events**: `onDismiss` (fires when close clicked, `hidden` still `false`), `onAfterHide` (fires after animation, `hidden` is `true`).

**Footguns**: `dismissible` banners must handle `onDismiss` to sync React state; dismissed state does not persist across page loads.

```jsx
<s-banner
  heading="Artwork pending"
  tone="warning"
  dismissible={false}
>
  <s-paragraph>Customer chose to upload artwork later.</s-paragraph>
  <s-button slot="secondary-actions" variant="secondary">Send reminder</s-button>
</s-banner>
```

---

### `<s-table>` family

**`<s-table>` props** (`TableProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `paginate` | `boolean` | `false` | Activates pagination controls |
| `hasPreviousPage` | `boolean` | `false` | Enables Previous button |
| `hasNextPage` | `boolean` | `false` | Enables Next button |
| `loading` | `boolean` | `false` | Loading overlay, prevents interaction |
| `variant` | `'auto' \| 'list' \| 'table'` | `'auto'` | `auto` = table on wide, list on narrow |

**Events**: `onPreviousPage`, `onNextPage`.

**`<s-table-header>` props**: `listSlot` (`'primary' \| 'secondary' \| 'kicker' \| 'inline' \| 'labeled'`, default `'labeled'`), `format` (`'base' \| 'currency' \| 'numeric'`).

**`<s-table-row>` props**: `clickDelegate` (string ID of the interactive child element that handles the row-click action).

**Filters slot**: Place `<s-grid slot="filters" ...>` inside `<s-table>` for the search/filter row.

**Footguns**:
- `clickDelegate` is click-only; keyboard/screen-reader users must interact with the target element directly.
- `listSlot="primary"` and `listSlot="secondary"` must each appear on exactly one column.

```jsx
<s-section padding="none" accessibilityLabel="Orders table">
  <s-table paginate hasPreviousPage={page > 1} hasNextPage={hasMore}
           onPreviousPage={goPrev} onNextPage={goNext}>
    <s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr auto auto">
      <s-text-field label="Search" labelAccessibilityVisibility="exclusive"
                    icon="search" placeholder="Searching all orders" />
      <s-button icon="filter" variant="secondary" accessibilityLabel="Filter" />
    </s-grid>
    <s-table-header-row>
      <s-table-header listSlot="primary">Order</s-table-header>
      <s-table-header listSlot="secondary">Status</s-table-header>
      <s-table-header format="numeric">Total</s-table-header>
    </s-table-header-row>
    <s-table-body>
      <s-table-row clickDelegate="cb-1042">
        <s-table-cell>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-checkbox id="cb-1042" accessibilityLabel="Select order 1042" />
            <s-link href="/orders/1042">#1042</s-link>
          </s-stack>
        </s-table-cell>
        <s-table-cell><s-badge tone="warning">Awaiting artwork</s-badge></s-table-cell>
        <s-table-cell>$36.00</s-table-cell>
      </s-table-row>
    </s-table-body>
  </s-table>
</s-section>
```

---

### `<s-text-field>`

**Props** (`TextFieldProps$1` extends `BaseTextFieldProps` + `FieldDecorationProps`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `label` | `string \| ComponentChildren` | — | Visible label text |
| `labelAccessibilityVisibility` | `'visible' \| 'exclusive'` | `'visible'` | `exclusive` = visually hidden |
| `icon` | `IconType \| string` | `''` | Inline icon; use `"search"` for search fields |
| `readOnly` | `boolean` | `false` | Focusable but not editable |
| `value` | `string` | — | Controlled value |
| `placeholder` | `string` | — | |
| `disabled` | `boolean` | `false` | |
| `name` | `string` | — | Form field name |

**Events**: `onChange` (on blur/commit), `onInput` (on each keystroke).

**Footguns**: `readOnly` fields are still focusable and announced by screen readers (unlike `disabled`).

```jsx
<s-text-field
  label="Upload link"
  labelAccessibilityVisibility="exclusive"
  value={uploadLink}
  readOnly={true}
/>
```

---

### `<s-text-area>`

**Props** (`TextAreaProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `rows` | `number` | `2` | Visible line count |
| `name` | `string` | — | Form field name |
| `label` | `string` | — | |
| `labelAccessibilityVisibility` | `'visible' \| 'exclusive'` | `'visible'` | |
| `placeholder` | `string` | — | |
| `disabled` | `boolean` | `false` | |

```jsx
<s-text-area
  label="Add a note"
  labelAccessibilityVisibility="visible"
  placeholder="Add a production note..."
  rows={3}
  name="production-note"
/>
```

---

### `<s-select>` + `<s-option>`

**`<s-select>` props** (`SelectProps$1`): Inherits `FieldProps` + `icon`, `label`, `labelAccessibilityVisibility`, `value`, `disabled`, `name`, `placeholder`, `onChange`.

**`<s-option>` props** (`OptionProps$1`): `value` (string), `selected` (boolean), `disabled` (boolean), `children`.

**Footguns**: Use `<s-option>` not native `<option>` inside `<s-select>`.

```jsx
<s-select label="Assigned to" labelAccessibilityVisibility="exclusive" disabled={true}>
  <s-option value="">Unassigned</s-option>
</s-select>
```

---

### `<s-checkbox>`

**Props** (`CheckboxProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `id` | `string` | — | Required for `clickDelegate` targeting |
| `accessibilityLabel` | `string` | — | Use when no visible `label` |
| `label` | `string \| ComponentChildren` | — | Visual label |
| `checked` | `boolean` | `false` | Controlled state |
| `disabled` | `boolean` | `false` | |
| `indeterminate` | `boolean` | — | Visual only; does not affect form value |
| `name` | `string` | — | |

**Events**: `onChange`, `onInput`.

```jsx
<s-checkbox
  id="order-1042-cb"
  accessibilityLabel="Select order 1042"
/>
```

---

### `<s-button>` + `<s-button-group>`

**`<s-button>` props** (`ButtonProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `variant` | `'auto' \| 'primary' \| 'secondary' \| 'tertiary'` | `'auto'` | |
| `tone` | `ToneKeyword` | `'auto'` | `tone="critical"` for destructive |
| `icon` | `IconType \| string` | `''` | Icon-only buttons need `accessibilityLabel` |
| `disabled` | `boolean` | `false` | |
| `loading` | `boolean` | `false` | Replaces content with spinner |
| `href` | `string` | — | Turns button into link |
| `target` | `string` | `'auto'` | |
| `accessibilityLabel` | `string` | — | Required for icon-only buttons |

**`<s-button-group>` props** (`ButtonGroupProps$1`): `gap` (`'base' \| 'none'`), `accessibilityLabel`. Slots: `primary-action`, `secondary-actions`.

**Footguns**: `gap="none"` creates connected/segmented button group; cannot use `primary-action` slot when `gap="none"`.

```jsx
<s-button-group>
  <s-button slot="primary-action" variant="primary">Save note</s-button>
  <s-button slot="secondary-actions" icon="email" disabled={true}
            accessibilityLabel="Message customer — coming soon">
    Message customer
  </s-button>
</s-button-group>
```

---

### `<s-badge>`

**MUST-ANSWER ANSWER: Amber = `tone="warning"`** (confirmed by skill docs showing `<s-badge tone="warning">Low stock</s-badge>` and `in-scope.html` uses `tone="warning"` for "Awaiting artwork" — amber state).

**Props** (`BadgeProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `tone` | `ToneKeyword` | `'auto'` | `warning`=amber, `success`=green, `info`=blue, `critical`=red |
| `color` | `'subdued' \| 'base' \| 'strong'` | `'base'` | Intensity modifier |
| `icon` | `IconType \| string` | `''` | Optional icon |
| `size` | `SizeKeyword` | `'base'` | |

```jsx
<s-badge tone="warning">Awaiting artwork</s-badge>
<s-badge tone="success">Provided</s-badge>
<s-badge tone="info">In production</s-badge>
<s-badge>Draft</s-badge>  {/* no tone = neutral/auto */}
```

---

### `<s-box>`

**Props** (`BoxProps$1` extends `BaseBoxPropsWithRole`): Full set from `BackgroundProps`, `PaddingProps`, `BorderProps`, `OverflowProps`, `SizingProps`.

Key props used in `in-scope.html`:

| Prop | Example values | Notes |
|------|---------------|-------|
| `background` | `'transparent' \| 'subdued' \| 'base' \| 'strong'` | |
| `border` | `'base'`, `'none'` | Shorthand: size + color + style |
| `borderRadius` | `'base'`, `'none'`, `'max'`, SizeKeyword | |
| `overflow` | `'hidden' \| 'visible'` | |
| `inlineSize` | `'${n}px' \| '${n}%' \| 'auto'` | |
| `blockSize` | same | |
| `padding` / `paddingBlock` / `paddingInline` | `SizeKeyword \| 'none'` | |

```jsx
<s-box background="subdued" borderRadius="base" overflow="hidden">
  ...
</s-box>
```

---

### `<s-stack>`

**Props** (`StackProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `direction` | `'block' \| 'inline'` | `'block'` | Inline stacks wrap; block stacks do not |
| `gap` | `SpacingKeyword` or `"val1 val2"` | `'none'` | Single value or `inline block` pair |
| `alignItems` | `AlignItemsKeyword` | `'normal'` | Cross-axis alignment |
| `justifyContent` | `JustifyContentKeyword` | `'normal'` | Main-axis distribution |
| `paddingBlock` | `PaddingKeyword` or two-value | `''` | |
| `paddingBlockStart` | `PaddingKeyword` | `''` | |

Inherits all `PaddingProps` and `BorderProps` from `BaseBoxProps`.

**Footguns**: All items share uniform gap; cannot vary spacing between individual items — nest multiple stacks instead.

```jsx
<s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
  <s-text color="subdued">Customer</s-text>
  <s-link href="#">Sophie Klass</s-link>
</s-stack>
```

---

### `<s-grid>`

**Props** (`GridProps$1`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `gridTemplateColumns` | `string` | `'none'` | CSS grid-template-columns, e.g. `"1fr auto auto"` |
| `gridTemplateRows` | `string` | `'none'` | |
| `gap` | `SpacingKeyword` | `'none'` | |
| `alignItems` | `AlignItemsKeyword` | `''` | |
| `justifyContent` | `JustifyContentKeyword` | `''` | |

```jsx
<s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr auto auto">
  <s-text-field label="Search" labelAccessibilityVisibility="exclusive" icon="search" />
  <s-button icon="filter" variant="secondary" accessibilityLabel="Filter" />
  <s-button icon="sort" variant="secondary" accessibilityLabel="Sort" />
</s-grid>
```

---

### `<s-divider>`

**Props** (`DividerProps$1`): `direction` (`'inline' \| 'block'`, default `'inline'`), `color` (`ColorKeyword`).

```jsx
<s-divider />
```

---

### `<s-paragraph>`

**Props** (`ParagraphProps$1`): `color` (`ColorKeyword`), `tone` (`ToneKeyword`), `type` (`'paragraph' \| 'small'`), `lineClamp` (number).

```jsx
<s-paragraph>Customer chose to upload artwork later.</s-paragraph>
```

---

### `<s-heading>`

**Props** (`HeadingProps$1`): `accessibilityRole` (`'heading' \| 'presentation' \| 'none'`), `lineClamp` (number), `accessibilityVisibility`. Heading level is determined automatically by nesting within `<s-section>`.

```jsx
<s-heading>Status</s-heading>
```

---

### `<s-link>`

**Props** (`LinkProps$1`): `href` (string), `target` (`'auto' \| '_blank' \| '_self'`), `tone` (`ToneKeyword`), `accessibilityLabel`. Implements `onClick`.

```jsx
<s-link href="#" target="_blank">artwork workflows</s-link>
<s-link slot="breadcrumb-actions" href="/app/orders" onClick={handleBack}>
  Orders
</s-link>
```

---

### `<s-text>`

**Props** (`TextProps$1`): `color` (`'subdued' \| 'base' \| 'strong'`), `tone` (`ToneKeyword`), `type` (`'strong' \| 'emphasis' \| 'small' \| 'address' \| 'redundant' \| 'mark' \| 'offset' \| 'generic'`), `accessibilityVisibility`.

`type="strong"` renders bold `<strong>`. `color="subdued"` is the de-emphasis pattern used throughout `in-scope.html`.

```jsx
<s-text type="strong">{placement.name}</s-text>
<s-text color="subdued">{placement.size}</s-text>
```

---

### `<s-spinner>`

**Props** (`SpinnerProps$1`): `size` (`'large' \| 'large-100' \| 'base'`, default `'base'`), `accessibilityLabel` (string — recommended).

```jsx
<s-spinner size="base" accessibilityLabel="Loading orders..." />
```

---

### `<s-drop-zone>`

**Props** (`DropZoneProps$1` extends `FileInputProps` + `BasicFieldProps`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `accept` | `string` | `''` | Comma-separated MIME types or extensions |
| `multiple` | `boolean` | `false` | Allow multiple files |
| `required` | `boolean` | `false` | |
| `error` | `string \| ComponentChildren` | — | Error message string |
| `label` | `string` | — | Visible label |
| `labelAccessibilityVisibility` | `'visible' \| 'exclusive'` | `'visible'` | |
| `accessibilityLabel` | `string` | — | Overrides label for screen readers |
| `disabled` | `boolean` | `false` | |

**Events**: `onChange` (file selection complete), `onInput` (any change), `onDropRejected` (rejected files based on `accept`).

**Files access**: Read `event.currentTarget.files` (array of `File` objects) in the event handler.

**XHR upload progress: NO.** `<s-drop-zone>` handles file selection only. Upload progress must be implemented separately using `XMLHttpRequest.upload.onprogress` or the Fetch API with a `ReadableStream` after obtaining files from the `onChange` event.

```jsx
<s-drop-zone
  label="Upload artwork"
  accept="image/*,.svg,.pdf"
  multiple={false}
  required
  error={uploadError}
  onChange={(e) => {
    const files = e.currentTarget.files;
    // files is readonly File[]; upload via XHR yourself
    uploadFile(files[0]);
  }}
  onDropRejected={() => setUploadError('Unsupported file type')}
/>
```

---

## App Bridge APIs

### Toast — `shopify.toast.show(message, options?)`

```js
shopify.toast.show('Note saved');
shopify.toast.show('Product saved', {
  duration: 5000,               // ms, default varies
  action: 'Undo',
  onAction: () => undoSave(),
  onDismiss: () => {},
});
```

Source: `shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/toast-api`

### Save Bar

**Option A — declarative** (recommended for simple forms):
```html
<form data-save-bar data-discard-confirmation
  onSubmit={handleSave} onReset={handleDiscard}>
  ...
</form>
```

**Option B — programmatic**:
```js
shopify.saveBar.show('my-save-bar-id');
shopify.saveBar.hide('my-save-bar-id');
shopify.saveBar.toggle('my-save-bar-id');
await shopify.saveBar.leaveConfirmation(); // before programmatic navigation
```

Source: `shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/save-bar-api`

### Modal — `shopify.modal.*`

```js
shopify.modal.show('my-modal-id');
shopify.modal.hide('my-modal-id');
shopify.modal.toggle('my-modal-id');
```

Also available as `commandFor`/`command` HTML attributes on buttons (no JS needed):
```html
<s-button commandFor="my-modal" command="--show">Open</s-button>
<s-modal id="my-modal" heading="Confirm action">...</s-modal>
```

Source: `shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/modal-api`

### Print

```js
print(); // browser dialog on desktop; App Bridge intercepts on Shopify Mobile/POS
```

`shopify.print` is not a method — use standard `window.print()` / `print()`.

### `useAppBridge()` hook

```tsx
import { useAppBridge } from '@shopify/app-bridge-react';

function MyComponent() {
  const shopify = useAppBridge();
  // shopify.toast.show(...)
  // shopify.saveBar.show(...)
}
```

Requires `@shopify/app-bridge-react@^4`. Returns the `shopify` global or a safe proxy during SSR.

---

## Must-Answer Questions — Answers

**1. Correct `<s-badge tone>` value for amber/awaiting-artwork state?**
`tone="warning"`. Confirmed by skill docs (`<s-badge tone="warning">Low stock</s-badge>`) and `in-scope.html` usage. There is no `"attention"` value in `ToneKeyword`.

**2. `polaris.js` CDN versioned URL pattern?**
Only `latest` is documented. The CDN URL is:
```
https://cdn.shopify.com/shopifycloud/polaris.js
```
No versioned URL pattern is published. Per skill docs: "loading your app from `cdn.shopify.com/shopifycloud/app-bridge.js` installs the **latest version**." Same applies to `polaris.js`. Use `@shopify/app-bridge-types@latest` in `package.json` to keep types in sync.

**3. Is `app-bridge.js` automatically injected by `@shopify/shopify-app-react-router/react`?**
Yes — partially. The `AppProvider` from `@shopify/shopify-app-react-router/react` (used in `app/routes/app.tsx` as `<AppProvider embedded apiKey={apiKey}>`) handles App Bridge initialization. The `app-bridge.js` script tag is injected by Shopify into the embedded app iframe automatically. You do **not** need to manually add it to `root.tsx`. The Remix adapter handles the script injection as part of the embedded app setup.

**4. SSR/FOUC mitigation for `<s-*>` tags before `polaris.js` loads?**
No dedicated Shopify pattern is documented (the skill search returned no results for SSR/FOUC). The standard practice for Remix/React Router embedded apps is: since admin routes render inside Shopify's iframe and `polaris.js` is loaded in that context, FOUC is minimal. For custom Remix routes, use `<ClientOnly>` from `remix-utils` to defer rendering `<s-*>` elements until hydration, or load `polaris.js` in `<head>` via `links()` export before hydration.

**5. `<s-drop-zone>` XHR upload progress support?**
**No.** `<s-drop-zone>` only handles file selection. The component fires `onChange`/`onInput` with selected `File` objects; the developer must implement XHR upload separately using `XMLHttpRequest.upload.addEventListener('progress', ...)` or a Fetch stream.

**6. `<s-page>` inside `<AppProvider>` + `<Box paddingBlockEnd="1600">` layout — conflict?**
No direct conflict. The existing `app/routes/app.tsx` wraps routes in `<PolarisAppProvider>` + `<Box paddingBlockEnd="1600"><Outlet /></Box>`. `<s-page>` is a Polaris Web Component managed by `polaris.js`, not a React Polaris component, so it does not interact with the Polaris React `AppProvider` context. The only concern is the `paddingBlockEnd="1600"` on the `<Box>` wrapper adding bottom space below `<s-page>` — this is cosmetic and acceptable. There is no functional conflict.
