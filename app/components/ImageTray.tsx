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

  // Label for the split-button main action (>3 views).
  // sel.length === 0 is a dead branch — the button is disabled when no views are selected —
  // but it returns the generic label as a safe fallback.
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

        {/* Split-button mode (>3 views): always rendered so the popover is accessible even
            when the tray is empty. Main action button is additionally disabled while empty. */}
        {!usePillMode && hasViews && views && onAutoAssign && (
          <InlineStack gap="100" blockAlign="center">
            <Button
              size="slim"
              variant="primary"
              onClick={() => onAutoAssign()}
              loading={isAutoAssigning}
              disabled={autoAssignDisabled || images.length === 0}
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
        )}

        {/* Pill mode or no views prop: simple button (only visible when tray has images) */}
        {images.length > 0 && onAutoAssign && (usePillMode || !hasViews) && (
          <Button
            size="slim"
            variant="primary"
            onClick={() => onAutoAssign()}
            loading={isAutoAssigning}
            disabled={autoAssignDisabled}
          >
            Auto-assign by color
          </Button>
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
