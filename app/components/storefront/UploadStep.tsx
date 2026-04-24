/**
 * Step 1 — Upload artwork (or defer) + select decoration method.
 *
 * State axis (data-state) for the dropzone — A1..A8 from the design intent doc:
 *   idle, dragover, uploading, uploaded, error-size, error-format, disabled, loading
 *
 * Method cards (radio-as-card) auto-select when there's exactly one method.
 *
 * Backend bindings (PENCIL.md):
 *   POST /apps/insignia/uploads (multipart, field: file)
 *     → { logoAsset: { id, kind, previewPngUrl, sanitizedSvgUrl } }
 *   Format list pulled from selectedMethod.artworkConstraints.fileTypes when
 *   present; falls back to the broad SVG/PNG/JPG list otherwise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StorefrontConfig } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { proxyUrl } from "../../lib/storefront/proxy-url.client";
import { formatCurrency, formatPriceDelta } from "./currency";
import {
  IconCheck,
  IconChevronRight,
  IconCloudUpload,
  IconDownload,
  IconAlertTriangle,
  IconClipboardCheck,
  IconHelpCircle,
} from "./icons";

const MAX_BYTES = 5 * 1024 * 1024;
const STALL_MS = 30_000;

type UploadState =
  | "idle"
  | "dragover"
  | "uploading"
  | "uploaded"
  | "error-size"
  | "error-format"
  | "later";

type UploadStepProps = {
  config: StorefrontConfig;
  logo: LogoState;
  onLogoChange: (logo: LogoState) => void;
  selectedMethodId: string | null;
  onMethodChange: (id: string) => void;
  t: TranslationStrings;
  onAnalytics?: (name: string, detail: Record<string, unknown>) => void;
};

function formatList(types: string[] | null | undefined): string {
  if (!types || types.length === 0) return "SVG · PNG · JPG";
  return types.map((s) => s.toUpperCase()).join(" · ");
}

export function UploadStep({
  config,
  logo,
  onLogoChange,
  selectedMethodId,
  onMethodChange,
  t,
  onAnalytics,
}: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stallTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<UploadState>(() =>
    logo.type === "uploaded" ? "uploaded" : logo.type === "later" ? "later" : "idle",
  );
  const [errorBody, setErrorBody] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);

  const selectedMethod = config.methods.find((m) => m.id === selectedMethodId);
  const constraints = selectedMethod?.artworkConstraints ?? null;
  const fileTypeList = constraints?.fileTypes ?? null;
  const formats = formatList(fileTypeList);

  // Keep upload state in sync with logo state changes (e.g. parent reset).
  useEffect(() => {
    if (logo.type === "uploaded") setState("uploaded");
    else if (logo.type === "later") setState("later");
    else if (state === "uploaded" || state === "later") setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logo.type]);

  // Auto-select method when there is exactly one.
  useEffect(() => {
    if (config.methods.length === 1 && !selectedMethodId) {
      onMethodChange(config.methods[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.methods.length]);

  const cancelStallTimer = () => {
    if (stallTimerRef.current != null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setStalled(false);
  };

  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cancelStallTimer();
    setState("idle");
    setErrorBody(null);
  }, []);

  const validateFile = useCallback(
    (file: File): UploadState | "ok" => {
      // Size first — fast check.
      if (file.size > MAX_BYTES) return "error-size";
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      // Method-defined allowlist takes precedence; otherwise a baseline of
      // server-supported types matches what /apps/insignia/uploads accepts.
      const allowed = fileTypeList ?? ["svg", "png", "jpg", "jpeg", "webp"];
      if (!allowed.includes(ext)) return "error-format";
      return "ok";
    },
    [fileTypeList],
  );

  const doUpload = useCallback(
    async (file: File) => {
      const validation = validateFile(file);
      if (validation !== "ok") {
        setState(validation);
        setErrorBody(
          validation === "error-size"
            ? t.v2.upload.rejectedSizeBody
            : t.v2.upload.rejectedFormatBody.replace("{formats}", formats),
        );
        onAnalytics?.("upload_error", {
          code: validation,
          fileType: file.type,
          fileSizeBytes: file.size,
        });
        return;
      }

      setState("uploading");
      setErrorBody(null);
      const controller = new AbortController();
      abortRef.current = controller;
      cancelStallTimer();
      stallTimerRef.current = window.setTimeout(() => setStalled(true), STALL_MS);

      onAnalytics?.("upload_start", { fileType: file.type, fileSizeBytes: file.size });

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(proxyUrl("/apps/insignia/uploads"), {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: { message?: string; code?: string };
          };
          const code = data.error?.code ?? `HTTP_${res.status}`;
          const message = data.error?.message ?? `Upload failed (${res.status})`;
          if (code === "VALIDATION_ERROR" && message.toLowerCase().includes("size")) {
            setState("error-size");
            setErrorBody(message);
          } else if (
            code === "VALIDATION_ERROR" &&
            (message.toLowerCase().includes("type") || message.toLowerCase().includes("format"))
          ) {
            setState("error-format");
            setErrorBody(message);
          } else {
            setState("error-format");
            setErrorBody(message);
          }
          onAnalytics?.("upload_error", { code, message });
          return;
        }
        const json = (await res.json()) as {
          logoAsset: {
            id: string;
            kind: "buyer_upload";
            previewPngUrl: string;
            sanitizedSvgUrl: string | null;
          };
        };
        const asset = json.logoAsset;
        onLogoChange({
          type: "uploaded",
          logoAssetId: asset.id,
          previewPngUrl: asset.previewPngUrl,
          sanitizedSvgUrl: asset.sanitizedSvgUrl,
        });
        setState("uploaded");
        onAnalytics?.("upload_success", { logoAssetId: asset.id, fileType: file.type });
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          // Aborted — could be explicit user cancel (cancelUpload()) or component
          // unmount cleanup. Reset to idle so re-mounting the component starts fresh.
          setState("idle");
          setErrorBody(null);
          return;
        }
        const message = err instanceof Error ? err.message : "Upload failed";
        setState("error-format");
        setErrorBody(message);
        onAnalytics?.("upload_error", { code: "NETWORK", message });
      } finally {
        cancelStallTimer();
        abortRef.current = null;
      }
    },
    [validateFile, formats, onLogoChange, onAnalytics, t.v2.upload],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      cancelStallTimer();
    };
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setState((s) => (s === "dragover" ? "idle" : s));
    if (state === "uploading") return;
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (state === "uploading" || state === "uploaded") return;
    setState("dragover");
  };

  const onDragLeave = () => {
    setState((s) => (s === "dragover" ? "idle" : s));
  };

  const onPickFile = () => {
    if (state === "uploading") return;
    inputRef.current?.click();
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) doUpload(file);
  };

  const removeLogo = () => {
    onLogoChange({ type: "none" });
    setState("idle");
    setErrorBody(null);
  };

  const toggleLater = () => {
    if (logo.type === "later") {
      onLogoChange({ type: "none" });
    } else {
      onLogoChange({ type: "later" });
    }
  };

  const acceptAttr = (fileTypeList ?? ["svg", "png", "jpg", "jpeg"])
    .map((ext) => `.${ext}`)
    .join(",");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="insignia-upload-heading">
      <div className="insignia-step-heading">
        <h2 id="insignia-upload-heading" className="insignia-step-heading-title">
          {t.v2.upload.sectionTitle}
        </h2>
        <p className="insignia-step-heading-sub">{t.v2.upload.sectionSubtitle}</p>
      </div>

      <h3 className="insignia-section-label insignia-only-mobile">
        {t.v2.upload.sectionTitle}
      </h3>

      {/* Logo-later confirmation block — replaces the dropzone + or-divider + later-card */}
      {logo.type === "later" ? (
        <LaterConfirm onCancel={toggleLater} t={t} />
      ) : (
        <>
          <div
            className="insignia-upload-zone"
            data-state={state}
            onClick={onPickFile}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPickFile();
              }
            }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            role="button"
            tabIndex={0}
            aria-label={t.v2.upload.idle}
          >
            <input
              ref={inputRef}
              className="insignia-upload-zone-input"
              type="file"
              accept={acceptAttr}
              onChange={onInputChange}
              aria-hidden="true"
              tabIndex={-1}
            />

            {(state === "idle" || state === "dragover") && (
              <UploadIdle
                state={state}
                t={t}
                formats={`${formats} (Max 5 MB)`}
              />
            )}

            {state === "uploading" && (
              <UploadInProgress
                stalled={stalled}
                onCancel={cancelUpload}
                t={t}
              />
            )}

            {state === "uploaded" && logo.type === "uploaded" && (
              <UploadDone
                previewUrl={logo.previewPngUrl}
                onReplace={onPickFile}
                onRemove={removeLogo}
                t={t}
              />
            )}

            {(state === "error-size" || state === "error-format") && (
              <UploadError
                kind={state}
                body={errorBody ?? ""}
                onRetry={onPickFile}
                t={t}
              />
            )}
          </div>

          {/* or-divider + later-card: only when no file has been picked yet */}
          {logo.type === "none" && (
            <>
              <div className="insignia-divider" role="separator" aria-orientation="horizontal">
                <span>{t.upload.orDivider || "or"}</span>
              </div>

              <button
                type="button"
                className="insignia-later-card"
                onClick={toggleLater}
                aria-pressed={false}
              >
                <span className="insignia-later-card-icon" aria-hidden="true">
                  <IconHelpCircle size={18} />
                </span>
                <span className="insignia-later-card-text">
                  <span className="insignia-later-card-title">{t.v2.upload.laterPrimary}</span>
                  <span className="insignia-later-card-sub">{t.v2.upload.laterSecondary}</span>
                </span>
                <IconChevronRight className="insignia-later-card-chevron" size={16} />
              </button>
            </>
          )}
        </>
      )}

      <h3 className="insignia-section-label">{t.v2.upload.methodLabel}</h3>
      <div
        className="insignia-method-list"
        role="radiogroup"
        aria-label={t.upload.methodLabel}
      >
        {config.methods.map((m, i) => {
          const selected = m.id === selectedMethodId;
          const display = m.customerName ?? m.name;
          const desc = m.customerDescription ?? "";
          const fee = m.basePriceCents;
          // Roving tabindex per WAI-ARIA radio-group: only the selected radio
          // (or the first when nothing selected) is focusable; arrow keys move
          // selection AND focus.
          const isFocusable = selected || (selectedMethodId == null && i === 0);
          return (
            <div
              key={m.id}
              className="insignia-method-card"
              role="radio"
              aria-checked={selected}
              tabIndex={isFocusable ? 0 : -1}
              data-state={selected ? "selected" : undefined}
              onClick={() => onMethodChange(m.id)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onMethodChange(m.id);
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const next = config.methods[(i + 1) % config.methods.length];
                  onMethodChange(next.id);
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const prev =
                    config.methods[(i - 1 + config.methods.length) % config.methods.length];
                  onMethodChange(prev.id);
                }
              }}
            >
              <span className="insignia-method-card-text">
                <span className="insignia-method-card-name">{display}</span>
                {desc && <span className="insignia-method-card-desc">{desc}</span>}
              </span>
              {!(m.hidePriceWhenZero && fee === 0) && (
                <span className="insignia-method-card-price">
                  {fee === 0
                    ? formatCurrency(0, config.currency)
                    : formatPriceDelta(fee, config.currency)}
                </span>
              )}
              <span className="insignia-method-card-radio" aria-hidden="true">
                <IconCheck size={12} />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function UploadIdle({
  state,
  t,
  formats,
}: {
  state: UploadState;
  t: TranslationStrings;
  formats: string;
}) {
  return (
    <>
      <span className="insignia-upload-zone-icon" aria-hidden="true">
        {state === "dragover" ? (
          <IconDownload size={32} />
        ) : (
          <IconCloudUpload size={32} />
        )}
      </span>
      <p className="insignia-upload-zone-title">
        {state === "dragover" ? t.v2.upload.dropHere : t.v2.upload.idle}
      </p>
      <p className="insignia-upload-zone-sub">{formats}</p>
    </>
  );
}

function UploadInProgress({
  stalled,
  onCancel,
  t,
}: {
  stalled: boolean;
  onCancel: () => void;
  t: TranslationStrings;
}) {
  return (
    <>
      <span className="insignia-upload-zone-icon" aria-hidden="true">
        <IconCloudUpload size={32} />
      </span>
      <p className="insignia-upload-zone-title" aria-live="polite">
        {stalled ? t.v2.upload.stalled : t.v2.upload.uploading}
      </p>
      <div className="insignia-progress" role="progressbar" aria-label={t.v2.upload.uploading} />
      {stalled && (
        <button
          type="button"
          className="insignia-btn insignia-btn--ghost"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          {t.v2.upload.cancel}
        </button>
      )}
    </>
  );
}

function UploadDone({
  previewUrl,
  onReplace,
  onRemove,
  t,
}: {
  previewUrl: string;
  onReplace: () => void;
  onRemove: () => void;
  t: TranslationStrings;
}) {
  return (
    <>
      <span className="insignia-upload-zone-icon" aria-hidden="true">
        <IconClipboardCheck size={32} />
      </span>
      <p className="insignia-upload-zone-title">{t.v2.upload.uploaded}</p>
      <img
        src={previewUrl}
        alt=""
        style={{ maxHeight: 60, maxWidth: 120, objectFit: "contain", marginTop: 4 }}
      />
      <div className="insignia-upload-zone-actions">
        <button
          type="button"
          className="insignia-btn insignia-btn--ghost"
          onClick={(e) => {
            e.stopPropagation();
            onReplace();
          }}
        >
          {t.v2.upload.replace}
        </button>
        <button
          type="button"
          className="insignia-btn insignia-btn--link"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          {t.v2.upload.remove}
        </button>
      </div>
    </>
  );
}

function UploadError({
  kind,
  body,
  onRetry,
  t,
}: {
  kind: "error-size" | "error-format";
  body: string;
  onRetry: () => void;
  t: TranslationStrings;
}) {
  return (
    <>
      <span className="insignia-upload-zone-icon" aria-hidden="true">
        <IconAlertTriangle size={32} />
      </span>
      <p className="insignia-upload-zone-title">
        {kind === "error-size" ? t.v2.upload.rejectedSize : t.v2.upload.rejectedFormat}
      </p>
      <p className="insignia-upload-zone-sub">{body}</p>
      <div className="insignia-upload-zone-actions">
        <button
          type="button"
          className="insignia-btn insignia-btn--ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          {t.v2.upload.replace}
        </button>
      </div>
    </>
  );
}

/**
 * LaterConfirm — single-state confirmation block shown when logo.type === "later".
 * Replaces the dropzone + or-divider + later-card entirely so neither the
 * green-tinted zone nor the card is visible simultaneously with this state.
 *
 * Visual idiom: neutral bg-subtle fill + border-mid border + check icon.
 * Intentionally NOT green (avoids the "green everywhere" problem from xaFE5).
 */
function LaterConfirm({
  onCancel,
  t,
}: {
  onCancel: () => void;
  t: TranslationStrings;
}) {
  return (
    <div className="insignia-later-confirm" role="status" aria-live="polite">
      <span className="insignia-later-confirm-icon" aria-hidden="true">
        <IconCheck size={20} />
      </span>
      <div className="insignia-later-confirm-text">
        <span className="insignia-later-confirm-title">{t.v2.upload.laterActiveTitle}</span>
        <span className="insignia-later-confirm-sub">{t.v2.upload.laterActiveBody}</span>
      </div>
      <button
        type="button"
        className="insignia-later-confirm-remove"
        onClick={onCancel}
        aria-label={t.v2.upload.remove}
      >
        {t.v2.upload.remove}
      </button>
    </div>
  );
}
