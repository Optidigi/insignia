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
  onBulkUpload: (files: FileList) => void | Promise<void>;
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

  return (
    <Card>
      <InlineStack gap="300" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Text variant="bodySm" fontWeight="semibold" as="span">
            Staging Tray
          </Text>
          {images.length > 0 && (
            <Badge size="small">{`${images.length}`}</Badge>
          )}
        </InlineStack>

        {images.length === 0 && (
          <Text variant="bodySm" tone="subdued" as="span">
            Upload images here, then drag them to the color cards below.
          </Text>
        )}

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
                // Selection handled by onClick; drag-and-drop API is pointer-only
                // Tap-to-select flow provides keyboard-accessible cell assignment
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
