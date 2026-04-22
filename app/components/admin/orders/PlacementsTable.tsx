/**
 * PlacementsTable — per-line placement rows showing artwork status + actions.
 *
 * Columns: Placement (name + size label + asset filename), Artwork (badge),
 * Action (download button when asset present, ArtworkUploader island when not).
 *
 * ArtworkUploader is preserved as a Polaris React island — the existing
 * DropZone / upload state machine is kept intact. It lives alongside
 * <s-*> web components without conflict because AppProvider wraps the
 * entire admin tree.
 *
 * Download button: links to logoAssetMap[assetId].downloadUrl (presigned).
 * On 403, user sees an explanatory toast (the <a> opens in a new tab; we
 * cannot intercept 403 on a direct anchor link, so we show an informational
 * toast on click to prime the user that they may need to refresh if the link
 * expired).
 */

import { useState, useCallback } from "react";
import type { Placement } from "../../../lib/admin-types";
import { artworkStatusLabel, artworkStatusTone } from "../../../lib/admin/terminology";
import type { ArtworkStatus } from "@prisma/client";
import { useToast } from "../../../lib/admin/app-bridge.client";
import { useSubmit } from "react-router";
import { DropZone, Spinner, Banner, Box } from "@shopify/polaris";

function ArtworkUploaderIsland({
  lineId,
  placementId,
  onDone,
}: {
  lineId: string;
  placementId: string;
  onDone: () => void;
}) {
  const submit = useSubmit();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const allowedTypes = ["image/jpeg", "image/png", "image/svg+xml"];
      if (!allowedTypes.includes(file.type)) {
        setError("Please upload a JPG, PNG, or SVG file");
        return;
      }

      setUploading(true);
      setError(null);

      try {
        // Step 1: Get presigned upload URL + create LogoAsset
        const urlForm = new FormData();
        urlForm.append("intent", "get-upload-url");
        urlForm.append("lineId", lineId);
        urlForm.append("contentType", file.type);
        urlForm.append("fileName", file.name);

        const urlRes = await fetch("/api/admin/artwork-upload", {
          method: "POST",
          body: urlForm,
        });
        const urlData = await urlRes.json();
        if (!urlData.success)
          throw new Error(urlData?.error?.message ?? "Failed to get upload URL");

        // Step 2: Upload file directly to R2
        const putRes = await fetch(urlData.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error("Failed to upload file to storage");

        // Step 3: Complete the upload and bind to the specific placement
        const completeForm = new FormData();
        completeForm.append("intent", "complete-upload");
        completeForm.append("lineId", lineId);
        completeForm.append("logoAssetId", urlData.logoAssetId);
        completeForm.append("placementId", placementId);

        const completeRes = await fetch("/api/admin/artwork-upload", {
          method: "POST",
          body: completeForm,
        });
        const completeData = await completeRes.json();
        if (!completeData.success) throw new Error("Failed to finalize upload");

        setDone(true);
        onDone();
        // Trigger a page reload to reflect the new status
        submit(null, { method: "GET" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [lineId, placementId, submit, onDone],
  );

  if (done) {
    return (
      <Box paddingBlockStart="200">
        <Banner tone="success">Artwork uploaded successfully.</Banner>
      </Box>
    );
  }

  return (
    <Box paddingBlockStart="200">
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}
      <DropZone
        accept="image/jpeg,image/png,image/svg+xml"
        type="image"
        onDrop={handleDrop}
        disabled={uploading}
        variableHeight
      >
        <DropZone.FileUpload actionTitle="Upload artwork" actionHint="SVG, PNG, JPG" />
        {uploading && <Spinner size="small" />}
      </DropZone>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// LogoAsset shape (subset of what loader returns)
// ---------------------------------------------------------------------------

export type LogoAssetDTO = {
  id: string;
  originalFileName: string | null;
  fileSizeBytes: number | null;
  downloadUrl: string | null;
  previewUrl: string | null;
};

// ---------------------------------------------------------------------------
// PlacementsTable
// ---------------------------------------------------------------------------

type PlacementsTableProps = {
  lineId: string;
  placements: Placement[];
  logoAssetIdsByPlacementId: Record<string, string | null> | null;
  logoAssetMap: Record<string, LogoAssetDTO>;
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export default function PlacementsTable({
  lineId,
  placements,
  logoAssetIdsByPlacementId,
  logoAssetMap,
}: PlacementsTableProps) {
  const showToast = useToast();
  // expandedUploader tracks which placementId is expanded, or null for none.
  const [expandedUploader, setExpandedUploader] = useState<string | null>(null);

  const handleDownloadClick = useCallback(
    (url: string | null) => {
      if (!url) {
        showToast(
          "Download URL is not available. Refresh the page to regenerate.",
          { isError: true },
        );
        return;
      }
      // Presigned URLs are valid for 3600 s. On 403, surface a toast.
      // We open the URL immediately; if it 403s, the browser handles it.
      // We prime the user with an informational note.
      showToast(
        "Opening download. If you see an error, the URL may have expired — refresh the page.",
        { duration: 4000 },
      );
    },
    [showToast],
  );

  if (placements.length === 0) {
    return (
      <s-section heading="Placements" padding="none" accessibilityLabel="Placements table">
        <s-box padding="base">
          <s-text color="subdued">No placements configured for this line.</s-text>
        </s-box>
      </s-section>
    );
  }

  return (
    <s-section heading="Placements" padding="none">
      <s-box border="base" borderRadius="base" overflow="hidden">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Placement</s-table-header>
            <s-table-header listSlot="inline">Artwork</s-table-header>
            <s-table-header>
              <s-stack direction="inline" alignItems="end">
                Action
              </s-stack>
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {placements.map((placement) => {
              const assetId = logoAssetIdsByPlacementId?.[placement.id] ?? null;
              const asset = assetId ? logoAssetMap[assetId] ?? null : null;

              // Derive artwork status for this placement.
              const artworkStatus: ArtworkStatus = asset ? "PROVIDED" : "PENDING_CUSTOMER";
              const badgeTone = artworkStatusTone(artworkStatus);
              const badgeLabel = artworkStatusLabel(artworkStatus);

              const isExpanded = expandedUploader === placement.id;

              return (
                <s-table-row key={placement.id}>
                  {/* Placement column */}
                  <s-table-cell>
                    <s-stack direction="block" gap="small-100">
                      <s-text type="strong">{placement.name}</s-text>
                      {asset?.originalFileName && (
                        <s-text color="subdued">
                          {asset.originalFileName}
                          {asset.fileSizeBytes != null
                            ? ` · ${formatFileSize(asset.fileSizeBytes)}`
                            : ""}
                        </s-text>
                      )}
                    </s-stack>
                  </s-table-cell>

                  {/* Artwork status column */}
                  <s-table-cell>
                    <s-badge tone={badgeTone}>{badgeLabel}</s-badge>
                  </s-table-cell>

                  {/* Action column */}
                  <s-table-cell>
                    <s-stack direction="block" gap="small-200" alignItems="end">
                      {asset?.downloadUrl ? (
                        <a
                          href={asset.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => handleDownloadClick(asset.downloadUrl)}
                          style={{ textDecoration: "none" }}
                        >
                          <s-button
                            variant="tertiary"
                            icon="download"
                            accessibilityLabel={`Download artwork for ${placement.name}`}
                          >
                            Download
                          </s-button>
                        </a>
                      ) : (
                        <s-button
                          variant={isExpanded ? "secondary" : "primary"}
                          accessibilityLabel={`Upload artwork for ${placement.name}`}
                          onClick={() =>
                            setExpandedUploader(isExpanded ? null : placement.id)
                          }
                        >
                          {isExpanded ? "Cancel" : "Upload artwork"}
                        </s-button>
                      )}

                      {isExpanded && (
                        <ArtworkUploaderIsland
                          lineId={lineId}
                          placementId={placement.id}
                          onDone={() => setExpandedUploader(null)}
                        />
                      )}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
      </s-box>
    </s-section>
  );
}
