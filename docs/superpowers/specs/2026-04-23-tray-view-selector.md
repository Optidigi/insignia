# Tray View Selector Design Spec

**Goal:** Let merchants choose which views the "Auto-assign by color" button targets, using inline toggle pills when ≤ 3 views or a split-button + popover when > 3 views.

**Architecture:** Pure client-side state in `app.products.$id.images.tsx`. A new `selectedViewIds: string[]` state (initialised to all view IDs) is passed into `ImageTray` alongside the existing `views` array. `ImageTray` picks its render mode based on `views.length`, and `handleAutoAssignFromTray` filters the view loop to `selectedViewIds`. No backend changes.

**Tech Stack:** React 18, Polaris v13 (`ButtonGroup`, `Button`, `Popover`, `ChoiceList`), TypeScript strict. Shopify Dev MCP must validate Polaris component usage before implementation.

---

## Behaviour

### Default state
All views are selected when the page loads. There is no persistence across sessions — every page visit resets to "all views on".

### ≤ 3 views — inline toggle pills
A `ButtonGroup variant="segmented"` renders one pill per view inside the ImageTray header. Each pill shows the view's human-readable name (`view.name || view.perspective`).

- **Selected** (in scope): rendered with `variant="primary"` (green fill).
- **Deselected** (excluded): rendered with no variant (grey).
- Clicking a pill calls `onViewToggle(view.id)`, toggling it in/out of `selectedViewIds`.
- The "Auto-assign by color" button is **disabled** (and shows `disabled` Polaris state) whenever `selectedViewIds` is empty.

### > 3 views — split button + popover
Two adjacent Polaris `Button` components form a visual split button:

1. **Main button** — `variant="primary"`, label updates to reflect scope:
   - All views selected → `"Auto-assign by color"`
   - Some views selected → `"Auto-assign · Front, Back"` (comma-joined view names)
   - None selected → `"Auto-assign by color"` + `disabled`
2. **Chevron button** — `variant="primary"`, `icon={ChevronDownIcon}`, `accessibilityLabel="Select views"`, opens/closes the popover.

The `Popover` renders a `ChoiceList` in `allowMultiple` mode, with one choice per view (label = `view.name || view.perspective`, value = `view.id`). The selection in the `ChoiceList` is bound to `selectedViewIds`. Closing the popover (clicking outside or chevron again) does not change the selection.

### Auto-assign logic change
`handleAutoAssignFromTray` currently iterates `for (const view of views)`. After this feature, it iterates only views whose IDs are in `selectedViewIds`:

```ts
const targetViews = views.filter((v) => selectedViewIds.includes(v.id));
for (const view of targetViews) { ... }
```

If `selectedViewIds` is empty the button is disabled, so this guard is defensive only.

---

## Component contract changes

### `ImageTray` — new props
```ts
type Props = {
  // existing
  images: TrayImage[];
  onBulkUpload: (files: FileList) => void | Promise<void>;
  onDragStart: (image: TrayImage) => void;
  onSelect?: (image: TrayImage | null) => void;
  selectedImageId?: string | null;
  onAutoAssign?: () => void | Promise<void>;
  isAutoAssigning?: boolean;
  autoAssignDisabled?: boolean;
  // NEW
  views?: Array<{ id: string; name: string | null; perspective: string }>;
  selectedViewIds?: string[];
  onViewToggle?: (viewId: string) => void;
};
```

All three new props are optional (backward-compatible). When `views` is undefined or empty, the existing button renders unchanged.

### `app.products.$id.images.tsx` — new state
```ts
const [selectedViewIds, setSelectedViewIds] = useState<string[]>(
  () => views.map((v) => v.id)
);

const handleViewToggle = useCallback((viewId: string) => {
  setSelectedViewIds((prev) =>
    prev.includes(viewId) ? prev.filter((id) => id !== viewId) : [...prev, viewId]
  );
}, []);
```

`selectedViewIds` initialises from loader `views` (stable array) via a lazy initialiser.  
`handleViewToggle` is passed as `onViewToggle` to `ImageTray`.  
`autoAssignDisabled` gains `|| selectedViewIds.length === 0`.

---

## Render mode decision

```ts
const PILL_THRESHOLD = 3;
const usePillMode = (views?.length ?? 0) <= PILL_THRESHOLD;
```

The threshold constant is defined at the top of `ImageTray.tsx` so it is easy to find and change.

---

## Edge cases

| Case | Behaviour |
|---|---|
| 1 view total | Single pill shown; always on; deselecting disables button |
| All views deselected | Button disabled; tray still functional for drag-drop |
| View names are null/empty | Fall back to `view.perspective` enum value |
| `views` prop not passed | No view-selector UI rendered; button behaves as before |
| Revalidation refreshes views | `selectedViewIds` state is NOT reset on revalidation — persists within the page session |

---

## What is NOT in scope

- Persisting view selection to localStorage or the database.
- Per-tray-image view assignment (dragging each image to a specific view cell is already handled by the existing drag-drop flow).
- Changing the split-button threshold (3) via any UI.
