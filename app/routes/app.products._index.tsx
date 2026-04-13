/**
 * Product Configs List Page
 * 
 * Displays all product configurations and allows creating new ones.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link, useNavigate, redirect } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Modal,
  FormLayout,
  TextField,
  Banner,
  EmptyState,
  BlockStack,
  InlineStack,
  Box,
  Divider,
  IndexTable,
  IndexFilters,
  useSetIndexFiltersMode,
} from "@shopify/polaris";

import { z } from "zod";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  listProductConfigs,
  createProductConfig,
  duplicateProductConfig,
  CreateProductConfigSchema,
} from "../lib/services/product-configs.server";

const DuplicateInputSchema = z.object({
  duplicateFromId: z.string().min(1, "Source config ID is required"),
  name: z.string().min(1, "Name is required").max(200),
  productIds: z.array(z.string().min(1)).min(1, "At least one product required"),
});

import { listMethods } from "../lib/services/methods.server";
import { handleError, validateOrThrow } from "../lib/errors.server";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    shop = await db.shop.create({
      data: {
        shopifyDomain: session.shop,
        accessToken: session.accessToken || "",
      },
      select: { id: true },
    });
  }

  const [configs, methods] = await Promise.all([
    listProductConfigs(shop.id),
    listMethods(shop.id),
  ]);

  return { configs, methods, shopId: shop.id };
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const productIds = JSON.parse(formData.get("productIds") as string || "[]");
    const methodIds = JSON.parse(formData.get("methodIds") as string || "[]");
    const duplicateFromId = (formData.get("duplicateFromId") as string | null) || null;

    // Duplicate path: copy views + placements + pricing from source config
    if (duplicateFromId) {
      const duplicateInput = validateOrThrow(
        DuplicateInputSchema,
        { duplicateFromId, name, productIds },
        "Invalid duplicate input"
      );
      const config = await duplicateProductConfig(
        shop.id,
        duplicateInput.duplicateFromId,
        duplicateInput.name,
        duplicateInput.productIds
      );
      return redirect(`/app/products/${config.id}`);
    }

    // Blank path: create config with empty placements
    const input = validateOrThrow(
      CreateProductConfigSchema,
      { name, linkedProductIds: productIds, allowedMethodIds: methodIds, presetKey: null },
      "Invalid config data"
    );

    const config = await createProductConfig(shop.id, input);

    return redirect(`/app/products/${config.id}`);
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Component
// ============================================================================

const SORT_OPTIONS = [
  { label: "Name", value: "name asc", directionLabel: "A–Z" },
  { label: "Name", value: "name desc", directionLabel: "Z–A" },
  { label: "Products", value: "products asc", directionLabel: "Low to high" },
  { label: "Products", value: "products desc", directionLabel: "High to low" },
  { label: "Views", value: "views asc", directionLabel: "Low to high" },
  { label: "Views", value: "views desc", directionLabel: "High to low" },
  { label: "Placements", value: "placements asc", directionLabel: "Low to high" },
  { label: "Placements", value: "placements desc", directionLabel: "High to low" },
] as const;

// ============================================================================
// Types for wizard state
// ============================================================================

type StartMethod = "duplicate" | "blank";

// Resource picker returns objects with at least id and title
interface PickedProduct {
  id: string;
  title: string;
  variants?: Array<{ id: string }>;
}

export default function ProductConfigsPage() {
  const { configs, methods } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { mode, setMode } = useSetIndexFiltersMode();

  // Table state
  const [queryValue, setQueryValue] = useState("");
  const [sortSelected, setSortSelected] = useState<string[]>(["name asc"]);

  // Wizard state
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: product selection
  const [pickedProducts, setPickedProducts] = useState<PickedProduct[]>([]);

  // Step 2: start method
  const [startMethod, setStartMethod] = useState<StartMethod>("duplicate");
  const [duplicateFromId, setDuplicateFromId] = useState<string>("");
  const [duplicateSearch, setDuplicateSearch] = useState<string>("");

  // Step 3: name + submit
  const [configName, setConfigName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = fetcher.state === "submitting" || fetcher.state === "loading";

  const filteredAndSortedConfigs = useMemo(() => {
    let list = configs;
    if (queryValue.trim()) {
      const q = queryValue.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    const [sortKey, sortDir] = (sortSelected[0] ?? "name asc").split(" ");
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "products":
          cmp = a.linkedProductIds.length - b.linkedProductIds.length;
          break;
        case "views":
          cmp = a.views.length - b.views.length;
          break;
        case "placements":
          cmp = a.placements.length - b.placements.length;
          break;
        default:
          cmp = a.name.localeCompare(b.name);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [configs, queryValue, sortSelected]);

  // Handle fetcher response (success redirects away; only handle errors here)
  useEffect(() => {
    if (fetcher.data && "error" in fetcher.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError((fetcher.data as Record<string, unknown> & { error?: { message?: string } }).error?.message || "Failed to create product setup");
    }
  }, [fetcher.data]);

  const handleSelectProducts = useCallback(async () => {
    try {
      const selected = await window.shopify.resourcePicker({
        type: "product",
        multiple: false,
        action: "select",
        filter: { variants: true },
        selectionIds: pickedProducts.map((p) => ({ id: p.id })),
        query: "NOT tag:insignia-fee",
      });
      if (selected && selected.length > 0) {
        const picked = selected as PickedProduct[];
        setPickedProducts(picked);
        // Pre-fill name from product title if not already set
        if (!configName.trim()) {
          setConfigName(picked[0].title ?? "");
        }
      }
    } catch (e) {
      console.error("ResourcePicker error:", e);
    }
  }, [pickedProducts, configName]);

  const handleCreateConfig = useCallback(() => {
    if (!configName.trim()) {
      setError("Name is required");
      return;
    }

    if (pickedProducts.length === 0) {
      setError("At least one product is required");
      return;
    }

    const productIds = pickedProducts.map((p) => p.id);

    if (startMethod === "duplicate" && duplicateFromId) {
      fetcher.submit(
        {
          name: configName.trim(),
          productIds: JSON.stringify(productIds),
          duplicateFromId,
        },
        { method: "POST" }
      );
    } else {
      // Blank path
      fetcher.submit(
        {
          name: configName.trim(),
          productIds: JSON.stringify(productIds),
          methodIds: JSON.stringify([]),
          duplicateFromId: "",
        },
        { method: "POST" }
      );
    }
  }, [configName, pickedProducts, startMethod, duplicateFromId, fetcher]);

  const handleModalOpen = useCallback(() => {
    setModalOpen(true);
    setStep(1);
    setPickedProducts([]);
    setStartMethod("duplicate");
    setDuplicateFromId("");
    setDuplicateSearch("");
    setConfigName("");
    setError(null);
  }, []);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setStep(1);
    setPickedProducts([]);
    setStartMethod("duplicate");
    setDuplicateFromId("");
    setDuplicateSearch("");
    setConfigName("");
    setError(null);
  }, []);

  const handleNext = useCallback(() => {
    if (step === 1) {
      if (pickedProducts.length === 0) {
        setError("Please select a product first");
        return;
      }
      setError(null);
      // Pre-fill name from product title when advancing past step 1
      if (!configName.trim() && pickedProducts.length > 0) {
        setConfigName(pickedProducts[0].title ?? "");
      }
      setStep(2);
    } else if (step === 2) {
      if (startMethod === "duplicate" && !duplicateFromId) {
        setError("Please select a setup to duplicate");
        return;
      }
      setError(null);
      setStep(3);
    }
  }, [step, pickedProducts, configName, startMethod, duplicateFromId]);

  const handleBack = useCallback(() => {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }, [step]);

  // Build modal primary/secondary actions based on current step
  const modalPrimaryAction = useMemo(() => {
    if (step === 3) {
      return {
        content: "Create setup",
        onAction: handleCreateConfig,
        loading: isSubmitting,
        disabled: !configName.trim() || isSubmitting,
      };
    }
    return {
      content: "Next",
      onAction: handleNext,
      disabled: step === 1 ? pickedProducts.length === 0 : (step === 2 && startMethod === "duplicate" && !duplicateFromId),
    };
  }, [step, handleCreateConfig, handleNext, isSubmitting, configName, pickedProducts, startMethod, duplicateFromId]);

  const modalSecondaryActions = useMemo(() => {
    const actions = [];
    if (step > 1) {
      actions.push({ content: "Back", onAction: handleBack });
    }
    actions.push({ content: "Cancel", onAction: handleModalClose });
    return actions;
  }, [step, handleBack, handleModalClose]);

  // Wizard step titles
  const stepTitle = step === 1 ? "Step 1 of 3 — Select a product" : step === 2 ? "Step 2 of 3 — How do you want to start?" : "Step 3 of 3 — Confirm setup";

  // Filtered configs for duplicate list
  const filteredDuplicateConfigs = useMemo(() => {
    if (!duplicateSearch.trim()) return configs;
    const q = duplicateSearch.trim().toLowerCase();
    return configs.filter((c) => c.name.toLowerCase().includes(q));
  }, [configs, duplicateSearch]);

  return (
    <Page
      title="Products"
      subtitle="Link products to decoration methods and customization options"
      primaryAction={{
        content: "Add Product Setup",
        onAction: handleModalOpen,
      }}
    >
      <Layout>
        {methods.length === 0 && (
          <Layout.Section>
            <Banner tone="warning">
              <p>
                You haven&apos;t created any decoration methods yet.{" "}
                <a href="/app/methods">Create a method</a> first to enable
                customization options.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          {configs.length === 0 ? (
            <Card>
              <EmptyState
                heading="Set up your first product"
                action={{ content: "Add product setup", onAction: handleModalOpen }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Configure which products customers can customize with logos and artwork.</p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <IndexFilters
                sortOptions={[...SORT_OPTIONS]}
                sortSelected={sortSelected}
                onSort={setSortSelected}
                queryValue={queryValue}
                queryPlaceholder="Search products"
                onQueryChange={setQueryValue}
                onQueryClear={() => setQueryValue("")}
                filters={[]}
                appliedFilters={[]}
                onClearAll={() => setQueryValue("")}
                hideFilters
                tabs={[{ id: "all", content: "All", isLocked: true }]}
                selected={0}
                onSelect={() => {}}
                mode={mode}
                setMode={setMode}
              />
              <IndexTable
                resourceName={{
                  singular: "product setup",
                  plural: "product setups",
                }}
                itemCount={filteredAndSortedConfigs.length}
                headings={[
                  { title: "Name" },
                  { title: "Products", alignment: "end" },
                  { title: "Views", alignment: "end" },
                  { title: "Print areas", alignment: "end" },
                  { title: "Methods" },
                ]}
                selectable={false}
                hasZebraStriping
                emptyState={
                  <EmptyState
                    heading="Set up your first product"
                    action={{ content: "Add product setup", onAction: handleModalOpen }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Configure which products customers can customize with logos and artwork.</p>
                  </EmptyState>
                }
              >
                {filteredAndSortedConfigs.map((config, index) => (
                  <IndexTable.Row
                    key={config.id}
                    id={config.id}
                    position={index}
                    onNavigation={(id) => navigate(`/app/products/${id}`)}
                  >
                    <IndexTable.Cell>
                      <Link
                        to={`/app/products/${config.id}`}
                        data-primary-link
                        style={{ color: "inherit", textDecoration: "none" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                          {config.name}
                        </Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" as="span" alignment="end" numeric>
                        {String(config.linkedProductIds.length)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" as="span" alignment="end" numeric>
                        {String(config.views.length)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" as="span" alignment="end" numeric>
                        {String(config.placements.length)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" as="span" tone={config.allowedMethods.length > 0 ? undefined : "subdued"}>
                        {config.allowedMethods.length > 0
                          ? config.allowedMethods.map((m) => m.decorationMethod.name).join(", ")
                          : "—"}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={handleModalClose}
        title="Add Product Setup"
        primaryAction={modalPrimaryAction}
        secondaryActions={modalSecondaryActions}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodySm" as="p" tone="subdued">
              {stepTitle}
            </Text>
            <Divider />

            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            {/* ── Step 1: Pick a product ── */}
            {step === 1 && (
              <BlockStack gap="400">
                <Text variant="bodyMd" as="p">
                  Choose the Shopify product you want to set up for customization.
                </Text>
                <Button onClick={handleSelectProducts} size="large">
                  {pickedProducts.length > 0
                    ? "Change product"
                    : "Select a product"}
                </Button>
                {pickedProducts.length > 0 && (
                  <Box
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="semibold" as="p">
                        {pickedProducts[0].title}
                      </Text>
                      {pickedProducts[0].variants && (
                        <Text variant="bodySm" as="p" tone="subdued">
                          {pickedProducts[0].variants.length}{" "}
                          {pickedProducts[0].variants.length === 1 ? "variant" : "variants"}
                        </Text>
                      )}
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            )}

            {/* ── Step 2: Choose start method ── */}
            {step === 2 && (
              <BlockStack gap="400">
                <Text variant="bodyMd" fontWeight="semibold" as="p">
                  How do you want to start?
                </Text>

                {/* Duplicate existing card */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={startMethod === "duplicate"}
                  onClick={() => { setStartMethod("duplicate"); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStartMethod("duplicate"); setError(null); } }}
                  style={{
                    border: `2px solid ${startMethod === "duplicate" ? "#005bd3" : "#e1e3e5"}`,
                    borderRadius: "8px",
                    padding: "12px 16px",
                    cursor: "pointer",
                    background: startMethod === "duplicate" ? "#f0f5ff" : "#ffffff",
                    outline: "none",
                  }}
                >
                  <BlockStack gap="100">
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <div style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        border: `2px solid ${startMethod === "duplicate" ? "#005bd3" : "#8c9196"}`,
                        background: startMethod === "duplicate" ? "#005bd3" : "transparent",
                        flexShrink: 0,
                        position: "relative",
                      }}>
                        {startMethod === "duplicate" && (
                          <div style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#ffffff",
                          }} />
                        )}
                      </div>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        Duplicate existing setup
                      </Text>
                    </InlineStack>
                    <Box paddingInlineStart="600">
                      <Text variant="bodySm" as="p" tone="subdued">
                        Copy views, print areas, and pricing from another setup
                      </Text>
                    </Box>
                  </BlockStack>
                </div>

                {/* Duplicate config selector — visible only when duplicate is selected */}
                {startMethod === "duplicate" && (
                  <Box paddingInlineStart="0">
                    <BlockStack gap="200">
                      <TextField
                        label="Search setups"
                        labelHidden
                        placeholder="Search setups..."
                        value={duplicateSearch}
                        onChange={setDuplicateSearch}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => setDuplicateSearch("")}
                      />
                      {configs.length === 0 ? (
                        <Box
                          background="bg-surface-secondary"
                          padding="400"
                          borderRadius="200"
                        >
                          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
                            No existing setups to duplicate
                          </Text>
                        </Box>
                      ) : (
                        <div style={{
                          border: "1px solid #e1e3e5",
                          borderRadius: "8px",
                          overflow: "hidden",
                          maxHeight: "220px",
                          overflowY: "auto",
                        }}>
                          {filteredDuplicateConfigs.length === 0 ? (
                            <Box padding="400">
                              <Text variant="bodySm" as="p" tone="subdued" alignment="center">
                                No setups match your search
                              </Text>
                            </Box>
                          ) : (
                            filteredDuplicateConfigs.map((config, idx) => (
                              <div
                                key={config.id}
                                role="button"
                                tabIndex={0}
                                aria-pressed={duplicateFromId === config.id}
                                onClick={(e) => { e.stopPropagation(); setDuplicateFromId(config.id); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDuplicateFromId(config.id); } }}
                                style={{
                                  padding: "10px 14px",
                                  cursor: "pointer",
                                  background: duplicateFromId === config.id ? "#e8f0fe" : idx % 2 === 0 ? "#ffffff" : "#fafbfb",
                                  borderBottom: idx < filteredDuplicateConfigs.length - 1 ? "1px solid #e1e3e5" : "none",
                                  borderLeft: `3px solid ${duplicateFromId === config.id ? "#005bd3" : "transparent"}`,
                                  outline: "none",
                                  transition: "background 0.1s",
                                }}
                              >
                                <BlockStack gap="050">
                                  <Text variant="bodyMd" fontWeight={duplicateFromId === config.id ? "semibold" : "regular"} as="p">
                                    {config.name}
                                  </Text>
                                  <InlineStack gap="300">
                                    <Text variant="bodySm" as="span" tone="subdued">
                                      {config.views.length} {config.views.length === 1 ? "view" : "views"}
                                    </Text>
                                    <Text variant="bodySm" as="span" tone="subdued">
                                      {config.placements.length} {config.placements.length === 1 ? "placement" : "placements"}
                                    </Text>
                                    {config.allowedMethods.length > 0 && (
                                      <Text variant="bodySm" as="span" tone="subdued">
                                        {config.allowedMethods.map((m) => m.decorationMethod.name).join(", ")}
                                      </Text>
                                    )}
                                  </InlineStack>
                                </BlockStack>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      <Banner tone="success">
                        <p>Copies all views, print areas, positions, and pricing</p>
                      </Banner>
                    </BlockStack>
                  </Box>
                )}

                {/* Blank card */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={startMethod === "blank"}
                  onClick={() => { setStartMethod("blank"); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStartMethod("blank"); setError(null); } }}
                  style={{
                    border: `2px solid ${startMethod === "blank" ? "#005bd3" : "#e1e3e5"}`,
                    borderRadius: "8px",
                    padding: "12px 16px",
                    cursor: "pointer",
                    background: startMethod === "blank" ? "#f0f5ff" : "#ffffff",
                    outline: "none",
                  }}
                >
                  <BlockStack gap="100">
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <div style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        border: `2px solid ${startMethod === "blank" ? "#005bd3" : "#8c9196"}`,
                        background: startMethod === "blank" ? "#005bd3" : "transparent",
                        flexShrink: 0,
                        position: "relative",
                      }}>
                        {startMethod === "blank" && (
                          <div style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#ffffff",
                          }} />
                        )}
                      </div>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        Start blank
                      </Text>
                    </InlineStack>
                    <Box paddingInlineStart="600">
                      <Text variant="bodySm" as="p" tone="subdued">
                        Empty setup, configure from scratch
                      </Text>
                    </Box>
                  </BlockStack>
                </div>
              </BlockStack>
            )}

            {/* ── Step 3: Confirm ── */}
            {step === 3 && (
              <BlockStack gap="400">
                <FormLayout>
                  <TextField
                    label="Setup name"
                    value={configName}
                    onChange={setConfigName}
                    autoComplete="off"
                    placeholder="e.g., T-Shirts Collection"
                    helpText="A descriptive name for this product setup"
                  />
                </FormLayout>

                <Box
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold" as="p">
                      Summary
                    </Text>
                    <InlineStack gap="200" align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Product</Text>
                      <Text variant="bodySm" as="span">
                        {pickedProducts[0]?.title ?? "—"}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200" align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Start from</Text>
                      <Text variant="bodySm" as="span">
                        {startMethod === "duplicate"
                          ? `Duplicate: ${configs.find((c) => c.id === duplicateFromId)?.name ?? duplicateFromId}`
                          : "Blank (manual setup)"}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
