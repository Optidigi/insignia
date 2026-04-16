/**
 * Step 1: Upload artwork or choose "Logo later", then select a decoration method.
 * Design intent: drag-drop, file picker, validation (type, 5MB), success state,
 * logo-later card, divider, and radio-style method cards.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StorefrontConfig } from "./types";
import type { LogoState } from "./CustomizationModal";
import { IconCheck, IconChevronRight, IconCloudUpload, IconCircleCheck } from "./icons";
import type { TranslationStrings } from "./i18n";
import { proxyUrl } from "../../lib/storefront/proxy-url.client";
import { formatCurrency } from "./currency";

const ACCEPT = ".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg";
const MAX_BYTES = 5 * 1024 * 1024;

function validateFileAgainstConstraints(
  file: File,
  constraints: { fileTypes: string[]; maxColors: number | null; minDpi: number | null } | null
): string | null {
  if (!constraints || constraints.fileTypes.length === 0) return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!constraints.fileTypes.includes(ext)) {
    return `This method accepts: ${constraints.fileTypes.map((t) => t.toUpperCase()).join(", ")}`;
  }
  return null;
}

type UploadStepProps = {
  config: StorefrontConfig;
  logo: LogoState;
  onLogoChange: (logo: LogoState) => void;
  selectedMethodId: string | null;
  onMethodChange: (id: string) => void;
  onContinue: () => void;
  t: TranslationStrings;
};

export function UploadStep({
  config,
  logo,
  onLogoChange,
  selectedMethodId,
  onMethodChange,
  t,
}: UploadStepProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-select method when there is exactly one option
  useEffect(() => {
    if (config.methods.length === 1 && !selectedMethodId) {
      onMethodChange(config.methods[0].id);
    }
  }, [config.methods.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateAndUpload = useCallback(
    async (file: File) => {
      if (uploading) return;
      setError(null);
      const allowedTypes = [
        "image/svg+xml",
        "image/png",
        "image/jpeg",
        "image/jpg",
      ];
      if (
        !allowedTypes.includes(file.type) &&
        !file.name.match(/\.(svg|png|jpg|jpeg)$/i)
      ) {
        setError("Please use an image file: SVG, PNG, or JPG.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("File must be 5MB or smaller.");
        return;
      }
      // Validate against the selected method's artwork constraints
      const selectedMethod = config.methods.find((m) => m.id === selectedMethodId);
      const constraintError = validateFileAgainstConstraints(file, selectedMethod?.artworkConstraints ?? null);
      if (constraintError) {
        setError(constraintError);
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(proxyUrl("/apps/insignia/uploads"), {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data?.error?.message || `Upload failed (${res.status})`
          );
        }
        const { logoAsset } = await res.json();
        onLogoChange({
          type: "uploaded",
          logoAssetId: logoAsset.id,
          previewPngUrl: logoAsset.previewPngUrl,
          sanitizedSvgUrl: logoAsset.sanitizedSvgUrl ?? null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onLogoChange, uploading, selectedMethodId, config.methods]
  );

  const onFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      validateAndUpload(file);
    },
    [validateAndUpload]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const onChooseFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) onFile(f);
      e.target.value = "";
    },
    [onFile]
  );

  const onLogoLater = useCallback(() => {
    setError(null);
    onLogoChange({ type: "later" });
  }, [onLogoChange]);

  const onRemove = useCallback(() => {
    onLogoChange({ type: "none" });
    setError(null);
  }, [onLogoChange]);

  const isLogoLater = logo.type === "later";
  const hasLogo = logo.type !== "none";

  return (
    <section aria-labelledby="upload-heading">
      <h2 id="upload-heading" className="visually-hidden">
        {t.upload.title}
      </h2>

      {/* Upload section label */}
      <p className="insignia-section-label">{t.upload.sectionLabel}</p>

      {/* Hidden file input — always present for replace-artwork flow */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onInputChange}
        className="visually-hidden"
        aria-hidden
        disabled={uploading}
      />

      {/* Upload zone — shown when no logo selected */}
      {logo.type === "none" && (
        <div
          className="insignia-upload-zone"
          data-dragging={dragging}
          onDrop={uploading ? undefined : onDrop}
          onDragOver={uploading ? undefined : onDragOver}
          onDragLeave={uploading ? undefined : onDragLeave}
          onClick={uploading ? undefined : onChooseFile}
          role="button"
          tabIndex={uploading ? -1 : 0}
          onKeyDown={
            uploading
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChooseFile();
                  }
                }
          }
          aria-label={t.upload.dropzone}
          aria-busy={uploading}
          style={uploading ? { opacity: 0.6, pointerEvents: "none" } : undefined}
        >
          {uploading ? (
            <>
              <IconCloudUpload size={32} style={{ color: "#9CA3AF" }} />
              <p>{t.common.loading}</p>
              <p className="hint">{t.upload.formats}</p>
            </>
          ) : (
            <>
              <IconCloudUpload size={32} style={{ color: "#9CA3AF" }} />
              <p>{t.upload.tapUpload}</p>
              <p className="hint">{t.upload.formats}</p>
            </>
          )}
        </div>
      )}

      {/* Success state — uploaded logo or logo later selected */}
      {hasLogo && (
        <div className="insignia-upload-zone" data-success="true">
          <div className="insignia-upload-success">
            <div className="insignia-upload-success-icon">
              <IconCheck />
            </div>
            <div className="insignia-upload-success-name">
              {isLogoLater ? t.upload.laterTitle : t.upload.title}
            </div>
            <div className="insignia-upload-success-status">
              {isLogoLater ? t.upload.placeholderSelected : t.upload.success}
            </div>
            <button className="insignia-upload-remove" onClick={onRemove}>
              {t.upload.remove}
            </button>
          </div>
        </div>
      )}

      {/* Replace artwork — always visible after upload so customer can swap */}
      {logo.type === "uploaded" && (
        <button
          type="button"
          className="insignia-btn insignia-btn-secondary"
          style={{ marginTop: 8, width: "100%" }}
          onClick={onChooseFile}
          disabled={uploading}
        >
          <IconCloudUpload size={14} style={{ marginRight: 6 }} />
          Replace artwork
        </button>
      )}

      {/* Or-divider + Logo later — only shown when no logo */}
      {logo.type === "none" && (
        <>
          <div className="insignia-or-divider">
            <div className="insignia-or-divider-line" />
            <span className="insignia-or-divider-text">{t.upload.orDivider}</span>
            <div className="insignia-or-divider-line" />
          </div>
          <button
            type="button"
            className="insignia-logo-later-card"
            onClick={onLogoLater}
          >
            <div className="insignia-logo-later-info">
              <div className="insignia-logo-later-title">{t.upload.laterTitle}</div>
              <div className="insignia-logo-later-subtitle">{t.upload.laterSubtitle}</div>
            </div>
            <IconChevronRight size={18} style={{ color: "#9CA3AF", flexShrink: 0 }} />
          </button>
          <p className="insignia-upload-helper-text">{t.upload.laterHelperMobile}</p>
        </>
      )}

      {error && (
        <div className="insignia-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {/* Divider between upload and method sections */}
      <div className="insignia-divider" />

      {/* Decoration method section label */}
      <p className="insignia-section-label">{t.upload.methodLabel}</p>

      {/* Method selection cards */}
      <div role="radiogroup" aria-label="Decoration method" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {config.methods.map((method) => {
        const isSelected = method.id === selectedMethodId;
        const displayName = method.customerName || method.name;
        const displayDescription = method.customerDescription;
        return (
          <button
            key={method.id}
            type="button"
            className="insignia-method-card"
            data-selected={isSelected ? "true" : undefined}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            onClick={() => onMethodChange(method.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onMethodChange(method.id);
              }
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>
                {displayName}
              </div>
              {displayDescription && (
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  {displayDescription}
                </div>
              )}
            </div>
            <div className="insignia-method-price-area">
              <span className="insignia-method-price-value">
                +{formatCurrency(method.basePriceCents, config.currency)}
              </span>
              <span className="insignia-method-price-label">{t.upload.perPlacement}</span>
            </div>
            <div
              className="insignia-method-indicator"
              data-selected={isSelected ? "true" : undefined}
            >
              {isSelected && <IconCircleCheck size={18} style={{ color: "white" }} />}
            </div>
          </button>
        );
      })}
      </div>
    </section>
  );
}
