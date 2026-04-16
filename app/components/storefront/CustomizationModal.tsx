/**
 * Storefront customization wizard: Upload → Placement → Size → Review.
 * Mobile-first, design intent (Tier 3) + modal-spec (Tier 2).
 * Canonical: docs/storefront/modal-spec.md, docs/notes/design-intent/storefront-modal.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontConfig, WizardStep, PlacementSelections } from "./types";
import { WIZARD_STEPS } from "./types";
import { UploadStep } from "./UploadStep";
import { PlacementStep } from "./PlacementStep";
import { SizeStep } from "./SizeStep";
import type { SizeStepHandle } from "./SizeStep";
import { ReviewStep } from "./ReviewStep";
import { PreviewSheet } from "./PreviewSheet";
import { addCustomizedToCart, addMultipleCustomizedToCart, buildInsigniaProperties } from "../../lib/storefront/cart.client";
import { proxyUrl } from "../../lib/storefront/proxy-url.client";
import { getTranslations, detectLocale } from "./i18n";
import { IconUpload, IconPlacement, IconSize, IconEye, IconCircleCheck, IconX, IconShoppingCart } from "./icons";
import { formatCurrency } from "./currency";
import { SizePreview } from "./SizePreview";
import "./storefront-modal.css";

type DraftState = {
  step: string;
  logoType: string;
  selectedPlacements: string[];
  sizeSelections: Record<string, number>;
};

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function makeDraftKey(productId: string, variantId: string) {
  return `insignia_draft_${productId}_${variantId}`;
}

function saveDraft(productId: string, variantId: string, state: DraftState, configVersion: string) {
  try {
    localStorage.setItem(
      makeDraftKey(productId, variantId),
      JSON.stringify({ ...state, _configVersion: configVersion, _savedAt: Date.now() }),
    );
  } catch { /* quota exceeded — silently fail */ }
}

function loadDraft(productId: string, variantId: string, currentConfigVersion: string): DraftState | null {
  try {
    const key = makeDraftKey(productId, variantId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Discard drafts older than 24 hours
    if (Date.now() - (parsed._savedAt ?? 0) > DRAFT_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    if (parsed._configVersion !== currentConfigVersion) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function clearDraft(productId: string, variantId: string) {
  try {
    localStorage.removeItem(makeDraftKey(productId, variantId));
  } catch {
    // ignore
  }
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 2,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
    } catch (err) {
      if (i === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error("Request failed after retries");
}

const STEP_ORDER: WizardStep[] = ["upload", "placement", "size", "review"];

const STEP_ICONS = {
  upload: IconUpload,
  placement: IconPlacement,
  size: IconSize,
  review: IconCircleCheck,
} as const;

export type LogoState =
  | { type: "none" }
  | { type: "later" }
  | {
      type: "uploaded";
      logoAssetId: string;
      previewPngUrl: string;
      sanitizedSvgUrl: string | null;
    };

type PriceResult = {
  unitPriceCents: number;
  feeCents: number;
  breakdown: Array<{ label: string; amountCents: number }>;
  validation: { ok: boolean };
};

type PrepareResult = {
  slotVariantId: string;
  configHash: string;
  pricingVersion: string;
  unitPriceCents: number;
  feeCents: number;
};

const CLOSE_CONFIRM_MESSAGE =
  "You have an unfinished customization. Close without adding to cart?";

export function CustomizationModal({
  productId,
  variantId,
}: {
  productId: string;
  variantId: string;
}) {
  const t = getTranslations(detectLocale());

  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [step, setStep] = useState<WizardStep>("upload");
  const [logo, setLogo] = useState<LogoState>({ type: "none" });
  const [placementSelections, setPlacementSelections] = useState<PlacementSelections>({});
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customizationId, setCustomizationId] = useState<string | null>(null);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showPreviewSheet, setShowPreviewSheet] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [logoUrlTimestamp, setLogoUrlTimestamp] = useState(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeStepRef = useRef<SizeStepHandle>(null);

  const currentStepIndex = STEP_ORDER.indexOf(step);

  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);

  // Compute footer label and price based on step
  const selectedMethod = config?.methods.find(m => m.id === selectedMethodId);

  const estimatedTotal = (config?.baseProductPriceCents ?? 0)
    + (selectedMethod?.basePriceCents ?? 0)
    + Object.keys(placementSelections).reduce((sum, pid) => {
        const p = config?.placements.find(x => x.id === pid);
        const placementPrice = p?.basePriceAdjustmentCents ?? 0;
        // Only include size-step price from the size step onward
        const stepPrice = (step === "size" || step === "review")
          ? (p?.steps[placementSelections[pid]]?.priceAdjustmentCents ?? 0)
          : 0;
        return sum + placementPrice + stepPrice;
      }, 0);

  const footerPriceLabel = (() => {
    switch (step) {
      case "upload": return t.footer.startingFrom;
      case "placement":
      case "size": return t.footer.totalSoFar;
      case "review": return t.footer.orderTotal;
    }
  })();

  const footerPriceValue = step === "review"
    ? (priceResult?.unitPriceCents ?? estimatedTotal)
    : step === "upload"
      ? (config?.baseProductPriceCents ?? 0)
      : estimatedTotal;

  const fetchConfig = useCallback(async () => {
    if (!productId || !variantId) return;
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetchWithRetry(
        proxyUrl(`/apps/insignia/config?${new URLSearchParams({ productId, variantId })}`)
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Config failed: ${res.status}`);
      }
      const data: StorefrontConfig = await res.json();
      setConfig(data);
      // Auto-select first method only on initial load — use functional setState
      // to read current value without adding selectedMethodId to deps (avoids re-fetch loop)
      setSelectedMethodId((current) => {
        if (data.methods.length > 0 && !current) {
          return data.methods[0].id;
        }
        return current;
      });
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to load configuration");
    } finally {
      setConfigLoading(false);
    }
  }, [productId, variantId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Variants are pre-filtered by the backend to only include sizes matching
  // the selected variant's non-size options (e.g. same color).

  // Initialize per-size quantities when config first loads
  useEffect(() => {
    if (config && config.variants.length > 0 && Object.keys(quantities).length === 0) {
      const init: Record<string, number> = {};
      for (const v of config.variants) {
        init[v.id] = 0;
      }
      // Pre-select the current variant with qty 1
      const currentGid = `gid://shopify/ProductVariant/${variantId}`;
      if (init[currentGid] !== undefined) {
        init[currentGid] = 1;
      } else if (config.variants.length > 0) {
        init[config.variants[0].id] = 1;
      }
      setQuantities(init);
    } else if (config && config.variants.length === 0 && Object.keys(quantities).length === 0) {
      setQuantities({ _default: 1 });
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore draft from localStorage once config is available
  useEffect(() => {
    if (!config) return;
    const draft = loadDraft(productId, variantId, config.productConfigId);
    if (!draft) return;
    if (draft.selectedPlacements.length === 0) return;

    // Restore placement selections — map saved placement IDs to their saved step indices
    const restoredSelections: PlacementSelections = {};
    for (const pid of draft.selectedPlacements) {
      const placement = config.placements.find((p) => p.id === pid);
      if (placement) {
        restoredSelections[pid] = draft.sizeSelections[pid] ?? placement.defaultStepIndex;
      }
    }
    if (Object.keys(restoredSelections).length > 0) {
      setPlacementSelections(restoredSelections);
    }

    // Restore step — only advance if the draft step is valid and reachable
    const draftStepIndex = STEP_ORDER.indexOf(draft.step as WizardStep);
    if (draftStepIndex > 0) {
      setStep(draft.step as WizardStep);
    }
  }, [config, productId, variantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToStep = useCallback((s: WizardStep) => {
    setStep(s);
    setSubmitError(null);
  }, []);

  const canGoNext = useCallback((): boolean => {
    switch (step) {
      case "upload":
        return logo.type !== "none";
      case "placement": {
        const count = Object.keys(placementSelections).length;
        return count > 0;
      }
      case "size":
        return true;
      case "review":
        return totalQuantity > 0;
      default:
        return false;
    }
  }, [step, logo, placementSelections, totalQuantity]);

  const handleBack = useCallback(() => {
    const i = currentStepIndex;
    if (i > 0) goToStep(STEP_ORDER[i - 1]);
  }, [currentStepIndex, goToStep]);

  const handleNext = useCallback(() => {
    // On size step with multiple positions: advance position first
    if (step === "size" && sizeStepRef.current?.tryAdvance()) {
      return; // stay on size step, position advanced
    }
    const i = currentStepIndex;
    if (i < STEP_ORDER.length - 1) goToStep(STEP_ORDER[i + 1]);
  }, [step, currentStepIndex, goToStep]);

  /** Close the modal: navigate back to the product page. */
  const closeModal = useCallback(() => {
    if (typeof window === "undefined") return;
    const numericId = productId.replace(/^gid:\/\/shopify\/Product\//, "");
    window.location.href = `/products/${numericId}`;
  }, [productId]);

  const handleClose = useCallback(() => {
    const hasSelections = step !== "upload" || logo.type !== "none";
    if (hasSelections) {
      setShowCloseConfirm(true);
    } else {
      closeModal();
    }
  }, [step, logo.type, closeModal]);

  const handleCloseConfirm = useCallback((confirmed: boolean) => {
    setShowCloseConfirm(false);
    if (confirmed) {
      clearDraft(productId, variantId);
      closeModal();
    }
  }, [productId, variantId, closeModal]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    first?.focus();
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [step]);

  // Save draft to localStorage on step change
  useEffect(() => {
    if (step !== "upload" && config) {
      const configVersion = config.productConfigId;
      saveDraft(productId, variantId, {
        step,
        logoType: logo.type,
        selectedPlacements: Object.keys(placementSelections),
        sizeSelections: placementSelections,
      }, configVersion);
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepLabel = WIZARD_STEPS.find((s) => s.id === step)?.label ?? step;

  // Derived values — computed unconditionally so hooks below can reference them
  // safely. When config is null (loading / error state), these produce empty
  // arrays/objects; the callbacks guard against that with `if (!config)` checks.
  const selectedPlacements = (config?.placements ?? []).filter(
    (p) => placementSelections[p.id] !== undefined
  );
  const selectedPlacementsWithStep = selectedPlacements.map((p) => ({
    placementId: p.id,
    stepIndex: placementSelections[p.id] ?? p.defaultStepIndex,
  }));

  const allSingleStep = config ? config.placements
    .filter((p) => placementSelections[p.id] !== undefined)
    .every((p) => p.steps.length <= 1) : false;

  const logoAssetIdsByPlacementId = useMemo<Record<string, string | null>>(() => {
    const result: Record<string, string | null> = {};
    (config?.placements ?? []).forEach((p) => {
      if (logo.type === "uploaded") {
        result[p.id] = Object.keys(placementSelections).includes(p.id)
          ? logo.logoAssetId
          : null;
      } else {
        result[p.id] = null;
      }
    });
    return result;
  }, [config?.placements, logo, placementSelections]);

  // Refresh presigned logo URLs if they are approaching expiry (8-minute threshold).
  // Silently no-ops when no logo is uploaded yet.
  const URL_REFRESH_THRESHOLD_MS = 8 * 60 * 1000;
  const refreshLogoUrlsIfNeeded = useCallback(async () => {
    if (logo.type !== "uploaded") return;
    if (Date.now() - logoUrlTimestamp <= URL_REFRESH_THRESHOLD_MS) return;

    try {
      const response = await fetch(
        proxyUrl(`/apps/insignia/uploads/${logo.logoAssetId}/refresh`),
        { method: "POST" }
      );
      if (response.ok) {
        const { previewUrl, sanitizedUrl } = await response.json();
        setLogo((prev) =>
          prev.type === "uploaded"
            ? {
                ...prev,
                previewPngUrl: previewUrl ?? prev.previewPngUrl,
                sanitizedSvgUrl: sanitizedUrl ?? prev.sanitizedSvgUrl,
              }
            : prev
        );
        setLogoUrlTimestamp(Date.now());
      }
    } catch {
      // Silent fail — existing URLs may still be valid
    }
  }, [logo, logoUrlTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attempt URL refresh on each step transition
  useEffect(() => {
    refreshLogoUrlsIfNeeded();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ALL hooks must be called unconditionally, before any early return.
  const saveDraftAndPrice = useCallback(async (): Promise<{ customizationId: string; priceResult: PriceResult } | null> => {
    if (!config || !selectedMethodId) return null;
    setSubmitError(null);
    try {
      const draftRes = await fetchWithRetry(proxyUrl("/apps/insignia/customizations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: config.productId,
          variantId: config.variantId,
          productConfigId: config.productConfigId,
          methodId: selectedMethodId,
          placements: selectedPlacementsWithStep,
          logoAssetIdsByPlacementId,
          artworkStatus: logo.type === "later" ? "PENDING_CUSTOMER" : "PROVIDED",
        }),
      });
      if (!draftRes.ok) {
        const d = await draftRes.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? "Failed to save customization");
      }
      const { customizationId: id } = await draftRes.json();
      setCustomizationId(id);
      const priceRes = await fetchWithRetry(proxyUrl("/apps/insignia/price"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customizationId: id }),
      });
      if (!priceRes.ok) {
        const d = await priceRes.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? "Failed to get price");
      }
      const priceData: PriceResult = await priceRes.json();
      setPriceResult(priceData);
      return { customizationId: id, priceResult: priceData };
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong");
      return null;
    }
  }, [
    config,
    selectedMethodId,
    selectedPlacementsWithStep,
    logoAssetIdsByPlacementId,
    logo.type,
  ]);

  useEffect(() => {
    if (step === "review" && config && selectedMethodId && !customizationId) {
      saveDraftAndPrice();
    }
  }, [step, config, selectedMethodId, customizationId, saveDraftAndPrice]);

  const prepareAndAddToCart = useCallback(async () => {
    let cid = customizationId;
    let pr = priceResult;
    if (!cid || !pr?.validation?.ok) {
      const out = await saveDraftAndPrice();
      if (!out) return;
      cid = out.customizationId;
      pr = out.priceResult;
    }
    if (!cid || !pr?.validation?.ok) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const isMultiVariant = config!.variants.length > 0;
      // Track all prepared slot IDs for the confirm step.
      // Use local variables — not React state — to avoid stale closure reads.
      const confirmedSlotIds: string[] = [];

      if (isMultiVariant) {
        // B2B per-size mode: call /prepare once per variant with qty > 0,
        // then batch all pairs into a single cart/add.js request.
        const activeVariants = config!.variants.filter(
          (v) => (quantities[v.id] ?? 0) > 0
        );
        if (activeVariants.length === 0) return;

        const pairs: Array<{
          baseVariantId: string;
          feeVariantId: string;
          quantity: number;
          properties: Record<string, string>;
        }> = [];
        for (const variant of activeVariants) {
          const prepareRes = await fetchWithRetry(proxyUrl("/apps/insignia/prepare"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customizationId: cid }),
          });
          if (!prepareRes.ok) {
            const d = await prepareRes.json().catch(() => ({}));
            throw new Error(d?.error?.message ?? "Failed to prepare");
          }
          const prep: PrepareResult = await prepareRes.json();
          confirmedSlotIds.push(prep.slotVariantId);

          const properties = buildInsigniaProperties(
            cid,
            selectedMethodId!,
            prep.configHash,
            prep.pricingVersion
          );
          pairs.push({
            baseVariantId: variant.id,
            feeVariantId: prep.slotVariantId,
            quantity: quantities[variant.id],
            properties,
          });
        }

        await addMultipleCustomizedToCart(pairs);
      } else {
        // Single-variant mode: original behaviour preserved.
        const qty = quantities["_default"] ?? totalQuantity;
        const prepareRes = await fetchWithRetry(proxyUrl("/apps/insignia/prepare"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId: cid }),
        });
        if (!prepareRes.ok) {
          const d = await prepareRes.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? "Failed to prepare");
        }
        const prep: PrepareResult = await prepareRes.json();
        confirmedSlotIds.push(prep.slotVariantId);
        const properties = buildInsigniaProperties(
          cid,
          selectedMethodId!,
          prep.configHash,
          prep.pricingVersion
        );
        await addCustomizedToCart(config!.variantId, prep.slotVariantId, qty, properties);
      }

      // Confirm each prepared slot (required for slot lifecycle management)
      for (const slotVariantId of confirmedSlotIds) {
        const confirmRes = await fetchWithRetry(proxyUrl("/apps/insignia/cart-confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId: cid, slotVariantId }),
        });
        if (!confirmRes.ok) {
          const d = await confirmRes.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? "Failed to confirm cart");
        }
      }
      clearDraft(productId, variantId);
      closeModal();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to add to cart");
    } finally {
      setSubmitLoading(false);
    }
  // priceResult is intentionally read outside deps (optimization check, not a reactive dependency)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customizationId, selectedMethodId, totalQuantity, quantities, saveDraftAndPrice, config, productId, variantId, closeModal]);

  // Early returns after all hooks — this is the required pattern.
  if (configLoading) {
    return (
      <div className="insignia-modal-page">
        <div className="insignia-loading">Loading…</div>
      </div>
    );
  }

  if (configError || !config) {
    return (
      <div className="insignia-modal-page">
        <div className="insignia-modal-body">
          <div className="insignia-error" role="alert">
            {configError ?? "Product configuration not found."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="insignia-modal-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insignia-modal-title"
    >
      <header className="insignia-modal-header">
        <h1 id="insignia-modal-title" className="insignia-modal-title visually-hidden">
          {stepLabel}
        </h1>
        <nav className="insignia-steps" aria-label="Progress">
          {STEP_ORDER.map((stepKey, i) => {
            const StepIcon = stepKey === "size" && allSingleStep ? IconEye : STEP_ICONS[stepKey];
            const label = stepKey === "size"
              ? (allSingleStep ? t.size.preview : t.size.logoSize)
              : t.steps[stepKey];
            return (
              <button
                key={stepKey}
                type="button"
                className="insignia-step-pill"
                data-current={step === stepKey ? "true" : undefined}
                data-completed={i < currentStepIndex ? "true" : undefined}
                disabled={i > currentStepIndex}
                onClick={() => i < currentStepIndex && goToStep(stepKey)}
                aria-label={label}
                aria-current={step === stepKey ? "step" : undefined}
              >
                <StepIcon size={16} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          className="insignia-modal-close"
          onClick={handleClose}
          aria-label="Close"
        >
          <IconX size={18} />
        </button>
      </header>

      {/* Desktop two-panel layout — on mobile this is display:contents (no visual change) */}
      <div className="insignia-desktop-layout">
        {/* Left panel: persistent product preview — desktop only */}
        <div className="insignia-desktop-preview" aria-hidden="true">
          <SizePreview
            config={config}
            placementSelections={placementSelections}
            logo={logo}
            showTabs
          />
        </div>

        {/* Right panel: scrollable content + footer */}
        <div className="insignia-desktop-right">
          <main className="insignia-modal-body">
            {step === "upload" && (
              <UploadStep
                config={config}
                logo={logo}
                onLogoChange={setLogo}
                selectedMethodId={selectedMethodId}
                onMethodChange={setSelectedMethodId}
                onContinue={() => handleNext()}
                t={t}
              />
            )}
            {step === "placement" && (
              <PlacementStep
                config={config}
                placementSelections={placementSelections}
                onPlacementSelectionsChange={setPlacementSelections}
                onContinue={() => handleNext()}
                selectedMethodId={selectedMethodId}
                t={t}
              />
            )}
            {step === "size" && (
              <SizeStep
                ref={sizeStepRef}
                config={config}
                placementSelections={placementSelections}
                onPlacementSelectionsChange={setPlacementSelections}
                logo={logo}
                onContinue={() => handleNext()}
                t={t}
              />
            )}
            {step === "review" && (
              <ReviewStep
                config={config}
                selectedMethodId={selectedMethodId!}
                placementSelections={placementSelections}
                logo={logo}
                quantities={quantities}
                onQuantitiesChange={setQuantities}
                priceResult={priceResult}
                submitError={submitError}
                onSaveDraftAndPrice={() => saveDraftAndPrice().then(() => {})}
                baseProductPriceCents={config.baseProductPriceCents}
                productTitle={config.productTitle}
                onShowPreviewSheet={() => setShowPreviewSheet(true)}
                t={t}
              />
            )}
          </main>

          <footer className="insignia-modal-footer">
            <div className="insignia-footer-price-area">
              <span className="insignia-footer-price-label">{footerPriceLabel}</span>
              <span className="insignia-footer-price-value">
                {formatCurrency(
                  step === "review" ? footerPriceValue * totalQuantity : footerPriceValue,
                  config.currency
                )}
              </span>
            </div>
            <div className="insignia-footer-buttons">
              {step === "review" ? (
                <>
                  <button
                    className="insignia-btn insignia-btn-secondary"
                    onClick={handleBack}
                  >
                    {t.placement.btnBack}
                  </button>
                  <button
                    className="insignia-btn insignia-btn-success"
                    disabled={totalQuantity < 1 || submitLoading || !priceResult?.validation?.ok}
                    onClick={prepareAndAddToCart}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <IconShoppingCart size={16} />
                    <span>
                      {submitLoading ? "Adding…" : t.review.addToCartWithPrice}
                    </span>
                  </button>
                </>
              ) : (
                <>
                  {currentStepIndex > 0 && (
                    <button
                      className="insignia-btn insignia-btn-secondary"
                      onClick={handleBack}
                    >
                      {t.placement.btnBack}
                    </button>
                  )}
                  <button
                    className="insignia-btn insignia-btn-primary"
                    disabled={!canGoNext()}
                    onClick={handleNext}
                  >
                    {t.placement.btnNext}
                  </button>
                </>
              )}
            </div>
          </footer>
        </div>
      </div>

      {showCloseConfirm && (
        <div className="insignia-overlay" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title">
          <div className="insignia-dialog">
            <h3 id="close-dialog-title">Close customization?</h3>
            <p>{CLOSE_CONFIRM_MESSAGE}</p>
            <div className="insignia-dialog-actions">
              <button
                type="button"
                className="insignia-btn insignia-btn-secondary"
                onClick={() => handleCloseConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="insignia-btn insignia-btn-primary"
                onClick={() => handleCloseConfirm(true)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreviewSheet && (
        <PreviewSheet
          open={showPreviewSheet}
          onClose={() => setShowPreviewSheet(false)}
          config={config}
          placementSelections={placementSelections}
          logo={logo}
          t={t}
        />
      )}
    </div>
  );
}
