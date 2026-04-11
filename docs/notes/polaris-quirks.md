# Polaris Quirks & Known Gotchas

Discovered issues with Polaris v13 component behaviour that are non-obvious and have caused bugs in this project. Read this before implementing any UI involving these components.

---

## 1. `Icon` has `margin: auto` — breaks flex layouts

**Symptom**: An `<Icon>` placed next to text inside an `<InlineStack>` causes the icon to hug one edge and the text to hug the opposite edge, even when `align="start"` is set on the stack.

**Root cause**: `.Polaris-Icon { margin: auto; }` in Polaris's CSS. CSS flexbox resolves `margin: auto` on flex items *before* applying `justify-content`, so `justify-content: flex-start` (or `align="start"`) cannot override it. The icon absorbs all free space on one side, pushing siblings to the far end.

**Fix**: Wrap `<Icon>` in a `<Box>`. The `Box` becomes the flex item; `margin: auto` is now scoped inside the Box and no longer affects the parent flex layout.

```tsx
// WRONG — icon and text will be pushed to opposite sides
<InlineStack gap="200" blockAlign="center">
  <Icon source={SomeIcon} tone="subdued" />
  <Text variant="headingSm" as="h2">Title</Text>
</InlineStack>

// CORRECT — wrap Icon in Box to neutralise margin: auto
<InlineStack gap="200" blockAlign="center">
  <Box>
    <Icon source={SomeIcon} tone="subdued" />
  </Box>
  <Text variant="headingSm" as="h2">Title</Text>
</InlineStack>
```

**Rule**: Always wrap `<Icon>` in `<Box>` when it appears as a sibling inside any flex container (`InlineStack`, or a `div` with `display: flex`). Do not try to fix this with `align`, `justify-content`, or inline styles on the parent — those cannot win.

---

## 2. `InlineStack` does not reset `--pc-inline-stack-align`

**Symptom**: An `<InlineStack>` with no `align` prop can inherit unexpected `justify-content` behaviour if a parent element sets the `--pc-inline-stack-align` CSS custom property.

**Root cause**: `InlineStack` sets `justify-content: var(--pc-inline-stack-align)` without providing a fallback value in the variable declaration. If the variable is already defined on an ancestor, the child stack inherits it.

**Fix**: Always explicitly set `align` on every `<InlineStack>` that has layout requirements. Don't rely on the default.

```tsx
// Fragile — inherits whatever --pc-inline-stack-align is in scope
<InlineStack gap="200">...</InlineStack>

// Robust — always explicit
<InlineStack gap="200" align="start">...</InlineStack>
```

---

## 3. `Card` padding is not zero — don't add extra `padding` to direct children

**Symptom**: Content inside a `<Card>` has double padding when a child `<Box>` or `<BlockStack>` also specifies `padding`.

**Root cause**: `Card` applies its own internal padding (equivalent to `padding="400"`). Wrapping children in a `<Box padding="400">` doubles the spacing.

**Fix**: Use `<BlockStack gap="...">` as the first child of `<Card>` to control vertical spacing between sections. Only add `<Box padding="...">` when you intentionally need to inset a specific sub-section differently from the card default.

---

## 4. `BlockStack gap` vs `InlineStack gap` values are not symmetric

**Symptom**: Using the same `gap` value on a `BlockStack` and an `InlineStack` produces visually different amounts of space because one is vertical and one is horizontal, and the design token mapping may produce different perceived whitespace.

**Guideline**: The standard card header pattern in this project uses:
- `gap="300"` for vertical stacks inside cards
- `gap="200"` for horizontal icon+label rows

Stick to these values for consistency.

---

## 5. `<Text>` renders as `<p>` by default — do not nest block elements inside it

**Symptom**: React warning `<div> cannot appear as a descendant of <p>` or unexpected layout collapse.

**Root cause**: `<Text>` renders as a `<p>` unless `as` is specified. Any block-level children (e.g. another `<BlockStack>`, a `<div>`) cause invalid HTML.

**Fix**: Always specify `as` when the text element needs to be something other than a paragraph.

```tsx
// Correct for headings
<Text variant="headingSm" as="h2">Section Title</Text>

// Correct for inline labels
<Text variant="bodySm" as="span" tone="subdued">Label</Text>
```
