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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  // design-fees:
  getCartToken,
  buildCustomizationDesignFeeProperties,
  changeCartLine,
  type DesignFeeLineInput,
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
import { getPlacementCents } from "./pricing";
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
  // design-fees: optional per-cart one-time fees (separate from unitPriceCents)
  designFees?: Array<{
    categoryId: string;
    categoryName: string;
    methodId: string;
    feeCents: number;
    alreadyCharged: boolean;
  }>;
};

// design-fees: ephemeral pending lines from /prepare
type PendingDesignFeeLine = {
  tempId: string;
  slotId: string;
  slotVariantId: string;
  feeCentsCharged: number;
  categoryId: string;
  categoryName: string;
  methodId: string;
  logoContentHash: string;
  lineProperties: Record<string, string>;
};

type PrepareResult = {
  slotVariantId: string;
  configHash: string;
  pricingVersion: string;
  unitPriceCents: number;
  feeCents: number;
  // design-fees:
  pendingDesignFeeLines?: PendingDesignFeeLine[];
  designFeeTagging?: {
    logoContentHash: string;
    feeCategoryIds: string[];
    methodId: string;
  } | null;
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

// ─── Desktop viewport hook ──────────────────────────────────────────────────
// Gates Konva PreviewCanvas mount only — does NOT branch the JSX tree.
// useSyncExternalStore is SSR-safe: server snapshot returns false (mobile-first).
function useIsDesktopViewport(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches, // client snapshot
    () => false, // server snapshot — mobile-first (SSR returns false)
  );
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
  // Placement id the canvas preview should zoom toward. Null until the user
  // interacts (hover/tap/size-step navigation). Draft restore intentionally
  // does NOT set this — the reload UX stays un-zoomed until the customer
  // gestures again, per plan decision #4.
  const [zoomTargetPlacementId, setZoomTargetPlacementId] = useState<string | null>(null);
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
  // design-fees: cart token captured lazily on mount. Best-effort dedup
  // identity (§14.C). Null until the first /cart.js fetch resolves.
  const cartTokenRef = useRef<string | null>(null);

  // useIsDesktopViewport gates PreviewCanvas only — not the JSX tree structure.
  // See the hook definition above the component for SSR safety notes.
  const isDesktopViewport = useIsDesktopViewport();
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

  // Effective zoom target fed to the PreviewCanvas. The Upload step is always
  // un-zoomed (no placements chosen yet). Review keeps whatever Size left in
  // state; if nothing active (e.g. user jumped straight here via back-nav),
  // fall back to the first selected placement in canonical config order.
  // Placement/Size just use the raw state value.
  const effectiveZoomTargetPlacementId: string | null = useMemo(() => {
    if (!config) return null;
    if (step === "upload") return null;
    if (step === "review") {
      if (zoomTargetPlacementId) return zoomTargetPlacementId;
      const firstSelected = config.placements.find(
        (p) => placementSelections[p.id] !== undefined,
      );
      return firstSelected?.id ?? null;
    }
    return zoomTargetPlacementId;
  }, [config, step, zoomTargetPlacementId, placementSelections]);

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
      const placementCents = getPlacementCents(p, selectedMethodId);
      const stepCents =
        step === "size" || step === "review"
          ? p?.steps[idx]?.priceAdjustmentCents ?? 0
          : 0;
      return sum + placementCents + stepCents;
    }, 0);
    return base + method + placements;
  }, [config, selectedMethod, selectedMethodId, placementSelections, step]);

  // design-fees: client-side preview of which design fees apply for the
  // CURRENT selection (method + selected placements). Used on placement/size
  // steps before priceResult exists, so the running total + breakdown reflect
  // fees in real time. On review step the priceResult-based version (with
  // cart-aware alreadyCharged) takes priority — see designFeesActiveLines below.
  const designFeesPreviewLines = useMemo(() => {
    if (!config?.designFees || !selectedMethodId) {
      return [] as Array<{
        categoryId: string;
        methodId: string;
        categoryName: string;
        feeCents: number;
        alreadyCharged: boolean;
      }>;
    }
    const seen = new Set<string>();
    const out: Array<{
      categoryId: string;
      methodId: string;
      categoryName: string;
      feeCents: number;
      alreadyCharged: boolean;
    }> = [];
    for (const placementId of Object.keys(placementSelections)) {
      const categoryId = config.designFees.placementCategoryByPlacementId[placementId];
      if (!categoryId) continue;
      const cat = config.designFees.categories.find(
        (c) => c.id === categoryId && c.methodId === selectedMethodId,
      );
      if (!cat || seen.has(cat.id)) continue;
      seen.add(cat.id);
      out.push({
        categoryId: cat.id,
        methodId: cat.methodId,
        categoryName: cat.name,
        feeCents: cat.feeCents,
        alreadyCharged: false,
      });
    }
    return out;
  }, [config, selectedMethodId, placementSelections]);

  // design-fees: source-of-truth for footer + Review breakdown. When
  // priceResult is present (review step or after price-recalc), use it so
  // alreadyCharged tuples render correctly. Otherwise fall back to the
  // client-side preview computed above.
  const designFeesActiveLines = useMemo(() => {
    if (priceResult?.designFees && priceResult.designFees.length > 0) {
      return priceResult.designFees;
    }
    return designFeesPreviewLines;
  }, [priceResult, designFeesPreviewLines]);

  // design-fees: per-placement preview map. Reads config.designFees +
  // priceResult.designFees. When feature is off (config.designFees === null),
  // resolves to undefined (PlacementStep renders no sub-labels).
  const designFeesByPlacementId = useMemo(() => {
    if (!config?.designFees) return undefined;
    const map: Record<string, { feeCents: number; alreadyCharged: boolean }> = {};
    const decisionByCategory = new Map<string, { feeCents: number; alreadyCharged: boolean }>();
    for (const df of priceResult?.designFees ?? []) {
      decisionByCategory.set(df.categoryId, {
        feeCents: df.feeCents,
        alreadyCharged: df.alreadyCharged,
      });
    }
    for (const [placementId, categoryId] of Object.entries(
      config.designFees.placementCategoryByPlacementId,
    )) {
      const decision = decisionByCategory.get(categoryId);
      if (decision) {
        map[placementId] = decision;
      } else {
        // No price computed yet — show base category fee from config
        const cat = config.designFees.categories.find((c) => c.id === categoryId);
        if (cat) {
          map[placementId] = { feeCents: cat.feeCents, alreadyCharged: false };
        }
      }
    }
    return map;
  }, [config, priceResult]);

  const fallbackUnitPriceCents = useMemo(() => {
    if (!config) return 0;
    const base = config.baseProductPriceCents ?? 0;
    const method = selectedMethod?.basePriceCents ?? 0;
    const placements = Object.entries(placementSelections).reduce((sum, [pid, idx]) => {
      const p = config.placements.find((pp) => pp.id === pid);
      return sum + getPlacementCents(p, selectedMethodId) + (p?.steps[idx]?.priceAdjustmentCents ?? 0);
    }, 0);
    return base + method + placements;
  }, [config, selectedMethod, selectedMethodId, placementSelections]);

  const footerPriceLabel =
    step === "review"
      ? t.footer.orderTotal
      : step === "upload"
        ? t.footer.startingFrom
        : t.footer.estimatedTotal;

  // design-fees: pending fees (those NOT alreadyCharged) for the current
  // active state — review uses cart-aware priceResult.designFees, earlier
  // steps fall back to the client-side preview.
  const designFeesPendingCents = useMemo(
    () =>
      designFeesActiveLines.reduce(
        (sum, d) => (d.alreadyCharged ? sum : sum + d.feeCents),
        0,
      ),
    [designFeesActiveLines],
  );

  // design-fees: include fees in the running total on EVERY step (placement,
  // size, review). Without this the modal's running total disagrees with the
  // Shopify cart total for any cart with active design fees.
  const footerPriceValue =
    step === "review"
      ? totalQuantity * (priceResult?.unitPriceCents ?? fallbackUnitPriceCents) +
        designFeesPendingCents
      : step === "upload"
        ? config?.baseProductPriceCents ?? 0
        : estimatedTotal + designFeesPendingCents;

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

  // design-fees: capture the cart token once on mount. Failure is non-fatal —
  // missing token just disables design-fee dedup for this modal session.
  useEffect(() => {
    let cancelled = false;
    void getCartToken().then((token) => {
      if (!cancelled) cartTokenRef.current = token;
    });
    return () => {
      cancelled = true;
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
        // design-fees: forward best-effort dedup identity to the backend
        cartToken: cartTokenRef.current,
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
        // design-fees: forward best-effort dedup identity to the backend
        cartToken: cartTokenRef.current,
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
        // design-fees: include cartToken so the price response includes designFees
        body: JSON.stringify({ customizationId: cid, cartToken: cartTokenRef.current }),
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
    // Guard: returnUrl must be a clean store-relative path (starts with /,
    // no double-slash, no backslash). Rejects open-redirect attempts and
    // any value that slipped through without url_encode.
    const safeReturnUrl =
      returnUrl && /^\/(?!\/|\\)/.test(returnUrl) ? returnUrl : null;
    window.location.href = safeReturnUrl ? `${origin}${safeReturnUrl}` : `${origin}/`;
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

  // design-fees: persist CartDesignFeeCharge rows and reconcile conflicts.
  // For each conflict (another tab/parallel-prepare beat us to the tuple),
  // the matching cart line is removed via /cart/change.js qty=0. Per §14.B.
  const persistDesignFeeCharges = useCallback(
    async (args: {
      cartToken: string;
      pendingFees: PendingDesignFeeLine[];
      cart: { items: Array<{ key: string; variant_id: number }> };
    }) => {
      const { cartToken, pendingFees, cart } = args;
      // Map slotVariantId (numeric) -> the cart-line key
      const lineKeyByVariantId = new Map<number, string>();
      for (const it of cart.items) {
        lineKeyByVariantId.set(Number(it.variant_id), it.key);
      }
      const inputs = pendingFees.map((p) => {
        const numericVariant = Number(
          p.slotVariantId.replace("gid://shopify/ProductVariant/", ""),
        );
        return {
          tempId: p.tempId,
          slotId: p.slotId,
          shopifyVariantId: p.slotVariantId,
          shopifyLineKey: lineKeyByVariantId.get(numericVariant) ?? null,
          feeCentsCharged: p.feeCentsCharged,
          categoryId: p.categoryId,
          methodId: p.methodId,
          logoContentHash: p.logoContentHash,
        };
      });
      try {
        const res = await fetch(proxyUrl("/apps/insignia/design-fees/confirm-charges"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cartToken, inputs }),
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as {
          conflicts?: Array<{ tempId: string; slotId: string }>;
        };
        const conflicts = data.conflicts ?? [];
        if (conflicts.length === 0) return;
        // Remove conflicted (duplicate) design-fee cart lines client-side
        for (const c of conflicts) {
          const pf = pendingFees.find((p) => p.tempId === c.tempId);
          if (!pf) continue;
          const numericVariant = Number(
            pf.slotVariantId.replace("gid://shopify/ProductVariant/", ""),
          );
          const lineKey = lineKeyByVariantId.get(numericVariant);
          if (!lineKey) continue;
          try {
            await changeCartLine(lineKey, 0);
          } catch {
            // Non-fatal — cart-sync will retry on next page load
          }
        }
      } catch {
        // Non-fatal — feature degrades gracefully
      }
    },
    [],
  );

  const submitOneVariant = useCallback(
    async (variantId: string, qty: number) => {
      if (!selectedMethodId) throw new Error("No decoration method selected");
      const cid = await ensureCustomization();
      if (!cid) throw new Error("Could not create customization draft");
      const res = await fetch(proxyUrl("/apps/insignia/prepare"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // design-fees: include cartToken so prepare returns pendingDesignFeeLines
        body: JSON.stringify({ customizationId: cid, cartToken: cartTokenRef.current }),
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
        placementNames: Object.keys(placementSelections).map((id) => {
          const placement = config?.placements.find((p) => p.id === id);
          const name = placement?.name ?? id;
          const stepLabel = (placement?.steps.length ?? 0) > 1
            ? placement?.steps[placementSelections[id]]?.label
            : undefined;
          return stepLabel ? `${name} (${stepLabel})` : name;
        }),
        artworkStatus: logo.type === "uploaded" ? "PROVIDED" : "PENDING_CUSTOMER",
      });
      const feeProps = buildFeeProperties();
      // design-fees: tag customization line + build extra fee lines
      const designFeeProps = json.designFeeTagging
        ? buildCustomizationDesignFeeProperties({
            logoContentHash: json.designFeeTagging.logoContentHash,
            feeCategoryIds: json.designFeeTagging.feeCategoryIds,
            methodId: json.designFeeTagging.methodId,
          })
        : {};
      const garmentPropsTagged = { ...garmentProps, ...designFeeProps };
      const pendingFees = json.pendingDesignFeeLines ?? [];
      const designFeeLines: DesignFeeLineInput[] = pendingFees.map((dfl) => ({
        variantId: dfl.slotVariantId,
        quantity: 1, // one-time per cart per (hash, category, method)
        properties: dfl.lineProperties,
      }));
      let cart;
      try {
        cart = await addCustomizedToCart(
          variantId,
          slotVariantId,
          qty,
          garmentPropsTagged,
          feeProps,
          designFeeLines,
        );
      } catch (cartErr) {
        // design-fees: free reserved slots so they're not lost on failure
        if (pendingFees.length > 0) {
          fetch(proxyUrl("/apps/insignia/design-fees/abort-charges"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slotIds: pendingFees.map((p) => p.slotId) }),
          }).catch(() => {});
        }
        throw cartErr;
      }
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
      // design-fees: persist charges + handle conflicts (§14.B)
      if (pendingFees.length > 0 && cartTokenRef.current) {
        await persistDesignFeeCharges({
          cartToken: cartTokenRef.current,
          pendingFees,
          cart,
        });
      }
      return { cart, customizationId: cid };
    },
    [ensureCustomization, selectedMethodId, selectedMethod, config, placementSelections, logo.type, persistDesignFeeCharges],
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
            // design-fees: include cartToken so prepare returns pendingDesignFeeLines
            body: JSON.stringify({ customizationId: cid, cartToken: cartTokenRef.current }),
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
            placementNames: Object.keys(placementSelections).map((id) => {
              const placement = config?.placements.find((p) => p.id === id);
              const name = placement?.name ?? id;
              const stepLabel = (placement?.steps.length ?? 0) > 1
                ? placement?.steps[placementSelections[id]]?.label
                : undefined;
              return stepLabel ? `${name} (${stepLabel})` : name;
            }),
            artworkStatus: logo.type === "uploaded" ? "PROVIDED" : "PENDING_CUSTOMER",
          });
          // design-fees: tag customization line + collect fee lines for batching
          const designFeeProps = json.designFeeTagging
            ? buildCustomizationDesignFeeProperties({
                logoContentHash: json.designFeeTagging.logoContentHash,
                feeCategoryIds: json.designFeeTagging.feeCategoryIds,
                methodId: json.designFeeTagging.methodId,
              })
            : {};
          return {
            cid,
            // design-fees:
            pendingFees: json.pendingDesignFeeLines ?? [],
            lineItem: {
              baseVariantId: vId,
              feeVariantId: json.slotVariantId!,
              quantity: qty,
              garmentProperties: { ...garmentProps, ...designFeeProps },
              feeProperties: buildFeeProperties(),
            },
          };
        }),
      );
      const lineItems = prepared.map((p) => p.lineItem);
      const cids = prepared.map((p) => p.cid);
      // design-fees: aggregate pending fee lines from all parallel prepares
      const allPendingFees: PendingDesignFeeLine[] = prepared.flatMap((p) => p.pendingFees);
      const designFeeLines: DesignFeeLineInput[] = allPendingFees.map((dfl) => ({
        variantId: dfl.slotVariantId,
        quantity: 1,
        properties: dfl.lineProperties,
      }));
      let cart;
      try {
        cart = await addMultipleCustomizedToCart(lineItems, designFeeLines);
      } catch (cartErr) {
        if (allPendingFees.length > 0) {
          fetch(proxyUrl("/apps/insignia/design-fees/abort-charges"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slotIds: allPendingFees.map((p) => p.slotId) }),
          }).catch(() => {});
        }
        throw cartErr;
      }
      // Confirm each cid (non-blocking).
      for (const cid of cids) {
        fetch(proxyUrl("/apps/insignia/cart-confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId: cid }),
        }).catch(() => {});
      }
      // design-fees: persist all charges + reconcile parallel-prepare conflicts
      if (allPendingFees.length > 0 && cartTokenRef.current) {
        await persistDesignFeeCharges({
          cartToken: cartTokenRef.current,
          pendingFees: allPendingFees,
          cart,
        });
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
    // design-fees:
    persistDesignFeeCharges,
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

      {/* Body — single tree, always rendered. CSS media queries in
          storefront-modal.css handle the mobile/desktop layout split.
          This avoids the SSR/hydration mismatch that previously remounted
          the entire subtree on desktop (isDesktop: false→true), which was
          aborting in-flight uploads via UploadStep's cleanup effect.
          PreviewCanvas is additionally gated by isDesktopViewport to prevent
          Konva 0-width geometry errors when the aside is display:none on mobile. */}
      <div className="insignia-modal-body-wrap">
        <aside className="insignia-desktop-preview">
          <div className="insignia-desktop-preview-canvas">
            {desktopShowPreview && isDesktopViewport && (
              <PreviewCanvas
                config={config}
                placementSelections={placementSelections}
                logo={logo}
                zoomTargetPlacementId={effectiveZoomTargetPlacementId}
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
        zoomTargetPlacementId={effectiveZoomTargetPlacementId}
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
            selectedMethodId={selectedMethodId}
            zoomTargetPlacementId={effectiveZoomTargetPlacementId}
            onZoomTargetChange={setZoomTargetPlacementId}
            t={t}
            onAnalytics={dispatchAnalytics}
            // design-fees: hand the per-placement preview to the row sub-label
            designFeesByPlacementId={designFeesByPlacementId}
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
            zoomTargetPlacementId={effectiveZoomTargetPlacementId}
            onActivePlacementChange={setZoomTargetPlacementId}
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
            // design-fees: fallback so the review breakdown shows fees even
            // before priceResult lands (or when backend returns empty).
            designFeesFallback={designFeesPreviewLines}
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
            {/* design-fees: fees are baked into footerPriceValue on
                placement/size; explicit breakdown lives only in the
                Review step (and the placement-row sub-label upstream). */}
            <div
              className="insignia-footer-price"
              aria-live="polite"
              aria-atomic="true"
            >
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
