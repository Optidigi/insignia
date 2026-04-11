/**
 * Decoration Method Detail Page
 *
 * AnnotatedSection layout: General, Pricing, Artwork Constraints,
 * Linked Products (read-only), and Danger Zone.
 * Uses Shopify SaveBar for unsaved-changes UX.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
  redirect,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  Banner,
  Modal,
  BlockStack,
  Text,
  Checkbox,
  Link,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  updateMethod,
  deleteMethod,
} from "../lib/services/methods.server";
import { handleError, AppError } from "../lib/errors.server";
import { currencySymbol } from "../lib/services/shop-currency.server";

// ============================================================================
// Types
// ============================================================================

interface ArtworkConstraints {
  fileTypes?: string[];
  maxColors?: number;
  minDpi?: number;
}

interface ProductConfigLink {
  productConfig: {
    id: string;
    name: string;
  };
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    throw new Response("Method ID required", { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const currency = currencySymbol(shop.currencyCode);

  try {
    const method = await db.decorationMethod.findFirst({
      where: { id, shopId: shop.id },
      include: {
        productConfigs: {
          include: {
            productConfig: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!method) {
      throw new Response("Method not found", { status: 404 });
    }

    return { method, shopId: shop.id, currency };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError && error.status === 404) {
      throw new Response("Method not found", { status: 404 });
    }
    throw error;
  }
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const { id } = params;

    if (!id) {
      throw new Response("Method ID required", { status: 400 });
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
      await deleteMethod(shop.id, id);
      return redirect("/app/methods");
    }

    if (intent === "update") {
      const name = formData.get("name") as string;
      const description = formData.get("description") as string | null;
      const customerName = formData.get("customerName") as string | null;
      const basePriceCents =
        parseInt(formData.get("basePriceCents") as string ?? "0", 10) || 0;
      const fileTypesRaw = formData.getAll("fileTypes") as string[];
      const maxColorsRaw = formData.get("maxColors") as string | null;
      const minDpiRaw = formData.get("minDpi") as string | null;

      const artworkConstraints: ArtworkConstraints = {
        fileTypes: fileTypesRaw,
        maxColors: maxColorsRaw ? parseInt(maxColorsRaw, 10) : undefined,
        minDpi: minDpiRaw ? parseInt(minDpiRaw, 10) : undefined,
      };

      const hasConstraints =
        fileTypesRaw.length > 0 ||
        artworkConstraints.maxColors !== undefined ||
        artworkConstraints.minDpi !== undefined;

      await updateMethod(shop.id, id, {
        name,
        description: description || null,
        customerName: customerName || null,
        basePriceCents,
        artworkConstraints: hasConstraints ? (artworkConstraints as Parameters<typeof updateMethod>[2]["artworkConstraints"]) : null,
      });

      return { success: true, intent: "update" };
    }

    throw new Response("Invalid intent", { status: 400 });
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// File type options (vector first, then raster)
// ============================================================================

const FILE_TYPE_OPTIONS = [
  "svg",
  "png",
  "jpg",
  "pdf",
  "ai",
  "eps",
  "webp",
  "tiff",
  "gif",
  "heic",
] as const;

// ============================================================================
// Component
// ============================================================================

export default function MethodDetailPage() {
  const { method, currency } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const loaderConstraints = (method.artworkConstraints as ArtworkConstraints | null) ?? {};

  // -- Form state -----------------------------------------------------------
  const [name, setName] = useState(method.name);
  const [description, setDescription] = useState(method.description ?? "");
  const [customerName, setCustomerName] = useState(method.customerName ?? "");
  const [priceRaw, setPriceRaw] = useState(() => {
    const initial = method.basePriceCents;
    return initial > 0 ? String((initial / 100).toFixed(2)) : "";
  });
  const [basePriceCents, setBasePriceCents] = useState(method.basePriceCents);
  const [fileTypes, setFileTypes] = useState<string[]>(
    loaderConstraints.fileTypes ?? [],
  );
  const [maxColors, setMaxColors] = useState<number | undefined>(
    loaderConstraints.maxColors ?? undefined,
  );
  const [minDpi, setMinDpi] = useState<number | undefined>(
    loaderConstraints.minDpi ?? undefined,
  );
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = navigation.state === "submitting";

  // -- Change detection ------------------------------------------------------
  const hasChanges = useMemo(() => {
    if (name !== method.name) return true;
    if (description !== (method.description ?? "")) return true;
    if (customerName !== (method.customerName ?? "")) return true;
    if (basePriceCents !== method.basePriceCents) return true;

    const origFileTypes = loaderConstraints.fileTypes ?? [];
    if (
      fileTypes.length !== origFileTypes.length ||
      fileTypes.some((ft) => !origFileTypes.includes(ft))
    )
      return true;

    if (maxColors !== (loaderConstraints.maxColors ?? undefined)) return true;
    if (minDpi !== (loaderConstraints.minDpi ?? undefined)) return true;

    return false;
  }, [
    name,
    description,
    customerName,
    basePriceCents,
    fileTypes,
    maxColors,
    minDpi,
    method,
    loaderConstraints,
  ]);

  // -- SaveBar ---------------------------------------------------------------
  useEffect(() => {
    const shopify = window.shopify;
    if (hasChanges) {
      shopify?.saveBar?.show("method-save-bar");
    } else {
      shopify?.saveBar?.hide("method-save-bar");
    }
    return () => { shopify?.saveBar?.hide("method-save-bar"); };
  }, [hasChanges]);

  // -- Toast on success ------------------------------------------------------
  useEffect(() => {
    if (actionData && "success" in actionData) {
      window.shopify?.toast?.show("Method saved");
    }
  }, [actionData]);

  // -- Handlers --------------------------------------------------------------
  const handleSave = useCallback(() => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("name", name.trim());
    formData.append("description", description);
    formData.append("customerName", customerName);
    formData.append("basePriceCents", String(basePriceCents));
    for (const ft of fileTypes) {
      formData.append("fileTypes", ft);
    }
    if (maxColors !== undefined) {
      formData.append("maxColors", String(maxColors));
    }
    if (minDpi !== undefined) {
      formData.append("minDpi", String(minDpi));
    }

    submit(formData, { method: "POST" });
    setError(null);
  }, [
    name,
    description,
    customerName,
    basePriceCents,
    fileTypes,
    maxColors,
    minDpi,
    submit,
  ]);

  const handleDiscard = useCallback(() => {
    setName(method.name);
    setDescription(method.description ?? "");
    setCustomerName(method.customerName ?? "");
    setBasePriceCents(method.basePriceCents);
    setPriceRaw(method.basePriceCents > 0 ? String((method.basePriceCents / 100).toFixed(2)) : "");
    setFileTypes(loaderConstraints.fileTypes ?? []);
    setMaxColors(loaderConstraints.maxColors ?? undefined);
    setMinDpi(loaderConstraints.minDpi ?? undefined);
    setError(null);
  }, [method, loaderConstraints]);

  const handleDelete = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "POST" });
    setDeleteModalOpen(false);
  }, [submit]);

  const handleFileTypeToggle = useCallback(
    (ft: string, checked: boolean) => {
      setFileTypes((prev) =>
        checked ? [...prev, ft] : prev.filter((t) => t !== ft),
      );
    },
    [],
  );

  // Cast productConfigs for rendering
  const productConfigs = method.productConfigs as ProductConfigLink[];

  // -- Price helpers ----------------------------------------------------------
  const handlePriceChange = useCallback((val: string) => {
    setPriceRaw(val);
  }, []);

  const handlePriceBlur = useCallback(() => {
    const parsed = parseFloat(priceRaw || "0");
    const cents = isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100));
    setBasePriceCents(cents);
    setPriceRaw(cents > 0 ? (cents / 100).toFixed(2) : "");
  }, [priceRaw]);

  return (
    <Page
      title={method.name}
      subtitle="Decoration method"
      backAction={{ content: "Decoration methods", url: "/app/methods" }}
      primaryAction={{
        content: "Save",
        disabled: !hasChanges,
        loading: isSubmitting,
        onAction: handleSave,
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical">
              <p>
                {(actionData as { error?: { message?: string } }).error?.message ?? "Something went wrong"}
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Section 1 -- General */}
        <Layout.AnnotatedSection
          title="General"
          description="Name and description for this decoration method."
        >
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Name"
                value={name}
                onChange={setName}
                autoComplete="off"
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                multiline={3}
                autoComplete="off"
                helpText="Describe this decoration method to help merchants and customers understand it."
              />
              <TextField
                label="Storefront display name"
                value={customerName}
                onChange={setCustomerName}
                autoComplete="off"
                helpText="Shown to customers in the method selector. Defaults to the name above if left empty."
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* Section 2 -- Pricing */}
        <Layout.AnnotatedSection
          title="Pricing"
          description="Base price added to every order using this method."
        >
          <Card>
            <TextField
              label="Base price"
              type="number"
              value={priceRaw}
              onChange={handlePriceChange}
              onBlur={handlePriceBlur}
              prefix={currency}
              autoComplete="off"
              helpText="Added on top of the product price and placement pricing."
            />
          </Card>
        </Layout.AnnotatedSection>

        {/* Section 3 -- Artwork Constraints */}
        <Layout.AnnotatedSection
          title="Artwork constraints"
          description="File types and quality requirements for customer uploads."
        >
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="semibold" as="p">
                  Accepted file types
                </Text>
                {FILE_TYPE_OPTIONS.map((ft) => (
                  <Checkbox
                    key={ft}
                    label={ft.toUpperCase()}
                    checked={fileTypes.includes(ft)}
                    onChange={(checked) => handleFileTypeToggle(ft, checked)}
                  />
                ))}
              </BlockStack>
              <TextField
                label="Max color count"
                type="number"
                value={maxColors !== undefined ? String(maxColors) : ""}
                onChange={(val) =>
                  setMaxColors(val === "" ? undefined : parseInt(val, 10))
                }
                autoComplete="off"
                helpText="e.g. 12 for embroidery, 6 for screen print. Leave blank for no limit."
              />
              <TextField
                label="Minimum DPI"
                type="number"
                value={minDpi !== undefined ? String(minDpi) : ""}
                onChange={(val) =>
                  setMinDpi(val === "" ? undefined : parseInt(val, 10))
                }
                autoComplete="off"
                helpText="e.g. 300 for print. Leave blank for no requirement."
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* Section 4 -- Linked Products (read-only) */}
        <Layout.AnnotatedSection
          title="Linked products"
          description="Product setups that use this method."
        >
          <Card>
            {productConfigs.length === 0 ? (
              <Text tone="subdued" as="p">
                No products linked yet.
              </Text>
            ) : (
              <BlockStack gap="200">
                {productConfigs.map((pm) => (
                  <Link
                    key={pm.productConfig.id}
                    url={`/app/products/${pm.productConfig.id}`}
                    removeUnderline
                  >
                    {pm.productConfig.name}
                  </Link>
                ))}
              </BlockStack>
            )}
          </Card>
        </Layout.AnnotatedSection>

        {/* Section 5 -- Danger Zone */}
        <Layout.AnnotatedSection
          title="Delete method"
          description="Permanently remove this decoration method. This cannot be undone."
        >
          <Card>
            <BlockStack gap="300">
              {productConfigs.length > 0 && (
                <Banner tone="warning">
                  <p>
                    This method is linked to {productConfigs.length} product
                    setup{productConfigs.length === 1 ? "" : "s"}. Unlink this
                    method from all products before deleting.
                  </p>
                </Banner>
              )}
              <div>
                <Button
                  tone="critical"
                  disabled={productConfigs.length > 0}
                  onClick={() => setDeleteModalOpen(true)}
                >
                  Delete method
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>
      </Layout>

      {/* SaveBar (Shopify embedded) */}
      <ui-save-bar id="method-save-bar">
        <button
          variant="primary"
          onClick={handleSave}
          disabled={isSubmitting || undefined}
        />
        <button onClick={handleDiscard} disabled={isSubmitting || undefined} />
      </ui-save-bar>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={`Delete "${method.name}"?`}
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete &quot;{method.name}&quot;?
            {productConfigs.length > 0 &&
              ` It will be removed from ${productConfigs.length} product setup${productConfigs.length === 1 ? "" : "s"}.`}{" "}
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
