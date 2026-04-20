/**
 * Customization modal v2.3 — full-page wizard mounted by
 * `apps.insignia.modal-v2.tsx`.
 *
 * Owns: config fetch, wizard state machine, draft persistence (localStorage,
 * 24 h TTL, version-invalidated), scroll lock, popstate guard, Esc handling,
 * close-confirm, header/tabs/footer chrome, body routing, /price + /prepare
 * + Shopify cart + /cart-confirm submit, analytics dispatch, idempotency key.
 *
 * Backend bindings — every fetch routed through proxyUrl() so the App Proxy
 * HMAC stays attached:
 *   GET  /apps/insignia/config          → StorefrontConfig
 *   POST /apps/insignia/uploads         → handled by UploadStep
 *   POST /apps/insignia/customizations  → { customizationId }
 *   POST /apps/insignia/price           → PriceResult
 *   POST /apps/insignia/prepare         → PrepareResult { slotVariantId, … }
 *   POST {origin}/cart/add.js           → Shopify Ajax Cart
 *   POST /apps/insignia/cart-confirm    → { ok: true }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontConfig, WizardStep, PlacementSelections } from "./types";
import { WIZARD_STEPS } from "./types";
import { UploadStep } from "./UploadStep";
import { PlacementStep } from "./PlacementStep";
import { SizeStep, type SizeStepHandle } from "./SizeStep";
import { ReviewStep } from "./ReviewStep";
import { PreviewSheet } from "./PreviewSheet";
import { PreviewCanvas } from "./PreviewCanvas";
import { CloseConfirmDialog } from "./CloseConfirmDialog";
import {
  addCustomizedToCart,
  addMultipleCustomizedToCart,
  buildGarmentProperties,
  buildFeeProperties,
} from "../../lib/storefront/cart.client";
import { proxyUrl } from "../../lib/storefront/proxy-url.client";
import { getTranslations, detectLocale } from "./i18n";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconCircleCheck,
  IconCloudUpload,
  IconClipboardCheck,
  IconEye,
  IconLoaderCircle,
  IconPlacement,
  IconShoppingCart,
  IconSize,
  IconWifiOff,
  IconX,
} from "./icons";
import { formatCurrency } from "./currency";
import "./storefront-modal.css";

// ─── Local types ────────────────────────────────────────────────────────────

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

type SubmitState = "ready" | "submitting" | "success" | "error" | "pool-exhausted";

// ─── Constants ──────────────────────────────────────────────────────────────

const STEP_ORDER: WizardStep[] = ["upload", "placement", "size", "review"];
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const SUBMIT_RETRY_409_MS = 1500;
/** How long the "Added to cart" success state is shown before redirecting to /cart.
 *  Long enough to register (>1s) but short enough not to annoy (~1.5s).
 *  Increase if you want a "Go to cart" CTA to be readable before the redirect. */
const SUCCESS_STATE_DURATION_MS = 1500;

const STEP_ICONS = {
  upload: IconCloudUpload,
  placement: IconPlacement,
  size: IconSize,
  review: IconClipboardCheck,
} as const;

// ─── Draft persistence (localStorage) ───────────────────────────────────────

type DraftState = {
  step: WizardStep;
  logoType: "none" | "later" | "uploaded";
  selectedPlacements: PlacementSelections;
  quantities: Record<string, number>;
  selectedMethodId: string | null;
};

function makeDraftKey(productId: string, variantId: string): string {
  return `insignia_draft_v2_${productId}_${variantId}`;
}

function saveDraft(
  productId: string,
  variantId: string,
  state: DraftState,
  configVersion: string,
) {
  try {
    localStorage.setItem(
      makeDraftKey(productId, variantId),
      JSON.stringify({ ...state, _configVersion: configVersion, _savedAt: Date.now() }),
    );
  } catch {
    /* quota — silent */
  }
}

function loadDraft(
  productId: string,
  variantId: string,
  configVersion: string,
): DraftState | null {
  try {
    const raw = localStorage.getItem(makeDraftKey(productId, variantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState & { _savedAt?: number; _configVersion?: string };
    if (Date.now() - (parsed._savedAt ?? 0) > DRAFT_TTL_MS) {
      localStorage.removeItem(makeDraftKey(productId, variantId));
      return null;
    }
    if (parsed._configVersion !== configVersion) {
      localStorage.removeItem(makeDraftKey(productId, variantId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearDraft(productId: string, variantId: string) {
  try {
    localStorage.removeItem(makeDraftKey(productId, variantId));
  } catch {
    /* ignore */
  }
}

// ─── Network helpers ────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 2,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      // Retry only on 429 / 503 per intent doc; bubble 4xx immediately.
      if (res.ok || (res.status !== 429 && res.status !== 503)) return res;
      lastResponse = res;
    } catch (err) {
      if (i === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  // Retries exhausted. Return the last 429/503 response so callers' existing
  // `res.ok` / `res.status` checks surface the real HTTP code instead of a
  // status-less generic Error.
  if (lastResponse) return lastResponse;
  throw new Error("Request failed after retries");
}

// ─── Analytics ──────────────────────────────────────────────────────────────

function dispatchAnalytics(name: string, detail: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(`insignia:${name}`, { detail }));
  } catch {
    /* no-op */
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CustomizationModal({
  productId,
  variantId,
  returnUrl,
}: {
  productId: string;
  variantId: string;
  returnUrl: string | null;
}) {
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  // Use the merchant's chosen locale from the config response when available.
  // Before config arrives we fall back to the browser's preference so the
  // tiny pre-fetch skeleton still reads as something coherent.
  const t = getTranslations(config?.locale ?? detectLocale());
  const [configError, setConfigError] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const [step, setStep] = useState<WizardStep>("upload");
  const [logo, setLogo] = useState<LogoState>({ type: "none" });
  const [placementSelections, setPlacementSelections] = useState<PlacementSelections>({});
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [customizationId, setCustomizationId] = useState<string | null>(null);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const [submitState, setSubmitState] = useState<SubmitState>("ready");
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  const [hasRetriedPool, setHasRetriedPool] = useState(false);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showPreviewSheet, setShowPreviewSheet] = useState(false);
  const [desktopActiveViewId, setDesktopActiveViewId] = useState<string | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  // Per-view natural image dimensions (set by PreviewCanvas → NativeCanvas
  // onImageMeta). Drives wide-aspect detection (B6) and SizeStep's calibration
  // cm suffix (C6) without requiring backend to project image dimensions.
  const [imageMetaByViewId, setImageMetaByViewId] = useState<
    Record<string, { naturalWidthPx: number; naturalHeightPx: number; aspect: number }>
  >({});
  const onImageMeta = useCallback(
    (viewId: string, meta: { naturalWidthPx: number; naturalHeightPx: number; aspect: number }) => {
      setImageMetaByViewId((prev) =>
        prev[viewId]?.naturalWidthPx === meta.naturalWidthPx ? prev : { ...prev, [viewId]: meta },
      );
    },
    [],
  );
  // Logo image dimensions (uploaded artwork OR placeholder asset). Lifted
  // here so SizeStep can compute the actual rendered logo size after
  // letterbox-fitting it inside the placement zone.
  const [logoMeta, setLogoMeta] = useState<
    { naturalWidthPx: number; naturalHeightPx: number; aspect: number } | null
  >(null);
  const onLogoMeta = useCallback(
    (meta: { naturalWidthPx: number; naturalHeightPx: number; aspect: number } | null) => {
      setLogoMeta((prev) =>
        prev?.naturalWidthPx === meta?.naturalWidthPx &&
        prev?.naturalHeightPx === meta?.naturalHeightPx
          ? prev
          : meta,
      );
    },
    [],
  );

  const idempotencyKeyRef = useRef<string | null>(null);
  const closingRef = useRef(false);
  const sizeStepRef = useRef<SizeStepHandle>(null);

  // Track which layout is active so we mount only ONE step instance.
  // Mounting both (mobile + desktop simultaneously) creates duplicate component
  // instances that each hold their own activeIndex — and the React ref ends up
  // pointing at whichever rendered last, so SizeStep's tryAdvance() acts on the
  // wrong instance and Next-step jumps over placements on desktop.
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabBtnRefs = useRef<Record<WizardStep, HTMLButtonElement | null>>({
    upload: null,
    placement: null,
    size: null,
    review: null,
  });
  const [underline, setUnderline] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const currentStepIndex = STEP_ORDER.indexOf(step);
  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);

  // ─── Derived state ──
  const selectedMethod = config?.methods.find((m) => m.id === selectedMethodId);
  const allSingleStep = useMemo(() => {
    if (!config) return false;
    return Object.entries(placementSelections).every(([id]) => {
      const p = config.placements.find((pp) => pp.id === id);
      return (p?.steps.length ?? 0) <= 1;
    });
  }, [config, placementSelections]);

  const stepLabels: Record<WizardStep, string> = {
    upload: t.steps.upload,
    placement: t.steps.placement,
    size: allSingleStep ? t.size.preview : t.steps.size,
    review: t.steps.review,
  };

  const hasSelections =
    logo.type !== "none" ||
    Object.keys(placementSelections).length > 0 ||
    totalQuantity > 0;

  const stepTabState = (s: WizardStep): "active" | "completed" | "default" => {
    if (s === step) return "active";
    if (STEP_ORDER.indexOf(s) < currentStepIndex) return "completed";
    return "default";
  };

  // ─── Estimated total (footer) ──
  const estimatedTotal = useMemo(() => {
    if (!config) return 0;
    const base = config.baseProductPriceCents ?? 0;
    const method = selectedMethod?.basePriceCents ?? 0;
    const placements = Object.entries(placementSelections).reduce((sum, [pid, idx]) => {
      const p = config.placements.find((pp) => pp.id === pid);
      const placementCents = p?.basePriceAdjustmentCents ?? 0;
      const stepCents =
        step === "size" || step === "review"
          ? p?.steps[idx]?.priceAdjustmentCents ?? 0
          : 0;
      return sum + placementCents + stepCents;
    }, 0);
    return base + method + placements;
  }, [config, selectedMethod, placementSelections, step]);

  const fallbackUnitPriceCents = useMemo(() => {
    if (!config) return 0;
    const base = config.baseProductPriceCents ?? 0;
    const method = selectedMethod?.basePriceCents ?? 0;
    const placements = Object.entries(placementSelections).reduce((sum, [pid, idx]) => {
      const p = config.placements.find((pp) => pp.id === pid);
      return sum + (p?.basePriceAdjustmentCents ?? 0) + (p?.steps[idx]?.priceAdjustmentCents ?? 0);
    }, 0);
    return base + method + placements;
  }, [config, selectedMethod, placementSelections]);

  const footerPriceLabel =
    step === "review"
      ? t.footer.orderTotal
      : step === "upload"
        ? t.footer.startingFrom
        : t.footer.estimatedTotal;

  const footerPriceValue =
    step === "review"
      ? totalQuantity * (priceResult?.unitPriceCents ?? fallbackUnitPriceCents)
      : step === "upload"
        ? config?.baseProductPriceCents ?? 0
        : estimatedTotal;

  // ─── Config fetch ──
  const fetchConfig = useCallback(async () => {
    if (!productId || !variantId) return;
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetchWithRetry(
        proxyUrl(`/apps/insignia/config?${new URLSearchParams({ productId, variantId })}`),
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(data.error?.message || `Config failed: ${res.status}`);
      }
      const data = (await res.json()) as StorefrontConfig;
      setConfig(data);
      // Restore draft if version matches; otherwise pre-fill the quantity for
      // the variant the customer selected on the product page (they already
      // told us "I want this size" — don't make them pick it again).
      const draft = loadDraft(productId, variantId, data.productConfigId);
      if (draft) {
        setStep(draft.step);
        setPlacementSelections(draft.selectedPlacements);
        setQuantities(draft.quantities);
        setSelectedMethodId(draft.selectedMethodId);
        if (draft.logoType === "later") setLogo({ type: "later" });
        // Uploaded logo isn't restored — its asset URL has expired by now.
      } else {
        const incoming = data.variants.find((v) => v.id === variantId && v.available);
        if (incoming) setQuantities({ [incoming.id]: 1 });
      }
      dispatchAnalytics("modal_open", { productId, variantId, shop: data.shop });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load product details";
      setConfigError(msg);
      console.error("[insignia]", { tag: "config-fetch", err });
    } finally {
      setConfigLoading(false);
    }
  }, [productId, variantId]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // ─── Persist draft on relevant changes ──
  useEffect(() => {
    if (!config) return;
    saveDraft(
      productId,
      variantId,
      {
        step,
        logoType: logo.type,
        selectedPlacements: placementSelections,
        quantities,
        selectedMethodId,
      },
      config.productConfigId,
    );
  }, [productId, variantId, config, step, logo.type, placementSelections, quantities, selectedMethodId]);

  // ─── Body scroll lock + popstate close-confirm guard ──
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Push a single history entry when the modal mounts so the back button
  // (hardware or browser) triggers the close-confirm guard.  Must run ONCE —
  // re-pushing on every hasSelections flip stacks up extra entries that require
  // multiple presses to unwind.
  useEffect(() => {
    if (typeof window === "undefined") return;
    history.pushState({ insigniaModal: true }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Separate effect: keep the popstate listener in sync with hasSelections so
  // it always sees the latest value without re-pushing history state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      if (closingRef.current) return;
      if (hasSelections) setShowCloseConfirm(true);
      else closeNow();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // closeNow is intentionally omitted: it closes over returnUrl which is
    // stable loader data (never changes during the session), so the stale
    // closure is safe. Adding it would require hoisting the declaration above
    // this effect, which adds structural complexity for no practical benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelections]);

  // ─── Esc handler at the shell level ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showCloseConfirm || showPreviewSheet) return; // those have their own handlers
        if (hasSelections) setShowCloseConfirm(true);
        else closeNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelections, showCloseConfirm, showPreviewSheet]);

  // ─── Online/offline tracking ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // ─── Tab underline positioning ──
  useEffect(() => {
    const measure = () => {
      const btn = tabBtnRefs.current[step];
      const container = tabsRef.current;
      if (!btn || !container) return;
      const cRect = container.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      setUnderline({ left: bRect.left - cRect.left, width: bRect.width });
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    if (tabsRef.current) ro.observe(tabsRef.current);
    return () => ro.disconnect();
  }, [step, configLoading]);

  // ─── Price + prepare ──
  // Declared BEFORE goNext so the dependency array is well-formed (TDZ-safe).
  const ensureCustomization = useCallback(async (): Promise<string | null> => {
    if (!config || !selectedMethodId) return null;
    if (customizationId) return customizationId;
    try {
      const placements = Object.entries(placementSelections).map(([placementId, stepIndex]) => ({
        placementId,
        stepIndex,
      }));
      const logoAssetIdsByPlacementId: Record<string, string | null> = {};
      const logoAssetId = logo.type === "uploaded" ? logo.logoAssetId : null;
      for (const p of placements) {
        logoAssetIdsByPlacementId[p.placementId] = logoAssetId;
      }
      const body = {
        productId,
        variantId,
        productConfigId: config.productConfigId,
        methodId: selectedMethodId,
        placements,
        logoAssetIdsByPlacementId,
        artworkStatus: logo.type === "later" ? "PENDING_CUSTOMER" : "PROVIDED",
      };
      const res = await fetchWithRetry(proxyUrl("/apps/insignia/customizations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message || `Draft create failed: ${res.status}`);
      }
      const data = (await res.json()) as { customizationId: string };
      setCustomizationId(data.customizationId);
      return data.customizationId;
    } catch (err) {
      console.error("[insignia]", { tag: "draft-create", err });
      return null;
    }
  }, [config, selectedMethodId, customizationId, placementSelections, logo, productId, variantId]);

  /**
   * Always creates a brand-new customization draft — never returns a cached one.
   * Used by the multi-size submit loop so each size variant gets its own slot.
   */
  const createFreshCustomization = useCallback(async (): Promise<string | null> => {
    if (!config || !selectedMethodId) return null;
    try {
      const placements = Object.entries(placementSelections).map(([placementId, stepIndex]) => ({
        placementId,
        stepIndex,
      }));
      const logoAssetIdsByPlacementId: Record<string, string | null> = {};
      const logoAssetId = logo.type === "uploaded" ? logo.logoAssetId : null;
      for (const p of placements) {
        logoAssetIdsByPlacementId[p.placementId] = logoAssetId;
      }
      const body = {
        productId,
        variantId,
        productConfigId: config.productConfigId,
        methodId: selectedMethodId,
        placements,
        logoAssetIdsByPlacementId,
        artworkStatus: logo.type === "later" ? "PENDING_CUSTOMER" : "PROVIDED",
      };
      const res = await fetchWithRetry(proxyUrl("/apps/insignia/customizations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message || `Draft create failed: ${res.status}`);
      }
      const data = (await res.json()) as { customizationId: string };
      return data.customizationId;
    } catch (err) {
      console.error("[insignia]", { tag: "draft-create-fresh", err });
      return null;
    }
  }, [config, selectedMethodId, placementSelections, logo, productId, variantId]);

  const preparePriceForReview = useCallback(async () => {
    setPriceLoading(true);
    setPriceResult(null);
    try {
      const cid = await ensureCustomization();
      if (!cid) {
        setPriceLoading(false);
        return;
      }
      const res = await fetchWithRetry(proxyUrl("/apps/insignia/price"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customizationId: cid }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message || `Price failed: ${res.status}`);
      }
      const json = (await res.json()) as PriceResult;
      setPriceResult(json);
    } catch (err) {
      console.error("[insignia]", { tag: "price-fetch", err });
    } finally {
      setPriceLoading(false);
    }
  }, [ensureCustomization]);

  // ─── Navigation ──
  const goNext = useCallback(async () => {
    if (step === "size" && sizeStepRef.current?.tryAdvance()) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= STEP_ORDER.length) return;
    const nextStep = STEP_ORDER[nextIndex];
    // Skip "size" if every selected placement has ≤ 1 step AND we're not on review.
    if (nextStep === "size" && allSingleStep) {
      setStep("review");
      dispatchAnalytics("step_view", { step: "review", productId });
      await preparePriceForReview();
      return;
    }
    setStep(nextStep);
    dispatchAnalytics("step_view", { step: nextStep, productId });
    if (nextStep === "review") await preparePriceForReview();
  }, [step, currentStepIndex, allSingleStep, productId, preparePriceForReview]);

  const goBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex < 0) return;
    setStep(STEP_ORDER[prevIndex]);
    dispatchAnalytics("step_view", { step: STEP_ORDER[prevIndex], productId });
  }, [currentStepIndex, productId]);

  const setStepDirect = useCallback(
    (target: WizardStep) => {
      const targetIndex = STEP_ORDER.indexOf(target);
      // Allow only backwards or to current; forward navigation must use Continue.
      if (targetIndex > currentStepIndex) return;
      setStep(target);
      dispatchAnalytics("step_view", { step: target, productId });
    },
    [currentStepIndex, productId],
  );

  // ─── Submit (Add to Cart) ──
  const closeNow = useCallback(() => {
    if (typeof window === "undefined") return;
    closingRef.current = true;
    // Hard-navigate off the modal route. history.back() cannot leave this
    // URL: React Router intercepts the popstate and re-renders the same route
    // in place because the URL doesn't change. Use returnUrl (passed from the
    // loader, sourced from ?return= on the Customize button link) so the
    // customer always lands back on the product page. Fall back to shop root
    // when returnUrl is absent (direct-link access without the param).
    // Use an absolute URL so AppProxyProvider's <base href> (which points at
    // the app tunnel) does not intercept resolution of a relative returnUrl.
    const origin = window.location.origin;
    window.location.href = returnUrl ? `${origin}${returnUrl}` : `${origin}/`;
  }, [returnUrl]);

  const onCartSuccess = useCallback(
    (totalCents: number, customizationIds: string[]) => {
      setSubmitState("success");
      dispatchAnalytics("cart_success", {
        totalItems: totalQuantity,
        totalCents,
        customizationId: customizationIds.join(","),
      });
      // Show the success state briefly, then redirect to cart.
      // SUCCESS_STATE_DURATION_MS is long enough to register (~1.5 s) without
      // annoying users. The redirect is non-blocking — if the user is already
      // on /cart the browser handles the navigation instantly.
      window.setTimeout(() => {
        if (productId) clearDraft(productId, variantId);
        if (typeof window !== "undefined") window.location.href = `${window.location.origin}/cart`;
      }, SUCCESS_STATE_DURATION_MS);
    },
    [totalQuantity, productId, variantId],
  );

  const submitOneVariant = useCallback(
    async (variantId: string, qty: number) => {
      if (!selectedMethodId) throw new Error("No decoration method selected");
      const cid = await ensureCustomization();
      if (!cid) throw new Error("Could not create customization draft");
      const res = await fetch(proxyUrl("/apps/insignia/prepare"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customizationId: cid }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<PrepareResult> & {
        error?: { code?: string; message?: string };
      };
      if (!res.ok) {
        const err = new Error(json.error?.message ?? `Prepare failed: ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const slotVariantId = json.slotVariantId!;
      const garmentProps = buildGarmentProperties({
        customizationId: cid,
        methodCustomerName: selectedMethod?.customerName ?? selectedMethod?.name ?? "",
        placementNames: Object.keys(placementSelections)
          .map((id) => config?.placements.find((p) => p.id === id)?.name ?? id),
        artworkStatus: logo.type === "uploaded" ? "PROVIDED" : "PENDING_CUSTOMER",
      });
      const feeProps = buildFeeProperties();
      const cart = await addCustomizedToCart(variantId, slotVariantId, qty, garmentProps, feeProps);
      // Best-effort confirm; failures don't block the cart redirect.
      try {
        await fetch(proxyUrl("/apps/insignia/cart-confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId: cid }),
        });
      } catch {
        /* non-fatal */
      }
      return { cart, customizationId: cid };
    },
    [ensureCustomization, selectedMethodId, selectedMethod, config, placementSelections, logo.type],
  );

  const onSubmit = useCallback(async (opts?: { isAutoRetry?: boolean }) => {
    if (!config || !selectedMethodId) return;
    const items = Object.entries(quantities).filter(([, q]) => q > 0);
    if (items.length === 0) return;
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `insignia-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setSubmitState("submitting");
    setSubmitErrorCode(null);
    // Reset auto-retry flag for each USER-initiated attempt so the customer
    // clicking "Try again" gets a fresh auto-retry. Skip the reset when the
    // call originates from the in-flight retry timer (would loop forever).
    if (!opts?.isAutoRetry) setHasRetriedPool(false);
    dispatchAnalytics("cart_submit", {
      totalItems: totalQuantity,
      totalCents: totalQuantity * (priceResult?.unitPriceCents ?? estimatedTotal),
      currency: config.currency,
    });

    try {
      if (items.length === 1 && items[0][0] === variantId) {
        // Single line item — fast path.
        const [vId, qty] = items[0];
        const result = await submitOneVariant(vId, qty);
        const totalCents = result.cart.items.reduce(
          (sum, it) => sum + (it.quantity ?? 0) * (priceResult?.unitPriceCents ?? estimatedTotal),
          0,
        );
        onCartSuccess(totalCents, [result.customizationId]);
        return;
      }

      // Multiple line items: prepare each in parallel, batch into one /cart/add.js.
      // Each size needs its own customization draft so it gets a unique slot variant.
      // createFreshCustomization always POSTs a new draft (never returns a cached id),
      // which is required because the slot reserved by /prepare is per-draft.
      // Slot claims use FOR UPDATE SKIP LOCKED in Postgres, so concurrent /prepare
      // calls are race-safe by design.
      const prepared = await Promise.all(
        items.map(async ([vId, qty]) => {
          const cid = await createFreshCustomization();
          if (!cid) throw new Error("Could not create customization draft");
          const res = await fetch(proxyUrl("/apps/insignia/prepare"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customizationId: cid }),
          });
          const json = (await res.json().catch(() => ({}))) as Partial<PrepareResult> & {
            error?: { code?: string; message?: string };
          };
          if (!res.ok) {
            const err = new Error(json.error?.message ?? `Prepare failed: ${res.status}`);
            (err as Error & { status?: number }).status = res.status;
            throw err;
          }
          const garmentProps = buildGarmentProperties({
            customizationId: cid,
            methodCustomerName: selectedMethod?.customerName ?? selectedMethod?.name ?? "",
            placementNames: Object.keys(placementSelections)
              .map((id) => config?.placements.find((p) => p.id === id)?.name ?? id),
            artworkStatus: logo.type === "uploaded" ? "PROVIDED" : "PENDING_CUSTOMER",
          });
          return {
            cid,
            lineItem: {
              baseVariantId: vId,
              feeVariantId: json.slotVariantId!,
              quantity: qty,
              garmentProperties: garmentProps,
              feeProperties: buildFeeProperties(),
            },
          };
        }),
      );
      const lineItems = prepared.map((p) => p.lineItem);
      const cids = prepared.map((p) => p.cid);
      const cart = await addMultipleCustomizedToCart(lineItems);
      // Confirm each cid (non-blocking).
      for (const cid of cids) {
        fetch(proxyUrl("/apps/insignia/cart-confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId: cid }),
        }).catch(() => {});
      }
      const totalCents = cart.items.reduce(
        (sum, it) => sum + (it.quantity ?? 0) * (priceResult?.unitPriceCents ?? estimatedTotal),
        0,
      );
      onCartSuccess(totalCents, cids);
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      const rawMessage = err instanceof Error ? err.message : "Add to cart failed";
      console.error("[insignia]", { tag: "cart-submit", err, step, productId, variantId });
      // 503 and 409 are both transient pool-contention signals (slot in use,
      // pool growing, etc). Auto-retry once with backoff; on second failure
      // surface the friendly pool-exhausted UI so the customer can manual-retry.
      const isTransient = status === 409 || status === 503;
      if (isTransient && !hasRetriedPool) {
        setHasRetriedPool(true);
        window.setTimeout(() => {
          setSubmitState("ready");
          void onSubmit({ isAutoRetry: true });
        }, SUBMIT_RETRY_409_MS);
        return;
      }
      if (isTransient) {
        setSubmitState("pool-exhausted");
      } else {
        setSubmitState("error");
      }
      // Surface the HTTP status as a short error code so support can correlate
      // a customer report to a server log. The friendly UI controls the body
      // text — raw message stays in console + analytics, never to the user.
      setSubmitErrorCode(status ? String(status) : "ERR");
      dispatchAnalytics("cart_error", { code: status ?? "unknown", message: rawMessage, retriable: status !== 401 });
    }
  }, [
    config,
    selectedMethodId,
    quantities,
    variantId,
    priceResult,
    estimatedTotal,
    totalQuantity,
    submitOneVariant,
    createFreshCustomization,
    onCartSuccess,
    hasRetriedPool,
    step,
    productId,
    selectedMethod,
    placementSelections,
    logo.type,
  ]);

  // ─── Render ──
  if (configLoading) {
    return (
      <div className="insignia-modal" aria-busy="true" aria-label={t.common.loading}>
        <div className="insignia-modal-header">
          <span className="insignia-skeleton" style={{ height: 18, width: 100 }} />
          <div className="insignia-tabs" aria-hidden="true">
            {WIZARD_STEPS.map((s) => (
              <span key={s.id} className="insignia-skeleton" style={{ height: 12, width: 60, marginInline: 8 }} />
            ))}
          </div>
          <span className="insignia-skeleton" style={{ height: 36, width: 36, borderRadius: 8 }} />
        </div>
        <div className="insignia-shell-skeleton">
          <span className="insignia-skeleton canvas" />
          <span className="insignia-skeleton row" />
          <span className="insignia-skeleton row" />
          <span className="insignia-skeleton row" />
        </div>
      </div>
    );
  }

  if (configError || !config) {
    return (
      <div className="insignia-modal">
        <div className="insignia-modal-header">
          <span className="insignia-modal-header-title insignia-only-desktop">
            <span className="title">{t.v2.header.title}</span>
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="insignia-modal-close"
            onClick={closeNow}
            aria-label={t.v2.header.closeAria}
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="insignia-modal-body" role="alert">
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t.v2.shell.configError}</h2>
          <p style={{ color: "var(--insignia-text-secondary)", fontSize: 14 }}>{configError}</p>
          <button
            type="button"
            className="insignia-btn insignia-btn--primary"
            onClick={() => void fetchConfig()}
          >
            {t.v2.shell.configErrorRetry}
          </button>
        </div>
      </div>
    );
  }

  const desktopShowPreview = ["upload", "placement", "size", "review"].includes(step);
  const showFooterBackButton = currentStepIndex > 0;
  const continueDisabled = (() => {
    if (step === "upload") return logo.type === "none" || !selectedMethodId;
    if (step === "placement") return Object.keys(placementSelections).length === 0;
    if (step === "review") return totalQuantity === 0 || submitState === "submitting";
    return false;
  })();

  return (
    <div className="insignia-modal" role="dialog" aria-modal="true" aria-label={t.v2.header.title}>
      {offline && (
        <div className="insignia-offline-banner" role="status">
          <IconWifiOff size={14} />
          <span>{t.v2.shell.offline}</span>
        </div>
      )}

      {/* Header */}
      <header className="insignia-modal-header">
        {config.shopLogoUrl && (
          <img src={config.shopLogoUrl} alt="" className="insignia-modal-header-logo" />
        )}
        <div className="insignia-modal-header-title insignia-only-desktop">
          <span className="title">{t.v2.header.title}</span>
          <span className="subtitle">{config.productTitle}</span>
        </div>
        <div className="insignia-tabs" ref={tabsRef} role="tablist" aria-label="Wizard steps">
          {WIZARD_STEPS.map((tab) => {
            const tabState = stepTabState(tab.id);
            const Icon = STEP_ICONS[tab.id];
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabBtnRefs.current[tab.id] = el;
                }}
                type="button"
                role="tab"
                className="insignia-tab"
                data-state={tabState !== "default" ? tabState : undefined}
                aria-selected={tabState === "active"}
                disabled={STEP_ORDER.indexOf(tab.id) > currentStepIndex}
                onClick={() => setStepDirect(tab.id)}
              >
                <span className="tab-icon" aria-hidden="true">
                  {tabState === "completed" ? <IconCheck size={14} /> : <Icon size={14} />}
                </span>
                <span>{stepLabels[tab.id]}</span>
              </button>
            );
          })}
          <span className="insignia-tab-underline" style={{ left: underline.left, width: underline.width }} />
        </div>
        <button
          type="button"
          className="insignia-modal-close"
          onClick={() => (hasSelections ? setShowCloseConfirm(true) : closeNow())}
          aria-label={t.v2.header.closeAria}
        >
          <IconX size={18} />
        </button>
      </header>

      {/* Body — desktop wraps in a 60/40 split. Only ONE layout mounts at
          a time so step-component refs (SizeStep.tryAdvance) target the
          live instance rather than a hidden duplicate. */}
      {isDesktop ? (
        <div className="insignia-modal-body-wrap">
          <aside className="insignia-desktop-preview">
            <div className="insignia-desktop-preview-canvas">
              {desktopShowPreview && (
                <PreviewCanvas
                  config={config}
                  placementSelections={placementSelections}
                  logo={logo}
                  viewId={desktopActiveViewId}
                  onViewChange={setDesktopActiveViewId}
                  context="panel"
                  onImageMeta={onImageMeta}
                  onLogoMeta={onLogoMeta}
                  t={t}
                />
              )}
            </div>
          </aside>
          <section className="insignia-desktop-content">
            <div className="insignia-desktop-content-body">{renderStep()}</div>
            {renderFooter()}
          </section>
        </div>
      ) : (
        <>
          <div className="insignia-modal-body">{renderStep()}</div>
          <div className="insignia-mobile-footer-wrap">{renderFooter()}</div>
        </>
      )}

      <CloseConfirmDialog
        open={showCloseConfirm}
        onKeepEditing={() => setShowCloseConfirm(false)}
        onCloseAnyway={() => {
          setShowCloseConfirm(false);
          dispatchAnalytics("modal_close", { step, hasDraft: hasSelections });
          closeNow();
        }}
        t={t}
      />

      <PreviewSheet
        open={showPreviewSheet}
        onClose={() => setShowPreviewSheet(false)}
        config={config}
        placementSelections={placementSelections}
        logo={logo}
        t={t}
      />
    </div>
  );

  function renderStep() {
    if (!config) return null;
    switch (step) {
      case "upload":
        return (
          <UploadStep
            config={config}
            logo={logo}
            onLogoChange={(next) => {
              setLogo(next);
              // Invalidate any draft id so the next price/prepare uses fresh logo.
              setCustomizationId(null);
              setPriceResult(null);
            }}
            selectedMethodId={selectedMethodId}
            onMethodChange={(id) => {
              setSelectedMethodId(id);
              setCustomizationId(null);
              setPriceResult(null);
            }}
            t={t}
            onAnalytics={dispatchAnalytics}
          />
        );
      case "placement":
        return (
          <PlacementStep
            config={config}
            placementSelections={placementSelections}
            onPlacementSelectionsChange={(next) => {
              setPlacementSelections(next);
              setCustomizationId(null);
              setPriceResult(null);
            }}
            logo={logo}
            desktopActiveViewId={desktopActiveViewId}
            onDesktopActiveViewChange={setDesktopActiveViewId}
            onImageMeta={onImageMeta}
            t={t}
            onAnalytics={dispatchAnalytics}
          />
        );
      case "size":
        return (
          <SizeStep
            ref={sizeStepRef}
            config={config}
            placementSelections={placementSelections}
            onPlacementSelectionsChange={(next) => {
              setPlacementSelections(next);
              setCustomizationId(null);
              setPriceResult(null);
            }}
            logo={logo}
            desktopActiveViewId={desktopActiveViewId}
            onDesktopActiveViewChange={setDesktopActiveViewId}
            onImageMeta={onImageMeta}
            onLogoMeta={onLogoMeta}
            imageMetaByViewId={imageMetaByViewId}
            logoMeta={logoMeta}
            t={t}
            onAnalytics={dispatchAnalytics}
          />
        );
      case "review":
        return (
          <ReviewStep
            config={config}
            selectedMethodId={selectedMethodId ?? ""}
            placementSelections={placementSelections}
            logo={logo}
            quantities={quantities}
            onQuantitiesChange={setQuantities}
            priceResult={priceResult}
            priceLoading={priceLoading}
            t={t}
          />
        );
    }
  }

  function renderFooter() {
    return (
      <footer className="insignia-modal-footer">
        {step === "review" ? (
          <ReviewFooter
            currency={config!.currency}
            totalCents={footerPriceValue}
            totalQty={totalQuantity}
            submitState={submitState}
            submitErrorCode={submitErrorCode}
            onBack={goBack}
            onShowPreview={() => setShowPreviewSheet(true)}
            onSubmit={() => void onSubmit()}
            t={t}
          />
        ) : (
          <>
            <div className="insignia-footer-price">
              <span className="insignia-footer-price-label">{footerPriceLabel}</span>
              <span className="insignia-footer-price-value">
                {formatCurrency(footerPriceValue, config!.currency)}
              </span>
            </div>
            <div className="insignia-footer-actions">
              {showFooterBackButton && (
                <button
                  type="button"
                  className="insignia-btn insignia-btn--ghost"
                  onClick={goBack}
                >
                  <IconArrowLeft size={14} />
                  <span>{t.placement.btnBack}</span>
                </button>
              )}
              <button
                type="button"
                className="insignia-btn insignia-btn--primary"
                onClick={() => void goNext()}
                disabled={continueDisabled}
              >
                <span>{t.upload.btnNext}</span>
                <IconArrowRight size={14} />
              </button>
            </div>
          </>
        )}
      </footer>
    );
  }
}

// ─── Review footer (Add-to-Cart) ─────────────────────────────────────────────

function ReviewFooter({
  currency,
  totalCents,
  totalQty,
  submitState,
  submitErrorCode,
  onBack,
  onShowPreview,
  onSubmit,
  t,
}: {
  currency: string;
  totalCents: number;
  totalQty: number;
  submitState: SubmitState;
  submitErrorCode: string | null;
  onBack: () => void;
  onShowPreview: () => void;
  onSubmit: () => void;
  t: ReturnType<typeof getTranslations>;
}) {
  const disabled = totalQty === 0 || submitState === "submitting" || submitState === "success";

  // In error/pool-exhausted states, the primary CTA becomes "Try again" so
  // it's the obvious next step. We disable it slightly less than the success
  // CTA — empty cart still blocks it.
  const inErrorState = submitState === "error" || submitState === "pool-exhausted";
  let buttonLabel: React.ReactNode;
  if (inErrorState) {
    buttonLabel = (
      <>
        <IconAlertTriangle size={16} />
        <span>{t.v2.review.errorRetry}</span>
      </>
    );
  } else if (submitState === "submitting") {
    buttonLabel = (
      <>
        {/* AlpVH (D4): loader-circle always visible immediately (no delay) +
            "Adding to cart…" — fill driven by [data-state="submitting"] CSS */}
        <IconLoaderCircle
          size={16}
          aria-hidden="true"
          className="insignia-spin"
        />
        <span>{t.v2.review.submitting}</span>
      </>
    );
  } else if (submitState === "success") {
    buttonLabel = (
      <>
        {/* EsOhG (D5): circle-check size 18 + "Added to cart" —
            fill driven by [data-state="success"] CSS (#065F46) */}
        <IconCircleCheck size={18} aria-hidden="true" />
        <span>{t.v2.review.success}</span>
      </>
    );
  } else {
    buttonLabel = (
      <>
        {/* D3: icon + label + em-dash separator (50% opacity) + price per .pen design (Nt3H7) */}
        <IconShoppingCart size={16} />
        <span>{t.v2.review.addToCart}</span>
        <span aria-hidden="true" style={{ opacity: 0.5 }}>—</span>
        <span>{formatCurrency(totalCents, currency)}</span>
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
        {submitState === "pool-exhausted" && (
          <div className="insignia-banner" data-tone="warning" role="alert">
            <span className="insignia-banner-icon"><IconAlertTriangle size={14} /></span>
            <div className="insignia-banner-body">
              <strong>
                {t.v2.review.poolExhaustedTitle}
                {submitErrorCode && (
                  <span className="insignia-banner-code"> ({submitErrorCode})</span>
                )}
              </strong>
              <div>{t.v2.review.poolExhaustedBody}</div>
            </div>
          </div>
        )}
        {submitState === "error" && (
          <div className="insignia-banner" data-tone="error" role="alert">
            <span className="insignia-banner-icon"><IconAlertTriangle size={14} /></span>
            <div className="insignia-banner-body">
              <strong>
                {t.v2.review.errorTitle}
                {submitErrorCode && (
                  <span className="insignia-banner-code"> ({submitErrorCode})</span>
                )}
              </strong>
              <div>{t.v2.review.errorBody}</div>
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="insignia-btn insignia-btn--ghost"
            onClick={onBack}
            aria-label={t.placement.btnBack}
          >
            <IconArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="insignia-btn insignia-btn--icon insignia-only-mobile"
            onClick={onShowPreview}
            aria-label={t.previewSheet.title}
          >
            <IconEye size={16} />
          </button>
          <button
            type="button"
            className="insignia-btn insignia-btn--success"
            data-state={
              submitState === "success"
                ? "success"
                : submitState === "submitting"
                  ? "submitting"
                  : undefined
            }
            onClick={onSubmit}
            disabled={disabled}
            style={{ flex: 1 }}
            aria-live="polite"
          >
            {buttonLabel}
          </button>
        </div>
        {/* qty=0: button already grays out via .insignia-btn--success:disabled — no separate hint needed */}
      </div>
    </>
  );
}
