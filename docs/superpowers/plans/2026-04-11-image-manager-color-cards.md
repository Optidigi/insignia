# Image Manager — Color Cards Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the tab-per-view image manager UI with a color-card layout where each color group shows all its view thumbnails inline, eliminating horizontal scroll for N views and matching the merchant's color-first mental model.

**Architecture:** The backend (loader, action, API routes, services, Prisma models) is unchanged. This is a frontend-only refactor of the component in `app/routes/app.products.$id.images.tsx` and `app/components/ImageTray.tsx`. The tab-based layout is replaced with vertically-stacked color cards, each containing labeled thumbnail slots for every view.

**Tech Stack:** React 18, React Router 7, Shopify Polaris v13, TypeScript (strict)

**Design reference:** See the .pen design file `admin-dashboard-v2.1-final.pen` — scroll to the teal "IMAGE MANAGER" section at the bottom of the canvas. Three screens show: partially-filled state, cell hover actions, and empty + import state.

---

## Context for the Executing Agent

### What this app is
Insignia is an embedded Shopify app. Merchants configure product customization (logos on products). The Image Manager lets merchants assign product photos to a matrix of color variants × views (Front, Back, Sleeve, etc.).

### What exists today
- **Route file** `app/routes/app.products.$id.images.tsx` (983 lines): Contains loader, action, and a monolithic component using Polaris `Tabs` to switch between views, showing one `Card` per color group within the selected tab.
- **Tray component** `app/components/ImageTray.tsx` (167 lines): Collapsible image staging area with pagination and drag-drop.
- **Backend services** in `app/lib/services/image-manager.server.ts`: `groupVariantsByColor()`, `getImageMatrix()`, `batchGetUploadUrls()`, `batchSaveImages()`, `setViewDefault()` — ALL UNCHANGED.
- **API routes**: `api.admin.batch-upload-urls`, `api.admin.batch-save-images`, `api.admin.import-shopify-images` — ALL UNCHANGED.

### What we're changing
**Only the component JSX and a few state/computed values** in the route file. The loader, action, all handlers (upload, save, import, drag-drop, copy, remove), and all backend code stay identical.

Key changes:
1. Remove `activeTabIndex` state, `activeViewId`, `activeCells`, `tabItems` — no more tabs
2. Add per-view completion badges to the progress card
3. Replace `<Tabs>` + per-view cell cards → `colorGroups.map()` rendering color cards with inline view thumbnails
4. Update `ImageTray` for a compact single-row inline display

### Rules
- All admin UI uses Shopify Polaris components (`Card`, `BlockStack`, `InlineStack`, `Text`, `Badge`, `Button`, etc.)
- Run `npm run typecheck` after code changes
- Run `npm run lint` after code changes
- Visually verify with browser after UI changes (use `/chrome` or Playwright MCP)
- Validate Polaris usage with `mcp__shopify-dev-mcp__validate_component_codeblocks` when uncertain

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/routes/app.products.$id.images.tsx` | **Modify** (lines 206-982) | Replace component imports, state, computed values, and render JSX |
| `app/components/ImageTray.tsx` | **Modify** | Simplify to compact inline tray (remove collapsible, reduce thumb size) |

**Files NOT changed:** All backend services, API routes, Prisma schema, storage utilities, error handling.

---

### Task 1: Update Component State and Computed Values

**Files:**
- Modify: `app/routes/app.products.$id.images.tsx:206-316`

- [x] **Step 1: Update Polaris imports — remove Tabs, add Divider**

In the imports block (lines 206-230), make these changes:

Remove `Tabs` from the Polaris import. Remove `Box`, `Layout`, `SkeletonPage`, `SkeletonBodyText` (unused after the rewrite). Remove `Thumbnail` and `Icon` imports. Add `Divider` import.

The updated import block should be:

```tsx
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ProgressBar,
  EmptyState,
  Banner,
  Popover,
  ActionList,
  Divider,
  SkeletonPage,
  SkeletonBodyText,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import type { ImageCell } from "../lib/services/image-manager.server";
import { ImageTray, type TrayImage } from "../components/ImageTray";
```

- [x] **Step 2: Remove tab-related state and computed values**

In the component function (starting line 258), make these changes:

**Remove** line 265 entirely:
```tsx
// DELETE: const [activeTabIndex, setActiveTabIndex] = useState(0);
```

**Remove** line 288 entirely:
```tsx
// DELETE: const activeViewId = views[activeTabIndex]?.id ?? "";
```

**Remove** lines 303-305 entirely:
```tsx
// DELETE: const activeCells = cells.filter(
// DELETE:   (c: ImageCell) => c.viewId === activeViewId
// DELETE: );
```

**Remove** lines 307-316 entirely (the tab items computation):
```tsx
// DELETE: // ---- Tab items ----
// DELETE: const tabItems = views.map(...)
```

- [x] **Step 3: Run typecheck to confirm tab references break**

Run: `npm run typecheck`

Expected: TypeScript errors pointing to remaining references to `activeTabIndex`, `setActiveTabIndex`, `tabItems`, `activeCells` in the render JSX. These will be fixed in Task 2.

- [x] **Step 4: Commit state changes**

```bash
git add app/routes/app.products.\$id.images.tsx
git commit -m "refactor(image-manager): remove tab state, prepare for color card layout"
```

---

### Task 2: Replace Tab Layout with Color Card Rendering

**Files:**
- Modify: `app/routes/app.products.$id.images.tsx:646-982`

This is the main change. Replace the entire render return (from `return (` at line 646 to the closing `}` of the component) with the new color-card layout. The handler functions above line 646 are **completely unchanged**.

- [x] **Step 1: Replace the render return with color card layout**

Replace everything from `return (` (line 646) through the end of the component (line 982) with the following. This is the complete new render section:

```tsx
  return (
    <Page
      title="Image Manager"
      subtitle={config.name}
      backAction={{ content: "Back", url: `/app/products/${config.id}` }}
      secondaryActions={[
        {
          content: "Import from Shopify",
          loading: isImporting,
          disabled: !config.linkedProductIds[0],
          onAction: handleImportFromShopify,
        },
      ]}
    >
      <BlockStack gap="500">
        {/* ---- Progress with per-view breakdown ---- */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" as="p">
                {totalFilled} of {totalCells} images assigned
              </Text>
              <Badge tone={allComplete ? "success" : "attention"}>
                {`${Math.round(progressPercent)}%`}
              </Badge>
            </InlineStack>
            <ProgressBar progress={progressPercent} tone="primary" size="small" />
            <InlineStack gap="300" wrap>
              {views.map((view: (typeof views)[number]) => {
                const counts = viewImageCounts[view.id] ?? { filled: 0, total: 0 };
                const viewComplete = counts.total > 0 && counts.filled === counts.total;
                return (
                  <InlineStack key={view.id} gap="100" blockAlign="center">
                    <Text variant="bodySm" tone="subdued" as="span">
                      {view.perspective}
                    </Text>
                    <Badge tone={viewComplete ? "success" : "attention"} size="small">
                      {`${counts.filled}/${counts.total}`}
                    </Badge>
                  </InlineStack>
                );
              })}
            </InlineStack>
          </BlockStack>
        </Card>

        {allComplete && (
          <Banner tone="success">
            All images assigned. Your product views are fully covered.
          </Banner>
        )}

        {importTruncated && (
          <Banner tone="warning" onDismiss={() => setImportTruncated(false)}>
            Only the first 100 variants were imported. Your product may have
            more — import again or upload manually.
          </Banner>
        )}

        {/* ---- Staging Tray ---- */}
        <ImageTray
          images={trayImages}
          onBulkUpload={(files) => {
            Array.from(files).forEach((file) => {
              const preview = URL.createObjectURL(file);
              const newImg: TrayImage = {
                id: `tray-${Date.now()}-${Math.random()}`,
                storageKey: "",
                previewUrl: preview,
                originalFileName: file.name,
              };
              setTrayImages((prev) => [...prev, newImg]);
            });
          }}
          onDragStart={(img) => setDraggedTrayImage(img)}
          onSelect={(img) => setSelectedTrayImageId(img?.id ?? null)}
          selectedImageId={selectedTrayImageId}
        />

        {/* ---- Color Cards ---- */}
        {colorGroups.map((group) => {
          const groupCells = cells.filter(
            (c: ImageCell) => c.colorValue === group.colorValue
          );
          const filledCount = groupCells.filter(
            (c: ImageCell) => c.imageUrl
          ).length;
          const totalCount = groupCells.length;
          const isGroupComplete =
            totalCount > 0 && filledCount === totalCount;

          return (
            <Card key={group.colorValue}>
              <BlockStack gap="300">
                {/* Card header: color swatch + name + sizes + completion */}
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        backgroundColor: "var(--p-color-bg-fill-secondary)",
                        border: "1px solid var(--p-color-border)",
                        flexShrink: 0,
                      }}
                    />
                    <Text variant="headingSm" as="h3">
                      {group.colorValue}
                    </Text>
                  </InlineStack>
                  <Badge
                    tone={isGroupComplete ? "success" : "attention"}
                    size="small"
                  >
                    {`${filledCount}/${totalCount}`}
                  </Badge>
                </InlineStack>

                {/* Thumbnail row: one slot per view */}
                <InlineStack gap="400" wrap>
                  {groupCells.map((cell: ImageCell) => {
                    const key = cellKey(cell);
                    const viewLabel =
                      views.find(
                        (v: (typeof views)[number]) => v.id === cell.viewId
                      )?.perspective ?? "";
                    const job = [...uploadQueue]
                      .reverse()
                      .find((j) => cellKey(j.cell) === key);
                    const isUploading =
                      job?.status === "uploading" ||
                      job?.status === "queued";
                    const hasError = job?.status === "error";
                    const uploadProgress = job?.progress ?? 0;

                    const otherCells = groupCells.filter(
                      (c: ImageCell) =>
                        c.viewId !== cell.viewId
                    );

                    return (
                      <BlockStack key={key} gap="100" inlineAlign="center">
                        {/* View label */}
                        <Text
                          variant="bodySm"
                          tone="subdued"
                          as="span"
                        >
                          {viewLabel}
                        </Text>

                        {/* Thumbnail cell */}
                        <div
                          role="button"
                          tabIndex={0}
                          style={{
                            width: 100,
                            height: 80,
                            borderRadius: 6,
                            border: hasError
                              ? "2px solid var(--p-color-border-critical)"
                              : isUploading
                                ? "2px solid var(--p-color-border-info)"
                                : cell.imageUrl && !cell.isDefault
                                  ? "1px solid var(--p-color-border)"
                                  : "1px dashed var(--p-color-border)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                            overflow: "hidden",
                            cursor: "pointer",
                            opacity: cell.isDefault ? 0.5 : 1,
                            backgroundImage:
                              cell.imageUrl
                                ? `url(${cell.imageUrl})`
                                : undefined,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedTrayImage) {
                              e.currentTarget.style.outline =
                                "2px solid var(--p-color-border-brand)";
                            }
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.style.outline = "none";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.style.outline = "none";
                            handleCellDrop(cell);
                          }}
                          onClick={() => {
                            if (selectedTrayImageId) {
                              const trayImg = trayImages.find(
                                (img) => img.id === selectedTrayImageId
                              );
                              if (trayImg?.storageKey) {
                                handleCopyToCell(
                                  {
                                    ...cell,
                                    imageUrl: trayImg.storageKey,
                                  } as ImageCell,
                                  cell
                                );
                                setSelectedTrayImageId(null);
                                setTrayImages((prev) =>
                                  prev.filter(
                                    (img) =>
                                      img.id !== selectedTrayImageId
                                  )
                                );
                              }
                            } else if (
                              !cell.imageUrl ||
                              cell.isDefault
                            ) {
                              fileInputRefs.current[key]?.click();
                            }
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" ||
                              e.key === " "
                            ) {
                              e.preventDefault();
                              if (selectedTrayImageId) {
                                const trayImg = trayImages.find(
                                  (img) =>
                                    img.id === selectedTrayImageId
                                );
                                if (trayImg?.storageKey) {
                                  handleCopyToCell(
                                    {
                                      ...cell,
                                      imageUrl: trayImg.storageKey,
                                    } as ImageCell,
                                    cell
                                  );
                                  setSelectedTrayImageId(null);
                                  setTrayImages((prev) =>
                                    prev.filter(
                                      (img) =>
                                        img.id !==
                                        selectedTrayImageId
                                    )
                                  );
                                }
                              } else if (
                                !cell.imageUrl ||
                                cell.isDefault
                              ) {
                                fileInputRefs.current[key]?.click();
                              }
                            }
                          }}
                        >
                          {/* Hidden file input */}
                          <input
                            ref={(el) => {
                              fileInputRefs.current[key] = el;
                            }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            style={{ display: "none" }}
                            onChange={handleFileChange(cell)}
                          />

                          {/* Uploading state */}
                          {isUploading && (
                            <BlockStack
                              gap="100"
                              inlineAlign="center"
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                tone="subdued"
                              >
                                {job?.status === "queued"
                                  ? "Queued"
                                  : `${uploadProgress}%`}
                              </Text>
                              <div style={{ width: 52 }}>
                                <ProgressBar
                                  progress={
                                    job?.status === "queued"
                                      ? 0
                                      : uploadProgress
                                  }
                                  tone="primary"
                                  size="small"
                                />
                              </div>
                            </BlockStack>
                          )}

                          {/* Error state */}
                          {hasError && !isUploading && (
                            <BlockStack
                              gap="100"
                              inlineAlign="center"
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                tone="critical"
                              >
                                Failed
                              </Text>
                              <Button
                                size="slim"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (job) handleRetry(job);
                                }}
                              >
                                Retry
                              </Button>
                            </BlockStack>
                          )}

                          {/* Empty cell */}
                          {!cell.imageUrl &&
                            !isUploading &&
                            !hasError && (
                              <Button
                                size="slim"
                                variant="plain"
                                icon={PlusIcon}
                                onClick={() =>
                                  fileInputRefs.current[
                                    key
                                  ]?.click()
                                }
                                accessibilityLabel={`Upload ${group.colorValue} ${viewLabel}`}
                              />
                            )}

                          {/* Uploaded image — show actions popover */}
                          {cell.imageUrl &&
                            !cell.isDefault &&
                            !isUploading &&
                            !hasError && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  right: 4,
                                }}
                              >
                                <Popover
                                  active={
                                    copyPopoverCell === key
                                  }
                                  activator={
                                    <Button
                                      size="slim"
                                      variant="plain"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCopyPopoverCell(
                                          copyPopoverCell ===
                                            key
                                            ? null
                                            : key
                                        );
                                      }}
                                      accessibilityLabel="Image actions"
                                    >
                                      ⋯
                                    </Button>
                                  }
                                  onClose={() =>
                                    setCopyPopoverCell(null)
                                  }
                                >
                                  <ActionList
                                    items={[
                                      {
                                        content: "Replace",
                                        onAction: () => {
                                          fileInputRefs.current[
                                            key
                                          ]?.click();
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                      {
                                        content:
                                          "Set as view default",
                                        onAction: () => {
                                          handleSetViewDefault(
                                            cell
                                          );
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                      {
                                        content:
                                          "Apply to all empty",
                                        onAction: () => {
                                          handleApplyToAllEmpty(
                                            cell
                                          );
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                      ...otherCells.map(
                                        (
                                          target: ImageCell
                                        ) => ({
                                          content: `Copy to ${views.find((v: (typeof views)[number]) => v.id === target.viewId)?.perspective ?? target.viewId}`,
                                          onAction: () => {
                                            handleCopyToCell(
                                              cell,
                                              target
                                            );
                                            setCopyPopoverCell(
                                              null
                                            );
                                          },
                                        })
                                      ),
                                      {
                                        content: "Remove",
                                        destructive: true,
                                        onAction: () => {
                                          handleRemoveImage(
                                            cell
                                          );
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                    ]}
                                  />
                                </Popover>
                              </div>
                            )}
                        </div>

                        {/* Default badge below cell */}
                        {cell.isDefault &&
                          cell.imageUrl &&
                          !isUploading && (
                            <Badge tone="info" size="small">
                              Default
                            </Badge>
                          )}
                      </BlockStack>
                    );
                  })}
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}

        {colorGroups.length === 0 && (
          <Card>
            <Text as="p" tone="subdued">
              No color groups found. Link a Shopify product with
              color variants to see the image matrix.
            </Text>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
```

**Important notes:**
- The `handleApplyToAllEmpty` call now operates across ALL cells for that color group (not just the active view's cells). Update the reference: `otherCells` here refers to other views within the same color group, which is the correct behavior for the card layout.
- The `handleCellDrop` function is unchanged — it still uses `draggedTrayImage` from state.
- All file input refs, upload handlers, and batched save logic work identically.

- [x] **Step 2: Fix the handleApplyToAllEmpty reference**

The existing `handleApplyToAllEmpty` handler on line ~463 filters `activeCells` which no longer exists. Update it to accept cells as a parameter or filter from `cells` directly.

Find this handler (around line 463):
```tsx
  const handleApplyToAllEmpty = useCallback(async (sourceCell: ImageCell) => {
    const key = sourceCell.imageUrl;
    if (!key) return;
    const emptyTargets = activeCells.filter((c: ImageCell) => !c.imageUrl && c.colorValue !== sourceCell.colorValue);
```

Replace with:
```tsx
  const handleApplyToAllEmpty = useCallback(async (sourceCell: ImageCell) => {
    const key = sourceCell.imageUrl;
    if (!key) return;
    // Find all empty cells across all color groups for this view
    const emptyTargets = cells.filter((c: ImageCell) => !c.imageUrl && c.viewId === sourceCell.viewId && c.colorValue !== sourceCell.colorValue);
```

Also update the dependency array at the end of this useCallback — change `activeCells` to `cells`:
```tsx
  }, [cells, config.id, revalidator]);
```

- [x] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS (no errors). If there are remaining references to removed variables (`activeTabIndex`, `tabItems`, `activeCells`, `activeViewId`), find and remove them.

- [x] **Step 4: Commit**

```bash
git add app/routes/app.products.\$id.images.tsx
git commit -m "feat(image-manager): replace tab layout with color card rendering

Each color group is now a Polaris Card containing all view thumbnails
inline. Progress card shows per-view completion badges. All upload,
drag-drop, and copy handlers preserved unchanged."
```

---

### Task 3: Simplify ImageTray for Compact Inline Display

**Files:**
- Modify: `app/components/ImageTray.tsx`

The tray becomes a compact single-row inline strip instead of a collapsible paginated section.

- [x] **Step 1: Rewrite ImageTray component**

Replace the entire content of `app/components/ImageTray.tsx` with:

```tsx
/**
 * ImageTray — compact inline staging area for unassigned images.
 * Images land here from Shopify import or bulk upload, then get
 * dragged/tapped onto color card cells.
 */

import {
  Card,
  InlineStack,
  Text,
  Badge,
  Button,
} from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";
import { useRef } from "react";

export type TrayImage = {
  id: string;
  storageKey: string;
  previewUrl: string;
  originalFileName?: string;
};

type Props = {
  images: TrayImage[];
  onBulkUpload: (files: FileList) => void;
  onDragStart: (image: TrayImage) => void;
  onSelect?: (image: TrayImage | null) => void;
  selectedImageId?: string | null;
};

export function ImageTray({
  images,
  onBulkUpload,
  onDragStart,
  onSelect,
  selectedImageId,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (images.length === 0) return null;

  return (
    <Card>
      <InlineStack gap="300" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Text variant="bodySm" fontWeight="semibold" as="span">
            Staging Tray
          </Text>
          <Badge size="small">{`${images.length}`}</Badge>
        </InlineStack>

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

        <Text variant="bodySm" tone="subdued" as="span">
          Drag to cards below
        </Text>

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

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS. The `TrayImage` type and `ImageTray` export names are unchanged, so all existing imports work.

- [x] **Step 3: Commit**

```bash
git add app/components/ImageTray.tsx
git commit -m "refactor(image-tray): simplify to compact inline strip

Remove collapsible behavior and pagination. Show all tray images
in a single row with drag-to-assign and tap-to-select."
```

---

### Task 4: Typecheck, Lint, and Fix

**Files:**
- Possibly modify: `app/routes/app.products.$id.images.tsx` (cleanup)

- [x] **Step 1: Run full typecheck**

Run: `npm run typecheck`

Expected: PASS. If there are errors, fix them. Common issues:
- Leftover references to `Tabs`, `activeTabIndex`, `activeCells`, `tabItems`, `activeViewId`
- Missing Polaris component imports (check `Divider` is imported but used, or remove if unused)
- Type mismatches in the new JSX

- [x] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS or only pre-existing warnings. Fix any new errors. Common issues:
- Unused imports (clean up)
- `@typescript-eslint/no-explicit-any` on `window.shopify`
- React hook dependency warnings

- [x] **Step 3: Commit fixes if any**

```bash
git add -A
git commit -m "fix(image-manager): resolve typecheck and lint issues"
```

---

### Task 5: Visual Verification

**Files:** None modified — this is a verification-only task.

**Prerequisites:** The Shopify dev server must be running (`npm run dev`). A product setup with views and linked Shopify product must exist.

- [x] **Step 1: Navigate to Image Manager page**

1. Open the Shopify admin in the browser
2. Navigate to an existing product setup (e.g., via the app dashboard → Products → click a product)
3. Click "Manage Images" button in the sidebar

- [x] **Step 2: Verify the color card layout**

Check these elements are present and correct:
- **Progress card** at the top with "X of Y images assigned", progress bar, and per-view badges (e.g., "Front 5/5", "Back 2/5")
- **Staging tray** (if images exist) as a compact horizontal row with small thumbnails
- **Color cards** — one per color group, each showing:
  - Color name as heading with completion badge (e.g., "2/3")
  - View labels above each thumbnail slot (Front, Back, Left Sleeve, etc.)
  - Correct cell states: empty (dashed border + "+"), uploaded (image thumbnail), default (dimmed + "Default" badge), uploading (progress bar)
- **"Import from Shopify"** button in the page header
- **Empty states** for no views / no linked product work correctly

- [x] **Step 3: Verify interactions**

Test each interaction:
1. **Click an empty cell** → file picker opens
2. **Upload a file** → progress bar appears, then thumbnail shows
3. **Click "⋯" on an uploaded image** → action popover shows: Replace, Set as view default, Apply to all empty, Copy to [other views], Remove
4. **"Set as view default"** → other color cards' same-view cells show the default image (dimmed + "Default" badge)
5. **"Remove"** → cell returns to empty
6. **Import from Shopify** → images appear in staging tray
7. **Drag from tray to cell** → image assigns to that cell
8. **Tap tray image then click cell** → same as drag (tap-to-select flow)

- [x] **Step 4: Take screenshots for the record**

Take a screenshot (JPG format) of:
1. The partially-filled state showing multiple color cards
2. The action popover on an uploaded image

Save to project root or verify visually.

- [x] **Step 5: Final commit if any visual fixes needed**

If visual issues were found and fixed in previous steps:
```bash
git add -A
git commit -m "fix(image-manager): visual polish after verification"
```

---

## Self-Review Checklist

| Requirement | Task |
|---|---|
| Remove tab-per-view layout | Task 1 (state), Task 2 (JSX) |
| Color card with all views inline | Task 2 |
| Per-view completion badges | Task 2 (progress card) |
| Per-card completion badge | Task 2 (card header) |
| Compact staging tray | Task 3 |
| Click-to-upload on empty cells | Task 2 (onClick → fileInputRef) |
| Drag-drop from tray | Task 2 (onDragOver/onDrop handlers) |
| Tap-to-select from tray | Task 2 (onClick with selectedTrayImageId) |
| Set as view default | Task 2 (ActionList item) |
| Copy to other views | Task 2 (ActionList with otherCells) |
| Apply to all empty | Task 2 (ActionList item, handler fixed in Step 2) |
| Remove image | Task 2 (ActionList destructive item) |
| Replace image | Task 2 (ActionList → fileInputRef) |
| Upload progress | Task 2 (isUploading state rendering) |
| Error + retry | Task 2 (hasError state rendering) |
| Default/inherited badge | Task 2 (isDefault badge below cell) |
| Empty state (no views) | Kept from existing code (lines 582-603) |
| Empty state (no product) | Kept from existing code (lines 605-627) |
| Loading skeleton | Kept from existing code (lines 629-644) |
| Backend unchanged | No backend tasks |
| Typecheck passes | Task 4 |
| Lint passes | Task 4 |
| Visual verification | Task 5 |
