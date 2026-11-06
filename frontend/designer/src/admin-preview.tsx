import { useEffect, useMemo, useState } from "preact/hooks";
import { createAdminTranslator } from "@insignia/ui-localization/admin";
import type { ProductConfig } from "./config";
import { LocalDesigner } from "./demo/local-designer";

import { AdminPreviewBuildError, buildCustomerPreviewConfig, cacheSchema, nonceSchema, readArtworkPreviewMessage, type AdminPreviewFailureReason, type PlacementProductSnapshot } from "./artwork-preview-config";
export { AdminPreviewBuildError, buildCustomerPreviewConfig, readArtworkPreviewMessage } from "./artwork-preview-config";
export type { AdminPreviewFailureReason } from "./artwork-preview-config";
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
