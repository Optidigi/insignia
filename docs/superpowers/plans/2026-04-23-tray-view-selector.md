# Tray View Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a view-selector control to the ImageTray staging area so merchants can choose which views "Auto-assign by color" targets — rendering as inline toggle pills for ≤ 3 views or a split button + popover for > 3 views.

**Architecture:** Pure client-side state change across two files. A new `selectedViewIds: string[]` state lives in the images route (initialised to all view IDs, resets on page load). It is passed down into `ImageTray` alongside the `views` array. `ImageTray` picks its render mode at the `PILL_THRESHOLD = 3` boundary. `handleAutoAssignFromTray` filters `views` to `selectedViewIds` before iterating. No backend changes.

**Tech Stack:** React 18, Polaris v13 (`Button`, `ButtonGroup`, `Popover`, `ChoiceList`, `Box`), `@shopify/polaris-icons` (`ChevronDownIcon`), TypeScript strict.

---

## File map

| File | Change |
|---|---|
| `app/components/ImageTray.tsx` | New props (`views`, `selectedViewIds`, `onViewSelectionChange`), pill/split-button render logic, `viewPopoverOpen` local state |
| `app/routes/app.products.$id.images.tsx` | New `selectedViewIds` state + `handleViewSelectionChange` callback, filter loop in `handleAutoAssignFromTray`, updated `autoAssignDisabled`, updated `<ImageTray>` JSX |

No other files change.

---

## Task 1: Update `ImageTray` component

**Files:**
- Modify: `app/components/ImageTray.tsx`

Before writing code, run:
```
mcp__shopify-dev-mcp__validate_component_codeblocks
```
on any Polaris components you use that you are unsure about (`Popover`, `ChoiceList`, `Box`, `Button` with `loading`/`accessibilityLabel`). Fix any prop issues the validator reports before proceeding.

- [ ] **Step 1: Replace the entire file with the new implementation**

Replace `app/components/ImageTray.tsx` with:

```tsx
/**
 * ImageTray — compact inline staging area for unassigned images.
 * Images land here from Shopify import or bulk upload, then get
 * dragged/tapped onto color card cells.
 *
 * View selector:
 *   - ≤ PILL_THRESHOLD views → individual toggle Button pills (always visible)
 *   - >  PILL_THRESHOLD views → primary Button + ChevronDown Popover / ChoiceList
 * In both modes the underlying state is `selectedViewIds: string[]` owned by the parent.
 */

import {
  Card,
  InlineStack,
  Text,
  Badge,
  Button,
  Popover,
  ChoiceList,
  Box,
} from "@shopify/polaris";
import { PlusIcon, ChevronDownIcon } from "@shopify/polaris-icons";
import { useRef, useState } from "react";

export type TrayImage = {
  id: string;
  storageKey: string;
  previewUrl: string;
  originalFileName?: string;
};

/** Views at or below this count use inline toggle pills; above use split-button+popover. */
const PILL_THRESHOLD = 3;

type ViewOption = {
  id: string;
  name: string | null;
  perspective: string;
};

type Props = {
  images: TrayImage[];
  onBulkUpload: (files: FileList) => void | Promise<void>;
  onDragStart: (image: TrayImage) => void;
  onSelect?: (image: TrayImage | null) => void;
  selectedImageId?: string | null;
  onAutoAssign?: () => void | Promise<void>;
  isAutoAssigning?: boolean;
  autoAssignDisabled?: boolean;
  /** When provided, a view selector is rendered. Omit to hide the selector (backward-compatible). */
  views?: ViewOption[];
  selectedViewIds?: string[];
  onViewSelectionChange?: (viewIds: string[]) => void;
};

export function ImageTray({
  images,
  onBulkUpload,
  onDragStart,
  onSelect,
  selectedImageId,
  onAutoAssign,
  isAutoAssigning,
  autoAssignDisabled,
  views,
  selectedViewIds,
  onViewSelectionChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [viewPopoverOpen, setViewPopoverOpen] = useState(false);

  const viewLabel = (v: ViewOption) => v.name || v.perspective;

  // Resolved selection — fall back to all views if parent hasn't provided the array yet
  const sel = selectedViewIds ?? (views?.map((v) => v.id) ?? []);

  const hasViews = (views?.length ?? 0) > 0;
  const usePillMode = (views?.length ?? 0) <= PILL_THRESHOLD;

  // Label for the split-button main action (>3 views)
  const autoAssignButtonLabel = (() => {
    if (!views || sel.length === 0 || sel.length === views.length) {
      return "Auto-assign by color";
    }
    const names = views
      .filter((v) => sel.includes(v.id))
      .map(viewLabel)
      .join(", ");
    return `Auto-assign · ${names}`;
  })();

  const handlePillToggle = (viewId: string) => {
    if (!onViewSelectionChange) return;
    const next = sel.includes(viewId)
      ? sel.filter((id) => id !== viewId)
      : [...sel, viewId];
    onViewSelectionChange(next);
  };

  return (
    <Card>
      <InlineStack gap="300" blockAlign="center" wrap>
        {/* ── Label + count ── */}
        <InlineStack gap="200" blockAlign="center">
          <Text variant="bodySm" fontWeight="semibold" as="span">
            Staging Tray
          </Text>
          {images.length > 0 && (
            <Badge size="small">{`${images.length}`}</Badge>
          )}
        </InlineStack>

        {/* ── View selector pills (≤ PILL_THRESHOLD) — always visible when views provided ── */}
        {hasViews && usePillMode && onViewSelectionChange && views && (
          <InlineStack gap="100" blockAlign="center">
            {views.map((view) => (
              <Button
                key={view.id}
                size="slim"
                variant={sel.includes(view.id) ? "primary" : undefined}
                onClick={() => handlePillToggle(view.id)}
                accessibilityLabel={`${sel.includes(view.id) ? "Exclude" : "Include"} ${viewLabel(view)} from auto-assign`}
              >
                {viewLabel(view)}
              </Button>
            ))}
          </InlineStack>
        )}

        {/* ── Auto-assign controls ── */}
        {images.length > 0 && onAutoAssign && (
          // Split-button mode (> PILL_THRESHOLD views): main button + chevron popover
          !usePillMode && hasViews && views ? (
            <InlineStack gap="100" blockAlign="center">
              <Button
                size="slim"
                variant="primary"
                onClick={() => onAutoAssign()}
                loading={isAutoAssigning}
                disabled={autoAssignDisabled}
              >
                {autoAssignButtonLabel}
              </Button>
              <Popover
                active={viewPopoverOpen}
                activator={
                  <Button
                    size="slim"
                    variant="primary"
                    icon={ChevronDownIcon}
                    onClick={() => setViewPopoverOpen((o) => !o)}
                    accessibilityLabel="Select views for auto-assign"
                  />
                }
                onClose={() => setViewPopoverOpen(false)}
              >
                <Box padding="300">
                  <ChoiceList
                    title="Assign to views"
                    allowMultiple
                    choices={(views ?? []).map((v) => ({
                      label: viewLabel(v),
                      value: v.id,
                    }))}
                    selected={sel}
                    onChange={(newSel) => onViewSelectionChange?.(newSel)}
                  />
                </Box>
              </Popover>
            </InlineStack>
          ) : (
            // Simple button — pill mode or no views prop
            <Button
              size="slim"
              variant="primary"
              onClick={() => onAutoAssign()}
              loading={isAutoAssigning}
              disabled={autoAssignDisabled}
            >
              Auto-assign by color
            </Button>
          )
        )}

        {images.length === 0 && (
          <Text variant="bodySm" tone="subdued" as="span">
            Upload images here, then drag them to the color cards below.
          </Text>
        )}

        {/* ── Thumbnails ── */}
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            draggable
            onDragStart={() => onDragStart(img)}
            onClick={() => {
              if (onSelect) {
                onSelect(selectedImageId === img.id ? null : img);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
              }
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 4,
              border:
                selectedImageId === img.id
                  ? "2px solid var(--p-color-border-brand)"
                  : "1px solid var(--p-color-border)",
              padding: 0,
              cursor: "grab",
              backgroundImage: `url(${img.previewUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundColor: "var(--p-color-bg-fill-secondary)",
              flexShrink: 0,
            }}
            title={img.originalFileName ?? "Unassigned image"}
            aria-label={`${selectedImageId === img.id ? "Deselect" : "Select"} ${img.originalFileName ?? "image"}`}
          />
        ))}

        {images.length > 0 && (
          <Text variant="bodySm" tone="subdued" as="span">
            Drag to cards below
          </Text>
        )}

        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) onBulkUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          size="slim"
          icon={PlusIcon}
          onClick={() => fileRef.current?.click()}
        >
          Upload
        </Button>
      </InlineStack>
    </Card>
  );
}
```

- [ ] **Step 2: Run typecheck and confirm no new errors**

```bash
cd C:\Users\Shimmy\Desktop\env\insignia\.claude\worktrees\frosty-knuth-7dc8b2
npm run typecheck 2>&1 | tail -20
```

Expected: only the pre-existing error in `app/routes/app.products.$id.views.$viewId.tsx(685)`. Zero new errors. If new errors appear, fix them before continuing.

- [ ] **Step 3: Run lint on ImageTray only**

```bash
cd C:\Users\Shimmy\Desktop\env\insignia\.claude\worktrees\frosty-knuth-7dc8b2
npx eslint "app/components/ImageTray.tsx" 2>&1
```

Expected: no output (no warnings, no errors).

- [ ] **Step 4: Commit ImageTray changes**

```bash
cd C:\Users\Shimmy\Desktop\env\insignia\.claude\worktrees\frosty-knuth-7dc8b2
git add app/components/ImageTray.tsx
git commit -m "feat(ImageTray): add view-selector — pills ≤3 views, split-button+popover >3 views"
```

---

## Task 2: Wire up the view selector in the images route

**Files:**
- Modify: `app/routes/app.products.$id.images.tsx`

- [ ] **Step 1: Add `selectedViewIds` state and `handleViewSelectionChange` callback**

Find the block of `useState` declarations near line 337 (after `const [isAutoAssigning, setIsAutoAssigning] = useState(false);`):

```ts
const [isAutoAssigning, setIsAutoAssigning] = useState(false);
const [importTruncated, setImportTruncated] = useState(false);
```

Insert the new state immediately after `isAutoAssigning`:

```ts
const [isAutoAssigning, setIsAutoAssigning] = useState(false);
// View selector — initialise to all views; resets on every page load (no persistence)
const [selectedViewIds, setSelectedViewIds] = useState<string[]>(
  () => views.map((v) => v.id)
);
const [importTruncated, setImportTruncated] = useState(false);
```

Then add the callback after the existing `handleViewToggle`-adjacent callbacks (place it near the other tray-related handlers, e.g. after `handleAutoAssignFromTray`). Add it before `handleCellDrop`:

```ts
const handleViewSelectionChange = useCallback((viewIds: string[]) => {
  setSelectedViewIds(viewIds);
}, []);
```

- [ ] **Step 2: Update `handleAutoAssignFromTray` to filter by `selectedViewIds`**

Find this line inside `handleAutoAssignFromTray` (around line 651):

```ts
        let anyAssigned = false;
        for (const view of views) {
```

Replace it with:

```ts
        let anyAssigned = false;
        const targetViews = views.filter((v) => selectedViewIds.includes(v.id));
        for (const view of targetViews) {
```

Also add `selectedViewIds` to the `useCallback` dependency array at the end of `handleAutoAssignFromTray` (around line 712):

```ts
  }, [trayImages, colorGroups, views, cells, config.id, revalidator]);
```

→ becomes:

```ts
  }, [trayImages, colorGroups, views, selectedViewIds, cells, config.id, revalidator]);
```

- [ ] **Step 3: Update `autoAssignDisabled` in the `<ImageTray>` JSX**

Find (around line 876):

```tsx
          autoAssignDisabled={isImporting || isAutoAssigning || revalidator.state !== "idle"}
```

Replace with:

```tsx
          autoAssignDisabled={isImporting || isAutoAssigning || revalidator.state !== "idle" || selectedViewIds.length === 0}
```

- [ ] **Step 4: Pass the three new props to `<ImageTray>`**

Find the `<ImageTray>` opening tag (around line 872) and add three props after `autoAssignDisabled`:

```tsx
        <ImageTray
          images={trayImages}
          onAutoAssign={handleAutoAssignFromTray}
          isAutoAssigning={isAutoAssigning}
          autoAssignDisabled={isImporting || isAutoAssigning || revalidator.state !== "idle" || selectedViewIds.length === 0}
          views={views.map((v) => ({ id: v.id, name: v.name ?? null, perspective: v.perspective }))}
          selectedViewIds={selectedViewIds}
          onViewSelectionChange={handleViewSelectionChange}
          onBulkUpload={async (files) => {
```

(The `views` prop maps Prisma's `ProductView` to the leaner `ViewOption` type that `ImageTray` expects, avoiding leaking DB types into the component.)

- [ ] **Step 5: Run typecheck and confirm no new errors**

```bash
cd C:\Users\Shimmy\Desktop\env\insignia\.claude\worktrees\frosty-knuth-7dc8b2
npm run typecheck 2>&1 | tail -20
```

Expected: only the pre-existing error in `$viewId.tsx(685)`. Zero new errors.

- [ ] **Step 6: Run lint on the route only**

```bash
cd C:\Users\Shimmy\Desktop\env\insignia\.claude\worktrees\frosty-knuth-7dc8b2
npx eslint "app/routes/app.products.\$id.images.tsx" 2>&1
```

Expected: no output.

- [ ] **Step 7: Commit route changes**

```bash
cd C:\Users\Shimmy\Desktop\env\insignia\.claude\worktrees\frosty-knuth-7dc8b2
git add "app/routes/app.products.\$id.images.tsx"
git commit -m "feat(images): wire view-selector state into ImageTray + filter auto-assign loop"
```

---

## Done criteria

- `npm run typecheck` — only the pre-existing `$viewId.tsx(685)` error, no new errors
- `npx eslint "app/components/ImageTray.tsx" "app/routes/app.products.\$id.images.tsx"` — no output
- Product with ≤ 3 views shows toggle pills in tray header; pills turn green when selected
- Product with > 3 views shows split button + chevron; chevron opens ChoiceList popover
- Deselecting all views disables the Auto-assign button in both modes
- Auto-assign only assigns to views in `selectedViewIds`
- All existing tray behaviour (upload, drag, import) unchanged
