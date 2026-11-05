import { useEffect, useMemo, useState } from "preact/hooks";
import { z } from "zod";
import { createAdminTranslator } from "@insignia/ui-localization/admin";
import { configSchema, type ProductConfig } from "./config";
import { LocalDesigner } from "./demo/local-designer";

const previewRectSchema = z.strictObject({
  centerX: z.number().finite().min(0).max(1),
  centerY: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).refine(
  ({ centerX, centerY, width, height }) =>
    centerX - width / 2 >= 0 &&
    centerX + width / 2 <= 1 &&
    centerY - height / 2 >= 0 &&
    centerY + height / 2 <= 1,
  "preview-area-outside-image",
);
const pointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const calibrationSchema = z.strictObject({
  imageUrl: z.string().url(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  a: pointSchema,
  b: pointSchema,
  distanceCm: z.number().finite().positive(),
});
const placementSizeSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  widthPercent: z.string(),
  prices: z.record(z.string(), z.string()),
});
const placementSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  rect: previewRectSchema,
  widthCm: z.string(),
  heightCm: z.string(),
  methodIds: z.array(z.string()),
  sizes: z.array(placementSizeSchema),
  logoLaterAllowed: z.boolean(),
  customPlacementAllowed: z.boolean().optional(),
  movementRect: previewRectSchema.optional(),
});
const viewSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  imageUrl: z.union([z.string().url(), z.literal("")]),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  placements: z.array(placementSchema),
  needsAlignmentReview: z.boolean().optional(),
  calibration: calibrationSchema.optional(),
});
const productImageSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string(),
});
const methodSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  pricing: z.enum(["fixed", "product"]),
  amount: z.string(),
});
const placementProductSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  images: z.array(productImageSchema),
  views: z.array(viewSchema),
  methods: z.array(methodSchema),
});
const nonceSchema = z.string().min(16).max(128).regex(/^[a-f0-9-]+$/i);
const dataMessageSchema = z.strictObject({
  type: z.literal("insignia:customer-preview:data"),
  nonce: nonceSchema,
  product: placementProductSchema,
});
const cacheSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  product: placementProductSchema,
});

type PlacementProductSnapshot = z.infer<typeof placementProductSchema>;
export type AdminPreviewFailureReason =
  | "reopen-from-editor"
  | "expired"
  | "draft-did-not-arrive"
  | "draft-could-not-be-previewed"
  | "unrepresentable-draft-data"
  | "empty-product-name"
  | "no-product-views"
  | "missing-image-for-placed-view"
  | "no-product-image"
  | "unnamed-product-view"
  | "unmappable-product-view"
  | "no-valid-artwork-placements"
  | "too-many-artwork-placements"
  | "unrepresentable-artwork-setup"
  | "invalid-image-source";

export class AdminPreviewBuildError extends Error {
  constructor(readonly reason: AdminPreviewFailureReason) {
    super(reason);
    this.name = "AdminPreviewBuildError";
  }
}

type ArtworkPreviewMessage =
  | { status: "ignored" }
  | { status: "error"; reason: "unrepresentable-draft-data" }
  | { status: "ready"; product: PlacementProductSnapshot };

/** Call only after checking the opener source and origin. */
export function readArtworkPreviewMessage(input: unknown, nonce: string): ArtworkPreviewMessage {
  if (
    !input || typeof input !== "object" ||
    !("type" in input) || input.type !== "insignia:customer-preview:data" ||
    !("nonce" in input) || input.nonce !== nonce
  ) return { status: "ignored" };
  const parsed = dataMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", reason: "unrepresentable-draft-data" };
  }
  return { status: "ready", product: parsed.data.product };
}
type PreviewState =
  | { status: "loading" }
  | {
      status: "ready";
      config: ProductConfig;
      availablePlacementCount: number;
      totalPlacementCount: number;
    }
  | { status: "error"; reason: AdminPreviewFailureReason };

const sessionTtlMs = 15 * 60 * 1000;

function originFor(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol)) return null;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function cents(value: string): number | null {
  const match = /^(0|[1-9]\d{0,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return amount <= 9_999_999n ? Number(amount) : null;
}

function imageUrlForCustomer(url: string, adminOrigin: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== "insignia-order-demo.invalid") return parsed.toString();
  const filename = parsed.pathname.split("/").at(-1);
  if (!filename) throw new AdminPreviewBuildError("invalid-image-source");
  return new URL(`/__preview/demo/files/${encodeURIComponent(decodeURIComponent(filename))}`, adminOrigin).toString();
}

function movementContainsPlacement(
  movement: z.infer<typeof previewRectSchema>,
  placement: z.infer<typeof previewRectSchema>,
): boolean {
  return (
    movement.centerX - movement.width / 2 <= placement.centerX - placement.width / 2 &&
    movement.centerX + movement.width / 2 >= placement.centerX + placement.width / 2 &&
    movement.centerY - movement.height / 2 <= placement.centerY - placement.height / 2 &&
    movement.centerY + movement.height / 2 >= placement.centerY + placement.height / 2
  );
}

/** Adapt an actual editor snapshot into the existing customer designer's option model. */
export function buildCustomerPreviewConfig(
  input: PlacementProductSnapshot,
  adminOrigin: string,
  productImageLabel = createAdminTranslator().t("admin-preview:preview.productImage"),
): ProductConfig {
  const product = placementProductSchema.parse(input);
  if (!product.title.trim()) throw new AdminPreviewBuildError("empty-product-name");
  if (!product.views.length) throw new AdminPreviewBuildError("no-product-views");
  if (product.views.some((view) => view.placements.length && !view.imageUrl)) {
    throw new AdminPreviewBuildError("missing-image-for-placed-view");
  }
  const imageViews = product.views.filter((view) => view.imageUrl);
  if (!imageViews.length) throw new AdminPreviewBuildError("no-product-image");
  if (imageViews.some((view) => !view.name.trim())) throw new AdminPreviewBuildError("unnamed-product-view");

  const viewIds = new Map(imageViews.map((view, index) => [view.id, `preview-view-${index + 1}`]));
  const methodIds = new Map(product.methods.map((method, index) => [method.id, `preview-method-${index + 1}`]));
  const views = imageViews.map((view) => ({
    id: viewIds.get(view.id)!,
    label: view.name.trim(),
    illustration: "front" as const,
  }));
  const images = Object.fromEntries(
    imageViews.map((view) => [viewIds.get(view.id)!, imageUrlForCustomer(view.imageUrl, adminOrigin)]),
  );
  const methodsById = new Map(product.methods.map((method) => [method.id, method]));
  const positions: ProductConfig["positions"] = [];
  let positionIndex = 0;
  const totalPlacementCount = product.views.reduce((count, view) => count + view.placements.length, 0);

  for (const view of imageViews) {
    const viewId = viewIds.get(view.id);
  if (!viewId) throw new AdminPreviewBuildError("unmappable-product-view");
    for (const placement of view.placements) {
      if (!placement.name.trim() || !placement.rect.width || !placement.rect.height) continue;
      if (
        placement.customPlacementAllowed &&
        (!placement.movementRect || !movementContainsPlacement(placement.movementRect, placement.rect))
      ) continue;
      if (!placement.sizes.length) continue;
      const widthFactors = placement.sizes.map((size) => Number(size.widthPercent));
      const sizeNames = placement.sizes.map((size) => size.name.trim().toLowerCase());
      if (
        placement.sizes.some((size) => !size.name.trim()) ||
        new Set(sizeNames).size !== sizeNames.length ||
        widthFactors.some((factor) => !Number.isFinite(factor) || factor <= 0 || factor > 100) ||
        new Set(widthFactors).size !== widthFactors.length
      ) continue;

      const methodSizePrices: Record<string, (number | null)[]> = {};
      const eligibleMethodIds: string[] = [];
      for (const sourceMethodId of placement.methodIds) {
        const method = methodsById.get(sourceMethodId);
        const previewMethodId = methodIds.get(sourceMethodId);
        if (!method || !previewMethodId || !method.name.trim()) continue;
        const prices = placement.sizes.map((size) =>
          cents(method.pricing === "fixed" ? method.amount : (size.prices[sourceMethodId] ?? "")),
        );
        if (!prices.some((price) => price !== null)) continue;
        // Amounts have no known shop currency here. Retain only option availability.
        methodSizePrices[previewMethodId] = prices.map((price) => price === null ? null : 0);
        eligibleMethodIds.push(previewMethodId);
      }
      if (!eligibleMethodIds.length) continue;
      const firstFactor = widthFactors[0];
      if (firstFactor === undefined) continue;
      const movementArea = placement.customPlacementAllowed && placement.movementRect
        ? {
            x: placement.movementRect.centerX * 100,
            y: placement.movementRect.centerY * 100,
            width: placement.movementRect.width * 100,
            height: placement.movementRect.height * 100,
          }
        : undefined;
      positions.push({
        id: `preview-placement-${++positionIndex}`,
        name: placement.name.trim(),
        view: viewId,
        x: placement.rect.centerX * 100,
        y: placement.rect.centerY * 100,
        width: placement.rect.width * firstFactor,
        maximumHeight: placement.rect.height * firstFactor,
        ...(movementArea ? { movementArea } : {}),
        sizeLabels: placement.sizes.map((size) => size.name.trim()),
        price: 0,
        dimensions: widthFactors,
        sizePrices: widthFactors.map(() => 0),
        methodSizePrices,
        methodIds: eligibleMethodIds,
        artworkLater: placement.logoLaterAllowed,
      });
    }
  }

  if (!positions.length) {
    throw new AdminPreviewBuildError("no-valid-artwork-placements");
  }
  if (positions.length > 100) {
    throw new AdminPreviewBuildError("too-many-artwork-placements");
  }
  const usedMethods = new Set(positions.flatMap((position) => position.methodIds));
  const config = {
    id: "admin-current-draft",
    name: product.title.trim(),
    description: "Preview of the current product setup.",
    storeName: "Preview",
    productName: product.title.trim(),
    productDescription: "Current product draft",
    artworkOnly: true,
    // Required internal model placeholders. Artwork-only rendering must never show
    // these as shop currency, a base price, a variant size or purchasable quantity.
    basePrice: 0,
    currency: "EUR",
    locale: "en-GB",
    preview: "photo" as const,
    maxQuantity: 1,
    artworkLater: false,
    sizes: [{ id: "preview-size", label: "Artwork preview" }],
    colors: [{
      id: "product-image",
      name: productImageLabel,
      nameSource: "admin-preview-product-image",
      availableSizeIds: ["preview-size"],
      images,
    }],
    views,
    positions,
    methods: product.methods
      .map((method, index) => ({ id: methodIds.get(method.id)!, label: method.name, surcharge: 0 }))
      .filter((method) => usedMethods.has(method.id)),
  };
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) throw new AdminPreviewBuildError("unrepresentable-artwork-setup");
  return parsed.data;
}

function readCachedProduct(key: string): PlacementProductSnapshot | null {
  try {
    const value = sessionStorage.getItem(key);
    if (!value) return null;
    const cached = cacheSchema.safeParse(JSON.parse(value));
    if (!cached.success || cached.data.expiresAt <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cached.data.product;
  } catch {
    return null;
  }
}

function cacheProduct(key: string, product: PlacementProductSnapshot): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + sessionTtlMs, product }));
  } catch {
    // The current message still renders if browser storage is unavailable.
  }
}

function PreviewMessage({
  title,
  message,
  context,
  loading = false,
}: {
  title: string;
  message: string;
  context: string;
  loading?: boolean;
}) {
  return (
    <main className="admin-preview-message">
      <section aria-live={loading ? "polite" : undefined} role={loading ? "status" : "alert"}>
        <p className="admin-preview-context">{context}</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

function previewFailureMessage(
  reason: AdminPreviewFailureReason,
  t: ReturnType<typeof createAdminTranslator>["t"],
): string {
  switch (reason) {
    case "reopen-from-editor": return t("admin-preview:preview.reopenFromEditor");
    case "expired": return t("admin-preview:preview.expired");
    case "draft-did-not-arrive": return t("admin-preview:preview.draftDidNotArrive");
    case "draft-could-not-be-previewed":
    case "invalid-image-source": return t("admin-preview:preview.draftCouldNotBePreviewed");
    case "unrepresentable-draft-data": return t("admin-preview:preview.unrepresentableDraftData");
    case "empty-product-name": return t("admin-preview:preview.emptyProductName");
    case "no-product-views": return t("admin-preview:preview.noProductViews");
    case "missing-image-for-placed-view": return t("admin-preview:preview.missingImageForPlacedView");
    case "no-product-image": return t("admin-preview:preview.noProductImage");
    case "unnamed-product-view": return t("admin-preview:preview.unnamedProductView");
    case "unmappable-product-view": return t("admin-preview:preview.unmappableProductView");
    case "no-valid-artwork-placements": return t("admin-preview:preview.noValidArtworkPlacements");
    case "too-many-artwork-placements": return t("admin-preview:preview.tooManyArtworkPlacements");
    case "unrepresentable-artwork-setup": return t("admin-preview:preview.unrepresentableArtworkSetup");
  }
}

function buildReadyPreview(
  product: PlacementProductSnapshot,
  adminOrigin: string,
  productImageLabel: string,
): Extract<PreviewState, { status: "ready" }> {
  const config = buildCustomerPreviewConfig(product, adminOrigin, productImageLabel);
  return {
    status: "ready",
    config,
    availablePlacementCount: config.positions.length,
    totalPlacementCount: product.views.reduce(
      (count, view) => count + view.placements.length,
      0,
    ),
  };
}

function failureReason(error: unknown): AdminPreviewFailureReason {
  return error instanceof AdminPreviewBuildError
    ? error.reason
    : "draft-could-not-be-previewed";
}

export function adminPreviewNoticeMessage(
  availableCount: number,
  totalCount: number,
  t: ReturnType<typeof createAdminTranslator>["t"],
): string {
  return availableCount < totalCount
    ? t("admin-preview:preview.previewNoticeWithPlacements", {
        count: totalCount,
        availableCount,
        totalCount,
      })
    : t("admin-preview:preview.previewNotice");
}

export function AdminPreview({
  nonce,
  locale,
}: {
  nonce: string | null;
  /** Merchant language supplied by the editor that launched this document. */
  locale: string;
}) {
  const translator = useMemo(() => createAdminTranslator(locale), [locale]);
  const { t, lang, dir } = translator;
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    const previous = {
      title: document.title,
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
    };
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = t("admin-preview:preview.documentTitle");
    return () => {
      document.title = previous.title;
      document.documentElement.lang = previous.lang;
      document.documentElement.dir = previous.dir;
    };
  }, [dir, lang, t]);

  useEffect(() => {
    const token = nonceSchema.safeParse(nonce);
    const adminOrigin = originFor(new URL(window.location.href).searchParams.get("adminOrigin"));
    if (!token.success || !adminOrigin) {
      setState({ status: "error", reason: "reopen-from-editor" });
      return;
    }
    const previewNonce = token.data;
    const key = `insignia:customer-preview:v1:${previewNonce}`;
    const cached = readCachedProduct(key);
    if (cached) {
      try {
        setState(buildReadyPreview(
          cached,
          adminOrigin,
          t("admin-preview:preview.productImage"),
        ));
      } catch (error: unknown) {
        setState({ status: "error", reason: failureReason(error) });
      }
      return;
    }
    const opener = window.opener;
    if (!opener) {
      setState({ status: "error", reason: "expired" });
      return;
    }
    let done = false;
    const timeout = window.setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      setState({ status: "error", reason: "draft-did-not-arrive" });
    }, 10_000);
    function onMessage(event: MessageEvent<unknown>) {
      if (event.source !== opener || event.origin !== adminOrigin) return;
      const parsed = readArtworkPreviewMessage(event.data, previewNonce);
      if (parsed.status === "ignored") return;
      done = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (parsed.status === "error") {
        setState({ status: "error", reason: parsed.reason });
        return;
      }
      const product = structuredClone(parsed.product);
      cacheProduct(key, product);
      try {
        setState(buildReadyPreview(
          product,
          adminOrigin,
          t("admin-preview:preview.productImage"),
        ));
        window.opener = null;
      } catch (error: unknown) {
        setState({ status: "error", reason: failureReason(error) });
      }
    }
    window.addEventListener("message", onMessage);
    opener.postMessage({ type: "insignia:customer-preview:ready", nonce: token.data }, adminOrigin);
    return () => {
      done = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
  }, [nonce]);

  if (state.status === "loading") {
    return <PreviewMessage
      title={t("admin-preview:preview.loadingTitle")}
      message={t("admin-preview:preview.waitingForDraft")}
      context={t("admin-preview:preview.context")}
      loading
    />;
  }
  if (state.status === "error") {
    return <PreviewMessage
      title={t("admin-preview:preview.unavailableTitle")}
      message={previewFailureMessage(state.reason, t)}
      context={t("admin-preview:preview.context")}
    />;
  }
  const previewNotice = adminPreviewNoticeMessage(
    state.availablePlacementCount,
    state.totalPlacementCount,
    t,
  );
  return (
    <LocalDesigner
      config={state.config}
      showExample={false}
      onLocationChange={() => undefined}
      previewOnly
      locale={locale}
      previewContextLabel={t("admin-preview:preview.context")}
      previewNotice={previewNotice}
      previewProductImageLabel={t("admin-preview:preview.productImage")}
    />
  );
}
