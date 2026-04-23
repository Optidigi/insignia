/**
 * Image Manager Route
 *
 * Loader: Fetches product config, Shopify variants, color groups, and image matrix.
 * Action: Handles set-view-default, save-image, and remove-image intents.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  data,
  useLoaderData,
  useSubmit,
  useNavigation,
  useRevalidator,
} from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  groupVariantsByColor,
  getImageMatrix,
  setViewDefault,
} from "../lib/services/image-manager.server";
import { getPresignedGetUrl } from "../lib/storage.server";
import { handleError, Errors } from "../lib/errors.server";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const productConfigId = params.id!;

    // Resolve shop DB UUID from Shopify domain
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) throw Errors.notFound("Shop");

    // Fetch product config with views
    const config = await db.productConfig.findFirst({
      where: { id: productConfigId, shopId: shop.id },
      include: {
        views: { orderBy: { displayOrder: "asc" } },
      },
    });
    if (!config) throw Errors.notFound("Product setup");

    // Fetch linked Shopify product for variants
    const shopifyProductId = config.linkedProductIds[0];
    if (!shopifyProductId) {
      return data({
        config,
        views: config.views,
        colorGroups: [],
        cells: [],
        viewImageCounts: {} as Record<string, { filled: number; total: number }>,
        shopName: session.shop,
        r2Configured: !!(
          process.env.R2_ACCOUNT_ID &&
          process.env.R2_ACCESS_KEY_ID &&
          process.env.R2_SECRET_ACCESS_KEY
        ),
        isDev: process.env.NODE_ENV !== "production",
      });
    }

    // Fetch variants from Shopify
    const variantResponse = await admin.graphql(
      `#graphql
      query GetVariants($productId: ID!) {
        product(id: $productId) {
          variants(first: 250) {
            nodes {
              id
              selectedOptions { name value }
            }
          }
        }
      }`,
      { variables: { productId: shopifyProductId } }
    );

    const variantData = await variantResponse.json();
    const variants = variantData.data?.product?.variants?.nodes ?? [];
    const colorGroups = groupVariantsByColor(variants);

    // Get image matrix (resolves URLs and defaults)
    const cells = await getImageMatrix(productConfigId, config.views, colorGroups);

    // Generate presigned GET URLs for cells that have images (1-hour TTL for admin)
    const ADMIN_SIGNED_URL_EXPIRES_SEC = 3600;
    const cellsWithUrls = await Promise.all(
      cells.map(async (cell) => {
        let resolvedImageUrl: string | null = null;
        if (cell.imageUrl) {
          try {
            resolvedImageUrl = await getPresignedGetUrl(cell.imageUrl, ADMIN_SIGNED_URL_EXPIRES_SEC);
          } catch (err) {
            console.warn(`[images] presign failed for key ${cell.imageUrl}:`, err);
            resolvedImageUrl = null;
          }
        }
        return { ...cell, imageUrl: resolvedImageUrl };
      })
    );

    // Compute per-view image counts for tab badges
    const viewImageCounts: Record<string, { filled: number; total: number }> = {};
    for (const view of config.views) {
      const viewCells = cellsWithUrls.filter((c) => c.viewId === view.id);
      viewImageCounts[view.id] = {
        filled: viewCells.filter((c) => c.imageUrl !== null).length,
        total: viewCells.length,
      };
    }

    const r2Configured = !!(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
    );
    const isDev = process.env.NODE_ENV !== "production";

    return data({
      config,
      views: config.views,
      colorGroups,
      cells: cellsWithUrls,
      viewImageCounts,
      shopName: session.shop,
      r2Configured,
      isDev,
    });
  } catch (error) {
    throw handleError(error);
  }
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const productConfigId = params.id!;

    // Resolve shop DB UUID from Shopify domain
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) return Errors.notFound("Shop");

    // Verify ownership
    const config = await db.productConfig.findFirst({
      where: { id: productConfigId, shopId: shop.id },
      select: { id: true },
    });
    if (!config) return Errors.notFound("Product setup");

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "set-view-default") {
      const viewId = formData.get("viewId") as string;
      const storageKey = formData.get("storageKey") as string;

      // Verify view belongs to this product config AND this shop (defense-in-depth)
      const view = await db.productView.findFirst({
        where: { id: viewId, productConfig: { id: productConfigId, shopId: shop.id } },
        select: { id: true },
      });
      if (!view) return Errors.notFound("View");

      await setViewDefault(viewId, storageKey);
      return data({ success: true, intent: "set-view-default" });
    }

    if (intent === "save-image") {
      const viewId = formData.get("viewId") as string;
      const variantId = formData.get("variantId") as string;
      const imageKey = formData.get("imageKey") as string;

      if (!viewId || !variantId || !imageKey) {
        return Errors.badRequest("Missing required fields");
      }

      // Verify viewId belongs to this productConfig (which is already shop-scoped).
      // Without this, a crafted request could associate this shop's productConfig
      // with another shop's viewId, corrupting both shops' data.
      const view = await db.productView.findFirst({
        where: { id: viewId, productConfigId },
        select: { id: true },
      });
      if (!view) return Errors.notFound("View");

      await db.variantViewConfiguration.upsert({
        where: {
          productConfigId_variantId_viewId: { productConfigId, variantId, viewId },
        },
        create: { productConfigId, variantId, viewId, imageUrl: imageKey },
        update: { imageUrl: imageKey },
      });
      return data({ success: true, intent: "save-image" });
    }

    if (intent === "remove-image") {
      const viewId = formData.get("viewId") as string;
      const variantId = formData.get("variantId") as string;

      if (!viewId || !variantId) {
        return Errors.badRequest("Missing required fields");
      }

      // Same shop-scoping requirement as save-image above.
      const view = await db.productView.findFirst({
        where: { id: viewId, productConfigId },
        select: { id: true },
      });
      if (!view) return Errors.notFound("View");

      await db.variantViewConfiguration.updateMany({
        where: { productConfigId, variantId, viewId },
        data: { imageUrl: null },
      });
      return data({ success: true, intent: "remove-image" });
    }

    return Errors.badRequest("Invalid intent");
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Component
// ============================================================================

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ProgressBar,
  EmptyState,
  Banner,
  Popover,
  ActionList,
  SkeletonPage,
  SkeletonBodyText,
} from "@shopify/polaris";
import type { ImageCell } from "../lib/services/image-manager.server";

// Maps common color names (lowercase) to a CSS hex color for the swatch dot.
// Unknown colors fall back to a neutral gray dot.
const COLOR_HEX_MAP: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#DC2626",
  blue: "#2563EB",
  navy: "#1E3A5F",
  "navy blue": "#1E3A5F",
  green: "#16A34A",
  "forest green": "#166534",
  yellow: "#EAB308",
  orange: "#F97316",
  purple: "#7C3AED",
  pink: "#EC4899",
  brown: "#92400E",
  grey: "#6B7280",
  gray: "#6B7280",
  teal: "#0D9488",
  cyan: "#06B6D4",
  lime: "#84CC16",
  gold: "#B45309",
  silver: "#9CA3AF",
  maroon: "#7F1D1D",
  beige: "#D4A373",
  burgundy: "#800020",
  turquoise: "#06B6D4",
  coral: "#F87171",
  mint: "#6EE7B7",
  lavender: "#C4B5FD",
  cream: "#FFFDD0",
  khaki: "#BDB76B",
  charcoal: "#374151",
  ivory: "#F5F5DC",
  sand: "#C2B280",
};

function colorNameToHex(name: string): string | null {
  return COLOR_HEX_MAP[name.toLowerCase().trim()] ?? null;
}
import { ImageTray, type TrayImage } from "../components/ImageTray";

// Module-level helper — no component dependencies
function cellKey(cell: ImageCell) {
  return `${cell.viewId}:${cell.colorValue}`;
}

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/tiff",
  "image/heic",
];

type UploadJob = {
  id: string;
  file: File;
  cell: ImageCell;
  status: "queued" | "uploading" | "complete" | "error";
  progress: number;
  retryCount: number;
};

const MAX_CONCURRENT = 4;

export default function ImageManagerPage() {
  const { config, views, colorGroups, cells, viewImageCounts, r2Configured, isDev } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const [uploadQueue, setUploadQueue] = useState<UploadJob[]>([]);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [copyPopoverCell, setCopyPopoverCell] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [trayImages, setTrayImages] = useState<TrayImage[]>([]);
  const [draggedTrayImage, setDraggedTrayImage] = useState<TrayImage | null>(null);
  const [selectedTrayImageId, setSelectedTrayImageId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importTruncated, setImportTruncated] = useState(false);
  const pendingSaves = useRef<Array<{ viewId: string; variantId: string; storageKey: string }>>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When navigation returns to idle, clear completed upload jobs
  useEffect(() => {
    if (navigation.state === "idle" && pendingKeys.size > 0) {
      setUploadQueue((q) =>
        q.filter((j) => !pendingKeys.has(cellKey(j.cell)) || j.status !== "complete")
      );
      setPendingKeys(new Set());
    }
  }, [navigation.state, pendingKeys]);

  // ---- Computed ----

  const totalFilled = Object.values(viewImageCounts).reduce(
    (sum, c) => sum + c.filled,
    0
  );
  const totalCells = Object.values(viewImageCounts).reduce(
    (sum, c) => sum + c.total,
    0
  );
  const progressPercent = totalCells > 0 ? (totalFilled / totalCells) * 100 : 0;
  const allComplete = totalCells > 0 && totalFilled === totalCells;

  // ---- Batched save ----

  const queueSave = useCallback((viewId: string, variantId: string, storageKey: string) => {
    pendingSaves.current.push({ viewId, variantId, storageKey });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const batch = [...pendingSaves.current];
      pendingSaves.current = [];
      await fetch("/api/admin/batch-save-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productConfigId: config.id,
          images: batch.map((s) => ({
            viewId: s.viewId,
            variantIds: [s.variantId],
            storageKey: s.storageKey,
          })),
        }),
      });
      revalidator.revalidate(); // ONE revalidation for the whole batch
    }, 500);
  }, [config.id, revalidator]);

  // ---- Upload processor ----

  const processUpload = useCallback(async (job: UploadJob) => {
    setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "uploading" } : j));
    try {
      // Get presigned URL
      const urlRes = await fetch("/api/admin/batch-upload-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productConfigId: config.id,
          items: [{ viewId: job.cell.viewId, variantId: job.cell.variantIds[0], contentType: job.file.type, fileName: job.file.name }],
        }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { items } = await urlRes.json();
      const { uploadUrl, storageKey } = items[0];

      // Upload with XHR progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, progress: Math.round((e.loaded / e.total) * 100) } : j));
          }
        });
        xhr.addEventListener("load", () => (xhr.status < 400 ? resolve() : reject(new Error(`HTTP ${xhr.status}`))));
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", job.file.type);
        xhr.send(job.file);
      });

      // Queue save reference for batched revalidation
      queueSave(job.cell.viewId, job.cell.variantIds[0], storageKey);

      setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "complete", progress: 100 } : j));
      setPendingKeys((prev) => new Set([...prev, cellKey(job.cell)]));
    } catch {
      setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "error" } : j));
    }
  }, [config.id, queueSave]);

  // Queue processor effect — runs up to MAX_CONCURRENT uploads at once
  useEffect(() => {
    const activeCount = uploadQueue.filter((j) => j.status === "uploading").length;
    const queued = uploadQueue.filter((j) => j.status === "queued");
    if (activeCount < MAX_CONCURRENT && queued.length > 0) {
      processUpload(queued[0]);
    }
  }, [uploadQueue, processUpload]);

  // ---- Upload handler ----

  const handleUpload = useCallback((file: File, cell: ImageCell) => {
    // Validate first
    if (file.size > 10 * 1024 * 1024) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.shopify?.toast?.show("File must be under 10 MB", { isError: true });
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.shopify?.toast?.show("Unsupported file type", { isError: true });
      return;
    }
    const job: UploadJob = {
      id: `${Date.now()}-${Math.random()}`,
      file,
      cell,
      status: "queued",
      progress: 0,
      retryCount: 0,
    };
    setUploadQueue((q) => [...q, job]);
  }, []);

  const handleFileChange = useCallback(
    (cell: ImageCell) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file, cell);
      // Reset input so re-selecting the same file triggers onChange
      e.target.value = "";
    },
    [handleUpload]
  );

  // Re-queue a failed job using the original File — no need to re-select
  const handleRetry = useCallback((job: UploadJob) => {
    setUploadQueue((q) =>
      q.map((j) =>
        j.id === job.id ? { ...j, status: "queued", progress: 0, retryCount: j.retryCount + 1 } : j
      )
    );
  }, []);

  const handleRemoveImage = useCallback(
    (cell: ImageCell) => {
      const fd = new FormData();
      fd.set("intent", "remove-image");
      fd.set("viewId", cell.viewId);
      fd.set("variantId", cell.variantIds[0]);
      submit(fd, { method: "POST" });
    },
    [submit]
  );

  const handleSetViewDefault = useCallback(
    (cell: ImageCell) => {
      if (!cell.imageUrl) return;
      const fd = new FormData();
      fd.set("intent", "set-view-default");
      fd.set("viewId", cell.viewId);
      fd.set("storageKey", cell.imageUrl);
      submit(fd, { method: "POST" });
    },
    [submit]
  );

  // ---- Copy/Apply handlers ----

  const handleApplyToAllEmpty = useCallback(async (sourceCell: ImageCell) => {
    const key = sourceCell.imageUrl;
    if (!key) return;
    // Find all empty cells across all color groups for this view
    const emptyTargets = cells.filter((c: ImageCell) => !c.imageUrl && c.viewId === sourceCell.viewId && c.colorValue !== sourceCell.colorValue);
    if (emptyTargets.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.shopify?.toast?.show("No empty cells to fill");
      return;
    }
    try {
      const res = await fetch("/api/admin/batch-save-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productConfigId: config.id,
          images: emptyTargets.map((c: ImageCell) => ({
            viewId: c.viewId,
            variantIds: c.variantIds,
            storageKey: key,
          })),
        }),
      });
      if (res.ok) {
        revalidator.revalidate();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.shopify?.toast?.show(`Applied to ${emptyTargets.length} cells`);
      }
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.shopify?.toast?.show("Failed to apply image", { isError: true });
    }
  }, [cells, config.id, revalidator]);

  const handleCopyToCell = useCallback(async (sourceCell: ImageCell, targetCell: ImageCell) => {
    const key = sourceCell.imageUrl;
    if (!key) return;
    try {
      const res = await fetch("/api/admin/batch-save-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productConfigId: config.id,
          images: [{ viewId: targetCell.viewId, variantIds: targetCell.variantIds, storageKey: key }],
        }),
      });
      if (res.ok) revalidator.revalidate();
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.shopify?.toast?.show("Failed to copy image", { isError: true });
    }
  }, [config.id, revalidator]);

  // ---- Import from Shopify ----

  const handleImportFromShopify = useCallback(async () => {
    const shopifyProductId = config.linkedProductIds[0];
    if (!shopifyProductId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.shopify as any)?.toast?.show("No Shopify product linked", { isError: true });
      return;
    }
    setIsImporting(true);
    setImportTruncated(false);
    try {
      // Flush any pending debounced saves before reading `cells` for auto-assignment.
      // Best-effort: prevents auto-assign from overwriting an image just uploaded
      // but whose revalidation hasn't settled into `cells` state yet.
      if (pendingSaves.current.length > 0) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        const batch = [...pendingSaves.current];
        pendingSaves.current = [];
        await fetch("/api/admin/batch-save-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productConfigId: config.id,
            images: batch.map((s) => ({
              viewId: s.viewId,
              variantIds: [s.variantId],
              storageKey: s.storageKey,
            })),
          }),
        });
        revalidator.revalidate();
      }

      const res = await fetch("/api/admin/import-shopify-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productConfigId: config.id, shopifyProductId }),
      });
      if (!res.ok) throw new Error("Import failed");
      const { imported, truncated } = await res.json() as {
        imported: Array<{ storageKey: string; previewUrl: string; colorOption: string }>;
        truncated: boolean;
      };

      if (imported.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.shopify as any)?.toast?.show("No images found on Shopify product");
        return;
      }

      // Match each imported image to a color group; build auto-assign list and tray remainder.
      // Matching is case-insensitive against colorGroup.colorValue.
      const autoAssignImages: Array<{ viewId: string; variantIds: string[]; storageKey: string }> = [];
      const unmatched: TrayImage[] = [];

      for (const img of imported) {
        const matchingGroup = colorGroups.find(
          (g) => g.colorValue.toLowerCase() === img.colorOption.toLowerCase()
        );
        if (matchingGroup) {
          let anyAssigned = false;
          for (const view of views) {
            const existingCell = cells.find(
              (c: ImageCell) => c.colorValue === matchingGroup.colorValue && c.viewId === view.id
            );
            // Only auto-assign to cells that have no real image (null or default fallback)
            if (!existingCell?.imageUrl || existingCell.isDefault) {
              autoAssignImages.push({
                viewId: view.id,
                variantIds: matchingGroup.variantIds,
                storageKey: img.storageKey,
              });
              anyAssigned = true;
            }
          }
          if (!anyAssigned) {
            // All cells for this color already have real images — put in tray rather than
            // silently discard so the merchant can handle it manually if needed.
            unmatched.push({
              id: `import-${img.storageKey}`,
              storageKey: img.storageKey,
              previewUrl: img.previewUrl,
              originalFileName: img.colorOption,
            });
          }
        } else {
          unmatched.push({
            id: `import-${img.storageKey}`,
            storageKey: img.storageKey,
            previewUrl: img.previewUrl,
            originalFileName: img.colorOption,
          });
        }
      }

      // Single consolidated POST for all auto-assigned cells
      if (autoAssignImages.length > 0) {
        try {
          const autoRes = await fetch("/api/admin/batch-save-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productConfigId: config.id, images: autoAssignImages }),
          });
          if (!autoRes.ok) throw new Error(`batch-save failed: ${autoRes.status}`);
          revalidator.revalidate();
        } catch (err) {
          console.error("[handleImportFromShopify] auto-assign batch failed:", err);
          // Fallback: move all matched items to tray so nothing is silently lost
          for (const img of imported) {
            if (!unmatched.some((u) => u.storageKey === img.storageKey)) {
              unmatched.push({
                id: `import-${img.storageKey}`,
                storageKey: img.storageKey,
                previewUrl: img.previewUrl,
                originalFileName: img.colorOption,
              });
            }
          }
        }
      }

      if (unmatched.length > 0) {
        setTrayImages((prev) => [...prev, ...unmatched]);
      }

      setImportTruncated(!!truncated);

      // Smart toast: report what happened
      const autoCount = imported.length - unmatched.length;
      if (autoCount > 0 && unmatched.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.shopify as any)?.toast?.show(
          `${autoCount} auto-assigned, ${unmatched.length} added to tray`
        );
      } else if (autoCount > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.shopify as any)?.toast?.show(
          `${autoCount} image${autoCount !== 1 ? "s" : ""} auto-assigned`
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.shopify as any)?.toast?.show(
          `${imported.length} image${imported.length !== 1 ? "s" : ""} imported — drag to assign`
        );
      }
    } catch (err) {
      console.error("[handleImportFromShopify] import failed", err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.shopify as any)?.toast?.show("Import failed — check network and try again", { isError: true });
    } finally {
      setIsImporting(false);
    }
  }, [config.id, config.linkedProductIds, colorGroups, views, cells, revalidator]);

  // ---- Tray DnD handler ----

  const handleCellDrop = useCallback(
    (cell: ImageCell) => {
      if (draggedTrayImage && draggedTrayImage.storageKey) {
        handleCopyToCell(
          { ...cell, imageUrl: draggedTrayImage.storageKey } as ImageCell,
          cell
        );
        const removedId = draggedTrayImage.id;
        setDraggedTrayImage(null);
        setTrayImages((prev) => prev.filter((img) => img.id !== removedId));
      }
    },
    [draggedTrayImage, handleCopyToCell]
  );

  // ---- Empty states ----

  if (views.length === 0) {
    return (
      <Page
        title="Image Manager"
        subtitle={config.name}
        backAction={{ content: "Back", url: `/app/products/${config.id}` }}
      >
        <EmptyState
          heading="Add views first"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          action={{
            content: "Go to product setup",
            url: `/app/products/${config.id}`,
          }}
        >
          <p>
            Create at least one view (e.g. Front, Back) before uploading
            variant images.
          </p>
        </EmptyState>
      </Page>
    );
  }

  if (colorGroups.length === 0) {
    return (
      <Page
        title="Image Manager"
        subtitle={config.name}
        backAction={{ content: "Back", url: `/app/products/${config.id}` }}
      >
        <EmptyState
          heading="Link a Shopify product"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          action={{
            content: "Go to product setup",
            url: `/app/products/${config.id}`,
          }}
        >
          <p>
            Link a Shopify product to see color variants and upload images for
            each one.
          </p>
        </EmptyState>
      </Page>
    );
  }

  if (navigation.state === "loading") {
    return (
      <SkeletonPage primaryAction>
        <BlockStack gap="400">
          <SkeletonBodyText lines={3} />
          <SkeletonBodyText lines={3} />
        </BlockStack>
      </SkeletonPage>
    );
  }

  return (
    <Page
      title="Image Manager"
      subtitle={config.name}
      backAction={{ content: "Back", url: `/app/products/${config.id}` }}
      secondaryActions={[
        {
          content: "Import from Shopify",
          loading: isImporting,
          disabled: !config.linkedProductIds[0],
          onAction: handleImportFromShopify,
        },
      ]}
    >
      <BlockStack gap="500">
        {isDev && !r2Configured && (
          <Banner tone="warning" title="Image storage not configured">
            <p>
              R2 credentials are missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and
              R2_SECRET_ACCESS_KEY in .env to enable image thumbnails.
            </p>
          </Banner>
        )}

        {/* ---- Progress with per-view breakdown ---- */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" as="p">
                {totalFilled} of {totalCells} images assigned
              </Text>
              <Badge tone={allComplete ? "success" : "attention"}>
                {`${Math.round(progressPercent)}%`}
              </Badge>
            </InlineStack>
            <ProgressBar progress={progressPercent} tone="primary" size="small" />
            <InlineStack gap="300" wrap>
              {views.map((view: (typeof views)[number]) => {
                const counts = viewImageCounts[view.id] ?? { filled: 0, total: 0 };
                const viewComplete = counts.total > 0 && counts.filled === counts.total;
                return (
                  <InlineStack key={view.id} gap="100" blockAlign="center">
                    <Text variant="bodySm" tone="subdued" as="span">
                      {view.name || view.perspective}
                    </Text>
                    <Badge tone={viewComplete ? "success" : "attention"} size="small">
                      {`${counts.filled}/${counts.total}`}
                    </Badge>
                  </InlineStack>
                );
              })}
            </InlineStack>
          </BlockStack>
        </Card>

        {allComplete && (
          <Banner tone="success">
            All images assigned. Your product views are fully covered.
          </Banner>
        )}

        {importTruncated && (
          <Banner tone="warning" onDismiss={() => setImportTruncated(false)}>
            Only the first 100 variants were imported. Your product may have
            more — import again or upload manually.
          </Banner>
        )}

        {/* ---- Staging Tray (or import banner when empty) ---- */}
        {trayImages.length === 0 && config.linkedProductIds[0] && !allComplete && (
          <Banner
            tone="info"
            action={{
              content: "Import to Tray",
              loading: isImporting,
              onAction: handleImportFromShopify,
            }}
          >
            <p>
              Import your Shopify product images into the staging tray, then drag each one to the correct slot below.
            </p>
          </Banner>
        )}
        <ImageTray
          images={trayImages}
          onBulkUpload={async (files) => {
            await Promise.all(
              Array.from(files).map(async (file) => {
                // Show preview immediately while uploading
                const preview = URL.createObjectURL(file);
                const imgId = `tray-${Date.now()}-${Math.random()}`;
                const placeholder: TrayImage = {
                  id: imgId,
                  storageKey: "",
                  previewUrl: preview,
                  originalFileName: file.name,
                };
                setTrayImages((prev) => [...prev, placeholder]);

                try {
                  // Get presigned URL from server
                  const fd = new FormData();
                  fd.set("intent", "tray-upload");
                  fd.set("productConfigId", config.id);
                  fd.set("contentType", file.type);
                  fd.set("fileName", file.name);
                  const urlRes = await fetch("/api/admin/upload-url", {
                    method: "POST",
                    body: fd,
                  });
                  if (!urlRes.ok) throw new Error("Failed to get upload URL");
                  const { uploadUrl, key } = (await urlRes.json()) as {
                    uploadUrl: string;
                    key: string;
                    success: boolean;
                  };

                  // PUT file directly to R2
                  const putRes = await fetch(uploadUrl, {
                    method: "PUT",
                    headers: { "Content-Type": file.type },
                    body: file,
                  });
                  if (!putRes.ok) throw new Error(`R2 upload failed: ${putRes.status}`);

                  // Stamp the real storageKey onto the tray image
                  setTrayImages((prev) =>
                    prev.map((img) =>
                      img.id === imgId ? { ...img, storageKey: key } : img
                    )
                  );
                } catch {
                  // Remove the placeholder so the merchant can try again
                  setTrayImages((prev) => prev.filter((img) => img.id !== imgId));
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window.shopify as any)?.toast?.show(
                    `Failed to upload ${file.name}`,
                    { isError: true }
                  );
                }
              })
            );
          }}
          onDragStart={(img) => setDraggedTrayImage(img)}
          onSelect={(img) => setSelectedTrayImageId(img?.id ?? null)}
          selectedImageId={selectedTrayImageId}
        />

        {/* ---- Color Cards ---- */}
        {colorGroups.map((group) => {
          const groupCells = cells.filter(
            (c: ImageCell) => c.colorValue === group.colorValue
          );
          const filledCount = groupCells.filter(
            (c: ImageCell) => c.imageUrl
          ).length;
          const totalCount = groupCells.length;
          const isGroupComplete =
            totalCount > 0 && filledCount === totalCount;

          return (
            <Card key={group.colorValue}>
              <BlockStack gap="300">
                {/* Card header: color swatch + name + sizes + completion */}
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    {group.colorOptionName !== "" && (
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          backgroundColor: colorNameToHex(group.colorValue) ?? "var(--p-color-bg-fill-secondary)",
                          border: "1px solid rgba(0,0,0,0.15)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Text variant="headingSm" as="h3">
                      {group.colorValue === "Default" ? "Default variant" : group.colorValue}
                    </Text>
                    {group.sizeValues.length > 0 && (
                      <Text variant="bodySm" tone="subdued" as="span">
                        {group.sizeValues.join(", ")}
                      </Text>
                    )}
                  </InlineStack>
                  <Badge
                    tone={isGroupComplete ? "success" : "attention"}
                    size="small"
                  >
                    {isGroupComplete
                      ? `✓ ${filledCount}/${totalCount}`
                      : `${filledCount}/${totalCount}`}
                  </Badge>
                </InlineStack>

                {/* Thumbnail row: one slot per view */}
                <InlineStack gap="300" wrap>
                  {groupCells.map((cell: ImageCell) => {
                    const key = cellKey(cell);
                    const viewLabel = (() => {
                      const v = views.find((v: (typeof views)[number]) => v.id === cell.viewId);
                      return v ? (v.name || v.perspective) : "";
                    })();
                    const job = [...uploadQueue]
                      .reverse()
                      .find((j) => cellKey(j.cell) === key);
                    const isUploading =
                      job?.status === "uploading" ||
                      job?.status === "queued";
                    const hasError = job?.status === "error";
                    const uploadProgress = job?.progress ?? 0;

                    // "Copy to [view]" — other views in same color group
                    const sameColorOtherViews = groupCells.filter(
                      (c: ImageCell) => c.viewId !== cell.viewId
                    );
                    // "Copy to [color]" — same view in other color groups
                    const sameViewOtherColors = cells.filter(
                      (c: ImageCell) =>
                        c.viewId === cell.viewId &&
                        c.colorValue !== cell.colorValue
                    );

                    return (
                      <BlockStack key={key} gap="100" inlineAlign="center">
                        {/* View label */}
                        <Text
                          variant="bodySm"
                          tone="subdued"
                          as="span"
                        >
                          {viewLabel}
                        </Text>

                        {/* Thumbnail cell */}
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={
                            cell.imageUrl && !cell.isDefault
                              ? `${group.colorValue} ${viewLabel} — click for actions`
                              : `Upload ${group.colorValue} ${viewLabel}`
                          }
                          style={{
                            width: 100,
                            height: 80,
                            borderRadius: 6,
                            border: hasError
                              ? "2px solid var(--p-color-border-critical)"
                              : isUploading
                                ? "2px solid var(--p-color-border-info)"
                                : cell.imageUrl && !cell.isDefault
                                  ? "1px solid var(--p-color-border)"
                                  : "1px dashed var(--p-color-border)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                            overflow: "hidden",
                            cursor: "pointer",
                            opacity: cell.isDefault ? 0.5 : 1,
                            backgroundImage:
                              cell.imageUrl
                                ? `url(${cell.imageUrl})`
                                : undefined,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedTrayImage) {
                              e.currentTarget.style.outline =
                                "2px solid var(--p-color-border-brand)";
                            }
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.style.outline = "none";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.style.outline = "none";
                            handleCellDrop(cell);
                          }}
                          onClick={() => {
                            if (selectedTrayImageId) {
                              const trayImg = trayImages.find(
                                (img) => img.id === selectedTrayImageId
                              );
                              if (trayImg?.storageKey) {
                                handleCopyToCell(
                                  {
                                    ...cell,
                                    imageUrl: trayImg.storageKey,
                                  } as ImageCell,
                                  cell
                                );
                                setSelectedTrayImageId(null);
                                setTrayImages((prev) =>
                                  prev.filter(
                                    (img) =>
                                      img.id !== selectedTrayImageId
                                  )
                                );
                              }
                            } else if (
                              !cell.imageUrl ||
                              cell.isDefault
                            ) {
                              fileInputRefs.current[key]?.click();
                            }
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" ||
                              e.key === " "
                            ) {
                              e.preventDefault();
                              if (selectedTrayImageId) {
                                const trayImg = trayImages.find(
                                  (img) =>
                                    img.id === selectedTrayImageId
                                );
                                if (trayImg?.storageKey) {
                                  handleCopyToCell(
                                    {
                                      ...cell,
                                      imageUrl: trayImg.storageKey,
                                    } as ImageCell,
                                    cell
                                  );
                                  setSelectedTrayImageId(null);
                                  setTrayImages((prev) =>
                                    prev.filter(
                                      (img) =>
                                        img.id !==
                                        selectedTrayImageId
                                    )
                                  );
                                }
                              } else if (
                                !cell.imageUrl ||
                                cell.isDefault
                              ) {
                                fileInputRefs.current[key]?.click();
                              }
                            }
                          }}
                        >
                          {/* Hidden file input — the empty-cell label below
                              activates it so the browser treats the click as a
                              direct user gesture even inside iframes */}
                          <input
                            id={`file-${key}`}
                            ref={(el) => {
                              fileInputRefs.current[key] = el;
                            }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            style={{ display: "none" }}
                            onChange={handleFileChange(cell)}
                          />

                          {/* Uploading state */}
                          {isUploading && (
                            <BlockStack
                              gap="100"
                              inlineAlign="center"
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                tone="subdued"
                              >
                                {job?.status === "queued"
                                  ? "Queued"
                                  : `${uploadProgress}%`}
                              </Text>
                              <div style={{ width: 52 }}>
                                <ProgressBar
                                  progress={
                                    job?.status === "queued"
                                      ? 0
                                      : uploadProgress
                                  }
                                  tone="primary"
                                  size="small"
                                />
                              </div>
                            </BlockStack>
                          )}

                          {/* Error state */}
                          {hasError && !isUploading && (
                            <BlockStack
                              gap="100"
                              inlineAlign="center"
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                tone="critical"
                              >
                                Failed
                              </Text>
                              <div role="presentation" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="slim"
                                  onClick={() => {
                                    if (job) handleRetry(job);
                                  }}
                                >
                                  Retry
                                </Button>
                              </div>
                            </BlockStack>
                          )}

                          {/* Empty cell — <label> for the hidden input so
                              the browser treats the activation as a direct
                              user gesture even inside iframes */}
                          {!cell.imageUrl &&
                            !isUploading &&
                            !hasError && (
                              <label
                                htmlFor={`file-${key}`}
                                aria-label={`Upload ${group.colorValue} ${viewLabel}`}
                                style={{
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 28,
                                  height: 28,
                                  borderRadius: 4,
                                  color: "var(--p-color-text-subdued)",
                                }}
                              >
                                {/* Plus icon inline so the label has visible content */}
                                <svg
                                  viewBox="0 0 20 20"
                                  width="16"
                                  height="16"
                                  fill="currentColor"
                                  aria-hidden="true"
                                  focusable="false"
                                >
                                  <path d="M11 9V5H9v4H5v2h4v4h2v-4h4V9h-4z" />
                                </svg>
                              </label>
                            )}

                          {/* Uploaded image — show actions popover */}
                          {cell.imageUrl &&
                            !cell.isDefault &&
                            !isUploading &&
                            !hasError && (
                              <div
                                role="presentation"
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  right: 4,
                                }}
                              >
                                <Popover
                                  active={
                                    copyPopoverCell === key
                                  }
                                  activator={
                                    <Button
                                      size="slim"
                                      variant="plain"
                                      onClick={() => {
                                        setCopyPopoverCell(
                                          copyPopoverCell ===
                                            key
                                            ? null
                                            : key
                                        );
                                      }}
                                      accessibilityLabel="Image actions"
                                    >
                                      ⋯
                                    </Button>
                                  }
                                  onClose={() =>
                                    setCopyPopoverCell(null)
                                  }
                                >
                                  <ActionList
                                    items={[
                                      {
                                        content: "Replace",
                                        onAction: () => {
                                          fileInputRefs.current[
                                            key
                                          ]?.click();
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                      {
                                        content:
                                          "Set as view default",
                                        onAction: () => {
                                          handleSetViewDefault(
                                            cell
                                          );
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                      {
                                        content:
                                          "Apply to all empty",
                                        onAction: () => {
                                          handleApplyToAllEmpty(
                                            cell
                                          );
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                      ...sameColorOtherViews.map(
                                        (target: ImageCell) => ({
                                          content: `Copy to ${views.find((v: (typeof views)[number]) => v.id === target.viewId)?.perspective ?? target.viewId}`,
                                          onAction: () => {
                                            handleCopyToCell(cell, target);
                                            setCopyPopoverCell(null);
                                          },
                                        })
                                      ),
                                      ...sameViewOtherColors.map(
                                        (target: ImageCell) => ({
                                          content: `Copy to ${target.colorValue}`,
                                          onAction: () => {
                                            handleCopyToCell(cell, target);
                                            setCopyPopoverCell(null);
                                          },
                                        })
                                      ),
                                      {
                                        content: "Remove",
                                        destructive: true,
                                        onAction: () => {
                                          handleRemoveImage(
                                            cell
                                          );
                                          setCopyPopoverCell(
                                            null
                                          );
                                        },
                                      },
                                    ]}
                                  />
                                </Popover>
                              </div>
                            )}
                        </div>

                        {/* Default badge below cell */}
                        {cell.isDefault &&
                          cell.imageUrl &&
                          !isUploading && (
                            <Badge tone="info" size="small">
                              Default
                            </Badge>
                          )}
                      </BlockStack>
                    );
                  })}
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}

      </BlockStack>
    </Page>
  );
}
